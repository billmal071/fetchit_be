import { Injectable, Inject, Logger } from '@nestjs/common';
import { ICacheProvider, CACHE_PROVIDER } from './interfaces';

/**
 * Cache Service
 *
 * A wrapper service that provides caching functionality using the configured
 * cache provider (Redis or Memory). This service can be injected into any
 * other service to access caching.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class UsersService {
 *   constructor(private readonly cache: CacheService) {}
 *
 *   async getUserById(id: string) {
 *     const cacheKey = CACHE_KEYS.USER_BY_ID(id);
 *
 *     // Try cache first
 *     const cached = await this.cache.get<User>(cacheKey);
 *     if (cached) return cached;
 *
 *     // Fetch from DB
 *     const user = await this.prisma.user.findUnique({ where: { id } });
 *
 *     // Cache the result
 *     await this.cache.set(cacheKey, user, CACHE_TTL.FIVE_MINUTES);
 *
 *     return user;
 *   }
 * }
 * ```
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(CACHE_PROVIDER)
    private readonly provider: ICacheProvider,
  ) {
    this.logger.log(`Cache service initialized with provider: ${provider.getProviderName()}`);
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    return this.provider.get<T>(key);
  }

  /**
   * Set a value in cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time to live in seconds (optional)
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    return this.provider.set(key, value, ttl);
  }

  /**
   * Delete a value from cache
   */
  async del(key: string): Promise<void> {
    return this.provider.del(key);
  }

  /**
   * Delete all keys matching a pattern
   * @param pattern - Pattern to match (e.g., "user:*")
   */
  async delByPattern(pattern: string): Promise<void> {
    return this.provider.delByPattern(pattern);
  }

  /**
   * Check if a key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    return this.provider.exists(key);
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    return this.provider.clear();
  }

  /**
   * Get multiple values from cache
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    return this.provider.mget<T>(keys);
  }

  /**
   * Set multiple values in cache
   */
  async mset<T>(entries: { key: string; value: T; ttl?: number }[]): Promise<void> {
    return this.provider.mset(entries);
  }

  /**
   * Get the current provider name
   */
  getProviderName(): string {
    return this.provider.getProviderName();
  }

  /**
   * Get or set pattern - tries cache first, falls back to factory
   * @param key - Cache key
   * @param factory - Function to call if cache miss
   * @param ttl - Time to live in seconds
   */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * Wrap a function with caching
   * @param keyFn - Function to generate cache key from args
   * @param fn - Function to wrap
   * @param ttl - Time to live in seconds
   */
  wrap<TArgs extends unknown[], TResult>(
    keyFn: (...args: TArgs) => string,
    fn: (...args: TArgs) => Promise<TResult>,
    ttl?: number,
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs): Promise<TResult> => {
      const key = keyFn(...args);
      return this.getOrSet(key, () => fn(...args), ttl);
    };
  }
}
