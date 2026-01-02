import { Module, Global, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_PROVIDER, ICacheProvider, ICacheConfig } from './interfaces';
import { RedisCacheProvider } from './providers/redis-cache.provider';
import { MemoryCacheProvider } from './providers/memory-cache.provider';
import { CacheService } from './cache.service';

const logger = new Logger('CacheModule');

/**
 * Cache Module
 *
 * Provides a pluggable caching system that can switch between Redis and
 * in-memory storage based on configuration. This allows:
 *
 * - Development: Use memory cache (no Redis needed)
 * - Production: Use Redis for distributed caching
 * - Testing: Use memory cache for isolation
 *
 * Configuration via environment variables:
 * - CACHE_TYPE: 'redis' | 'memory' (default: 'memory')
 * - CACHE_DEFAULT_TTL: default TTL in seconds (default: 300)
 * - REDIS_HOST, REDIS_PORT, REDIS_PASSWORD: Redis connection settings
 *
 * @example
 * ```typescript
 * // In your service
 * @Injectable()
 * export class MyService {
 *   constructor(private readonly cache: CacheService) {}
 *
 *   async getData(id: string) {
 *     return this.cache.getOrSet(
 *       `data:${id}`,
 *       () => this.fetchFromDb(id),
 *       CACHE_TTL.FIVE_MINUTES
 *     );
 *   }
 * }
 * ```
 */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_PROVIDER,
      useFactory: (configService: ConfigService): ICacheProvider => {
        const cacheConfig = configService.get<ICacheConfig>('cache');
        const redisConfig = configService.get('redis');

        const cacheType = cacheConfig?.type || 'memory';
        const defaultTtl = cacheConfig?.defaultTtl || 300;

        logger.log(`Initializing cache with provider: ${cacheType}`);

        if (cacheType === 'redis') {
          return new RedisCacheProvider({
            url: redisConfig?.url,
            host: redisConfig?.host || 'localhost',
            port: redisConfig?.port || 6379,
            password: redisConfig?.password,
            tls: redisConfig?.tls,
            keyPrefix: cacheConfig?.redis?.keyPrefix || 'fetchit:cache:',
          });
        }

        return new MemoryCacheProvider({
          max: cacheConfig?.memory?.max || 1000,
          defaultTtl,
        });
      },
      inject: [ConfigService],
    },
    CacheService,
  ],
  exports: [CacheService, CACHE_PROVIDER],
})
export class CacheModule {}
