/**
 * Cache Provider Interface
 *
 * This abstraction allows swapping between different cache implementations
 * (Redis, Memory, etc.) without changing business logic.
 */
export interface ICacheProvider {
  /**
   * Get a value from cache
   * @param key - The cache key
   * @returns The cached value or null if not found
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in cache
   * @param key - The cache key
   * @param value - The value to cache
   * @param ttl - Time to live in seconds (optional)
   */
  set<T>(key: string, value: T, ttl?: number): Promise<void>;

  /**
   * Delete a value from cache
   * @param key - The cache key
   */
  del(key: string): Promise<void>;

  /**
   * Delete multiple keys matching a pattern
   * @param pattern - The pattern to match (e.g., "user:*")
   */
  delByPattern(pattern: string): Promise<void>;

  /**
   * Check if a key exists in cache
   * @param key - The cache key
   */
  exists(key: string): Promise<boolean>;

  /**
   * Clear all cache entries
   */
  clear(): Promise<void>;

  /**
   * Get multiple values from cache
   * @param keys - Array of cache keys
   */
  mget<T>(keys: string[]): Promise<(T | null)[]>;

  /**
   * Set multiple values in cache
   * @param entries - Array of key-value pairs with optional TTL
   */
  mset<T>(entries: { key: string; value: T; ttl?: number }[]): Promise<void>;

  /**
   * Get the provider name for debugging/logging
   */
  getProviderName(): string;
}

/**
 * Cache configuration options
 */
export interface ICacheConfig {
  type: 'memory' | 'redis';
  defaultTtl: number; // in seconds
  redis?: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
  };
  memory?: {
    max: number; // maximum number of items
    ttl: number; // default TTL in seconds
  };
}

/**
 * Cache provider token for dependency injection
 */
export const CACHE_PROVIDER = 'CACHE_PROVIDER';
