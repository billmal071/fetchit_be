import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { FEATURE_FLAG_KEYS, FeatureFlagKey } from '@common/constants';
import {
  FEATURE_FLAG_REPOSITORY,
  IFeatureFlagRepository,
  IFeatureFlagRow,
} from '@/database/repositories';

/**
 * How long a process trusts what it last read. A change made through the admin endpoint
 * invalidates the cache of the process that handled it at once; any OTHER process (pm2 may
 * run several) sees the change within this long.
 */
export const FEATURE_FLAG_CACHE_TTL_MS = 10_000;

type Snapshot = Map<string, IFeatureFlagRow>;

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  private cache: { loadedAt: number; flags: Snapshot } | null = null;
  private inflight: Promise<Snapshot | null> | null = null;
  /** Bumped by invalidate(): a read that started before it must not repopulate the cache. */
  private generation = 0;
  private readonly reportedMissing = new Set<string>();

  constructor(
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly repository: IFeatureFlagRepository,
  ) {}

  /**
   * Whether `key` is on for a caller with `role`. ADMIN always passes (staff can test a
   * flag that is off). Otherwise the flag must be enabled and either list no roles
   * (everyone) or list this one. A key with no row fails CLOSED.
   */
  async isEnabledFor(key: FeatureFlagKey, role: string): Promise<boolean> {
    if (role === UserRole.ADMIN) {
      return true;
    }
    const flags = await this.snapshot();
    if (!flags) {
      return false; // could not read the table and nothing is cached: closed
    }
    return this.evaluate(flags, key, role);
  }

  /** Every known flag as a boolean, for the caller's role. */
  async evaluateAll(role: string): Promise<Record<FeatureFlagKey, boolean>> {
    const flags = role === UserRole.ADMIN ? null : await this.snapshot();
    return Object.fromEntries(
      FEATURE_FLAG_KEYS.map((key) => [
        key,
        role === UserRole.ADMIN || (flags !== null && this.evaluate(flags, key, role)),
      ]),
    ) as Record<FeatureFlagKey, boolean>;
  }

  /** Drop what is cached, so the next call reads the table. Called after an admin edit. */
  invalidate(): void {
    this.generation++;
    this.cache = null;
    this.inflight = null;
  }

  private evaluate(flags: Snapshot, key: string, role: string): boolean {
    const flag = flags.get(key);
    if (!flag) {
      if (!this.reportedMissing.has(key)) {
        this.reportedMissing.add(key);
        this.logger.warn(`Feature flag "${key}" has no row in feature_flags; treating it as OFF`);
      }
      return false;
    }
    return (
      flag.enabled &&
      (flag.allowedRoles.length === 0 || flag.allowedRoles.includes(role as UserRole))
    );
  }

  private async snapshot(): Promise<Snapshot | null> {
    if (this.cache && Date.now() - this.cache.loadedAt < FEATURE_FLAG_CACHE_TTL_MS) {
      return this.cache.flags;
    }
    this.inflight ??= this.refresh();
    return this.inflight;
  }

  private async refresh(): Promise<Snapshot | null> {
    const generation = this.generation;
    try {
      const rows = await this.repository.list();
      const flags: Snapshot = new Map(rows.map((row) => [row.key, row]));
      if (generation === this.generation) {
        this.cache = { loadedAt: Date.now(), flags };
        this.inflight = null;
      }
      return flags;
    } catch (error) {
      this.logger.error(
        `Could not read feature flags: ${error instanceof Error ? error.message : error}`,
      );
      if (generation === this.generation) {
        this.inflight = null;
      }
      // Serve what we last knew rather than fail every request; with nothing, fail closed.
      return this.cache?.flags ?? null;
    }
  }
}
