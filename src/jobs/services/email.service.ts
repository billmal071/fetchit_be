import { Inject, Injectable, Logger } from '@nestjs/common';
import { IEmailProvider } from '@/common/interfaces';
import { EmailTemplateService, TemplateName } from '@/emails/email-template.service';
import { IEmailJob } from '../queues';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject('EMAIL_PROVIDER') private readonly emailProvider: IEmailProvider,
    private readonly emailTemplateService: EmailTemplateService,
  ) {}

  async sendEmail(data: IEmailJob): Promise<void> {
    const { to, subject, template, context } = data;

    const html = await this.getEmailTemplate(template, context);
    await this.emailProvider.sendEmail({ to, subject, html });
    this.logger.log(`Email sent to ${to}`);
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
    template: TemplateName,
    context: Record<string, unknown>,
  ): Promise<string> {
    return this.emailTemplateService.renderTemplate(template, context);
  }
}
