import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES } from '@/common/constants';
import { IEmailProvider } from '@/common/interfaces';
import { EmailTemplateService } from '@/emails/email-template.service';
import { IEmailJob } from '../queues';

@Processor(QUEUE_NAMES.EMAIL)
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    @Inject('EMAIL_PROVIDER') private readonly emailProvider: IEmailProvider,
    private readonly emailTemplateService: EmailTemplateService,
  ) {}

  @Process('send-email')
  async handleSendEmail(job: Job<IEmailJob>): Promise<void> {
    const { to, subject, template, context } = job.data;

    this.logger.log(`Processing email job ${job.id}: ${subject} to ${to}`);

    try {
      const html = await this.getEmailTemplate(template, context);

      await this.emailProvider.sendEmail({ to, subject, html });
      this.logger.log(`Email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
      throw error;
    }
  }

  private async getEmailTemplate(
    template: string,
    context: Record<string, unknown>,
  ): Promise<string> {
    return this.emailTemplateService.renderTemplate(template as never, context);
  }
}
