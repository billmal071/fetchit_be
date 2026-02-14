import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS } from '@/common/constants';
import { UserVerifiedEvent } from '@/common/events';
import { EmailService } from '../services';

/**
 * Listener for user-related events
 * Handles reactions to user lifecycle events such as verification, creation, etc.
 */
@Injectable()
export class UserEventsListener {
  private readonly logger = new Logger(UserEventsListener.name);

  constructor(private readonly emailService: EmailService) {}

  /**
   * Sends a welcome email when a user verifies their email address
   */
  @OnEvent(EVENTS.USER_EMAIL_VERIFIED)
  async handleUserVerified(event: UserVerifiedEvent): Promise<void> {
    try {
      this.logger.log(`Handling user verified event for: ${event.email}`);

      await this.emailService.sendWelcomeEmail(event.email, event.username);

      this.logger.log(`Welcome email sent to: ${event.email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send welcome email to ${event.email}:`,
        error instanceof Error ? error.stack : error,
      );
      // Don't throw - we don't want to fail the verification process if email sending fails
    }
  }
}
