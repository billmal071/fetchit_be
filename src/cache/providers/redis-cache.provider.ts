import Redis, { RedisOptions } from 'ioredis';
import { Logger } from '@nestjs/common';
import { ICacheProvider } from '../interfaces';

export interface IRedisCacheOptions {
  /** Connection URL (e.g., rediss://default:password@host:port) - takes precedence */
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  /** Enable TLS (auto-enabled for rediss:// URLs) */
  tls?: boolean;
}

export class RedisCacheProvider implements ICacheProvider {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisCacheProvider.name);
  private readonly keyPrefix: string;
  private isConnected = false;

  constructor(options: IRedisCacheOptions) {
    this.keyPrefix = options.keyPrefix || 'cache:';

    const redisOptions: RedisOptions = {
      retryStrategy: (times) => {
        if (times > 3) {
          this.logger.warn(`Redis connection attempt ${times} failed, will keep trying...`);
        }
        // Keep retrying with exponential backoff, max 30 seconds
        return Math.min(times * 1000, 30000);
      },
      maxRetriesPerRequest: null, // Required for Bull queues compatibility
      lazyConnect: true,
      enableReadyCheck: false, // Don't wait for Redis to be ready
      enableOfflineQueue: true, // Queue commands when disconnected
      reconnectOnError: () => true, // Always try to reconnect
    };

    // Use connection URL if provided (Upstash, Railway, etc.)
    if (options.url) {
      this.logger.log('Connecting to Redis via URL');
      // ioredis parses rediss:// and enables TLS automatically
      this.client = new Redis(options.url, redisOptions);
    } else {
      // Fallback to host/port config
      this.client = new Redis({
        ...redisOptions,
        host: options.host || 'localhost',
        port: options.port || 6379,
        password: options.password || undefined,
        db: options.db || 0,
        tls: options.tls ? {} : undefined,
      });
    }

    this.client.on('connect', () => {
      this.isConnected = true;
      this.logger.log('Redis cache connected');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      this.logger.log('Redis cache ready');
    });

    this.client.on('error', (err) => {
      this.logger.warn(`Redis cache error: ${err.message}`);
    });

    this.client.on('close', () => {
      this.isConnected = false;
      this.logger.warn('Redis cache connection closed');
    });

    this.client.on('reconnecting', () => {
      this.logger.log('Redis cache reconnecting...');
    });

    // Try to connect but don't crash if it fails
    this.client.connect().catch((err) => {
      this.logger.warn(
        `Initial Redis connection failed: ${err.message}. Will retry in background.`,
      );
    });
  }

  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.client.get(this.prefixKey(key));
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (error) {
      this.logger.error(`Cache get error for key ${key}: ${error}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await this.client.setex(this.prefixKey(key), ttl, serialized);
      } else {
        await this.client.set(this.prefixKey(key), serialized);
      }
    } catch (error) {
      this.logger.error(`Cache set error for key ${key}: ${error}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(this.prefixKey(key));
    } catch (error) {
      this.logger.error(`Cache del error for key ${key}: ${error}`);
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(this.prefixKey(pattern));
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (error) {
      this.logger.error(`Cache delByPattern error for pattern ${pattern}: ${error}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(this.prefixKey(key));
      return result === 1;
    } catch (error) {
      this.logger.error(`Cache exists error for key ${key}: ${error}`);
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      const keys = await this.client.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (error) {
      this.logger.error(`Cache clear error: ${error}`);
    }
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      const prefixedKeys = keys.map((k) => this.prefixKey(k));
      const results = await this.client.mget(...prefixedKeys);
      return results.map((data) => {
        if (!data) return null;
        try {
          return JSON.parse(data) as T;
        } catch {
          return null;
        }
      });
    } catch (error) {
      this.logger.error(`Cache mget error: ${error}`);
      return keys.map(() => null);
    }
  }

  async mset<T>(entries: { key: string; value: T; ttl?: number }[]): Promise<void> {
    try {
      const pipeline = this.client.pipeline();
      for (const entry of entries) {
        const serialized = JSON.stringify(entry.value);
        if (entry.ttl) {
          pipeline.setex(this.prefixKey(entry.key), entry.ttl, serialized);
        } else {
          pipeline.set(this.prefixKey(entry.key), serialized);
        }
      }
      await pipeline.exec();
    } catch (error) {
      this.logger.error(`Cache mset error: ${error}`);
    }
  }

  getProviderName(): string {
    return 'redis';
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}
