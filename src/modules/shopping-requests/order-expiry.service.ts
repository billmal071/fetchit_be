import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ICancelledOrderInfo,
  IExpireScope,
  IShopperOrderRepository,
  SHOPPER_ORDER_REPOSITORY,
} from '@/database/repositories';
import { EVENTS } from '@common/constants';
import { ShoppingOrderCancelledEvent } from '@common/events';
import { ShoppingConfigService } from './shopping-config.service';

/**
 * The accept timeout. There is no cron: an ASSIGNED order whose shopper has not
 * accepted within `shopperAcceptWindowMinutes` is cancelled (as SYSTEM) the next
 * time anyone looks at it or acts on it. The cancel itself is a conditional
 * update in the repository, so it races safely with the shopper accepting:
 * exactly one of the two wins.
 */
/** What is true of an order after its accept window expired during an accept. */
export type AcceptTimeoutOutcome =
  | 'CANCELLED_BY_SYSTEM'
  | 'CANCELLED_BY_CUSTOMER'
  | 'NOT_CANCELLED';

export interface IOrderWindows {
  acceptWindowMinutes: number;
  offerWindowMinutes: number;
}

@Injectable()
export class OrderExpiryService {
  private readonly logger = new Logger(OrderExpiryService.name);

  constructor(
    @Inject(SHOPPER_ORDER_REPOSITORY) private readonly orders: IShopperOrderRepository,
    private readonly config: ShoppingConfigService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Both windows, from ONE read of the config. A caller that needs several
   * decisions to agree (the accept path) reads them here once and passes them on.
   */
  async windows(): Promise<IOrderWindows> {
    const rules = await this.config.getRules();
    return {
      acceptWindowMinutes: rules.shopperAcceptWindowMinutes,
      offerWindowMinutes: rules.offerWindowMinutes,
    };
  }

  /** Cancel every stale ASSIGNED order in `scope`, telling each shopper. */
  async sweep(scope: IExpireScope, windows?: IOrderWindows): Promise<void> {
    const { acceptWindowMinutes, offerWindowMinutes } = windows ?? (await this.windows());
    const now = Date.now();
    const cancelled = await this.orders.expireStale(
      scope,
      new Date(now - acceptWindowMinutes * 60_000),
      new Date(now + offerWindowMinutes * 60_000),
    );
    for (const info of cancelled) {
      this.announce(info);
    }
  }

  /**
   * The follow-up to an accept that found its window expired: cancel THAT order
   * as SYSTEM with the cutoff the accept itself judged by, and report what is
   * actually true afterwards, so the caller never claims a cancellation that
   * did not happen. A cancel that fails (it rolled back) is logged, not thrown:
   * the order is still ASSIGNED and the next sweep retries it.
   */
  async cancelAfterAcceptTimeout(
    orderId: string,
    assignedBefore: Date,
    offerWindowMinutes: number,
  ): Promise<AcceptTimeoutOutcome> {
    try {
      const result = await this.orders.cancelOrder({
        orderId,
        actor: { kind: 'SYSTEM' },
        assignedBefore,
        reopenDeadline: new Date(Date.now() + offerWindowMinutes * 60_000),
      });
      if (result.outcome === 'cancelled') {
        this.announce(result);
        return 'CANCELLED_BY_SYSTEM';
      }
      if (result.outcome === 'already_cancelled') {
        return result.order.cancelledBy === 'CUSTOMER'
          ? 'CANCELLED_BY_CUSTOMER'
          : 'CANCELLED_BY_SYSTEM';
      }
      return 'NOT_CANCELLED';
    } catch (error) {
      this.logger.error(
        `Could not cancel order ${orderId} after its accept window expired: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return 'NOT_CANCELLED';
    }
  }

  /** The shopper is told; the customer's reason is deliberately not part of the event. */
  announce(info: ICancelledOrderInfo): void {
    this.events.emit(
      EVENTS.SHOPPING_ORDER_CANCELLED,
      new ShoppingOrderCancelledEvent(
        info.order.id,
        info.order.reference,
        info.order.requestId,
        info.requestReference,
        info.shopperUserId,
        info.cancelledBy,
      ),
    );
  }
}
