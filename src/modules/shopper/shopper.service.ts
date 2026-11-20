import { Inject, Injectable } from '@nestjs/common';
import { ShopperAccountState } from '@prisma/client';
import type { ExtraService, ShoppingCategory, ShoppingLocation } from '@prisma/client';
import {
  SHOPPER_PROFILE_REPOSITORY,
  SHOPPING_REFERENCE_REPOSITORY,
  IShopperProfileRepository,
  IShoppingReferenceRepository,
  ShopperProfileWithDetails,
} from '@/database/repositories';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@common/exceptions/base.exception';
import {
  AvailabilityResponseDto,
  ExtraServiceResponseDto,
  OnboardShopperDto,
  SetAvailabilityDto,
  ShopperProfileResponseDto,
  ShoppingCategoryResponseDto,
  ShoppingLocationResponseDto,
  UpdateShopperProfileDto,
} from './dto';

/** States in which the application can no longer be (re)submitted. */
const LOCKED_STATES: ShopperAccountState[] = [
  ShopperAccountState.APPROVED,
  ShopperAccountState.SUSPENDED,
  ShopperAccountState.DEACTIVATED,
];

/** States in which a shopper cannot edit their own profile at all. */
const FROZEN_STATES: ShopperAccountState[] = [
  ShopperAccountState.SUSPENDED,
  ShopperAccountState.DEACTIVATED,
];

/**
 * The contract omits a field to mean "not applicable", so nulls are dropped
 * rather than sent: the UI treats a missing field differently from a real 0.
 */
const orUndefined = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

@Injectable()
export class ShopperService {
  constructor(
    @Inject(SHOPPER_PROFILE_REPOSITORY)
    private readonly profiles: IShopperProfileRepository,
    @Inject(SHOPPING_REFERENCE_REPOSITORY)
    private readonly reference: IShoppingReferenceRepository,
  ) {}

  // ---------------------------------------------------------------- reference

  async listCategories(): Promise<ShoppingCategoryResponseDto[]> {
    return (await this.reference.listCategories()).map(toCategory);
  }

  async listLocations(): Promise<ShoppingLocationResponseDto[]> {
    return (await this.reference.listLocations()).map(toLocation);
  }

  async listServices(): Promise<ExtraServiceResponseDto[]> {
    return (await this.reference.listServices()).map(toService);
  }

  // ------------------------------------------------------------------ profile

  async getProfile(userId: string): Promise<ShopperProfileResponseDto> {
    return toProfile(await this.profiles.ensureByUserId(userId));
  }

  /**
   * Submit the application. Allowed until the account is approved (or closed):
   * a shopper whose application is still pending, or was sent back for an
   * update, can resubmit, and the new submission replaces the old one.
   */
  async submitOnboarding(
    userId: string,
    dto: OnboardShopperDto,
  ): Promise<ShopperProfileResponseDto> {
    const profile = await this.profiles.ensureByUserId(userId);

    if (LOCKED_STATES.includes(profile.accountState)) {
      throw new ConflictException(
        `This account is ${profile.accountState.toLowerCase().replace(/_/g, ' ')} and can no longer submit an application`,
      );
    }

    await this.assertReferences(dto);
    assertAvailability(dto.availability);

    const { phone, ...input } = dto;
    return toProfile(await this.profiles.submitApplication(profile.id, userId, input, phone));
  }

  async updateProfile(
    userId: string,
    dto: UpdateShopperProfileDto,
  ): Promise<ShopperProfileResponseDto> {
    const profile = await this.profiles.ensureByUserId(userId);

    if (FROZEN_STATES.includes(profile.accountState)) {
      throw new ForbiddenException('This account is not allowed to edit its profile');
    }

    await this.assertReferences(dto);
    assertAvailability(dto.availability);

    return toProfile(await this.profiles.update(profile.id, dto));
  }

  /**
   * The dashboard's online/offline toggle. Matching trusts this flag, so only
   * an approved shopper may turn it on or off.
   */
  async setOnline(userId: string, dto: SetAvailabilityDto): Promise<ShopperProfileResponseDto> {
    const profile = await this.profiles.ensureByUserId(userId);

    if (profile.accountState !== ShopperAccountState.APPROVED) {
      throw new ForbiddenException('Only an approved shopper can go online or offline');
    }

    return toProfile(await this.profiles.setOnline(profile.id, dto.isOnline));
  }

  // ------------------------------------------------------------------ helpers

  /** Every id the client sent must be an existing, active row. */
  private async assertReferences(dto: {
    categoryIds?: string[];
    locationIds?: string[];
    serviceIds?: string[];
  }): Promise<void> {
    await this.assertActive('category', dto.categoryIds, (ids) =>
      this.reference.findActiveCategoryIds(ids),
    );
    await this.assertActive('location', dto.locationIds, (ids) =>
      this.reference.findActiveLocationIds(ids),
    );
    await this.assertActive('service', dto.serviceIds, (ids) =>
      this.reference.findActiveServiceIds(ids),
    );
  }

  private async assertActive(
    kind: string,
    ids: string[] | undefined,
    findActive: (ids: string[]) => Promise<string[]>,
  ): Promise<void> {
    if (!ids || ids.length === 0) {
      return;
    }
    const known = new Set(await findActive(ids));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown or inactive ${kind} id: ${unknown.join(', ')}`);
    }
  }
}

function assertAvailability(
  availability: Array<{ weekday: string; startTime?: string; endTime?: string }> | undefined,
): void {
  if (!availability) {
    return;
  }
  const seen = new Set<string>();
  for (const slot of availability) {
    if (seen.has(slot.weekday)) {
      throw new BadRequestException(`${slot.weekday} appears more than once in availability`);
    }
    seen.add(slot.weekday);

    if ((slot.startTime === undefined) !== (slot.endTime === undefined)) {
      throw new BadRequestException(
        `${slot.weekday}: startTime and endTime must be given together`,
      );
    }
    // HH:mm strings in the same 24-hour day compare correctly as text.
    if (
      slot.startTime !== undefined &&
      slot.endTime !== undefined &&
      slot.startTime >= slot.endTime
    ) {
      throw new BadRequestException(`${slot.weekday}: startTime must be before endTime`);
    }
  }
}

function toCategory(row: ShoppingCategory): ShoppingCategoryResponseDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: orUndefined(row.icon),
  };
}

function toLocation(row: ShoppingLocation): ShoppingLocationResponseDto {
  return {
    id: row.id,
    name: row.name,
    city: orUndefined(row.city),
    state: orUndefined(row.state),
  };
}

function toService(row: ExtraService): ExtraServiceResponseDto {
  return {
    id: row.id,
    name: row.name,
    description: orUndefined(row.description),
    fee: orUndefined(row.fee),
  };
}

function toProfile(profile: ShopperProfileWithDetails): ShopperProfileResponseDto {
  const availability: AvailabilityResponseDto[] = profile.availability.map((slot) => ({
    weekday: slot.weekday,
    startTime: orUndefined(slot.startTime),
    endTime: orUndefined(slot.endTime),
  }));

  return {
    id: profile.id,
    userId: profile.userId,
    accountState: profile.accountState,
    displayName: orUndefined(profile.displayName),
    bio: orUndefined(profile.bio),
    yearsOfExperience: orUndefined(profile.yearsOfExperience),
    avatarUrl: orUndefined(profile.user.avatar),
    isOnline: profile.isOnline,
    categories: profile.categories.map((row) => toCategory(row.category)),
    locations: profile.locations.map((row) => toLocation(row.location)),
    services: profile.services.map((row) => toService(row.service)),
    availability,
    rating: profile.rating === null ? undefined : Number(profile.rating),
    completedOrders: profile.completedOrders,
    completionRate: profile.completionRate === null ? undefined : Number(profile.completionRate),
    payoutAccountVerified: profile.payoutAccountVerified,
    rejectionReason: orUndefined(profile.rejectionReason),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
