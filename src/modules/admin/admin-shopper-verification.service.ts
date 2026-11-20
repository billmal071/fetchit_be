import { Inject, Injectable, Logger } from '@nestjs/common';
import { ShopperAccountState } from '@prisma/client';
import {
  IShopperProfileRepository,
  SHOPPER_PROFILE_REPOSITORY,
  ShopperApplication,
} from '@/database/repositories';
import { AuditService } from '@common/services/audit.service';
import { AUDIT_ACTIONS } from '@common/constants';
import { createPaginationMeta } from '@common/utils/pagination.util';
import type { IPaginatedResult } from '@common/interfaces';
import {
  InvalidVerificationTransitionException,
  ResourceNotFoundException,
} from '@common/exceptions/domain.exception';
import { ShopperApplicationResponseDto } from '@modules/shopper/dto';
import { toApplication } from '@modules/shopper/shopper.mapper';
import { RejectShopperDto, ShopperApplicationQueryDto } from './dto';

/**
 * Admin review of shopper applications. An application is "pending" once the
 * shopper has submitted it (VERIFICATION_PENDING). Approving it makes the
 * account APPROVED, which is what unlocks going online and the request feed;
 * sending it back moves it to VERIFICATION_REQUIRES_UPDATE with a reason, and
 * the shopper can resubmit from there.
 */
@Injectable()
export class AdminShopperVerificationService {
  private readonly logger = new Logger(AdminShopperVerificationService.name);

  constructor(
    @Inject(SHOPPER_PROFILE_REPOSITORY)
    private readonly profiles: IShopperProfileRepository,
    private readonly auditService: AuditService,
  ) {}

  async list(
    query: ShopperApplicationQueryDto,
  ): Promise<IPaginatedResult<ShopperApplicationResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const state = query.state ?? ShopperAccountState.VERIFICATION_PENDING;

    const { rows, total } = await this.profiles.findApplications(state, (page - 1) * limit, limit);

    return { data: rows.map(toApplication), meta: createPaginationMeta(page, limit, total) };
  }

  async getForReview(id: string): Promise<ShopperApplicationResponseDto> {
    return toApplication(await this.find(id));
  }

  async approve(id: string, adminUserId: string): Promise<ShopperApplicationResponseDto> {
    await this.transition(id, ShopperAccountState.APPROVED, adminUserId, null);

    await this.audit(adminUserId, AUDIT_ACTIONS.SHOPPER_APPROVE, id);
    return toApplication(await this.find(id));
  }

  async reject(
    id: string,
    adminUserId: string,
    dto: RejectShopperDto,
  ): Promise<ShopperApplicationResponseDto> {
    await this.transition(
      id,
      ShopperAccountState.VERIFICATION_REQUIRES_UPDATE,
      adminUserId,
      dto.reason,
    );

    await this.audit(adminUserId, AUDIT_ACTIONS.SHOPPER_REJECT, id, { reason: dto.reason });
    return toApplication(await this.find(id));
  }

  /**
   * Only a pending application can be reviewed. The state check is repeated
   * inside the UPDATE, so if two admins act at once, or the shopper resubmits
   * while one is deciding, exactly one wins and the rest are told the state
   * they found.
   */
  private async transition(
    id: string,
    to: ShopperAccountState,
    adminUserId: string,
    rejectionReason: string | null,
  ): Promise<void> {
    const current = await this.find(id);

    if (current.accountState !== ShopperAccountState.VERIFICATION_PENDING) {
      throw new InvalidVerificationTransitionException(current.accountState, to);
    }

    const moved = await this.profiles.transitionState(
      id,
      ShopperAccountState.VERIFICATION_PENDING,
      to,
      adminUserId,
      rejectionReason,
    );

    if (!moved) {
      // Lost a race: say what it is now, not what it was a moment ago.
      const latest = await this.find(id);
      throw new InvalidVerificationTransitionException(latest.accountState, to);
    }
  }

  private async find(id: string): Promise<ShopperApplication> {
    const application = await this.profiles.findApplicationById(id);
    if (!application) {
      throw new ResourceNotFoundException('ShopperProfile', id);
    }
    return application;
  }

  /**
   * Best-effort. By now the decision is committed; failing the request over a
   * missing audit row would tell the admin it did not happen, and a retry
   * would then be refused as an invalid transition.
   */
  private async audit(
    adminUserId: string,
    action: string,
    id: string,
    details?: Record<string, string>,
  ): Promise<void> {
    try {
      await this.auditService.log({
        userId: adminUserId,
        action,
        entity: 'ShopperProfile',
        entityId: id,
        details,
      });
    } catch (error) {
      this.logger.error(`Failed to record ${action} for shopper profile ${id}: ${error}`);
    }
  }
}
