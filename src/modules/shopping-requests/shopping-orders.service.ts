import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CustomerOrder,
  IShopperOrderRepository,
  SHOPPER_ORDER_REPOSITORY,
} from '@/database/repositories';
import { EVENTS } from '@common/constants';
import { ShoppingOfferAcceptedEvent } from '@common/events';
import { ConflictException } from '@common/exceptions/base.exception';
import { ResourceNotFoundException } from '@common/exceptions/domain.exception';
import { IPaginatedResult } from '@common/interfaces';
import { createPaginationMeta } from '@common/utils/pagination.util';
import { AuditService } from '@common/services/audit.service';
import {
  CustomerOrderDetailResponseDto,
  CustomerOrderResponseDto,
  OrderEventResponseDto,
  OrderQueryDto,
} from './dto';
import { toCustomerOrder, toCustomerOrderDetail, toOrderEvent } from './order.mapper';

const words = (state: string): string => state.toLowerCase().replace(/_/g, ' ');

/** The customer side of orders: accepting an offer, and reading the result. */
@Injectable()
export class ShoppingOrdersService {
  private readonly logger = new Logger(ShoppingOrdersService.name);

  constructor(
    @Inject(SHOPPER_ORDER_REPOSITORY) private readonly orders: IShopperOrderRepository,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  /**
   * Accept an offer: the order is created UNPAID. Nothing is charged: payment,
   * escrow and wallet are Part C and do not exist yet. The money on the order is
   * the accepted offer's stored breakdown, copied; the client sends none of it.
   */
  async acceptOffer(
    customerId: string,
    requestId: string,
    offerId: string,
  ): Promise<{ data: CustomerOrderResponseDto; created: boolean }> {
    const result = await this.orders.acceptOffer({ requestId, offerId, customerId });
    switch (result.outcome) {
      case 'already_accepted':
        // A retry: same order back, and no second audit entry or notification.
        return { data: toCustomerOrder(result.order), created: false };
      case 'shopper_unavailable':
        throw new ConflictException('This shopper is no longer available; choose another offer');
      case 'not_found':
        throw new ResourceNotFoundException('Offer', offerId);
      case 'request_not_open':
        throw new ConflictException(
          `This request is no longer open for offers; it is ${words(result.status)}`,
        );
      case 'offer_not_pending':
        throw new ConflictException(
          `This offer can no longer be accepted; it is ${words(result.state)}`,
        );
      case 'offer_expired':
        throw new ConflictException('This offer has expired and can no longer be accepted');
    }

    const { order } = result;
    await this.record(customerId, order.id, {
      reference: order.reference,
      requestId,
      offerId,
      rejectedOffers: result.rejected.length,
    });
    this.events.emit(
      EVENTS.SHOPPING_OFFER_ACCEPTED,
      new ShoppingOfferAcceptedEvent(
        order.id,
        order.reference,
        requestId,
        result.requestReference,
        result.winnerUserId,
        result.rejected.map((r) => r.userId),
      ),
    );
    return { data: toCustomerOrder(order), created: true };
  }

  async list(
    customerId: string,
    query: OrderQueryDto,
  ): Promise<IPaginatedResult<CustomerOrderResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const { rows, total } = await this.orders.listForCustomer(
      customerId,
      (page - 1) * limit,
      limit,
      query.filter,
    );
    return { data: rows.map(toCustomerOrder), meta: createPaginationMeta(page, limit, total) };
  }

  async findOne(customerId: string, id: string): Promise<CustomerOrderDetailResponseDto> {
    const order = await this.owned(customerId, id);
    return toCustomerOrderDetail(order, await this.orders.listEvents(id, 'desc'));
  }

  async listEvents(customerId: string, id: string): Promise<OrderEventResponseDto[]> {
    await this.owned(customerId, id);
    return (await this.orders.listEvents(id, 'desc')).map(toOrderEvent);
  }

  private async owned(customerId: string, id: string): Promise<CustomerOrder> {
    const order = await this.orders.findOwnedByCustomer(id, customerId);
    if (!order) {
      throw new ResourceNotFoundException('Order', id);
    }
    return order;
  }

  private async record(
    userId: string,
    entityId: string,
    details: Record<string, string | number>,
  ): Promise<void> {
    try {
      await this.audit.log({
        userId,
        action: 'SHOPPING_OFFER_ACCEPTED',
        entity: 'ShopperOrder',
        entityId,
        details,
      });
    } catch (error) {
      this.logger.error(`Failed to record offer acceptance for order ${entityId}: ${error}`);
    }
  }
}
