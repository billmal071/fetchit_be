import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS } from '@/common/constants';
import { ShopperApprovedEvent, ShopperSentBackEvent } from '@/common/events';
import { NotificationsService } from '@/modules/notifications/notifications.service';

const MAX_REASON_LENGTH = 200;

const truncate = (text: string | null | undefined, max: number): string => {
  if (typeof text !== 'string') return '';
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
};

/**
 * In-app notification counterpart of ShopperEventsListener (email) and
 * ShopperPushListener (Web Push). NotificationsService.create never throws.
 */
@Injectable()
export class ShopperNotificationListener {
  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(EVENTS.SHOPPER_APPROVED)
  async handleShopperApproved(event: ShopperApprovedEvent): Promise<void> {
    await this.notifications.create(event.userId, {
      type: 'shopper.approved',
      title: 'Application approved',
      body: 'You can now go online and start receiving requests.',
      href: '/shopper',
      data: { shopperProfileId: event.shopperProfileId },
    });
  }

  @OnEvent(EVENTS.SHOPPER_SENT_BACK)
  async handleShopperSentBack(event: ShopperSentBackEvent): Promise<void> {
    await this.notifications.create(event.userId, {
      type: 'shopper.sent_back',
      title: 'Application needs changes',
      body: truncate(event.reason, MAX_REASON_LENGTH),
      href: '/shopper/onboarding',
      data: { shopperProfileId: event.shopperProfileId },
    });
  }
}
