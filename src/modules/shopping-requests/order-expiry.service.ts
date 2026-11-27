import { Inject, Injectable } from '@nestjs/common';
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
@Injectable()
export class OrderExpiryService {
  constructor(
    @Inject(SHOPPER_ORDER_REPOSITORY) private readonly orders: IShopperOrderRepository,
    private readonly config: ShoppingConfigService,
    private readonly events: EventEmitter2,
  ) {}

  /** Minutes a shopper has to accept an ASSIGNED order, from the config. */
  async acceptWindowMinutes(): Promise<number> {
    return (await this.config.getRules()).shopperAcceptWindowMinutes;
  }

  /** Cancel every stale ASSIGNED order in `scope`, telling each shopper. */
  async sweep(scope: IExpireScope): Promise<void> {
    const rules = await this.config.getRules();
    const now = Date.now();
    const cancelled = await this.orders.expireStale(
      scope,
      new Date(now - rules.shopperAcceptWindowMinutes * 60_000),
      new Date(now + rules.offerWindowMinutes * 60_000),
    );
    for (const info of cancelled) {
      this.announce(info);
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
