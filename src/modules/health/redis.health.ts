import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { IRedisConfig } from '@/config';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private client: RedisClientType | null = null;

  constructor(private readonly configService: ConfigService) {
    super();
  }

  private async getClient(): Promise<RedisClientType> {
    if (this.client) {
      return this.client;
    }

    const redisConfig = this.configService.get<IRedisConfig>('redis');

    const url =
      redisConfig?.url ??
      `redis://${redisConfig?.host || 'localhost'}:${redisConfig?.port || 6379}`;

    this.client = createClient({
      url,
      password: redisConfig?.password || undefined,
      socket: redisConfig?.tls ? { tls: true } : undefined,
    });

    if (!this.client.isOpen) {
      await this.client.connect();
    }

    return this.client;
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const client = await this.getClient();
      await client.ping();
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'Redis health check failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}
