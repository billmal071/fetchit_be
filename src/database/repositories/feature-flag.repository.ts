import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  FeatureFlagUpdatedHook,
  FeatureFlagUpdateResult,
  IFeatureFlagPatch,
  IFeatureFlagRecord,
  IFeatureFlagRepository,
} from './interfaces';

const WITH_EDITOR = { updatedBy: { select: { id: true, username: true } } } as const;

type FlagRow = Prisma.FeatureFlagGetPayload<{ include: typeof WITH_EDITOR }>;

const toRecord = (row: FlagRow): IFeatureFlagRecord => ({
  key: row.key,
  description: row.description,
  enabled: row.enabled,
  allowedRoles: row.allowedRoles,
  updatedAt: row.updatedAt,
  updatedBy: row.updatedBy,
});

/** Role lists are sets: their order is not meaningful, so compare and store them sorted. */
const normalise = (roles: UserRole[]): UserRole[] => [...new Set(roles)].sort();

@Injectable()
export class FeatureFlagRepository implements IFeatureFlagRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<IFeatureFlagRecord[]> {
    const rows = await this.prisma.featureFlag.findMany({
      include: WITH_EDITOR,
      orderBy: { key: 'asc' },
    });
    return rows.map(toRecord);
  }

  async update(
    key: string,
    patch: IFeatureFlagPatch,
    updatedById: string,
    onUpdated?: FeatureFlagUpdatedHook,
  ): Promise<FeatureFlagUpdateResult> {
    return this.prisma.$transaction(async (tx): Promise<FeatureFlagUpdateResult> => {
      await tx.$queryRaw`SELECT key FROM feature_flags WHERE key = ${key} FOR UPDATE`;
      const row = await tx.featureFlag.findUnique({ where: { key }, include: WITH_EDITOR });
      if (!row) {
        return { outcome: 'not_found' };
      }

      const before: IFeatureFlagPatch = {};
      const after: IFeatureFlagPatch = {};
      if (patch.enabled !== undefined && patch.enabled !== row.enabled) {
        before.enabled = row.enabled;
        after.enabled = patch.enabled;
      }
      if (patch.allowedRoles !== undefined) {
        const wanted = normalise(patch.allowedRoles);
        const stored = normalise(row.allowedRoles);
        if (wanted.join() !== stored.join()) {
          before.allowedRoles = stored;
          after.allowedRoles = wanted;
        }
      }
      if (Object.keys(after).length === 0) {
        return { outcome: 'unchanged', record: toRecord(row) };
      }

      const updated = await tx.featureFlag.update({
        where: { key },
        data: { ...after, updatedById },
        include: WITH_EDITOR,
      });
      await onUpdated?.(tx, { before, after });
      return { outcome: 'updated', before, after, record: toRecord(updated) };
    });
  }
}
