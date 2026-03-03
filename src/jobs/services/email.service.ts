import { Inject, Injectable, Logger } from '@nestjs/common';
import { IEmailProvider } from '@/common/interfaces';
import { EmailTemplateService } from '@/emails/email-template.service';
import { EmailQueue, IEmailJob } from '../queues';

/**
 * Email Service
 *
 * Sends emails directly via the provider (primary path), then enqueues for
 * async retry handling. This ensures reliable delivery regardless of queue health.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject('EMAIL_PROVIDER') private readonly emailProvider: IEmailProvider,
    private readonly emailTemplateService: EmailTemplateService,
    private readonly emailQueue: EmailQueue,
  ) {}

  async sendEmail(data: IEmailJob): Promise<void> {
    const { to, subject, template, context } = data;

    const html = await this.getEmailTemplate(template, context);
    await this.emailProvider.sendEmail({ to, subject, html });
    this.logger.log(`Email sent to ${to}`);

    // Enqueue for retry tracking — non-critical, failure is silent
    this.emailQueue.addEmailJob(data).catch((err: Error) => {
      this.logger.debug(`Could not enqueue email for ${to}: ${err.message}`);
    });
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
