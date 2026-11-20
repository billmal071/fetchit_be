import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, ShopperAccountState, Weekday } from '@prisma/client';
import { ShopperService } from './shopper.service';
import {
  SHOPPER_PROFILE_REPOSITORY,
  SHOPPING_REFERENCE_REPOSITORY,
  ShopperProfileWithDetails,
} from '@/database/repositories';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@common/exceptions/base.exception';
import { OnboardShopperDto, UpdateShopperProfileDto } from './dto';

const CAT = '550e8400-e29b-41d4-a716-446655440001';
const LOC = '550e8400-e29b-41d4-a716-446655440002';
const SVC = '550e8400-e29b-41d4-a716-446655440003';

describe('ShopperService', () => {
  let service: ShopperService;
  let profiles: Record<string, jest.Mock>;
  let reference: Record<string, jest.Mock>;

  const userId = 'user-1';

  const makeProfile = (
    overrides: Partial<ShopperProfileWithDetails> = {},
  ): ShopperProfileWithDetails =>
    ({
      id: 'profile-1',
      userId,
      accountState: ShopperAccountState.REGISTERED,
      displayName: null,
      bio: null,
      yearsOfExperience: null,
      isOnline: false,
      rating: null,
      completedOrders: 0,
      completionRate: null,
      payoutAccountVerified: false,
      rejectionReason: null,
      submittedAt: null,
      createdAt: new Date('2026-11-20T10:00:00.000Z'),
      updatedAt: new Date('2026-11-20T11:00:00.000Z'),
      categories: [],
      locations: [],
      services: [],
      availability: [],
      user: { avatar: null },
      ...overrides,
    }) as ShopperProfileWithDetails;

  const onboardDto = (overrides: Partial<OnboardShopperDto> = {}): OnboardShopperDto =>
    ({
      displayName: 'Amaka O.',
      bio: 'Six years buying for restaurants around Mile 12.',
      categoryIds: [CAT],
      locationIds: [LOC],
      ...overrides,
    }) as OnboardShopperDto;

  beforeEach(async () => {
    profiles = {
      ensureByUserId: jest.fn().mockResolvedValue(makeProfile()),
      update: jest.fn().mockImplementation(async () => makeProfile()),
      submitApplication: jest
        .fn()
        .mockImplementation(async () =>
          makeProfile({ accountState: ShopperAccountState.VERIFICATION_PENDING }),
        ),
      setOnline: jest
        .fn()
        .mockImplementation(async (_id: string, isOnline: boolean) =>
          makeProfile({ accountState: ShopperAccountState.APPROVED, isOnline }),
        ),
    };
    reference = {
      listCategories: jest.fn(),
      listLocations: jest.fn(),
      listServices: jest.fn(),
      findActiveCategoryIds: jest.fn().mockImplementation(async (ids: string[]) => ids),
      findActiveLocationIds: jest.fn().mockImplementation(async (ids: string[]) => ids),
      findActiveServiceIds: jest.fn().mockImplementation(async (ids: string[]) => ids),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopperService,
        { provide: SHOPPER_PROFILE_REPOSITORY, useValue: profiles },
        { provide: SHOPPING_REFERENCE_REPOSITORY, useValue: reference },
      ],
    }).compile();

    service = module.get(ShopperService);
  });

  describe('reference data', () => {
    it('drops null fields so the client sees "not applicable", not null', async () => {
      reference.listCategories.mockResolvedValue([
        { id: CAT, name: 'Fashion', slug: 'fashion', icon: null, isActive: true },
      ]);
      reference.listLocations.mockResolvedValue([
        { id: LOC, name: 'Yaba', city: null, state: 'Lagos', isActive: true },
      ]);
      reference.listServices.mockResolvedValue([
        { id: SVC, name: 'Gift wrapping', description: null, fee: 1500, isActive: true },
        { id: 'svc-2', name: 'Packing', description: 'Box it', fee: null, isActive: true },
      ]);

      const categories = await service.listCategories();
      const locations = await service.listLocations();
      const services = await service.listServices();

      expect(categories).toEqual([{ id: CAT, name: 'Fashion', slug: 'fashion', icon: undefined }]);
      expect('icon' in JSON.parse(JSON.stringify(categories[0]))).toBe(false);
      expect(locations[0]).toEqual({ id: LOC, name: 'Yaba', city: undefined, state: 'Lagos' });
      expect(services[0].fee).toBe(1500);
      // A configured fee of 0 would be a real zero; a missing fee must stay missing.
      expect(services[1].fee).toBeUndefined();
    });
  });

  describe('getProfile', () => {
    it('maps relations and numbers, and omits what is null', async () => {
      profiles.ensureByUserId.mockResolvedValue(
        makeProfile({
          displayName: 'Amaka O.',
          rating: new Prisma.Decimal('4.85'),
          completionRate: new Prisma.Decimal('97.5'),
          completedOrders: 61,
          user: { avatar: 'https://cdn.example/a.png' },
          categories: [
            {
              shopperProfileId: 'profile-1',
              categoryId: CAT,
              category: { id: CAT, name: 'Fashion', slug: 'fashion', icon: null },
            },
          ] as never,
          availability: [
            {
              id: 'a1',
              shopperProfileId: 'profile-1',
              weekday: Weekday.MONDAY,
              startTime: '08:00',
              endTime: null,
            },
          ] as never,
        }),
      );

      const profile = await service.getProfile(userId);

      expect(profile.rating).toBe(4.85);
      expect(profile.completionRate).toBe(97.5);
      expect(profile.completedOrders).toBe(61);
      expect(profile.avatarUrl).toBe('https://cdn.example/a.png');
      expect(profile.categories).toEqual([
        { id: CAT, name: 'Fashion', slug: 'fashion', icon: undefined },
      ]);
      expect(profile.availability).toEqual([
        { weekday: Weekday.MONDAY, startTime: '08:00', endTime: undefined },
      ]);
      expect(profile.bio).toBeUndefined();
      expect(profile.createdAt).toBe('2026-11-20T10:00:00.000Z');
    });

    it('keeps a real zero rating distinct from no rating', async () => {
      profiles.ensureByUserId.mockResolvedValue(makeProfile({ rating: new Prisma.Decimal('0') }));

      expect((await service.getProfile(userId)).rating).toBe(0);
    });
  });

  describe('submitOnboarding', () => {
    it('submits the application and hands the phone number over separately', async () => {
      const result = await service.submitOnboarding(
        userId,
        onboardDto({ phone: '+2348012345678', yearsOfExperience: 6, serviceIds: [SVC] }),
      );

      expect(profiles.submitApplication).toHaveBeenCalledWith(
        'profile-1',
        userId,
        expect.objectContaining({
          displayName: 'Amaka O.',
          categoryIds: [CAT],
          locationIds: [LOC],
          serviceIds: [SVC],
          yearsOfExperience: 6,
        }),
        '+2348012345678',
      );
      // The phone belongs to the user row, not the profile input.
      expect(profiles.submitApplication.mock.calls[0][2]).not.toHaveProperty('phone');
      expect(result.accountState).toBe(ShopperAccountState.VERIFICATION_PENDING);
    });

    it.each([
      ShopperAccountState.REGISTERED,
      ShopperAccountState.ONBOARDING,
      ShopperAccountState.VERIFICATION_PENDING,
      ShopperAccountState.VERIFICATION_REQUIRES_UPDATE,
    ])('allows (re)submitting from %s', async (accountState) => {
      profiles.ensureByUserId.mockResolvedValue(makeProfile({ accountState }));

      await expect(service.submitOnboarding(userId, onboardDto())).resolves.toBeDefined();
    });

    it.each([
      ShopperAccountState.APPROVED,
      ShopperAccountState.SUSPENDED,
      ShopperAccountState.DEACTIVATED,
    ])('rejects with 409 once the account is %s, and writes nothing', async (accountState) => {
      profiles.ensureByUserId.mockResolvedValue(makeProfile({ accountState }));

      await expect(service.submitOnboarding(userId, onboardDto())).rejects.toThrow(
        ConflictException,
      );
      expect(profiles.submitApplication).not.toHaveBeenCalled();
    });

    it.each([
      [
        'category',
        'findActiveCategoryIds',
        { categoryIds: ['550e8400-e29b-41d4-a716-446655440099'] },
      ],
      [
        'location',
        'findActiveLocationIds',
        { locationIds: ['550e8400-e29b-41d4-a716-446655440099'] },
      ],
      ['service', 'findActiveServiceIds', { serviceIds: ['550e8400-e29b-41d4-a716-446655440099'] }],
    ])(
      'rejects an unknown or inactive %s id with 400 and writes nothing',
      async (kind, finder, dto) => {
        reference[finder].mockResolvedValue([]);

        await expect(service.submitOnboarding(userId, onboardDto(dto))).rejects.toThrow(
          new BadRequestException(
            `Unknown or inactive ${kind} id: 550e8400-e29b-41d4-a716-446655440099`,
          ),
        );
        expect(profiles.submitApplication).not.toHaveBeenCalled();
      },
    );

    it('does not look up services when none were sent', async () => {
      await service.submitOnboarding(userId, onboardDto());

      expect(reference.findActiveServiceIds).not.toHaveBeenCalled();
    });

    it('rejects the same weekday twice, which the unique index would otherwise 500 on', async () => {
      await expect(
        service.submitOnboarding(
          userId,
          onboardDto({
            availability: [{ weekday: Weekday.MONDAY }, { weekday: Weekday.MONDAY }],
          }),
        ),
      ).rejects.toThrow('MONDAY appears more than once');
    });

    it('rejects a slot with only one of startTime / endTime', async () => {
      await expect(
        service.submitOnboarding(
          userId,
          onboardDto({ availability: [{ weekday: Weekday.MONDAY, startTime: '08:00' }] }),
        ),
      ).rejects.toThrow('startTime and endTime must be given together');
    });

    it.each([
      ['18:00', '08:00'],
      ['08:00', '08:00'],
    ])(
      'rejects a slot that does not start before it ends (%s - %s)',
      async (startTime, endTime) => {
        await expect(
          service.submitOnboarding(
            userId,
            onboardDto({ availability: [{ weekday: Weekday.MONDAY, startTime, endTime }] }),
          ),
        ).rejects.toThrow('startTime must be before endTime');
      },
    );

    it('accepts days with no times at all', async () => {
      await expect(
        service.submitOnboarding(
          userId,
          onboardDto({
            availability: [{ weekday: Weekday.MONDAY }, { weekday: Weekday.SATURDAY }],
          }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('updateProfile', () => {
    it.each([ShopperAccountState.SUSPENDED, ShopperAccountState.DEACTIVATED])(
      'is forbidden while %s',
      async (accountState) => {
        profiles.ensureByUserId.mockResolvedValue(makeProfile({ accountState }));

        await expect(
          service.updateProfile(userId, { displayName: 'New' } as UpdateShopperProfileDto),
        ).rejects.toThrow(ForbiddenException);
        expect(profiles.update).not.toHaveBeenCalled();
      },
    );

    it('is allowed for an approved shopper and passes only what was sent', async () => {
      profiles.ensureByUserId.mockResolvedValue(
        makeProfile({ accountState: ShopperAccountState.APPROVED }),
      );

      await service.updateProfile(userId, {
        bio: 'Updated bio text here',
      } as UpdateShopperProfileDto);

      expect(profiles.update).toHaveBeenCalledWith('profile-1', { bio: 'Updated bio text here' });
      expect(reference.findActiveCategoryIds).not.toHaveBeenCalled();
      expect(reference.findActiveLocationIds).not.toHaveBeenCalled();
    });

    it('passes an empty serviceIds / availability through, which clears them, without lookups', async () => {
      profiles.ensureByUserId.mockResolvedValue(
        makeProfile({ accountState: ShopperAccountState.APPROVED }),
      );

      await service.updateProfile(userId, {
        serviceIds: [],
        availability: [],
      } as UpdateShopperProfileDto);

      expect(profiles.update).toHaveBeenCalledWith('profile-1', {
        serviceIds: [],
        availability: [],
      });
      expect(reference.findActiveServiceIds).not.toHaveBeenCalled();
    });

    it('validates a replacement set before writing it', async () => {
      reference.findActiveCategoryIds.mockResolvedValue([]);

      await expect(
        service.updateProfile(userId, { categoryIds: [CAT] } as UpdateShopperProfileDto),
      ).rejects.toThrow(BadRequestException);
      expect(profiles.update).not.toHaveBeenCalled();
    });
  });

  describe('setOnline', () => {
    it.each([
      ShopperAccountState.REGISTERED,
      ShopperAccountState.ONBOARDING,
      ShopperAccountState.VERIFICATION_PENDING,
      ShopperAccountState.VERIFICATION_REQUIRES_UPDATE,
      ShopperAccountState.SUSPENDED,
      ShopperAccountState.DEACTIVATED,
    ])('is forbidden unless approved (%s)', async (accountState) => {
      profiles.ensureByUserId.mockResolvedValue(makeProfile({ accountState }));

      await expect(service.setOnline(userId, { isOnline: true })).rejects.toThrow(
        ForbiddenException,
      );
      expect(profiles.setOnline).not.toHaveBeenCalled();
    });

    it('toggles an approved shopper', async () => {
      profiles.ensureByUserId.mockResolvedValue(
        makeProfile({ accountState: ShopperAccountState.APPROVED }),
      );

      const online = await service.setOnline(userId, { isOnline: true });
      const offline = await service.setOnline(userId, { isOnline: false });

      expect(online.isOnline).toBe(true);
      expect(offline.isOnline).toBe(false);
      expect(profiles.setOnline).toHaveBeenNthCalledWith(1, 'profile-1', true);
      expect(profiles.setOnline).toHaveBeenNthCalledWith(2, 'profile-1', false);
    });
  });
});
