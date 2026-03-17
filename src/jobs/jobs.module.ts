import { Module, Global, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from '@/common/constants';
import { IRedisConfig } from '@/config';
import { EmailQueue } from './queues';
import { EmailProcessor } from './processors';
import { EmailService, ResendEmailProvider } from './services';
import { EmailTemplateService } from '@/emails/email-template.service';
import {
  UserEventsListener,
  HandymanEventsListener,
  ServiceRequestEventsListener,
} from './listeners';

const logger = new Logger('JobsModule');

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisConfig = configService.get<IRedisConfig>('redis');

        // Use connection URL if provided (Upstash, Railway, etc.)
        if (redisConfig?.url) {
          const url = new URL(redisConfig.url);
          logger.log('Configuring BullMQ with Redis URL');
          return {
            connection: {
              host: url.hostname,
              port: parseInt(url.port) || 6379,
              username: url.username || undefined,
              password: url.password || undefined,
              tls: url.protocol === 'rediss:' ? {} : undefined,
            },
            prefix: 'fetchit',
          };
        }

        logger.log(
          `Configuring BullMQ with Redis at ${redisConfig?.host || 'localhost'}:${redisConfig?.port || 6379}`,
        );
        return {
          connection: {
            host: redisConfig?.host || 'localhost',
            port: redisConfig?.port || 6379,
            password: redisConfig?.password || undefined,
            tls: redisConfig?.tls ? {} : undefined,
          },
          prefix: 'fetchit',
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.EMAIL },
      { name: QUEUE_NAMES.NOTIFICATION },
      { name: QUEUE_NAMES.FILE_PROCESSING },
    ),
  ],
  providers: [
    EmailQueue,
    EmailProcessor,
    EmailService,
    ResendEmailProvider,
    EmailTemplateService,
    UserEventsListener,
    HandymanEventsListener,
    ServiceRequestEventsListener,
    {
      provide: 'EMAIL_PROVIDER',
      useExisting: ResendEmailProvider,
    },
  ],
  exports: [EmailService, EmailQueue],
})
export class JobsModule {}
