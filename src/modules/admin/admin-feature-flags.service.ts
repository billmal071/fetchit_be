import { Inject, Injectable } from '@nestjs/common';
import {
  FEATURE_FLAG_REPOSITORY,
  IFeatureFlagPatch,
  IFeatureFlagRecord,
  IFeatureFlagRepository,
} from '@/database/repositories';
import { BadRequestException, NotFoundException } from '@common/exceptions/base.exception';
import { AuditService } from '@common/services/audit.service';
import { FeatureFlagService } from '@modules/feature-flags/feature-flag.service';
import { FeatureFlagAdminResponseDto, UpdateFeatureFlagDto } from './dto';

const toResponse = (record: IFeatureFlagRecord): FeatureFlagAdminResponseDto => ({
  key: record.key,
  description: record.description,
  enabled: record.enabled,
  allowedRoles: record.allowedRoles,
  updatedAt: record.updatedAt.toISOString(),
  updatedBy: record.updatedBy,
});

/** Admin view and edit of the feature flags. Flags are defined in code; there is no create or delete. */
@Injectable()
export class AdminFeatureFlagsService {
  constructor(
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly repository: IFeatureFlagRepository,
    private readonly flags: FeatureFlagService,
    private readonly auditService: AuditService,
  ) {}

  async list(): Promise<FeatureFlagAdminResponseDto[]> {
    return (await this.repository.list()).map(toResponse);
  }

  async update(
    adminId: string,
    key: string,
    dto: UpdateFeatureFlagDto,
  ): Promise<FeatureFlagAdminResponseDto> {
    const patch: IFeatureFlagPatch = {
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      ...(dto.allowedRoles !== undefined && { allowedRoles: dto.allowedRoles }),
    };
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Send enabled, allowedRoles, or both');
    }

    // The audit row is written in the update's own transaction: a flag is never changed
    // unaudited, and if the audit insert fails the change rolls back and the error
    // propagates (500), so a retry applies AND audits it.
    const result = await this.repository.update(key, patch, adminId, (tx, change) =>
      this.auditService.log(
        {
          userId: adminId,
          action: 'FEATURE_FLAG_UPDATED',
          entity: 'FeatureFlag',
          entityId: key,
          details: { before: { ...change.before }, after: { ...change.after } },
        },
        tx,
      ),
    );
    if (result.outcome === 'not_found') {
      throw new NotFoundException('Feature flag');
    }
    if (result.outcome === 'unchanged') {
      return toResponse(result.record);
    }

    // Only after the commit: a rolled-back edit never reaches here, so the cache is not
    // invalidated for it. This process sees the change on its very next call; others
    // within the cache TTL.
    this.flags.invalidate();
    return toResponse(result.record);
  }
}
