import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderEvent, OrderState } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  AcceptOfferResult,
  CancelOrderResult,
  ICancelOrderInput,
  ICancelledOrderInfo,
  IExpireScope,
  CustomerOrder,
  IAcceptOfferInput,
  IShopperOrderRepository,
  ORDER_EVENT_TYPES,
  OrderListFilter,
  OrderTransitionResult,
  ShopperOrderForShopper,
  customerOrderInclude,
  orderStatesFor,
  shopperOrderInclude,
} from './interfaces';
import { generateReference, isUniqueViolation } from './shopping-request.repository';

const REFERENCE_ATTEMPTS = 5;

/** Recorded on the order and the event when the accept window runs out. */
export const SYSTEM_CANCEL_REASON = 'Shopper did not accept in time';

@Injectable()
export class ShopperOrderRepository implements IShopperOrderRepository {
  private readonly logger = new Logger(ShopperOrderRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async acceptOffer(input: IAcceptOfferInput): Promise<AcceptOfferResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.acceptOnce(input);
      } catch (error) {
        // A reference collision aborts the transaction; retry it whole.
        if (attempt < REFERENCE_ATTEMPTS && isUniqueViolation(error, 'reference')) {
          continue;
        }
        throw error;
      }
    }
  }

  private acceptOnce(input: IAcceptOfferInput): Promise<AcceptOfferResult> {
    return this.prisma.$transaction(async (tx): Promise<AcceptOfferResult> => {
      // FOR UPDATE: serialises with every other accept, with a cancel, and with
      // an offer being submitted (which takes FOR SHARE). Whoever gets here
      // second reads the first one's committed result.
      // Filtering on the owner in the lock query means a customer who merely
      // knows a request id locks nothing: not theirs reads the same as missing.
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS status
        FROM shopping_requests
        WHERE id = ${input.requestId} AND customer_id = ${input.customerId}
        FOR UPDATE`;
      const request = locked[0];
      if (!request) {
        return { outcome: 'not_found' };
      }
      if (request.status === 'ASSIGNED') {
        // A retry of an accept that already went through (a lost response, a
        // double tap) gets the same order back. Any other offer stays a conflict.
        const existing = await tx.shopperOrder.findFirst({
          where: {
            requestId: input.requestId,
            offerId: input.offerId,
            customerId: input.customerId,
            // A cancelled order for the same offer is history, not a retry.
            state: { not: 'CANCELLED' },
          },
          include: customerOrderInclude,
        });
        if (existing) {
          return { outcome: 'already_accepted', order: existing };
        }
      }
      if (request.status !== 'OPEN') {
        return {
          outcome: 'request_not_open',
          status: request.status as 'ASSIGNED' | 'CANCELLED' | 'EXPIRED',
        };
      }

      const offer = await tx.shoppingOffer.findFirst({
        where: { id: input.offerId, requestId: input.requestId },
        include: { shopperProfile: { select: { userId: true } } },
      });
      if (!offer) {
        return { outcome: 'not_found' };
      }
      // Take EVERY lock before judging anything time-dependent: waiting for the
      // profile lock can outlast the deadline, and a clock read before it would
      // accept an expired offer. FOR SHARE also makes an admin's suspension wait
      // for this transaction, so the state read here is final.
      const profile = await tx.$queryRaw<Array<{ account_state: string }>>`
        SELECT account_state::text AS account_state
        FROM shopper_profiles WHERE id = ${offer.shopperProfileId} FOR SHARE`;
      // The clock is read after all the locks. (Whether the offer is still
      // PENDING is decided atomically by the conditional UPDATE below.)
      const now = new Date();
      if (offer.state !== 'PENDING') {
        return { outcome: 'offer_not_pending', state: offer.state };
      }
      if (offer.expiresAt <= now) {
        return { outcome: 'offer_expired' };
      }
      // The shopper must still be able to work: a suspended shopper would hold an
      // order they get 403 on, which the customer could not cancel.
      if (profile[0]?.account_state !== 'APPROVED') {
        return { outcome: 'shopper_unavailable' };
      }

      // The offer's own shopper can withdraw without taking the request lock, so
      // this conditional UPDATE is what decides a withdraw racing the accept.
      const accepted = await tx.shoppingOffer.updateMany({
        where: { id: offer.id, state: 'PENDING' },
        data: { state: 'ACCEPTED' },
      });
      if (accepted.count !== 1) {
        const current = await tx.shoppingOffer.findUniqueOrThrow({
          where: { id: offer.id },
          select: { state: true },
        });
        return { outcome: 'offer_not_pending', state: current.state };
      }
      const assigned = await tx.shoppingRequest.updateMany({
        where: { id: input.requestId, status: 'OPEN' },
        data: { status: 'ASSIGNED' },
      });
      if (assigned.count !== 1) {
        // Unreachable under the row lock; refuse (and roll back) rather than half-apply.
        throw new Error('Accepting the offer lost the request update under the row lock');
      }

      const losers = await tx.shoppingOffer.findMany({
        where: { requestId: input.requestId, state: 'PENDING', id: { not: offer.id } },
        select: { id: true, shopperProfile: { select: { userId: true } } },
      });
      let rejectedLosers = losers;
      if (losers.length > 0) {
        const ids = losers.map((l) => l.id);
        await tx.shoppingOffer.updateMany({
          where: { id: { in: ids }, state: 'PENDING' },
          data: { state: 'REJECTED' },
        });
        // A bidder who withdrew between the read and the update stayed WITHDRAWN:
        // only those this transaction actually moved to REJECTED are told so.
        const changed = new Set(
          (
            await tx.shoppingOffer.findMany({
              where: { id: { in: ids }, state: 'REJECTED' },
              select: { id: true },
            })
          ).map((o) => o.id),
        );
        rejectedLosers = losers.filter((l) => changed.has(l.id));
      }

      const source = await tx.shoppingRequest.findUniqueOrThrow({
        where: { id: input.requestId },
        include: { items: { orderBy: { position: 'asc' } } },
      });
      const order = await tx.shopperOrder.create({
        data: {
          reference: generateReference('SO'),
          requestId: source.id,
          offerId: offer.id,
          customerId: input.customerId,
          shopperProfileId: offer.shopperProfileId,
          shoppingLocationId: source.shoppingLocationId,
          handoffArea: source.handoffArea,
          // The accepted offer's stored breakdown, copied as quoted.
          financials: offer.financials as Prisma.InputJsonValue,
          items: {
            create: source.items.map((item) => ({
              requestItemId: item.id,
              position: item.position,
              name: item.name,
              brand: item.brand,
              size: item.size,
              quantity: item.quantity,
              unit: item.unit,
              notes: item.notes,
              substitutionPreference: item.substitutionPreference,
              maxSubstitutePrice: item.maxSubstitutePrice,
              customerEstimatedPrice: item.estimatedUnitPrice,
            })),
          },
          events: {
            create: {
              type: ORDER_EVENT_TYPES.OFFER_ACCEPTED,
              actorId: input.customerId,
              actorRole: 'CUSTOMER',
              metadata: { offerId: offer.id, requestId: source.id },
            },
          },
        },
        include: customerOrderInclude,
      });

      return {
        outcome: 'accepted',
        order,
        winnerUserId: offer.shopperProfile.userId,
        requestReference: source.reference,
        rejected: rejectedLosers.map((l) => ({ offerId: l.id, userId: l.shopperProfile.userId })),
      };
    });
  }

  async listForCustomer(
    customerId: string,
    skip: number,
    take: number,
    filter?: OrderListFilter,
  ): Promise<{ rows: CustomerOrder[]; total: number }> {
    const where: Prisma.ShopperOrderWhereInput = {
      customerId,
      ...(filter && { state: orderStatesFor(filter) }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.shopperOrder.findMany({
        where,
        include: customerOrderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.shopperOrder.count({ where }),
    ]);
    return { rows, total };
  }

  async findOwnedByCustomer(id: string, customerId: string): Promise<CustomerOrder | null> {
    return this.prisma.shopperOrder.findFirst({
      where: { id, customerId },
      include: customerOrderInclude,
    });
  }

  async listForShopper(
    shopperProfileId: string,
    skip: number,
    take: number,
    filter?: OrderListFilter,
  ): Promise<{ rows: ShopperOrderForShopper[]; total: number }> {
    const where: Prisma.ShopperOrderWhereInput = {
      shopperProfileId,
      ...(filter && { state: orderStatesFor(filter) }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.shopperOrder.findMany({
        where,
        include: shopperOrderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.shopperOrder.count({ where }),
    ]);
    return { rows, total };
  }

  async findOwnedByShopper(
    id: string,
    shopperProfileId: string,
  ): Promise<ShopperOrderForShopper | null> {
    return this.prisma.shopperOrder.findFirst({
      where: { id, shopperProfileId },
      include: shopperOrderInclude,
    });
  }

  async listEvents(orderId: string, order: 'asc' | 'desc'): Promise<OrderEvent[]> {
    return this.prisma.orderEvent.findMany({
      where: { orderId },
      // `id` breaks ties between events written in the same millisecond.
      orderBy: [{ createdAt: order }, { id: order }],
    });
  }

  async transition(input: {
    id: string;
    shopperProfileId: string;
    actorId: string;
    from: OrderState;
    to: OrderState;
    eventType: string;
    stamp: 'shopperAcceptedAt' | 'shoppingStartedAt';
    acceptWindowMinutes?: number;
  }): Promise<OrderTransitionResult> {
    return this.prisma.$transaction(async (tx): Promise<OrderTransitionResult> => {
      // The caller checked APPROVED before this transaction; a suspension may have
      // committed since. FOR SHARE makes the check final: a suspension arriving
      // now waits for this transaction instead of slipping in before the write.
      const profile = await tx.$queryRaw<Array<{ account_state: string }>>`
        SELECT account_state::text AS account_state
        FROM shopper_profiles WHERE id = ${input.shopperProfileId} FOR SHARE`;
      if (profile[0]?.account_state !== 'APPROVED') {
        return { outcome: 'shopper_unavailable' };
      }
      // The clock is read only now, after the lock: waiting for it can outlast the
      // accept window, which the caller's earlier sweep could not know.
      const now = new Date();
      const acceptCutoff =
        input.acceptWindowMinutes === undefined
          ? undefined
          : new Date(now.getTime() - input.acceptWindowMinutes * 60_000);
      const { count } = await tx.shopperOrder.updateMany({
        where: {
          id: input.id,
          shopperProfileId: input.shopperProfileId,
          state: input.from,
          // Part of the UPDATE, so the deadline and the state are one atomic test.
          ...(acceptCutoff && { createdAt: { gte: acceptCutoff } }),
        },
        data: { state: input.to, [input.stamp]: now },
      });
      if (count === 1) {
        await tx.orderEvent.create({
          data: {
            orderId: input.id,
            type: input.eventType,
            actorId: input.actorId,
            actorRole: 'PERSONAL_SHOPPER',
            metadata: { from: input.from, to: input.to },
          },
        });
        const order = await tx.shopperOrder.findUniqueOrThrow({
          where: { id: input.id },
          include: shopperOrderInclude,
        });
        return { outcome: 'transitioned', order };
      }
      const current = await tx.shopperOrder.findFirst({
        where: { id: input.id, shopperProfileId: input.shopperProfileId },
        select: { state: true, cancelledBy: true },
      });
      if (!current) {
        return { outcome: 'not_found' };
      }
      // Still in the state it was expected in, so only the window can have stopped it.
      if (acceptCutoff && current.state === input.from) {
        return { outcome: 'accept_expired', assignedBefore: acceptCutoff };
      }
      return { outcome: 'conflict', state: current.state, cancelledBy: current.cancelledBy };
    });
  }

  async cancelOrder(input: ICancelOrderInput): Promise<CancelOrderResult> {
    const { actor } = input;
    // The type already demands it; this is the second line of defence for callers
    // that get past it (a cast, plain JS): a SYSTEM cancel with no cutoff would
    // cancel an order that is still inside its window.
    if (actor.kind === 'SYSTEM' && !(input.assignedBefore instanceof Date)) {
      throw new Error('A SYSTEM cancel requires assignedBefore');
    }
    return this.prisma.$transaction(async (tx): Promise<CancelOrderResult> => {
      const head = await tx.shopperOrder.findUnique({
        where: { id: input.orderId },
        select: { requestId: true, customerId: true },
      });
      // Someone else's order reads the same as a missing one, before any lock is taken.
      if (!head || (actor.kind === 'CUSTOMER' && head.customerId !== actor.userId)) {
        return { outcome: 'not_found' };
      }

      // Same lock as accepting an offer: serialises with an accept, a cancel of
      // the request, and another cancel of this order. The customer path also
      // filters on the owner, so a non-owner locks nothing.
      const locked =
        actor.kind === 'CUSTOMER'
          ? await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM shopping_requests
              WHERE id = ${head.requestId} AND customer_id = ${actor.userId}
              FOR UPDATE`
          : await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM shopping_requests WHERE id = ${head.requestId} FOR UPDATE`;
      if (locked.length === 0) {
        return { outcome: 'not_found' };
      }

      const now = new Date();
      const cancelledBy = actor.kind;
      const reason = actor.kind === 'SYSTEM' ? SYSTEM_CANCEL_REASON : input.reason;
      // The state check is part of the UPDATE: of a cancel and a shopper accept
      // (or two cancels) exactly one changes the row. The timeout also requires
      // the order to still be past its accept window.
      const { count } = await tx.shopperOrder.updateMany({
        where: {
          id: input.orderId,
          state: 'ASSIGNED',
          ...(actor.kind === 'SYSTEM' && { createdAt: { lt: input.assignedBefore } }),
        },
        data: {
          state: 'CANCELLED',
          cancelledAt: now,
          cancelledBy,
          cancelReason: reason ?? null,
        },
      });

      if (count !== 1) {
        const current = await tx.shopperOrder.findUnique({
          where: { id: input.orderId },
          include: customerOrderInclude,
        });
        if (!current) return { outcome: 'not_found' };
        if (current.state === 'CANCELLED') return { outcome: 'already_cancelled', order: current };
        if (actor.kind === 'SYSTEM') return { outcome: 'not_stale' };
        return { outcome: 'conflict', state: current.state };
      }

      const order = await tx.shopperOrder.findUniqueOrThrow({
        where: { id: input.orderId },
        include: customerOrderInclude,
      });
      // The customer turned this shopper down; on timeout the offer simply lapsed.
      // Both are terminal and neither is PENDING, so the shopper may bid again.
      await tx.shoppingOffer.updateMany({
        where: { id: order.offerId, state: 'ACCEPTED' },
        data: { state: actor.kind === 'CUSTOMER' ? 'REJECTED' : 'EXPIRED' },
      });
      // Reopen for bidding with a fresh window. The other bidders stay REJECTED.
      await tx.shoppingRequest.updateMany({
        where: { id: head.requestId, status: 'ASSIGNED' },
        data: { status: 'OPEN', offerDeadline: input.reopenDeadline },
      });
      await tx.orderEvent.create({
        data: {
          orderId: input.orderId,
          type: ORDER_EVENT_TYPES.ORDER_CANCELLED,
          actorId: actor.kind === 'CUSTOMER' ? actor.userId : null,
          actorRole: actor.kind,
          metadata: { cancelledBy, ...(reason && { reason }) },
        },
      });
      const shopper = await tx.shopperProfile.findUniqueOrThrow({
        where: { id: order.shopperProfileId },
        select: { userId: true },
      });
      return {
        outcome: 'cancelled',
        order,
        shopperUserId: shopper.userId,
        requestReference: order.request.reference,
        cancelledBy,
      };
    });
  }

  async expireStale(
    scope: IExpireScope,
    assignedBefore: Date,
    reopenDeadline: Date,
  ): Promise<ICancelledOrderInfo[]> {
    const stale = await this.prisma.shopperOrder.findMany({
      where: {
        state: 'ASSIGNED',
        createdAt: { lt: assignedBefore },
        ...(scope.orderId && { id: scope.orderId }),
        ...(scope.customerId && { customerId: scope.customerId }),
        ...(scope.shopperProfileId && { shopperProfileId: scope.shopperProfileId }),
      },
      select: { id: true },
    });
    const cancelled: ICancelledOrderInfo[] = [];
    for (const { id } of stale) {
      // Each cancel commits on its own. A failure of one must not discard the ones
      // that already committed: their shoppers would never be told, because a later
      // sweep only selects orders that are still ASSIGNED. So it is logged and the
      // sweep goes on; the failed order stays ASSIGNED and the next sweep retries it.
      try {
        const result = await this.cancelOrder({
          orderId: id,
          actor: { kind: 'SYSTEM' },
          assignedBefore,
          reopenDeadline,
        });
        if (result.outcome === 'cancelled') {
          cancelled.push(result);
        }
      } catch (error) {
        this.logger.error(
          `Could not expire stale order ${id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return cancelled;
  }
}
