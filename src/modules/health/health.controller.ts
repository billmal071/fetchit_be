import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  DiskHealthIndicator,
  HealthCheckResult,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { Public } from '@/common/decorators';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { QueueHealthIndicator } from './queue.health';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly queueHealth: QueueHealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({
    summary: 'Check application health',
    description: 'Full health check: database, Redis, queue, memory, disk.',
  })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      (): Promise<HealthIndicatorResult> => this.prismaHealth.isHealthy('database'),
      (): Promise<HealthIndicatorResult> => this.redisHealth.isHealthy('redis'),
      (): Promise<HealthIndicatorResult> => this.queueHealth.isHealthy('queue'),
      (): Promise<HealthIndicatorResult> => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024), // 300MB
      (): Promise<HealthIndicatorResult> => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024), // 300MB
      (): Promise<HealthIndicatorResult> =>
        this.disk.checkStorage('storage', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }

  @Get('liveness')
  @Public()
  @ApiOperation({
    summary: 'Liveness probe for Kubernetes',
    description: 'Kubernetes liveness probe. Always returns 200.',
  })
  liveness(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('readiness')
  @Public()
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe for Kubernetes',
    description: 'Kubernetes readiness probe. Checks database connectivity.',
  })
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      (): Promise<HealthIndicatorResult> => this.prismaHealth.isHealthy('database'),
    ]);
  }
}
