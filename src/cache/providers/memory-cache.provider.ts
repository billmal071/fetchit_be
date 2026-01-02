import { Logger } from '@nestjs/common';
import { ICacheProvider } from '../interfaces';

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null; // timestamp or null for no expiry
}

export interface MemoryCacheOptions {
  max?: number; // maximum entries
  defaultTtl?: number; // default TTL in seconds
}

export class MemoryCacheProvider implements ICacheProvider {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly logger = new Logger(MemoryCacheProvider.name);
  private readonly maxEntries: number;
  private readonly defaultTtl: number;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = options.max || 1000;
    this.defaultTtl = options.defaultTtl || 300; // 5 minutes default
    this.logger.log('Memory cache initialized');

    // Periodic cleanup of expired entries
    setInterval(() => this.cleanup(), 60000); // every minute
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired cache entries`);
    }
  }

  private isExpired(entry: CacheEntry<unknown>): boolean {
    if (!entry.expiresAt) return false;
    return Date.now() > entry.expiresAt;
  }

  private evictIfNeeded(): void {
    if (this.cache.size >= this.maxEntries) {
      // Simple LRU-like: remove oldest entry (first in map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const entry = this.cache.get(key);
      if (!entry) return null;

      if (this.isExpired(entry)) {
        this.cache.delete(key);
        return null;
      }

      return entry.value as T;
    } catch (error) {
      this.logger.error(`Cache get error for key ${key}: ${error}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      this.evictIfNeeded();

      const effectiveTtl = ttl ?? this.defaultTtl;
      const entry: CacheEntry<T> = {
        value,
        expiresAt: effectiveTtl > 0 ? Date.now() + effectiveTtl * 1000 : null,
      };

      this.cache.set(key, entry);
    } catch (error) {
      this.logger.error(`Cache set error for key ${key}: ${error}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      this.cache.delete(key);
    } catch (error) {
      this.logger.error(`Cache del error for key ${key}: ${error}`);
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    try {
      // Convert glob pattern to regex
      const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
      const regex = new RegExp(`^${regexPattern}$`);

      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          this.cache.delete(key);
        }
      }
    } catch (error) {
      this.logger.error(`Cache delByPattern error for pattern ${pattern}: ${error}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const entry = this.cache.get(key);
      if (!entry) return false;

      if (this.isExpired(entry)) {
        this.cache.delete(key);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Cache exists error for key ${key}: ${error}`);
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      this.cache.clear();
    } catch (error) {
      this.logger.error(`Cache clear error: ${error}`);
    }
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    return Promise.all(keys.map((key) => this.get<T>(key)));
  }

  async mset<T>(entries: { key: string; value: T; ttl?: number }[]): Promise<void> {
    await Promise.all(entries.map((entry) => this.set(entry.key, entry.value, entry.ttl)));
  }

  getProviderName(): string {
    return 'memory';
  }

  getStats(): { size: number; maxEntries: number } {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
    };
  }
}
