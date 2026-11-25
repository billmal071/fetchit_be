import { Test, TestingModule } from '@nestjs/testing';
import { ShopperAccountState } from '@prisma/client';
import { AdminShopperVerificationService } from './admin-shopper-verification.service';
import { SHOPPER_PROFILE_REPOSITORY, ShopperApplication } from '@/database/repositories';
import { AuditService } from '@common/services/audit.service';
import { AUDIT_ACTIONS } from '@common/constants';
import {
  InvalidVerificationTransitionException,
  ResourceNotFoundException,
  StaleVerificationSubmissionException,
} from '@common/exceptions/domain.exception';
import { ApproveShopperDto, RejectShopperDto, ShopperApplicationQueryDto } from './dto';

const { VERIFICATION_PENDING, APPROVED, VERIFICATION_REQUIRES_UPDATE } = ShopperAccountState;

describe('AdminShopperVerificationService', () => {
  let service: AdminShopperVerificationService;
  let profiles: Record<string, jest.Mock>;
  let audit: { log: jest.Mock };

  const adminId = 'admin-1';
  const profileId = 'profile-1';
  const loadedAt = '2026-11-20T10:00:00.000Z';
  const approveDto = { submittedAt: loadedAt } as ApproveShopperDto;

  const makeApplication = (overrides: Partial<ShopperApplication> = {}): ShopperApplication =>
    ({
      id: profileId,
      userId: 'user-1',
      accountState: VERIFICATION_PENDING,
      displayName: 'Amaka O.',
      bio: 'Six years buying for restaurants around Mile 12.',
      yearsOfExperience: 6,
      isOnline: false,
      rating: null,
      completedOrders: 0,
      completionRate: null,
      payoutAccountVerified: false,
      rejectionReason: null,
      submittedAt: new Date('2026-11-20T10:00:00.000Z'),
      reviewedById: null,
      reviewedAt: null,
      createdAt: new Date('2026-11-20T09:00:00.000Z'),
      updatedAt: new Date('2026-11-20T10:00:00.000Z'),
      categories: [],
      locations: [],
      services: [],
      availability: [],
      user: {
        id: 'user-1',
        username: 'amaka',
        email: 'amaka@example.com',
        phone: '+2348012345678',
        avatar: null,
      },
      ...overrides,
    }) as ShopperApplication;

  beforeEach(async () => {
    profiles = {
      findApplications: jest.fn(),
      findApplicationById: jest.fn().mockResolvedValue(makeApplication()),
      transitionState: jest.fn().mockResolvedValue(true),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminShopperVerificationService,
        { provide: SHOPPER_PROFILE_REPOSITORY, useValue: profiles },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(AdminShopperVerificationService);
  });

  describe('list', () => {
    it('lists applications awaiting review by default, with applicant details', async () => {
      profiles.findApplications.mockResolvedValue({ rows: [makeApplication()], total: 1 });

      const result = await service.list({} as ShopperApplicationQueryDto);

      expect(profiles.findApplications).toHaveBeenCalledWith(VERIFICATION_PENDING, 0, 10);
      expect(result.data[0].user).toEqual({
        id: 'user-1',
        username: 'amaka',
        email: 'amaka@example.com',
        phone: '+2348012345678',
      });
      expect(result.data[0].submittedAt).toBe('2026-11-20T10:00:00.000Z');
      expect(result.meta).toMatchObject({ page: 1, limit: 10, total: 1 });
    });

    it('filters by state and turns page/limit into skip/take', async () => {
      profiles.findApplications.mockResolvedValue({ rows: [], total: 0 });

      await service.list({ state: APPROVED, page: 3, limit: 20 } as ShopperApplicationQueryDto);

      expect(profiles.findApplications).toHaveBeenCalledWith(APPROVED, 40, 20);
    });
  });

  describe('getForReview', () => {
    it('returns the application', async () => {
      expect((await service.getForReview(profileId)).id).toBe(profileId);
    });

    it('is a 404 for an unknown id', async () => {
      profiles.findApplicationById.mockResolvedValue(null);

      await expect(service.getForReview('nope')).rejects.toThrow(ResourceNotFoundException);
    });
  });

  describe('approve', () => {
    it('moves a pending application to APPROVED, recording the reviewer, and audits it', async () => {
      profiles.findApplicationById.mockResolvedValueOnce(makeApplication()).mockResolvedValueOnce(
        makeApplication({
          accountState: APPROVED,
          reviewedById: adminId,
          reviewedAt: new Date('2026-11-20T11:00:00.000Z'),
        }),
      );

      const result = await service.approve(profileId, adminId, approveDto);

      expect(profiles.transitionState).toHaveBeenCalledWith(
        profileId,
        VERIFICATION_PENDING,
        APPROVED,
        adminId,
        null,
        new Date(loadedAt),
      );
      expect(result.accountState).toBe(APPROVED);
      expect(result.reviewedById).toBe(adminId);
      expect(audit.log).toHaveBeenCalledWith({
        userId: adminId,
        action: AUDIT_ACTIONS.SHOPPER_APPROVE,
        entity: 'ShopperProfile',
        entityId: profileId,
        details: undefined,
      });
    });

    it('is a 404 for an unknown id and changes nothing', async () => {
      profiles.findApplicationById.mockResolvedValue(null);

      await expect(service.approve('nope', adminId, approveDto)).rejects.toThrow(
        ResourceNotFoundException,
      );
      expect(profiles.transitionState).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it.each([
      ShopperAccountState.REGISTERED,
      ShopperAccountState.ONBOARDING,
      ShopperAccountState.VERIFICATION_REQUIRES_UPDATE,
      ShopperAccountState.APPROVED,
      ShopperAccountState.SUSPENDED,
      ShopperAccountState.DEACTIVATED,
    ])('refuses to approve an application that is %s', async (accountState) => {
      // An account that never submitted (REGISTERED / ONBOARDING) must not be
      // approvable, and neither may one already decided, suspended or closed.
      profiles.findApplicationById.mockResolvedValue(makeApplication({ accountState }));

      await expect(service.approve(profileId, adminId, approveDto)).rejects.toThrow(
        InvalidVerificationTransitionException,
      );
      expect(profiles.transitionState).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('reports the state it found when it loses a race, not the one it read first', async () => {
      // Another admin (or the shopper resubmitting) got in between the read
      // and the UPDATE: the conditional UPDATE matched nothing.
      profiles.transitionState.mockResolvedValue(false);
      profiles.findApplicationById
        .mockResolvedValueOnce(makeApplication())
        .mockResolvedValueOnce(makeApplication({ accountState: VERIFICATION_REQUIRES_UPDATE }));

      await expect(service.approve(profileId, adminId, approveDto)).rejects.toThrow(
        'Cannot transition from VERIFICATION_REQUIRES_UPDATE to APPROVED',
      );
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('refuses a stale approve after send-back and resubmit: 409, nothing changes, no event', async () => {
      // Admin A loaded the application at `loadedAt`. Admin B sent it back, the
      // shopper edited and resubmitted: pending again, but a NEW submittedAt.
      const resubmitted = makeApplication({ submittedAt: new Date('2026-11-21T08:30:00.000Z') });
      profiles.findApplicationById.mockResolvedValue(resubmitted);

      const attempt = service.approve(profileId, adminId, approveDto);

      await expect(attempt).rejects.toThrow(StaleVerificationSubmissionException);
      await expect(attempt).rejects.toMatchObject({ response: { statusCode: 409 } });
      await expect(attempt).rejects.toThrow(/resubmitted/);
      expect(profiles.transitionState).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(resubmitted.accountState).toBe(VERIFICATION_PENDING);
    });

    it('reports a resubmission, not an invalid transition, when the resubmit lands mid-decision', async () => {
      // Read saw the loaded submission; the shopper resubmitted before the UPDATE.
      profiles.transitionState.mockResolvedValue(false);
      profiles.findApplicationById
        .mockResolvedValueOnce(makeApplication())
        .mockResolvedValueOnce(
          makeApplication({ submittedAt: new Date('2026-11-21T08:30:00.000Z') }),
        );

      const attempt = service.approve(profileId, adminId, approveDto);

      await expect(attempt).rejects.toThrow(StaleVerificationSubmissionException);
      await expect(attempt).rejects.not.toThrow(/Cannot transition/);
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('still succeeds when the audit write fails: the decision is already committed', async () => {
      audit.log.mockRejectedValue(new Error('audit table unavailable'));

      await expect(service.approve(profileId, adminId, approveDto)).resolves.toBeDefined();
      expect(profiles.transitionState).toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    const dto = {
      reason: 'Please add a market you know well.',
      submittedAt: loadedAt,
    } as RejectShopperDto;

    it('sends a pending application back with the reason, and audits it', async () => {
      await service.reject(profileId, adminId, dto);

      expect(profiles.transitionState).toHaveBeenCalledWith(
        profileId,
        VERIFICATION_PENDING,
        VERIFICATION_REQUIRES_UPDATE,
        adminId,
        'Please add a market you know well.',
        new Date(loadedAt),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.SHOPPER_REJECT,
          details: { reason: 'Please add a market you know well.' },
        }),
      );
    });

    it.each([ShopperAccountState.APPROVED, ShopperAccountState.REGISTERED])(
      'refuses to send back an application that is %s',
      async (accountState) => {
        profiles.findApplicationById.mockResolvedValue(makeApplication({ accountState }));

        await expect(service.reject(profileId, adminId, dto)).rejects.toThrow(
          InvalidVerificationTransitionException,
        );
        expect(profiles.transitionState).not.toHaveBeenCalled();
      },
    );

    it('refuses to send back a resubmitted application the reviewer never saw', async () => {
      profiles.findApplicationById.mockResolvedValue(
        makeApplication({ submittedAt: new Date('2026-11-21T08:30:00.000Z') }),
      );

      await expect(service.reject(profileId, adminId, dto)).rejects.toThrow(
        StaleVerificationSubmissionException,
      );
      expect(profiles.transitionState).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('is a 404 for an unknown id', async () => {
      profiles.findApplicationById.mockResolvedValue(null);

      await expect(service.reject('nope', adminId, dto)).rejects.toThrow(ResourceNotFoundException);
    });
  });
});
