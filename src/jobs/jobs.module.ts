import { Module, Global, Logger } from '@nestjs/common';
import { BullModule, BullModuleOptions } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from '@/common/constants';
import { IRedisConfig } from '@/config';
import { EmailQueue } from './queues';
import { EmailProcessor } from './processors';
import { EmailService, ResendEmailProvider } from './services';
import { EmailTemplateService } from '@/emails/email-template.service';

const logger = new Logger('JobsModule');

/**
 * Jobs Module
 *
 * Provides background job processing functionality.
 * - When Redis is available: Uses Bull queues for async processing
 * - When Redis is unavailable: EmailService falls back to direct sending
 *
 * The module is designed to be resilient - if Redis fails to connect or
 * drops connection, the app continues to function with degraded functionality.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): BullModuleOptions => {
        const redisConfig = configService.get<IRedisConfig>('redis');

        const baseRedisOptions = {
          maxRetriesPerRequest: null, // Required for Bull - uses blocking commands
          enableOfflineQueue: true, // Queue commands when disconnected, execute when reconnected
          enableReadyCheck: false, // Don't wait for Redis to be ready
          lazyConnect: true, // Don't connect immediately
          retryStrategy: (times: number): number => {
            if (times > 3) {
              logger.warn(`Redis connection attempt ${times} failed, will keep trying...`);
            }
            // Keep retrying with exponential backoff, max 30 seconds
            return Math.min(times * 1000, 30000);
          },
          reconnectOnError: () => true, // Always try to reconnect
        };

        // Use connection URL if provided (Upstash, Railway, etc.)
        if (redisConfig?.url) {
          const url = new URL(redisConfig.url);
          logger.log('Configuring Bull with Redis URL');
          return {
            redis: {
              ...baseRedisOptions,
              host: url.hostname,
              port: parseInt(url.port) || 6379,
              username: url.username || undefined,
              password: url.password || undefined,
              tls: url.protocol === 'rediss:' ? {} : undefined,
            },
            defaultJobOptions: {
              removeOnComplete: true,
              removeOnFail: false,
            },
          };
        }

        // Fallback to host/port config
        logger.log(
          `Configuring Bull with Redis at ${redisConfig?.host || 'localhost'}:${redisConfig?.port || 6379}`,
        );
        return {
          redis: {
            ...baseRedisOptions,
            host: redisConfig?.host || 'localhost',
            port: redisConfig?.port || 6379,
            password: redisConfig?.password || undefined,
            tls: redisConfig?.tls ? {} : undefined,
          },
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: false,
          },
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
    {
      provide: 'EMAIL_PROVIDER',
      useExisting: ResendEmailProvider,
    },
  ],
  exports: [EmailService, EmailQueue],
})
export class JobsModule {}
