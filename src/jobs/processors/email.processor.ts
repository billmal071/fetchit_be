import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '@/common/constants';
import { IEmailProvider } from '@/common/interfaces';
import { EmailTemplateService } from '@/emails/email-template.service';
import { IEmailJob } from '../queues';

@Processor(QUEUE_NAMES.EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    @Inject('EMAIL_PROVIDER') private readonly emailProvider: IEmailProvider,
    private readonly emailTemplateService: EmailTemplateService,
  ) {
    super();
  }

  async process(job: Job<IEmailJob>): Promise<void> {
    switch (job.name) {
      case 'send-email':
        return this.handleSendEmail(job);
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  }

  private async handleSendEmail(job: Job<IEmailJob>): Promise<void> {
    const { to, subject, template, context } = job.data;

    this.logger.log(`Processing email job ${job.id}: ${subject} to ${to}`);

    const html = await this.emailTemplateService.renderTemplate(template as never, context);
    await this.emailProvider.sendEmail({ to, subject, html });

    this.logger.log(`Email sent successfully to ${to}`);
  }
}
