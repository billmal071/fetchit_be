import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS } from '@/common/constants';
import {
  HandymanVerifiedEvent,
  HandymanRejectedEvent,
  HandymanDocumentsSubmittedEvent,
} from '@/common/events';
import { EmailService } from '../services';

@Injectable()
export class HandymanEventsListener {
  private readonly logger = new Logger(HandymanEventsListener.name);

  constructor(private readonly emailService: EmailService) {}

  @OnEvent(EVENTS.HANDYMAN_VERIFIED)
  async handleHandymanVerified(event: HandymanVerifiedEvent): Promise<void> {
    try {
      this.logger.log(`Handyman verified: ${event.email}`);
      await this.emailService.sendEmail({
        to: event.email,
        subject: 'Your FetchIt Handyman Account is Verified!',
        template: 'welcome',
        context: {
          username: event.username,
          message:
            'Your handyman account has been verified. You can now start receiving service requests!',
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${event.email}:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  @OnEvent(EVENTS.HANDYMAN_REJECTED)
  async handleHandymanRejected(event: HandymanRejectedEvent): Promise<void> {
    try {
      this.logger.log(`Handyman rejected: ${event.email}, reason: ${event.reason}`);
      await this.emailService.sendEmail({
        to: event.email,
        subject: 'FetchIt Handyman Verification Update',
        template: 'welcome',
        context: {
          username: event.username,
          message: `Your handyman verification was not approved. Reason: ${event.reason}. You can resubmit your documents.`,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send rejection email to ${event.email}:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  @OnEvent(EVENTS.HANDYMAN_DOCUMENTS_SUBMITTED)
  async handleDocumentsSubmitted(event: HandymanDocumentsSubmittedEvent): Promise<void> {
    try {
      this.logger.log(
        `Handyman documents submitted for review: profile ${event.handymanProfileId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle documents submitted event:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
