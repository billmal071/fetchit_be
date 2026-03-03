import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { IResendConfig } from '@/config';
import { IEmailPayload, IEmailProvider } from '@/common/interfaces';

@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly resend: Resend;
  private readonly resendConfig: IResendConfig;

  constructor(private readonly configService: ConfigService) {
    this.resendConfig = this.configService.get<IResendConfig>('resend') as IResendConfig;
    this.resend = new Resend(this.resendConfig.apiKey);
  }

  async sendEmail(payload: IEmailPayload): Promise<void> {
    const { to, subject, html } = payload;

    if (!this.resendConfig.apiKey) {
      this.logger.warn(`Resend not configured. Email would be sent to ${to}`);
      return;
    }

    const { data, error } = await this.resend.emails.send({
      from: this.resendConfig.from,
      to,
      subject,
      html,
    });

    if (error) {
      throw new Error(error.message);
    }

    this.logger.log(`Email sent via Resend to ${to} (id: ${data?.id})`);
  }
}
