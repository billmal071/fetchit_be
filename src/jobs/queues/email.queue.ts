import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE_NAMES } from '@/common/constants';

export interface IEmailJob {
  to: string;
  subject: string;
  template: string;
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
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async addWelcomeEmail(email: string, username: string): Promise<void> {
    await this.addEmailJob({
      to: email,
      subject: 'Welcome to FetchIt!',
      template: 'welcome',
      context: { username },
    });
  }

  async addPasswordResetEmail(email: string, resetUrl: string, username: string): Promise<void> {
    await this.addEmailJob({
      to: email,
      subject: 'Reset Your Password - FetchIt',
      template: 'password-reset',
      context: { resetUrl, username },
    });
  }

  async addEmailVerificationEmail(email: string, verificationUrl: string, username: string): Promise<void> {
    await this.addEmailJob({
      to: email,
      subject: 'Verify Your Email - FetchIt',
      template: 'email-verification',
      context: { verificationUrl, username },
    });
  }
}
