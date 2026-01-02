import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from '@/common/constants';
import { IRedisConfig } from '@/config';
import { EmailQueue } from './queues';
import { EmailProcessor } from './processors';

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
          return {
            redis: {
              host: url.hostname,
              port: parseInt(url.port) || 6379,
              username: url.username || undefined,
              password: url.password || undefined,
              tls: url.protocol === 'rediss:' ? {} : undefined,
              maxRetriesPerRequest: null, // Required for Bull - uses blocking commands
            },
            defaultJobOptions: {
              removeOnComplete: true,
              removeOnFail: false,
            },
          };
        }

        // Fallback to host/port config
        return {
          redis: {
            host: redisConfig?.host || 'localhost',
            port: redisConfig?.port || 6379,
            password: redisConfig?.password || undefined,
            tls: redisConfig?.tls ? {} : undefined,
            maxRetriesPerRequest: null, // Required for Bull - uses blocking commands
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
  providers: [EmailQueue, EmailProcessor],
  exports: [EmailQueue],
})
export class JobsModule {}
