import { Injectable } from '@nestjs/common';
import { Prisma, ShopperAccountState } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  IShopperProfileInput,
  IShopperProfileRepository,
  ShopperProfileWithDetails,
  shopperProfileInclude,
} from './interfaces';

@Injectable()
export class ShopperProfileRepository implements IShopperProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get-or-create by userId. Race-safe: on a concurrent first read where two
   * requests both try to create, the loser's P2002 unique-constraint error is
   * swallowed and the row is re-read. A default profile is REGISTERED.
   */
  async ensureByUserId(userId: string): Promise<ShopperProfileWithDetails> {
    const existing = await this.prisma.shopperProfile.findUnique({
      where: { userId },
      include: shopperProfileInclude,
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.shopperProfile.create({
        data: { userId },
        include: shopperProfileInclude,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.shopperProfile.findUniqueOrThrow({
          where: { userId },
          include: shopperProfileInclude,
        });
      }
      throw error;
    }
  }

  async update(id: string, input: IShopperProfileInput): Promise<ShopperProfileWithDetails> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockProfile(tx, id);
      return this.write(tx, id, input, {});
    });
  }

  async submitApplication(
    id: string,
    userId: string,
    input: IShopperProfileInput,
    phone?: string,
  ): Promise<ShopperProfileWithDetails> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockProfile(tx, id);
      if (phone !== undefined) {
        await tx.user.update({ where: { id: userId }, data: { phone } });
      }
      return this.write(tx, id, input, {
        accountState: ShopperAccountState.VERIFICATION_PENDING,
        submittedAt: new Date(),
        rejectionReason: null,
      });
    });
  }

  async setOnline(id: string, isOnline: boolean): Promise<ShopperProfileWithDetails> {
    return this.prisma.shopperProfile.update({
      where: { id },
      data: { isOnline },
      include: shopperProfileInclude,
    });
  }

  /**
   * Lock the profile row until the surrounding transaction commits. Every write
   * path takes this FIRST, before touching the user row or any child table.
   *
   * A relation set is replaced by delete-then-insert. At Read Committed, two
   * concurrent replacements would each delete before either inserts, both
   * commit, and the profile ends up with the UNION of the two sets. With the
   * lock, the second waits for the first to commit and its delete then sees the
   * first one's rows.
   */
  private async lockProfile(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM shopper_profiles WHERE id = ${id} FOR UPDATE`;
  }

  /** Profile row + every relation set that was given, inside a transaction that holds the lock. */
  private async write(
    tx: Prisma.TransactionClient,
    id: string,
    input: IShopperProfileInput,
    extra: Prisma.ShopperProfileUpdateInput,
  ): Promise<ShopperProfileWithDetails> {
    if (input.categoryIds) {
      await tx.shopperProfileCategory.deleteMany({ where: { shopperProfileId: id } });
      await tx.shopperProfileCategory.createMany({
        data: input.categoryIds.map((categoryId) => ({ shopperProfileId: id, categoryId })),
      });
    }
    if (input.locationIds) {
      await tx.shopperProfileLocation.deleteMany({ where: { shopperProfileId: id } });
      await tx.shopperProfileLocation.createMany({
        data: input.locationIds.map((locationId) => ({ shopperProfileId: id, locationId })),
      });
    }
    if (input.serviceIds) {
      await tx.shopperProfileService.deleteMany({ where: { shopperProfileId: id } });
      await tx.shopperProfileService.createMany({
        data: input.serviceIds.map((serviceId) => ({ shopperProfileId: id, serviceId })),
      });
    }
    if (input.availability) {
      await tx.shopperAvailability.deleteMany({ where: { shopperProfileId: id } });
      await tx.shopperAvailability.createMany({
        data: input.availability.map((slot) => ({
          shopperProfileId: id,
          weekday: slot.weekday,
          startTime: slot.startTime ?? null,
          endTime: slot.endTime ?? null,
        })),
      });
    }

    return tx.shopperProfile.update({
      where: { id },
      data: {
        ...(input.displayName !== undefined && { displayName: input.displayName }),
        ...(input.bio !== undefined && { bio: input.bio }),
        ...(input.yearsOfExperience !== undefined && {
          yearsOfExperience: input.yearsOfExperience,
        }),
        ...extra,
      },
      include: shopperProfileInclude,
    });
  }
}
