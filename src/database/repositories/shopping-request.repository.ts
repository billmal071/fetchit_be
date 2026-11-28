import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, ShoppingRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  CancelShoppingRequestResult,
  ICreateShoppingRequestInput,
  IShopperFeedQuery,
  IShoppingRequestRepository,
  ShoppingRequestListRow,
  ShoppingRequestWithItems,
  shopperCoverageWhere,
  shopperMatchWhere,
  shoppingRequestInclude,
  shoppingRequestListInclude,
} from './interfaces';

const REFERENCE_ATTEMPTS = 5;
// No 0/O/1/I: references are read out and typed by people.
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `<prefix>-` plus 8 random characters, e.g. SR-K7M2QX9D (requests) or SO-K7M2QX9D (orders). */
export function generateReference(prefix = 'SR'): string {
  const bytes = randomBytes(8);
  let out = `${prefix}-`;
  for (const byte of bytes) {
    out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  }
  return out;
}

export const isUniqueViolation = (error: unknown, field?: string): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  if (!field) return true;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target).includes(field);
};

@Injectable()
export class ShoppingRequestRepository implements IShoppingRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: ICreateShoppingRequestInput): Promise<ShoppingRequestWithItems> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.shoppingRequest.create({
          data: {
            reference: generateReference(),
            customerId: input.customerId,
            shoppingLocationId: input.shoppingLocationId,
            handoffArea: input.handoffArea,
            deliveryAddress: input.deliveryAddress,
            deliveryLatitude: input.deliveryLatitude,
            deliveryLongitude: input.deliveryLongitude,
            note: input.note,
            estimatedGoodsBudget: input.estimatedGoodsBudget,
            estimate: input.estimate,
            offerDeadline: input.offerDeadline,
            items: {
              create: input.items.map((item, position) => ({
                position,
                name: item.name,
                brand: item.brand,
                size: item.size,
                quantity: item.quantity,
                unit: item.unit,
                estimatedUnitPrice: item.estimatedUnitPrice,
                notes: item.notes,
                substitutionPreference: item.substitutionPreference,
                maxSubstitutePrice: item.maxSubstitutePrice,
                categoryId: item.categoryId,
              })),
            },
          },
          include: shoppingRequestInclude,
        });
      } catch (error) {
        // A reference collision is astronomically unlikely but cheap to survive.
        if (attempt < REFERENCE_ATTEMPTS && isUniqueViolation(error, 'reference')) {
          continue;
        }
        throw error;
      }
    }
  }

  async isShopperBarred(requestId: string, shopperProfileId: string): Promise<boolean> {
    const barred = await this.prisma.shopperOrder.findFirst({
      where: { requestId, shopperProfileId, state: 'CANCELLED' },
      select: { id: true },
    });
    return barred !== null;
  }

  async expireElapsed(
    scope: { customerId: string; requestId?: string },
    now: Date,
    acceptanceWindowMinutes: number,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - acceptanceWindowMinutes * 60_000);
    return this.prisma.$executeRaw`
      UPDATE shopping_requests r
      SET status = 'EXPIRED', updated_at = ${now}
      WHERE r.status = 'OPEN'
        AND r.customer_id = ${scope.customerId}
        AND (${scope.requestId ?? null}::text IS NULL OR r.id = ${scope.requestId ?? null})
        AND r.offer_deadline < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM shopping_offers o
          WHERE o.request_id = r.id AND o.state = 'PENDING' AND o.expires_at > ${now}
        )`;
  }

  async findOwnedById(id: string, customerId: string): Promise<ShoppingRequestWithItems | null> {
    return this.prisma.shoppingRequest.findFirst({
      where: { id, customerId },
      include: shoppingRequestInclude,
    });
  }

  async listForCustomer(
    customerId: string,
    skip: number,
    take: number,
    status?: ShoppingRequestStatus,
    now: Date = new Date(),
  ): Promise<{ rows: ShoppingRequestListRow[]; total: number }> {
    const where: Prisma.ShoppingRequestWhereInput = { customerId, ...(status && { status }) };
    const [rows, total] = await Promise.all([
      this.prisma.shoppingRequest.findMany({
        where,
        include: shoppingRequestListInclude(now),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.shoppingRequest.count({ where }),
    ]);
    return { rows, total };
  }

  async cancel(id: string, customerId: string, now: Date): Promise<CancelShoppingRequestResult> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.shoppingRequest.updateMany({
        where: { id, customerId, status: 'OPEN' },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      if (count === 1) {
        // An offer being submitted holds this row FOR SHARE, so this UPDATE
        // waited for it to commit and the offer is visible here.
        await tx.shoppingOffer.updateMany({
          where: { requestId: id, state: 'PENDING' },
          data: { state: 'EXPIRED' },
        });
        const request = await tx.shoppingRequest.findUniqueOrThrow({
          where: { id },
          include: shoppingRequestInclude,
        });
        return { outcome: 'cancelled', request };
      }
      const current = await tx.shoppingRequest.findFirst({
        where: { id, customerId },
        select: { status: true },
      });
      return current ? { outcome: 'not_open', status: current.status } : { outcome: 'not_found' };
    });
  }

  async findMatchingForShopper(
    query: IShopperFeedQuery,
  ): Promise<{ rows: ShoppingRequestWithItems[]; total: number }> {
    const where: Prisma.ShoppingRequestWhereInput = {
      AND: [
        shopperMatchWhere(query.shopperProfileId, query.now),
        ...(query.locationId ? [{ shoppingLocationId: query.locationId }] : []),
        ...(query.categoryId ? [{ items: { some: { categoryId: query.categoryId } } }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.shoppingRequest.findMany({
        where,
        include: shoppingRequestInclude,
        // `id` breaks ties so a page boundary never repeats or skips a row.
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.shoppingRequest.count({ where }),
    ]);
    return { rows, total };
  }

  async findCoveredByShopper(
    id: string,
    shopperProfileId: string,
  ): Promise<ShoppingRequestWithItems | null> {
    return this.prisma.shoppingRequest.findFirst({
      where: { id, ...shopperCoverageWhere(shopperProfileId) },
      include: shoppingRequestInclude,
    });
  }

  async findReadableByShopper(
    id: string,
    shopperProfileId: string,
    now: Date,
  ): Promise<ShoppingRequestWithItems | null> {
    return this.prisma.shoppingRequest.findFirst({
      where: {
        id,
        OR: [shopperMatchWhere(shopperProfileId, now), { offers: { some: { shopperProfileId } } }],
      },
      include: shoppingRequestInclude,
    });
  }
}
