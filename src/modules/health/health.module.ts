import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { QueueHealthIndicator } from './queue.health';
import { BullModule } from '@nestjs/bull';
import { QUEUE_NAMES } from '@/common/constants';

@Module({
  imports: [TerminusModule, BullModule.registerQueue({ name: QUEUE_NAMES.EMAIL })],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator, QueueHealthIndicator],
})
export class HealthModule {}
