import { Inject, Injectable } from '@nestjs/common';
import { ShopperAccountState } from '@prisma/client';
import {
  APPLICATION_LOCKED_STATES,
  ApplicationLockedError,
  PROFILE_EDIT_BLOCKED_STATES,
  PROFILE_FROZEN_STATES,
  ProfileEditBlockedError,
  applicationLockedMessage,
  SHOPPER_PROFILE_REPOSITORY,
  SHOPPING_REFERENCE_REPOSITORY,
  IShopperProfileRepository,
  IShoppingReferenceRepository,
} from '@/database/repositories';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@common/exceptions/base.exception';
import { toCategory, toLocation, toProfile, toService } from './shopper.mapper';
import {
  ExtraServiceResponseDto,
  OnboardShopperDto,
  SetAvailabilityDto,
  ShopperProfileResponseDto,
  ShoppingCategoryResponseDto,
  ShoppingLocationResponseDto,
  UpdateShopperProfileDto,
} from './dto';

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

    if (APPLICATION_LOCKED_STATES.includes(profile.accountState)) {
      throw new ConflictException(applicationLockedMessage(profile.accountState));
    }

    await this.assertReferences(dto);
    assertAvailability(dto.availability);

    const { phone, ...input } = dto;
    try {
      return toProfile(await this.profiles.submitApplication(profile.id, userId, input, phone));
    } catch (error) {
      // The precheck above read the state before the repository's lock; this is
      // the same rule re-checked under it.
      if (error instanceof ApplicationLockedError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  async updateProfile(
    userId: string,
    dto: UpdateShopperProfileDto,
  ): Promise<ShopperProfileResponseDto> {
    const profile = await this.profiles.ensureByUserId(userId);

    if (PROFILE_EDIT_BLOCKED_STATES.includes(profile.accountState)) {
      throw editBlocked(profile.accountState);
    }

    await this.assertReferences(dto);
    assertAvailability(dto.availability);

    try {
      return toProfile(await this.profiles.update(profile.id, dto));
    } catch (error) {
      // Same rule, re-checked under the repository's row lock.
      if (error instanceof ProfileEditBlockedError) {
        throw editBlocked(error.accountState);
      }
      throw error;
    }
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

/** Frozen accounts get 403; an application under review gets 409 (it can be edited again once sent back). */
function editBlocked(state: ShopperAccountState): ForbiddenException | ConflictException {
  return PROFILE_FROZEN_STATES.includes(state)
    ? new ForbiddenException('This account is not allowed to edit its profile')
    : new ConflictException(applicationLockedMessage(state));
}
