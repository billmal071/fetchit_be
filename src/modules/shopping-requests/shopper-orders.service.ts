import { Inject, Injectable, Logger } from '@nestjs/common';
import { OrderState, ShopperAccountState } from '@prisma/client';
import {
  IShopperOrderRepository,
  IShopperProfileRepository,
  ORDER_EVENT_TYPES,
  OrderTransitionResult,
  SHOPPER_ORDER_REPOSITORY,
  SHOPPER_PROFILE_REPOSITORY,
  ShopperOrderForShopper,
} from '@/database/repositories';
import { ConflictException, ForbiddenException } from '@common/exceptions/base.exception';
import { ResourceNotFoundException } from '@common/exceptions/domain.exception';
import { IPaginatedResult } from '@common/interfaces';
import { createPaginationMeta } from '@common/utils/pagination.util';
import { AuditService } from '@common/services/audit.service';
import { OrderEventResponseDto, OrderQueryDto, ShopperOrderResponseDto } from './dto';
import { toShopperOrder, toShopperOrderEvent } from './order.mapper';
import { OrderExpiryService } from './order-expiry.service';

const cancelledMessage = (cancelledBy: string | null): string =>
  cancelledBy === 'SYSTEM'
    ? 'This order was cancelled because it was not accepted in time'
    : 'This order was cancelled by the customer';

const words = (state: string): string => state.toLowerCase().replace(/_/g, ' ');

/**
 * The shopper side of orders. Only two transitions exist in this slice:
 * ASSIGNED -> SHOPPER_ACCEPTED -> SHOPPING_STARTED. An order that is not the
 * caller's reads as 404, never 403: it might as well not exist for them.
 */
@Injectable()
export class ShopperOrdersService {
  private readonly logger = new Logger(ShopperOrdersService.name);

  constructor(
    @Inject(SHOPPER_PROFILE_REPOSITORY) private readonly profiles: IShopperProfileRepository,
    @Inject(SHOPPER_ORDER_REPOSITORY) private readonly orders: IShopperOrderRepository,
    private readonly audit: AuditService,
    private readonly expiry: OrderExpiryService,
  ) {}

  async list(
    userId: string,
    query: OrderQueryDto,
  ): Promise<IPaginatedResult<ShopperOrderResponseDto>> {
    const profileId = await this.approvedProfileId(userId);
    await this.expiry.sweep({ shopperProfileId: profileId });
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const { rows, total } = await this.orders.listForShopper(
      profileId,
      (page - 1) * limit,
      limit,
      query.filter,
    );
    return { data: rows.map(toShopperOrder), meta: createPaginationMeta(page, limit, total) };
  }

  async findOne(userId: string, id: string): Promise<ShopperOrderResponseDto> {
    const profileId = await this.approvedProfileId(userId);
    await this.expiry.sweep({ orderId: id });
    return toShopperOrder(await this.owned(profileId, id));
  }

  /** Newest first. */
  async listEvents(userId: string, id: string): Promise<OrderEventResponseDto[]> {
    const profileId = await this.approvedProfileId(userId);
    await this.expiry.sweep({ orderId: id });
    await this.owned(profileId, id);
    return (await this.orders.listEvents(id, 'desc')).map(toShopperOrderEvent);
  }

  accept(userId: string, id: string): Promise<ShopperOrderResponseDto> {
    return this.move(userId, id, {
      from: OrderState.ASSIGNED,
      to: OrderState.SHOPPER_ACCEPTED,
      eventType: ORDER_EVENT_TYPES.SHOPPER_ACCEPTED,
      stamp: 'shopperAcceptedAt',
      enforceAcceptWindow: true,
      refusal: (state, cancelledBy) =>
        state === OrderState.CANCELLED
          ? cancelledMessage(cancelledBy)
          : `This order cannot be accepted: it is ${words(state)}. Only a newly assigned order can be accepted.`,
    });
  }

  start(userId: string, id: string): Promise<ShopperOrderResponseDto> {
    return this.move(userId, id, {
      from: OrderState.SHOPPER_ACCEPTED,
      to: OrderState.SHOPPING_STARTED,
      eventType: ORDER_EVENT_TYPES.SHOPPING_STARTED,
      stamp: 'shoppingStartedAt',
      refusal: (state, cancelledBy) =>
        state === OrderState.CANCELLED
          ? cancelledMessage(cancelledBy)
          : state === OrderState.ASSIGNED
            ? 'Accept this order before starting to shop'
            : `Shopping cannot be started: the order is ${words(state)}. Only an accepted order can be started.`,
    });
  }

  // ------------------------------------------------------------------ helpers

  /**
   * One conditional UPDATE decides the transition, so two concurrent calls
   * cannot both win: the loser gets 409 and writes no event.
   */
  private async move(
    userId: string,
    id: string,
    step: {
      from: OrderState;
      to: OrderState;
      eventType: string;
      stamp: 'shopperAcceptedAt' | 'shoppingStartedAt';
      /** Only the accept step is bound by the accept window; starting to shop is not. */
      enforceAcceptWindow?: boolean;
      refusal: (current: OrderState, cancelledBy: string | null) => string;
    },
  ): Promise<ShopperOrderResponseDto> {
    const profileId = await this.approvedProfileId(userId);
    // An order whose accept window has run out is cancelled now, so a late accept loses.
    await this.expiry.sweep({ orderId: id });
    const result: OrderTransitionResult = await this.orders.transition({
      id,
      shopperProfileId: profileId,
      actorId: userId,
      from: step.from,
      to: step.to,
      eventType: step.eventType,
      stamp: step.stamp,
      ...(step.enforceAcceptWindow && {
        acceptWindowMinutes: await this.expiry.acceptWindowMinutes(),
      }),
    });
    if (result.outcome === 'shopper_unavailable') {
      // Suspended after the check above: the same 403 as any non-approved shopper.
      throw new ForbiddenException('Only an approved shopper can work on orders');
    }
    if (result.outcome === 'accept_expired') {
      // The window ran out while the accept waited for its locks. Nothing was
      // written; run the same SYSTEM cancel the sweep would have, then refuse.
      await this.expiry.sweep({ orderId: id });
      throw new ConflictException(cancelledMessage('SYSTEM'));
    }
    if (result.outcome === 'not_found') {
      throw new ResourceNotFoundException('Order', id);
    }
    if (result.outcome === 'conflict') {
      throw new ConflictException(step.refusal(result.state, result.cancelledBy));
    }
    await this.record(userId, step.eventType, id, result.order.reference);
    return toShopperOrder(result.order);
  }

  private async owned(profileId: string, id: string): Promise<ShopperOrderForShopper> {
    const order = await this.orders.findOwnedByShopper(id, profileId);
    if (!order) {
      throw new ResourceNotFoundException('Order', id);
    }
    return order;
  }

  /** 403 unless APPROVED. */
  private async approvedProfileId(userId: string): Promise<string> {
    const profile = await this.profiles.ensureByUserId(userId);
    if (profile.accountState !== ShopperAccountState.APPROVED) {
      throw new ForbiddenException('Only an approved shopper can work on orders');
    }
    return profile.id;
  }

  private async record(
    userId: string,
    action: string,
    entityId: string,
    reference: string,
  ): Promise<void> {
    try {
      await this.audit.log({
        userId,
        action: `ORDER_${action}`,
        entity: 'ShopperOrder',
        entityId,
        details: { reference },
      });
    } catch (error) {
      this.logger.error(`Failed to record ${action} for order ${entityId}: ${error}`);
    }
  }
}
