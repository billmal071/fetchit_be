import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@/common/constants';
import { TemplateName } from '@/emails/email-template.service';

export interface IEmailJob {
  to: string;
  subject: string;
  template: TemplateName;
  context: Record<string, unknown>;
}

@Injectable()
export class EmailQueue {
  constructor(
    @InjectQueue(QUEUE_NAMES.EMAIL)
    private readonly emailQueue: Queue<IEmailJob>,
  ) {}

  async addEmailJob(data: IEmailJob): Promise<void> {
    await this.emailQueue.add('send-email', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });
  }
}
