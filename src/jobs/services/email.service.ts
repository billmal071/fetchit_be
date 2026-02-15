import { Inject, Injectable, Logger } from '@nestjs/common';
import { IEmailProvider } from '@/common/interfaces';
import { EmailTemplateService } from '@/emails/email-template.service';
import { EmailQueue, IEmailJob } from '../queues';

/**
 * Email Service
 *
 * Provides email sending functionality that is resilient to Redis failures.
 * - When Redis is available: Uses Bull queues for async processing
 * - When Redis is unavailable: Falls back to sending emails synchronously via Resend
 *
 * The service automatically detects queue failures and falls back to direct sending,
 * ensuring emails are always delivered even if Redis goes down.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject('EMAIL_PROVIDER') private readonly emailProvider: IEmailProvider,
    private readonly emailTemplateService: EmailTemplateService,
    private readonly emailQueue: EmailQueue,
  ) {}

  private async sendEmailDirectly(data: IEmailJob): Promise<void> {
    const { to, subject, template, context } = data;

    try {
      const html = await this.getEmailTemplate(template, context);

      await this.emailProvider.sendEmail({ to, subject, html });
      this.logger.log(`Email sent directly to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
      throw error;
    }
  }

  async sendEmail(data: IEmailJob): Promise<void> {
    try {
      await this.emailQueue.addEmailJob(data);
      this.logger.debug(`Email queued for ${data.to}`);
    } catch (error) {
      this.logger.warn(`Queue unavailable, sending directly: ${(error as Error).message}`);
      await this.sendEmailDirectly(data);
    }
  }

  async sendWelcomeEmail(email: string, username: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Welcome to FetchIt!',
      template: 'welcome',
      context: { username },
    });
  }

  async sendPasswordResetEmail(email: string, resetUrl: string, username: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Reset Your Password - FetchIt',
      template: 'password-reset',
      context: { resetUrl, username },
    });
  }

  async sendEmailVerificationEmail(
    email: string,
    verificationUrl: string,
    username: string,
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Verify Your Email - FetchIt',
      template: 'email-verification',
      context: { verificationUrl, username },
    });
  }

  private async getEmailTemplate(
    template: string,
    context: Record<string, unknown>,
  ): Promise<string> {
    return this.emailTemplateService.renderTemplate(template as never, context);
  }
}
