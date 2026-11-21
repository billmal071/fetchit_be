import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS } from '@/common/constants';
import { ShopperApprovedEvent, ShopperSentBackEvent } from '@/common/events';
import { PushService } from '@/modules/push/push.service';

const MAX_REASON_LENGTH = 120;

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** Web Push counterpart of ShopperEventsListener (which sends the emails). */
@Injectable()
export class ShopperPushListener {
  private readonly logger = new Logger(ShopperPushListener.name);

  constructor(private readonly pushService: PushService) {}

  @OnEvent(EVENTS.SHOPPER_APPROVED)
  async handleShopperApproved(event: ShopperApprovedEvent): Promise<void> {
    try {
      await this.pushService.sendToUser(event.userId, {
        title: 'Application approved',
        body: 'You can now go online and start receiving requests.',
        url: '/shopper',
        tag: 'shopper-application',
      });
    } catch (error) {
      this.logger.error(
        `Failed to send shopper approval push for profile ${event.shopperProfileId}:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  @OnEvent(EVENTS.SHOPPER_SENT_BACK)
  async handleShopperSentBack(event: ShopperSentBackEvent): Promise<void> {
    try {
      await this.pushService.sendToUser(event.userId, {
        title: 'Application needs changes',
        body: truncate(event.reason, MAX_REASON_LENGTH),
        url: '/shopper/onboarding',
        tag: 'shopper-application',
      });
    } catch (error) {
      this.logger.error(
        `Failed to send shopper send-back push for profile ${event.shopperProfileId}:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
