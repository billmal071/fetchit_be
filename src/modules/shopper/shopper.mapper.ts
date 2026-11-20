import type { ExtraService, ShoppingCategory, ShoppingLocation } from '@prisma/client';
import type { ShopperApplication, ShopperProfileWithDetails } from '@/database/repositories';
import {
  AvailabilityResponseDto,
  ExtraServiceResponseDto,
  ShopperApplicationResponseDto,
  ShopperProfileResponseDto,
  ShoppingCategoryResponseDto,
  ShoppingLocationResponseDto,
} from './dto';

/**
 * The contract omits a field to mean "not applicable", so nulls are dropped
 * rather than sent: the UI treats a missing field differently from a real 0.
 */
const orUndefined = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

export function toCategory(row: ShoppingCategory): ShoppingCategoryResponseDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: orUndefined(row.icon),
  };
}

export function toLocation(row: ShoppingLocation): ShoppingLocationResponseDto {
  return {
    id: row.id,
    name: row.name,
    city: orUndefined(row.city),
    state: orUndefined(row.state),
  };
}

export function toService(row: ExtraService): ExtraServiceResponseDto {
  return {
    id: row.id,
    name: row.name,
    description: orUndefined(row.description),
    fee: orUndefined(row.fee),
  };
}

export function toProfile(profile: ShopperProfileWithDetails): ShopperProfileResponseDto {
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

export function toApplication(application: ShopperApplication): ShopperApplicationResponseDto {
  return {
    ...toProfile(application),
    user: {
      id: application.user.id,
      username: application.user.username,
      email: application.user.email,
      phone: orUndefined(application.user.phone),
    },
    submittedAt: application.submittedAt?.toISOString(),
    reviewedAt: application.reviewedAt?.toISOString(),
    reviewedById: orUndefined(application.reviewedById),
  };
}
