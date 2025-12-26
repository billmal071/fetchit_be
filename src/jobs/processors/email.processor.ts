import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { Resend } from 'resend';
import { QUEUE_NAMES } from '@/common/constants';
import { IResendConfig } from '@/config';
import { IEmailJob } from '../queues';

@Processor(QUEUE_NAMES.EMAIL)
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);
  private resend: Resend;
  private resendConfig: IResendConfig;

  constructor(private readonly configService: ConfigService) {
    this.resendConfig = this.configService.get<IResendConfig>('resend') as IResendConfig;
    this.resend = new Resend(this.resendConfig.apiKey);
  }

  @Process('send-email')
  async handleSendEmail(job: Job<IEmailJob>): Promise<void> {
    const { to, subject, template, context } = job.data;

    this.logger.log(`Processing email job ${job.id}: ${subject} to ${to}`);

    try {
      const html = this.getEmailTemplate(template, context);

      // Only send email if Resend API key is configured
      if (this.resendConfig.apiKey) {
        const { error } = await this.resend.emails.send({
          from: this.resendConfig.from,
          to,
          subject,
          html,
        });

        if (error) {
          throw new Error(error.message);
        }

        this.logger.log(`Email sent successfully to ${to}`);
      } else {
        // Log email in development when Resend is not configured
        this.logger.warn(`Resend not configured. Email would be sent to ${to}`);
        this.logger.debug(`Subject: ${subject}`);
        this.logger.debug(`Template: ${template}`);
        this.logger.debug(`Context: ${JSON.stringify(context)}`);
      }
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
      throw error;
    }
  }

  private getEmailTemplate(template: string, context: Record<string, unknown>): string {
    switch (template) {
      case 'welcome':
        return this.getWelcomeTemplate(context);
      case 'password-reset':
        return this.getPasswordResetTemplate(context);
      case 'email-verification':
        return this.getEmailVerificationTemplate(context);
      default:
        return `<p>${JSON.stringify(context)}</p>`;
    }
  }

  private getWelcomeTemplate(context: Record<string, unknown>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to FetchIt!</h1>
          </div>
          <div class="content">
            <p>Hi ${context.username},</p>
            <p>Welcome to FetchIt! We're excited to have you on board.</p>
            <p>Get started by exploring our features and making your first fetch!</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} FetchIt. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getPasswordResetTemplate(context: Record<string, unknown>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Reset Your Password</h1>
          </div>
          <div class="content">
            <p>Hi ${context.username},</p>
            <p>We received a request to reset your password. Click the button below to create a new password:</p>
            <p style="text-align: center;">
              <a href="${context.resetUrl}" class="button">Reset Password</a>
            </p>
            <p>If you didn't request this, you can safely ignore this email. The link will expire in 1 hour.</p>
            <p>Or copy and paste this URL into your browser:</p>
            <p style="word-break: break-all; color: #666;">${context.resetUrl}</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} FetchIt. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getEmailVerificationTemplate(context: Record<string, unknown>): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Verify Your Email</h1>
          </div>
          <div class="content">
            <p>Hi ${context.username},</p>
            <p>Thanks for signing up! Please verify your email address by clicking the button below:</p>
            <p style="text-align: center;">
              <a href="${context.verificationUrl}" class="button">Verify Email</a>
            </p>
            <p>This link will expire in 24 hours.</p>
            <p>Or copy and paste this URL into your browser:</p>
            <p style="word-break: break-all; color: #666;">${context.verificationUrl}</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} FetchIt. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
