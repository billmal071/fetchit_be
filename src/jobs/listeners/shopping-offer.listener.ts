import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS } from '@/common/constants';
import { ShoppingOfferSubmittedEvent } from '@/common/events';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PushService } from '@/modules/push/push.service';

const naira = (amount: number): string => `₦${amount.toLocaleString('en-NG')}`;

/**
 * Tells a customer a shopper bid on their request: an in-app notification
 * (NotificationsService.create never throws) and a Web Push. Each channel is
 * independent; one failing never blocks the other or the submit that emitted.
 */
@Injectable()
export class ShoppingOfferListener {
  private readonly logger = new Logger(ShoppingOfferListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly pushService: PushService,
  ) {}

  @OnEvent(EVENTS.SHOPPING_OFFER_SUBMITTED)
  async handleOfferSubmitted(event: ShoppingOfferSubmittedEvent): Promise<void> {
    const href = `/customer/shopping-requests/${event.requestId}`;
    const body = `${event.shopperName} offered to shop for ${naira(event.customerTotal)} total (shopper fee ${naira(event.shopperFee)}).`;

    await this.notifications.create(event.customerId, {
      type: 'shopping.offer.received',
      title: `New offer on ${event.requestReference}`,
      body,
      href,
      data: { requestId: event.requestId, offerId: event.offerId },
    });

    try {
      await this.pushService.sendToUser(event.customerId, {
        title: `New offer on ${event.requestReference}`,
        body,
        url: href,
        tag: `shopping-request-${event.requestId}`,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send offer push for request ${event.requestId}:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
