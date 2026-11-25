import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS } from '@/common/constants';
import { ShopperApprovedEvent, ShopperSentBackEvent } from '@/common/events';
import { EmailService } from '../services';

@Injectable()
export class ShopperEventsListener {
  private readonly logger = new Logger(ShopperEventsListener.name);

  constructor(private readonly emailService: EmailService) {}

  @OnEvent(EVENTS.SHOPPER_APPROVED)
  async handleShopperApproved(event: ShopperApprovedEvent): Promise<void> {
    try {
      await this.emailService.sendEmail({
        to: event.email,
        subject: 'Your FetchIt Shopper Application is Approved!',
        template: 'shopper-approved',
        context: { username: event.username },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send shopper approval email for profile ${event.shopperProfileId}:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  @OnEvent(EVENTS.SHOPPER_SENT_BACK)
  async handleShopperSentBack(event: ShopperSentBackEvent): Promise<void> {
    try {
      await this.emailService.sendEmail({
        to: event.email,
        subject: 'Your FetchIt Shopper Application Needs an Update',
        template: 'shopper-needs-update',
        context: { username: event.username, reason: event.reason },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send shopper send-back email for profile ${event.shopperProfileId}:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
