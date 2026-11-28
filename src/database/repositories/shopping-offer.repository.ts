import { Injectable } from '@nestjs/common';
import { Prisma, ShoppingOffer, ShoppingOfferState } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  DuplicateActiveOfferError,
  ISubmitOfferInput,
  IShoppingOfferRepository,
  OfferRequestClosedError,
  OfferWithRequest,
  OfferWithShopper,
  ShopperBarredFromRequestError,
  offerWithRequestInclude,
  offerWithShopperInclude,
} from './interfaces';

@Injectable()
export class ShoppingOfferRepository implements IShoppingOfferRepository {
  constructor(private readonly prisma: PrismaService) {}

  async submit(input: ISubmitOfferInput): Promise<OfferWithRequest> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // FOR SHARE: a concurrent cancel (an UPDATE of this row) waits for this
        // transaction, and this read waits for a cancel already in flight. The
        // OPEN check below is therefore final for the insert that follows.
        const locked = await tx.$queryRaw<Array<{ status: string; offer_deadline: Date }>>`
          SELECT status::text AS status, offer_deadline
          FROM shopping_requests WHERE id = ${input.requestId} FOR SHARE`;
        // Read the clock only now: waiting for a connection or for the row lock
        // can outlast the bidding deadline, and a time captured before it would let
        // a bid in after bidding closed.
        const now = new Date();
        const request = locked[0];
        // The deadline closes BIDDING only; the offer itself outlives it (below).
        if (!request || request.status !== 'OPEN' || request.offer_deadline <= now) {
          throw new OfferRequestClosedError();
        }
        // A cancelled order on this request bars this shopper from it. Read under the
        // same lock a cancel needs FOR UPDATE: if the cancel committed first it is
        // visible here; if this transaction holds the lock first, the bid stands.
        const barred = await tx.shopperOrder.findFirst({
          where: {
            requestId: input.requestId,
            shopperProfileId: input.shopperProfileId,
            state: 'CANCELLED',
          },
          select: { id: true },
        });
        if (barred) {
          throw new ShopperBarredFromRequestError();
        }
        return tx.shoppingOffer.create({
          data: {
            requestId: input.requestId,
            shopperProfileId: input.shopperProfileId,
            shopperFee: input.shopperFee,
            etaMinutes: input.etaMinutes,
            note: input.note,
            expiresAt: new Date(
              request.offer_deadline.getTime() + input.acceptanceWindowMinutes * 60_000,
            ),
            financials: input.financials,
          },
          include: offerWithRequestInclude,
        });
      });
    } catch (error) {
      // The partial unique index on (request, shopper) WHERE state = 'PENDING'.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateActiveOfferError();
      }
      throw error;
    }
  }

  async withdraw(id: string, shopperProfileId: string): Promise<boolean> {
    const { count } = await this.prisma.shoppingOffer.updateMany({
      where: { id, shopperProfileId, state: 'PENDING' },
      data: { state: 'WITHDRAWN' },
    });
    return count === 1;
  }

  async expireDue(
    now: Date,
    scope: { requestId?: string; shopperProfileId?: string },
  ): Promise<number> {
    const { count } = await this.prisma.shoppingOffer.updateMany({
      where: {
        state: 'PENDING',
        expiresAt: { lte: now },
        ...(scope.requestId && { requestId: scope.requestId }),
        ...(scope.shopperProfileId && { shopperProfileId: scope.shopperProfileId }),
      },
      data: { state: 'EXPIRED' },
    });
    return count;
  }

  async findOwnedById(id: string, shopperProfileId: string): Promise<OfferWithRequest | null> {
    return this.prisma.shoppingOffer.findFirst({
      where: { id, shopperProfileId },
      include: offerWithRequestInclude,
    });
  }

  async listForShopper(
    shopperProfileId: string,
    skip: number,
    take: number,
    state?: ShoppingOfferState,
  ): Promise<{ rows: OfferWithRequest[]; total: number }> {
    const where: Prisma.ShoppingOfferWhereInput = { shopperProfileId, ...(state && { state }) };
    const [rows, total] = await Promise.all([
      this.prisma.shoppingOffer.findMany({
        where,
        include: offerWithRequestInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.shoppingOffer.count({ where }),
    ]);
    return { rows, total };
  }

  async listForRequest(requestId: string): Promise<OfferWithShopper[]> {
    return this.prisma.shoppingOffer.findMany({
      // A PENDING offer from a shopper who is no longer APPROVED cannot be
      // accepted, so the customer is not shown it.
      where: {
        requestId,
        state: { not: 'WITHDRAWN' },
        OR: [{ state: { not: 'PENDING' } }, { shopperProfile: { accountState: 'APPROVED' } }],
      },
      include: offerWithShopperInclude,
      orderBy: [{ shopperFee: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async findPendingByShopperAndRequest(
    shopperProfileId: string,
    requestId: string,
  ): Promise<ShoppingOffer | null> {
    return this.prisma.shoppingOffer.findFirst({
      where: { shopperProfileId, requestId, state: 'PENDING' },
    });
  }

  async findPendingRequestIds(
    shopperProfileId: string,
    requestIds: string[],
  ): Promise<Set<string>> {
    if (requestIds.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.shoppingOffer.findMany({
      where: { shopperProfileId, state: 'PENDING', requestId: { in: requestIds } },
      select: { requestId: true },
    });
    return new Set(rows.map((row) => row.requestId));
  }
}
