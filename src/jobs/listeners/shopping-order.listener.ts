import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS } from '@/common/constants';
import { ShoppingOfferAcceptedEvent, ShoppingOrderCancelledEvent } from '@/common/events';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PushService } from '@/modules/push/push.service';

/**
 * Tells shoppers how a bid ended: the winner gets an in-app notification and a
 * Web Push; the shoppers who lost get a short in-app notification only.
 * NotificationsService.create never throws; a failing push never blocks the rest.
 */
@Injectable()
export class ShoppingOrderListener {
  private readonly logger = new Logger(ShoppingOrderListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly pushService: PushService,
  ) {}

  @OnEvent(EVENTS.SHOPPING_OFFER_ACCEPTED)
  async handleOfferAccepted(event: ShoppingOfferAcceptedEvent): Promise<void> {
    const href = `/shopper/orders/${event.orderId}`;
    const title = `You won ${event.requestReference}`;
    const body = `Your offer was accepted. Order ${event.orderReference} is ready for you to accept.`;

    await this.notifications.create(event.winnerUserId, {
      type: 'shopping.order.assigned',
      title,
      body,
      href,
      data: { orderId: event.orderId, requestId: event.requestId },
    });
    try {
      await this.pushService.sendToUser(event.winnerUserId, {
        title,
        body,
        url: href,
        tag: `shopping-order-${event.orderId}`,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send order push for order ${event.orderId}:`,
        error instanceof Error ? error.stack : error,
      );
    }

    for (const userId of event.rejectedUserIds) {
      await this.notifications.create(userId, {
        type: 'shopping.offer.rejected',
        title: 'Offer not selected',
        body: `The customer chose another shopper for ${event.requestReference}.`,
        href: '/shopper/offers',
        data: { requestId: event.requestId },
      });
    }
  }

  /**
   * The shopper learns their assigned order is gone: in-app and push. The
   * customer's reason is not in the event and is never passed on.
   */
  @OnEvent(EVENTS.SHOPPING_ORDER_CANCELLED)
  async handleOrderCancelled(event: ShoppingOrderCancelledEvent): Promise<void> {
    const href = `/shopper/orders/${event.orderId}`;
    const title = `Order ${event.orderReference} cancelled`;
    const body =
      event.cancelledBy === 'SYSTEM'
        ? 'It was cancelled because it was not accepted in time.'
        : 'The customer cancelled it before you accepted.';

    await this.notifications.create(event.shopperUserId, {
      type: 'shopping.order.cancelled',
      title,
      body,
      href,
      data: { orderId: event.orderId, requestId: event.requestId, cancelledBy: event.cancelledBy },
    });
    try {
      await this.pushService.sendToUser(event.shopperUserId, {
        title,
        body,
        url: href,
        tag: `shopping-order-${event.orderId}`,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send order cancelled push for order ${event.orderId}:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
