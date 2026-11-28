import type { Prisma } from '@prisma/client';
import { UserRole } from '@prisma/client';

/** What the evaluator needs. */
export interface IFeatureFlagRow {
  key: string;
  enabled: boolean;
  /** Empty means everyone; otherwise only these roles. */
  allowedRoles: UserRole[];
}

/** What the admin screen shows. */
export interface IFeatureFlagRecord extends IFeatureFlagRow {
  description: string;
  updatedAt: Date;
  updatedBy: { id: string; username: string } | null;
}

export interface IFeatureFlagPatch {
  enabled?: boolean;
  allowedRoles?: UserRole[];
}

export type FeatureFlagUpdateResult =
  | {
      outcome: 'updated';
      /** Only the fields that actually changed. */
      before: IFeatureFlagPatch;
      after: IFeatureFlagPatch;
      record: IFeatureFlagRecord;
    }
  | { outcome: 'unchanged'; record: IFeatureFlagRecord }
  | { outcome: 'not_found' };

/** Runs in the update's own transaction; see IFeatureFlagRepository.update. */
export type FeatureFlagUpdatedHook = (
  tx: Prisma.TransactionClient,
  change: { before: IFeatureFlagPatch; after: IFeatureFlagPatch },
) => Promise<void>;

export interface IFeatureFlagRepository {
  /** Every flag, with who last changed it. Ordered by key. */
  list(): Promise<IFeatureFlagRecord[]>;

  /**
   * Edit one flag with a single UPDATE under a row lock (SELECT ... FOR UPDATE), so two
   * concurrent edits are applied one after the other and the second compares against what
   * the first stored. Nothing is written if every given value is already the stored one.
   * Flags cannot be created or deleted here: they are defined in code and a migration.
   *
   * `onUpdated`, when given, runs INSIDE the same transaction right after an effective
   * write (never for a no-op or an unknown key) with the transaction client: whatever it
   * writes (the audit row) commits with the change, and if it throws the change is rolled
   * back and the error propagates.
   */
  update(
    key: string,
    patch: IFeatureFlagPatch,
    updatedById: string,
    onUpdated?: FeatureFlagUpdatedHook,
  ): Promise<FeatureFlagUpdateResult>;
}

export const FEATURE_FLAG_REPOSITORY = Symbol('FEATURE_FLAG_REPOSITORY');
