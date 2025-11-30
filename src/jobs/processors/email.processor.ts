import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES } from '@/common/constants';
import { IEmailJob } from '../queues';

@Processor(QUEUE_NAMES.EMAIL)
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  @Process('send-email')
  async handleSendEmail(job: Job<IEmailJob>): Promise<void> {
    const { to, subject, template, context } = job.data;

    this.logger.log(`Processing email job ${job.id}: ${subject} to ${to}`);

    try {
      // TODO: Implement actual email sending logic using a service like SendGrid, AWS SES, etc.
      // For now, we'll just log the email details
      this.logger.log(`Email sent successfully to ${to}`);
      this.logger.debug(`Template: ${template}, Context: ${JSON.stringify(context)}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
      throw error;
    }
  }
}
