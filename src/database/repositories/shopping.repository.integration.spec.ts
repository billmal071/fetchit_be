/**
 * Real-Postgres checks for the shopping request/offer repositories: the
 * matching query, the one-active-offer partial unique index, and the
 * submit-vs-cancel race. They need a database with the migrations applied, so
 * they run only when SHOPPING_TEST_DATABASE_URL points at a THROWAWAY database
 * (the tests insert and delete rows); otherwise they are skipped.
 *
 *   SHOPPING_TEST_DATABASE_URL=postgresql://user@localhost:5432/scratch npx jest shopping.repository.integration
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ShoppingConfigRepository } from './shopping-config.repository';
import { ShoppingOfferRepository } from './shopping-offer.repository';
import { ShoppingRequestRepository } from './shopping-request.repository';
import { ShopperOrderRepository } from './shopper-order.repository';
import { OrderExpiryService } from '../../modules/shopping-requests/order-expiry.service';
import { ShopperProfileRepository } from './shopper-profile.repository';
import { ShoppingReferenceRepository } from './shopping-reference.repository';
import { ShoppingConfigService } from '../../modules/shopping-requests/shopping-config.service';
import { ShoppingRequestsService } from '../../modules/shopping-requests/shopping-requests.service';
import { ShopperOrdersService } from '../../modules/shopping-requests/shopper-orders.service';
import { ShoppingOrdersService } from '../../modules/shopping-requests/shopping-orders.service';
import { AdminShoppingConfigService } from '../../modules/admin/admin-shopping-config.service';
import { validateShoppingConfig } from '../../modules/admin/admin-shopping-config.validation';
import { ShopperBiddingService } from '../../modules/shopping-requests/shopper-bidding.service';
import {
  DuplicateActiveOfferError,
  OfferRequestClosedError,
  ShopperBarredFromRequestError,
  ShoppingConfigConstraintError,
} from './interfaces';

const url = process.env.SHOPPING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('shopping repositories (real Postgres)', () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const prisma = db as unknown as PrismaService;
  const requests = new ShoppingRequestRepository(prisma);
  const offers = new ShoppingOfferRepository(prisma);
  const run = randomUUID().slice(0, 8);

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  /** Whether a promise has settled yet, without awaiting it. */
  const settledFlag = (promise: Promise<unknown>): (() => boolean) => {
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    return () => settled;
  };
  /**
   * Hold a lock from a SECOND connection until released. `ready` resolves only
   * once `lock` has succeeded, so nothing here depends on a sleep; `done`
   * settles after the holder's transaction has finished. The timeouts bound it.
   */
  const hold = (lock: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    let release!: () => void;
    let signalReady!: () => void;
    const ready = new Promise<void>((resolve) => (signalReady = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const done = db.$transaction(
      async (tx) => {
        await lock(tx);
        signalReady();
        await released;
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
    return { ready: Promise.race([ready, done]), release, done };
  };
  /** Wait until some backend in this database is blocked on a lock in a statement mentioning `table`. */
  const untilBlockedOn = async (table: string): Promise<void> => {
    for (let i = 0; i < 100; i++) {
      const rows = await db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query ILIKE ${`%${table}%`} AND pid <> pg_backend_pid()`;
      if (Number(rows[0].n) > 0) return;
      await sleep(30);
    }
    throw new Error(`no statement ever blocked on ${table}`);
  };

  const userIds: string[] = [];
  let loc1: string;
  let loc2: string;
  let cat1: string;
  let cat2: string;
  let customerId: string;
  let shopperA: string; // covers loc1 + cat1
  let shopperB: string; // covers loc1 + cat2

  const makeUser = async (tag: string): Promise<string> => {
    const user = await db.user.create({
      data: { username: `${tag}-${run}`, email: `${tag}-${run}@example.test`, role: 'CUSTOMER' },
    });
    userIds.push(user.id);
    return user.id;
  };

  const makeShopper = async (
    tag: string,
    locationId: string,
    categoryId: string,
  ): Promise<string> => {
    const userId = await makeUser(tag);
    const profile = await db.shopperProfile.create({
      data: {
        userId,
        accountState: 'APPROVED',
        isOnline: true,
        locations: { create: { locationId } },
        categories: { create: { categoryId } },
      },
    });
    return profile.id;
  };

  const item = (categoryId?: string) => ({
    name: 'Milk',
    brand: 'Peak',
    size: '400g',
    quantity: 2,
    unit: 'tin',
    estimatedUnitPrice: 4500,
    substitutionPreference: 'REFUND' as const,
    categoryId,
  });

  const makeRequest = (
    locationId: string,
    categoryIds: Array<string | undefined>,
    deadlineOffsetMs = 30 * 60_000,
  ) =>
    requests.create({
      customerId,
      shoppingLocationId: locationId,
      deliveryAddress: '1 Test Street',
      estimatedGoodsBudget: 9000,
      estimate: { estimatedGoodsCost: 9000 },
      offerDeadline: new Date(Date.now() + deadlineOffsetMs),
      items: categoryIds.map((id) => item(id)),
    });

  const submit = (requestId: string, shopperProfileId: string) =>
    offers.submit({
      requestId,
      shopperProfileId,
      shopperFee: 1000,
      etaMinutes: 30,
      financials: { shopperFee: 1000 },
      acceptanceWindowMinutes: 1440,
    });

  beforeAll(async () => {
    loc1 = (await db.shoppingLocation.create({ data: { name: `L1-${run}` } })).id;
    loc2 = (await db.shoppingLocation.create({ data: { name: `L2-${run}` } })).id;
    cat1 = (await db.shoppingCategory.create({ data: { name: `C1-${run}`, slug: `c1-${run}` } }))
      .id;
    cat2 = (await db.shoppingCategory.create({ data: { name: `C2-${run}`, slug: `c2-${run}` } }))
      .id;
    customerId = await makeUser('customer');
    shopperA = await makeShopper('shopper-a', loc1, cat1);
    shopperB = await makeShopper('shopper-b', loc1, cat2);
  });

  afterAll(async () => {
    // Orders keep their request, offer and users alive (no cascade): remove them first.
    await db.shopperOrder.deleteMany({ where: { customerId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } }); // cascades requests, items, offers, profiles
    await db.shoppingLocation.deleteMany({ where: { id: { in: [loc1, loc2] } } });
    await db.shoppingCategory.deleteMany({ where: { id: { in: [cat1, cat2] } } });
    await db.$disconnect();
  });

  it('ships a seeded fee configuration', async () => {
    const rules = await new ShoppingConfigRepository(prisma).get();
    expect(rules).toEqual({
      minShopperFee: expect.any(Number),
      maxShopperFee: expect.any(Number),
      deliveryFee: expect.any(Number),
      serviceChargePercent: expect.any(Number),
      vatPercent: expect.any(Number),
      priceBufferPercent: expect.any(Number),
      offerWindowMinutes: expect.any(Number),
      shopperAcceptWindowMinutes: 30,
      offerAcceptanceWindowMinutes: 1440,
    });
    expect(rules?.maxShopperFee).toBeGreaterThanOrEqual(rules?.minShopperFee ?? Infinity);
  });

  it('refuses a second config row and an inverted fee range', async () => {
    await expect(
      db.$executeRaw`INSERT INTO shopping_config (id, min_shopper_fee, max_shopper_fee, delivery_fee,
        service_charge_percent, vat_percent, price_buffer_percent, offer_window_minutes, updated_at)
        VALUES (2, 1, 2, 3, 1, 1, 1, 1, now())`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`UPDATE shopping_config SET min_shopper_fee = 9999999 WHERE id = 1`,
    ).rejects.toThrow();
  });

  describe('matching', () => {
    let match: string;
    let noCategory: string;
    let otherMarket: string;
    let otherCategory: string;
    let expired: string;
    let cancelled: string;
    let mixed: string;

    beforeAll(async () => {
      match = (await makeRequest(loc1, [cat1])).id;
      noCategory = (await makeRequest(loc1, [undefined])).id;
      mixed = (await makeRequest(loc1, [cat2, cat1])).id;
      otherMarket = (await makeRequest(loc2, [cat1])).id;
      otherCategory = (await makeRequest(loc1, [cat2])).id;
      expired = (await makeRequest(loc1, [cat1], -60_000)).id;
      cancelled = (await makeRequest(loc1, [cat1])).id;
      await requests.cancel(cancelled, customerId, new Date());
    });

    const feed = (shopperProfileId: string, extra: object = {}) =>
      requests.findMatchingForShopper({
        shopperProfileId,
        now: new Date(),
        sortBy: 'createdAt',
        sortOrder: 'asc',
        skip: 0,
        take: 50,
        ...extra,
      });

    it('returns open, in-window requests at a covered market with a covered category', async () => {
      const { rows, total } = await feed(shopperA);
      const ids = rows.map((r) => r.id);
      expect(ids.sort()).toEqual([match, noCategory, mixed].sort());
      expect(total).toBe(3);
      expect(ids).not.toEqual(
        expect.arrayContaining([otherMarket, otherCategory, expired, cancelled]),
      );
    });

    it('uses the shopper own categories: B sees the cat2 requests, not the cat1-only one', async () => {
      const ids = (await feed(shopperB)).rows.map((r) => r.id);
      expect(ids.sort()).toEqual([noCategory, mixed, otherCategory].sort());
    });

    it('applies the categoryId and locationId filters on top of matching', async () => {
      expect((await feed(shopperA, { categoryId: cat1 })).rows.map((r) => r.id).sort()).toEqual(
        [match, mixed].sort(),
      );
      expect((await feed(shopperA, { locationId: loc2 })).total).toBe(0); // not a market A covers
    });

    it('pages without repeating or skipping rows and reports the full total', async () => {
      const first = await feed(shopperA, { take: 2, skip: 0 });
      const second = await feed(shopperA, { take: 2, skip: 2 });
      expect(first.total).toBe(3);
      expect([...first.rows, ...second.rows].map((r) => r.id).sort()).toEqual(
        [match, noCategory, mixed].sort(),
      );
    });

    it('findCoveredByShopper ignores status; findReadableByShopper adds requests the shopper bid on', async () => {
      expect((await requests.findCoveredByShopper(expired, shopperA))?.id).toBe(expired);
      expect(await requests.findCoveredByShopper(otherMarket, shopperA)).toBeNull();

      expect(await requests.findReadableByShopper(otherCategory, shopperA, new Date())).toBeNull();
      await db.shoppingOffer.create({
        data: {
          requestId: otherCategory,
          shopperProfileId: shopperA,
          shopperFee: 1,
          etaMinutes: 1,
          expiresAt: new Date(Date.now() + 60_000),
          financials: {},
        },
      });
      expect((await requests.findReadableByShopper(otherCategory, shopperA, new Date()))?.id).toBe(
        otherCategory,
      );
    });
  });

  describe('one active offer per shopper per request', () => {
    it('rejects a second PENDING offer, allows one again after withdrawing', async () => {
      const { id } = await makeRequest(loc1, [cat1]);
      const first = await submit(id, shopperA);
      expect(first.state).toBe('PENDING');
      // the offer outlives the bidding deadline by the acceptance window
      expect(first.expiresAt.getTime()).toBe(first.request.offerDeadline.getTime() + 1440 * 60_000);

      await expect(submit(id, shopperA)).rejects.toBeInstanceOf(DuplicateActiveOfferError);
      await expect(submit(id, shopperB)).resolves.toBeDefined(); // another shopper is fine

      expect(await offers.withdraw(first.id, shopperA)).toBe(true);
      expect(await offers.withdraw(first.id, shopperA)).toBe(false); // no longer PENDING
      await expect(submit(id, shopperA)).resolves.toBeDefined();
    });

    it('lets exactly one of many concurrent submits win', async () => {
      const { id } = await makeRequest(loc1, [cat1]);
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => submit(id, shopperA)),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results.filter((r) => r.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateActiveOfferError);
      }
      expect(await db.shoppingOffer.count({ where: { requestId: id, state: 'PENDING' } })).toBe(1);
    });

    it('refuses an offer on a cancelled request or after the deadline', async () => {
      const cancelled = await makeRequest(loc1, [cat1]);
      await requests.cancel(cancelled.id, customerId, new Date());
      await expect(submit(cancelled.id, shopperA)).rejects.toBeInstanceOf(OfferRequestClosedError);

      const late = await makeRequest(loc1, [cat1], -1000);
      await expect(submit(late.id, shopperA)).rejects.toBeInstanceOf(OfferRequestClosedError);
    });

    it('refuses an offer whose deadline passed while it waited for the request row lock', async () => {
      const { id } = await makeRequest(loc1, [cat1], 400);
      const holder = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM shopping_requests WHERE id = ${id} FOR UPDATE`;
          await new Promise((resolve) => setTimeout(resolve, 900));
        },
        { timeout: 5000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const attempt = submit(id, shopperA); // blocks on FOR SHARE until the holder commits
      await holder;
      await expect(attempt).rejects.toBeInstanceOf(OfferRequestClosedError);
      expect(await db.shoppingOffer.count({ where: { requestId: id } })).toBe(0);
    });

    it('expireDue moves only PENDING offers past their expiry', async () => {
      const { id } = await makeRequest(loc1, [cat1]);
      const offer = await submit(id, shopperA);
      expect(await offers.expireDue(new Date(), { requestId: id })).toBe(0);
      const later = new Date(offer.expiresAt.getTime() + 1);
      expect(await offers.expireDue(later, { requestId: id })).toBe(1);
      expect((await db.shoppingOffer.findUniqueOrThrow({ where: { id: offer.id } })).state).toBe(
        'EXPIRED',
      );
    });
  });

  describe('cancel racing offer submit', () => {
    it('never leaves a PENDING offer on a cancelled request', async () => {
      for (let i = 0; i < 15; i++) {
        const { id } = await makeRequest(loc1, [cat1]);
        const [cancel, bidA, bidB] = await Promise.allSettled([
          requests.cancel(id, customerId, new Date()),
          submit(id, shopperA),
          submit(id, shopperB),
        ]);
        expect(cancel.status).toBe('fulfilled');
        for (const bid of [bidA, bidB]) {
          if (bid.status === 'rejected') {
            expect(bid.reason).toBeInstanceOf(OfferRequestClosedError);
          }
        }
        const request = await db.shoppingRequest.findUniqueOrThrow({ where: { id } });
        expect(request.status).toBe('CANCELLED');
        expect(await db.shoppingOffer.count({ where: { requestId: id, state: 'PENDING' } })).toBe(
          0,
        );
      }
    });

    it('cancel is single-winner and reports not_found / not_open', async () => {
      const { id } = await makeRequest(loc1, [cat1]);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => requests.cancel(id, customerId, new Date())),
      );
      expect(results.filter((r) => r.outcome === 'cancelled')).toHaveLength(1);
      expect(results.filter((r) => r.outcome === 'not_open')).toHaveLength(4);
      expect((await requests.cancel(id, shopperA, new Date())).outcome).toBe('not_found'); // not the owner
    });
  });

  it('the customer list does not count offers past their deadline', async () => {
    const { id } = await makeRequest(loc1, [cat1]);
    const offer = await submit(id, shopperA);
    const count = async (now: Date): Promise<number | undefined> =>
      (await requests.listForCustomer(customerId, 0, 100, undefined, now)).rows.find(
        (r) => r.id === id,
      )?._count.offers;
    expect(await count(new Date())).toBe(1);
    expect(await count(new Date(offer.expiresAt.getTime() + 1))).toBe(0);
  });

  it('the request reference is unique and well formed', async () => {
    const a = await makeRequest(loc1, [cat1]);
    const b = await makeRequest(loc1, [cat1]);
    expect(a.reference).toMatch(/^SR-[A-Z2-9]{8}$/);
    expect(a.reference).not.toBe(b.reference);
  });

  describe('end to end through the services, real repositories', () => {
    it('create -> feed -> preview -> submit -> customer view -> withdraw -> cancel', async () => {
      const config = new ShoppingConfigService(new ShoppingConfigRepository(prisma));
      const emit = jest.fn();
      const audit = { log: jest.fn() };
      const customerSvc = new ShoppingRequestsService(
        requests,
        offers,
        new ShoppingReferenceRepository(prisma),
        config,
        audit as never,
      );
      const shopperSvc = new ShopperBiddingService(
        new ShopperProfileRepository(prisma),
        requests,
        offers,
        config,
        { emit } as never,
        audit as never,
      );
      const shopperUser = (await db.shopperProfile.findUniqueOrThrow({ where: { id: shopperA } }))
        .userId;
      const rules = await config.getRules();

      const created = await customerSvc.create(customerId, {
        locationId: loc1,
        deliveryAddress: { text: '1 Test Street' },
        items: [{ ...item(cat1), substitutionPreference: 'REFUND' }],
      } as never);
      expect(created.estimate.estimatedGoodsCost).toBe(9000);
      expect(created.offerDeadline).toBeDefined();

      const feed = await shopperSvc.feed(shopperUser, { page: 1, limit: 50 } as never);
      const row = feed.data.find((r) => r.id === created.id);
      expect(row).toMatchObject({
        itemCount: 1,
        estimatedGoodsBudget: 9000,
        hasSubmittedOffer: false,
      });

      const fee = rules.minShopperFee;
      const preview = await shopperSvc.preview(shopperUser, created.id, {
        shopperFee: fee,
        etaMinutes: 20,
      });
      expect(await db.shoppingOffer.count({ where: { requestId: created.id } })).toBe(0);

      const offer = await shopperSvc.submit(shopperUser, created.id, {
        shopperFee: fee,
        etaMinutes: 20,
      });
      expect(offer.financials).toEqual(preview.financials);
      await expect(
        shopperSvc.submit(shopperUser, created.id, { shopperFee: fee, etaMinutes: 20 }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        shopperSvc.submit(shopperUser, created.id, {
          shopperFee: rules.maxShopperFee + 1,
          etaMinutes: 20,
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(emit).toHaveBeenCalledTimes(1);

      const detail = await customerSvc.findOne(customerId, created.id);
      expect(detail.offers).toHaveLength(1);
      expect(detail.offers[0].financials.customerTotal).toBe(offer.financials.customerTotal);
      expect(detail.offers[0].shopper.id).toBe(shopperA);

      const feedAfter = await shopperSvc.feed(shopperUser, { page: 1, limit: 50 } as never);
      expect(feedAfter.data.find((r) => r.id === created.id)?.hasSubmittedOffer).toBe(true);

      const withdrawn = await shopperSvc.withdraw(shopperUser, offer.id as string);
      expect(withdrawn.state).toBe('WITHDRAWN');
      expect((await customerSvc.findOne(customerId, created.id)).offers).toHaveLength(0);

      const again = await shopperSvc.submit(shopperUser, created.id, {
        shopperFee: fee,
        etaMinutes: 25,
      });
      const cancelled = await customerSvc.cancel(customerId, created.id);
      expect(cancelled.status).toBe('CANCELLED');
      expect((await shopperSvc.getOffer(shopperUser, again.id as string)).state).toBe('EXPIRED');
      await expect(
        shopperSvc.submit(shopperUser, created.id, { shopperFee: fee, etaMinutes: 25 }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(customerSvc.cancel(customerId, created.id)).rejects.toMatchObject({
        status: 409,
      });
    });
  });

  describe('orders: accepting an offer', () => {
    const orderRepo = new ShopperOrderRepository(prisma);
    const extraShoppers: string[] = [];

    const shoppersNeeded = async (n: number): Promise<string[]> => {
      while (extraShoppers.length < n) {
        extraShoppers.push(await makeShopper(`os-${extraShoppers.length}`, loc1, cat1));
      }
      return extraShoppers.slice(0, n);
    };

    /** A request with one PENDING offer from each given shopper. */
    const offered = async (shoppers: string[], deadlineOffsetMs = 30 * 60_000) => {
      const { id: requestId } = await makeRequest(loc1, [cat1], deadlineOffsetMs);
      const placed = [];
      for (const [i, shopperId] of shoppers.entries()) {
        placed.push(
          await offers.submit({
            requestId,
            shopperProfileId: shopperId,
            shopperFee: 1000 + i,
            etaMinutes: 30,
            financials: { shopperFee: 1000 + i, customerTotal: 12171 + i },
            acceptanceWindowMinutes: 1440,
          }),
        );
      }
      return { requestId, offers: placed };
    };
    const accept = (requestId: string, offerId: string, by = customerId) =>
      orderRepo.acceptOffer({ requestId, offerId, customerId: by });

    it('creates one UNPAID order from the offer, rejects the other bids, and assigns the request', async () => {
      const { requestId, offers: placed } = await offered([shopperA, shopperB]);
      const [winning, losing] = placed;

      const result = await accept(requestId, winning.id);
      if (result.outcome !== 'accepted')
        throw new Error(`expected accepted, got ${result.outcome}`);

      expect(result.order).toMatchObject({
        requestId,
        offerId: winning.id,
        customerId,
        shopperProfileId: shopperA,
        state: 'ASSIGNED',
        shoppingLocationId: loc1,
      });
      expect(result.order.reference).toMatch(/^SO-[A-HJ-NP-Z2-9]{8}$/);
      // Money is copied from the offer exactly as stored, not recomputed.
      expect(result.order.financials).toEqual(winning.financials);
      expect(result.order.items).toHaveLength(1);
      expect(result.order.items[0]).toMatchObject({
        name: 'Milk',
        quantity: 2,
        customerEstimatedPrice: 4500,
        state: 'PENDING',
        actualPurchasePrice: null,
        approvedPrice: null,
        finalPurchasePrice: null,
      });
      expect(result.rejected.map((r) => r.offerId)).toEqual([losing.id]);

      const states = await db.shoppingOffer.findMany({
        where: { requestId },
        select: { id: true, state: true },
      });
      expect(Object.fromEntries(states.map((o) => [o.id, o.state]))).toEqual({
        [winning.id]: 'ACCEPTED',
        [losing.id]: 'REJECTED',
      });
      expect(
        (await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
      ).toBe('ASSIGNED');
      const events = await db.orderEvent.findMany({ where: { orderId: result.order.id } });
      expect(events.map((e) => e.type)).toEqual(['OFFER_ACCEPTED']);
    });

    it('then refuses every further accept, and a cancel, with a state conflict', async () => {
      const { requestId, offers: placed } = await offered([shopperA, shopperB]);
      await accept(requestId, placed[0].id);

      expect(await accept(requestId, placed[1].id)).toEqual({
        outcome: 'request_not_open',
        status: 'ASSIGNED',
      });
      // A retry of the winning accept is not a conflict: it returns the same order.
      expect((await accept(requestId, placed[0].id)).outcome).toBe('already_accepted');
      expect(await requests.cancel(requestId, customerId, new Date())).toEqual({
        outcome: 'not_open',
        status: 'ASSIGNED',
      });
      expect(await db.shopperOrder.count({ where: { requestId } })).toBe(1);
    });

    it('treats a request that is not the caller own, or an offer from another request, as not found', async () => {
      const { requestId, offers: placed } = await offered([shopperA]);
      const other = await offered([shopperB]);
      expect(await accept(requestId, placed[0].id, shopperA)).toEqual({ outcome: 'not_found' });
      expect(await accept(requestId, other.offers[0].id)).toEqual({ outcome: 'not_found' });
      expect(await db.shopperOrder.count({ where: { requestId } })).toBe(0);
    });

    it('refuses a withdrawn offer and an offer past its deadline, creating nothing', async () => {
      const { requestId, offers: placed } = await offered([shopperA]);
      await offers.withdraw(placed[0].id, shopperA);
      expect(await accept(requestId, placed[0].id)).toEqual({
        outcome: 'offer_not_pending',
        state: 'WITHDRAWN',
      });

      // Created with the normal deadline, then moved into the past: no timing race with setup.
      const late = await offered([shopperA]);
      const past = new Date(Date.now() - 60_000);
      await db.shoppingOffer.update({
        where: { id: late.offers[0].id },
        data: { expiresAt: past },
      });
      await db.shoppingRequest.update({
        where: { id: late.requestId },
        data: { offerDeadline: past },
      });
      expect(await accept(late.requestId, late.offers[0].id)).toEqual({ outcome: 'offer_expired' });
      expect(
        await db.shopperOrder.count({ where: { requestId: { in: [requestId, late.requestId] } } }),
      ).toBe(0);
      expect(
        (await db.shoppingRequest.findUniqueOrThrow({ where: { id: late.requestId } })).status,
      ).toBe('OPEN');
    });

    it('yields exactly one order when 8 shoppers offers are accepted concurrently', async () => {
      const shoppers = await shoppersNeeded(8);
      const { requestId, offers: placed } = await offered(shoppers);

      const results = await Promise.all(placed.map((o) => accept(requestId, o.id)));

      expect(results.filter((r) => r.outcome === 'accepted')).toHaveLength(1);
      expect(results.filter((r) => r.outcome === 'request_not_open')).toHaveLength(7);
      expect(await db.shopperOrder.count({ where: { requestId } })).toBe(1);
      expect(await db.shoppingOffer.count({ where: { requestId, state: 'ACCEPTED' } })).toBe(1);
      expect(await db.shoppingOffer.count({ where: { requestId, state: 'REJECTED' } })).toBe(7);
      expect(await db.shoppingOffer.count({ where: { requestId, state: 'PENDING' } })).toBe(0);
      const winner = results.find((r) => r.outcome === 'accepted');
      const order = await db.shopperOrder.findFirstOrThrow({ where: { requestId } });
      expect(winner?.outcome === 'accepted' && winner.order.id).toBe(order.id);
      expect(await db.orderEvent.count({ where: { orderId: order.id } })).toBe(1);
    });

    it('never leaves both an order and a cancelled request when accept races cancel', async () => {
      for (let i = 0; i < 15; i++) {
        const { requestId, offers: placed } = await offered([shopperA]);
        const [acceptResult, cancelResult] = await Promise.all([
          accept(requestId, placed[0].id),
          requests.cancel(requestId, customerId, new Date()),
        ]);
        const request = await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } });
        const orderCount = await db.shopperOrder.count({ where: { requestId } });
        if (acceptResult.outcome === 'accepted') {
          expect(cancelResult.outcome).toBe('not_open');
          expect(request.status).toBe('ASSIGNED');
          expect(orderCount).toBe(1);
        } else {
          expect(acceptResult.outcome).toBe('request_not_open');
          expect(cancelResult.outcome).toBe('cancelled');
          expect(request.status).toBe('CANCELLED');
          expect(orderCount).toBe(0);
          expect(await db.shoppingOffer.count({ where: { requestId, state: 'ACCEPTED' } })).toBe(0);
        }
      }
    });

    it('never accepts a withdrawn offer when accept races the shopper withdrawing it', async () => {
      for (let i = 0; i < 15; i++) {
        const { requestId, offers: placed } = await offered([shopperA]);
        const [acceptResult, withdrawn] = await Promise.all([
          accept(requestId, placed[0].id),
          offers.withdraw(placed[0].id, shopperA),
        ]);
        const offer = await db.shoppingOffer.findUniqueOrThrow({ where: { id: placed[0].id } });
        const orderCount = await db.shopperOrder.count({ where: { requestId } });
        if (acceptResult.outcome === 'accepted') {
          expect(withdrawn).toBe(false);
          expect(offer.state).toBe('ACCEPTED');
          expect(orderCount).toBe(1);
        } else {
          expect(acceptResult).toEqual({ outcome: 'offer_not_pending', state: 'WITHDRAWN' });
          expect(offer.state).toBe('WITHDRAWN');
          expect(orderCount).toBe(0);
          expect(
            (await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
          ).toBe('OPEN');
        }
      }
    });

    it('refuses an offer from a shopper suspended between the bid and the accept, changing nothing', async () => {
      const [suspended] = await shoppersNeeded(1);
      const { requestId, offers: placed } = await offered([suspended, shopperB]);
      await db.shopperProfile.update({
        where: { id: suspended },
        data: { accountState: 'SUSPENDED' },
      });
      try {
        expect(await accept(requestId, placed[0].id)).toEqual({ outcome: 'shopper_unavailable' });
        expect(await db.shopperOrder.count({ where: { requestId } })).toBe(0);
        expect(
          (await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
        ).toBe('OPEN');
        expect(await db.shoppingOffer.count({ where: { requestId, state: 'PENDING' } })).toBe(2);
        // The customer's other offer is still acceptable.
        expect((await accept(requestId, placed[1].id)).outcome).toBe('accepted');
      } finally {
        await db.shopperProfile.update({
          where: { id: suspended },
          data: { accountState: 'APPROVED' },
        });
      }
    });

    describe('a suspension and an accept, in each commit order (controlled by a held lock)', () => {
      const suspend = (id: string) =>
        db.shopperProfile.update({ where: { id }, data: { accountState: 'SUSPENDED' } });
      const approve = (id: string) =>
        db.shopperProfile.update({ where: { id }, data: { accountState: 'APPROVED' } });

      it('suspension commits first: the accept waits for it, is refused, and writes nothing', async () => {
        const [target] = await shoppersNeeded(1);
        const { requestId, offers: placed } = await offered([target]);
        const suspension = hold((tx) =>
          tx.shopperProfile.update({ where: { id: target }, data: { accountState: 'SUSPENDED' } }),
        );
        try {
          await suspension.ready; // the suspension is written but NOT committed
          const attempt = accept(requestId, placed[0].id);
          const attemptSettled = settledFlag(attempt);
          await untilBlockedOn('shopper_profiles');
          expect(attemptSettled()).toBe(false); // it cannot pass the profile lock
          suspension.release();
          await suspension.done;

          expect(await attempt).toEqual({ outcome: 'shopper_unavailable' });
          expect(await db.shopperOrder.count({ where: { requestId } })).toBe(0);
          expect(
            (await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
          ).toBe('OPEN');
          expect(
            (await db.shoppingOffer.findUniqueOrThrow({ where: { id: placed[0].id } })).state,
          ).toBe('PENDING');
        } finally {
          suspension.release();
          await suspension.done.catch(() => undefined);
          await approve(target);
        }
      });

      it('accept commits first: the suspension waits for it, and the order survives it', async () => {
        const [target] = await shoppersNeeded(1);
        const { requestId, offers: placed } = await offered([target]);
        // Stall the accept AFTER it has taken the profile lock, by holding the offer row it must update.
        const stall = hold(
          (tx) =>
            tx.$queryRaw`SELECT id FROM shopping_offers WHERE id = ${placed[0].id} FOR UPDATE`,
        );
        let suspension: Promise<unknown> | undefined;
        try {
          await stall.ready;
          const attempt = accept(requestId, placed[0].id);
          const attemptSettled = settledFlag(attempt);
          await untilBlockedOn('shopping_offers'); // the accept now holds the profile lock
          suspension = suspend(target);
          const suspensionSettled = settledFlag(suspension);
          // Observe the suspension itself parked on the profile lock the accept holds
          // (not just a pending promise) before letting the accept go on.
          await untilBlockedOn('shopper_profiles');
          expect(attemptSettled()).toBe(false);
          expect(suspensionSettled()).toBe(false);

          stall.release();
          const result = await attempt;
          await suspension;

          expect(result.outcome).toBe('accepted');
          expect(await db.shopperOrder.count({ where: { requestId } })).toBe(1);
          // The later suspension does not undo the order.
          expect(
            (await db.shopperProfile.findUniqueOrThrow({ where: { id: target } })).accountState,
          ).toBe('SUSPENDED');
          expect((await db.shopperOrder.findFirstOrThrow({ where: { requestId } })).state).toBe(
            'ASSIGNED',
          );
        } finally {
          stall.release();
          await stall.done.catch(() => undefined);
          await suspension?.catch(() => undefined);
          await approve(target);
        }
      });
    });

    it('refuses an offer that expired while the accept waited for the shopper profile lock', async () => {
      const [target] = await shoppersNeeded(1);
      const { requestId, offers: placed } = await offered([target]);
      // A conflicting lock on the profile row; the profile itself stays APPROVED.
      const blocker = hold(
        (tx) => tx.$queryRaw`SELECT id FROM shopper_profiles WHERE id = ${target} FOR UPDATE`,
      );
      try {
        await blocker.ready;
        // The deadline is set only now, after the lock is held, so setup cannot consume it.
        const deadline = Date.now() + 2500;
        await db.shoppingOffer.update({
          where: { id: placed[0].id },
          data: { expiresAt: new Date(deadline) },
        });
        const attempt = accept(requestId, placed[0].id);
        const attemptSettled = settledFlag(attempt);
        await untilBlockedOn('shopper_profiles');
        // Proof the accept is parked on the profile lock WHILE the offer is still valid: a
        // repository that sampled the clock before this lock would have judged it right now.
        expect(Date.now()).toBeLessThan(deadline);
        expect(attemptSettled()).toBe(false);

        await sleep(deadline - Date.now() + 150); // now the deadline has passed
        expect(attemptSettled()).toBe(false);
        blocker.release();
        await blocker.done;

        expect(await attempt).toEqual({ outcome: 'offer_expired' });
        expect(await db.shopperOrder.count({ where: { requestId } })).toBe(0);
        expect(
          (await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
        ).toBe('OPEN');
        expect(
          (await db.shoppingOffer.findUniqueOrThrow({ where: { id: placed[0].id } })).state,
        ).toBe('PENDING');
      } finally {
        blocker.release();
        await blocker.done.catch(() => undefined);
      }
    });

    it('hides PENDING offers from non-APPROVED shoppers from the customer, and does not count them', async () => {
      const [target] = await shoppersNeeded(1);
      const { requestId, offers: placed } = await offered([target, shopperB]);
      await db.shopperProfile.update({
        where: { id: target },
        data: { accountState: 'SUSPENDED' },
      });
      try {
        expect((await offers.listForRequest(requestId)).map((o) => o.id)).toEqual([placed[1].id]);
        const row = (await requests.listForCustomer(customerId, 0, 100)).rows.find(
          (r) => r.id === requestId,
        );
        expect(row?._count.offers).toBe(1);
      } finally {
        await db.shopperProfile.update({
          where: { id: target },
          data: { accountState: 'APPROVED' },
        });
      }
    });

    it('returns the existing order when the same offer is accepted again, and refuses a different one', async () => {
      const { requestId, offers: placed } = await offered([shopperA, shopperB]);
      const first = await accept(requestId, placed[0].id);
      if (first.outcome !== 'accepted') throw new Error('expected accepted');

      const again = await accept(requestId, placed[0].id);
      expect(again.outcome).toBe('already_accepted');
      expect(again.outcome === 'already_accepted' && again.order.id).toBe(first.order.id);
      expect(await accept(requestId, placed[1].id)).toEqual({
        outcome: 'request_not_open',
        status: 'ASSIGNED',
      });
      expect(await accept(requestId, placed[0].id, shopperA)).toEqual({ outcome: 'not_found' }); // another user
      expect(await db.shopperOrder.count({ where: { requestId } })).toBe(1);
      expect(await db.orderEvent.count({ where: { orderId: first.order.id } })).toBe(1);
    });

    it('lets concurrent retries of the winning accept all succeed with one order', async () => {
      const { requestId, offers: placed } = await offered([shopperA]);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => accept(requestId, placed[0].id)),
      );
      expect(results.filter((r) => r.outcome === 'accepted')).toHaveLength(1);
      expect(results.filter((r) => r.outcome === 'already_accepted')).toHaveLength(5);
      expect(await db.shopperOrder.count({ where: { requestId } })).toBe(1);
    });

    it('a non-owner locks nothing: their accept returns not_found while the owner row lock is still held', async () => {
      const { requestId, offers: placed } = await offered([shopperA]);
      const owner = hold(
        (tx) => tx.$queryRaw`SELECT id FROM shopping_requests WHERE id = ${requestId} FOR UPDATE`,
      );
      let timer: NodeJS.Timeout | undefined;
      try {
        await owner.ready; // the row lock is definitely held, and stays held below
        // ONE bound for the whole call: if the call waited on the lock it would lose this race.
        const bound = new Promise<'blocked'>((resolve) => {
          timer = setTimeout(() => resolve('blocked'), 10_000);
        });
        const result = await Promise.race([
          accept(requestId, placed[0].id, shopperA), // not the owner
          bound,
        ]);
        clearTimeout(timer);
        // Decisive, and made BEFORE the holder releases: it did not wait for the lock.
        expect(result).toEqual({ outcome: 'not_found' });
      } finally {
        clearTimeout(timer);
        owner.release();
        await owner.done.catch(() => undefined);
      }
    });

    describe('the partial unique indexes on orders (live = not CANCELLED)', () => {
      const insert = (requestId: string, offerId: string, reference: string) =>
        db.shopperOrder.create({
          data: {
            reference,
            requestId,
            offerId,
            customerId,
            shopperProfileId: shopperA,
            shoppingLocationId: loc1,
            financials: {},
          },
        });
      const violation = async (
        attempt: Promise<unknown>,
      ): Promise<Prisma.PrismaClientKnownRequestError> => {
        const error = await attempt.then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        return error as Prisma.PrismaClientKnownRequestError;
      };

      it('rejects a second live order for the same REQUEST (with a different, unused offer)', async () => {
        const { requestId } = await offered([shopperA]).then(async (o) => {
          const r = await accept(o.requestId, o.offers[0].id);
          if (r.outcome !== 'accepted') throw new Error('expected accepted');
          return o;
        });
        const spare = await offered([shopperB]); // an offer on another request: unique on its own
        const error = await violation(insert(requestId, spare.offers[0].id, 'SO-DUPREQ01'));
        expect(error.code).toBe('P2002');
        expect(error.meta?.target).toEqual(['request_id']);
      });

      it('rejects a second live order for the same OFFER (with a different, unused request)', async () => {
        const first = await offered([shopperA]);
        const r = await accept(first.requestId, first.offers[0].id);
        if (r.outcome !== 'accepted') throw new Error('expected accepted');
        const { id: otherRequest } = await makeRequest(loc1, [cat1]);
        const error = await violation(insert(otherRequest, first.offers[0].id, 'SO-DUPOFR01'));
        expect(error.code).toBe('P2002');
        expect(error.meta?.target).toEqual(['offer_id']);
      });

      it('allows the same request and offer again once the earlier order is CANCELLED', async () => {
        const first = await offered([shopperA]);
        const r = await accept(first.requestId, first.offers[0].id);
        if (r.outcome !== 'accepted') throw new Error('expected accepted');
        await orderRepo.cancelOrder({
          orderId: r.order.id,
          actor: { kind: 'CUSTOMER', userId: customerId },
          reopenWindowMinutes: 1,
        });
        await expect(
          insert(first.requestId, first.offers[0].id, 'SO-AFTERC02'),
        ).resolves.toBeDefined();
      });
    });

    describe('shopper transitions', () => {
      const newOrder = async (shopperId = shopperA): Promise<string> => {
        const { requestId, offers: placed } = await offered([shopperId]);
        const result = await accept(requestId, placed[0].id);
        if (result.outcome !== 'accepted') throw new Error('expected accepted');
        return result.order.id;
      };
      const move = (id: string, by: string, from: 'ASSIGNED' | 'SHOPPER_ACCEPTED') =>
        orderRepo.transition({
          id,
          shopperProfileId: by,
          actorId: 'actor',
          from,
          to: from === 'ASSIGNED' ? 'SHOPPER_ACCEPTED' : 'SHOPPING_STARTED',
          eventType: from === 'ASSIGNED' ? 'SHOPPER_ACCEPTED' : 'SHOPPING_STARTED',
          stamp: from === 'ASSIGNED' ? 'shopperAcceptedAt' : 'shoppingStartedAt',
        });

      it('lets exactly one of 8 concurrent accepts win and records one event', async () => {
        const id = await newOrder();
        const results = await Promise.all(
          Array.from({ length: 8 }, () => move(id, shopperA, 'ASSIGNED')),
        );

        expect(results.filter((r) => r.outcome === 'transitioned')).toHaveLength(1);
        expect(results.filter((r) => r.outcome === 'conflict')).toHaveLength(7);
        const types = (await orderRepo.listEvents(id, 'asc')).map((e) => e.type);
        expect(types).toEqual(['OFFER_ACCEPTED', 'SHOPPER_ACCEPTED']);
        expect(
          (await db.shopperOrder.findUniqueOrThrow({ where: { id } })).shopperAcceptedAt,
        ).not.toBeNull();
      });

      it('refuses start before accept, then lets exactly one concurrent start win', async () => {
        const id = await newOrder();
        expect(await move(id, shopperA, 'SHOPPER_ACCEPTED')).toEqual({
          outcome: 'conflict',
          state: 'ASSIGNED',
          cancelledBy: null,
        });
        await move(id, shopperA, 'ASSIGNED');

        const results = await Promise.all(
          Array.from({ length: 8 }, () => move(id, shopperA, 'SHOPPER_ACCEPTED')),
        );
        expect(results.filter((r) => r.outcome === 'transitioned')).toHaveLength(1);
        expect((await db.shopperOrder.findUniqueOrThrow({ where: { id } })).state).toBe(
          'SHOPPING_STARTED',
        );
        expect((await orderRepo.listEvents(id, 'desc')).map((e) => e.type)).toEqual([
          'SHOPPING_STARTED',
          'SHOPPER_ACCEPTED',
          'OFFER_ACCEPTED',
        ]);
      });

      const untouched = async (id: string): Promise<void> => {
        expect((await db.shopperOrder.findUniqueOrThrow({ where: { id } })).state).toBe('ASSIGNED');
        expect(await db.orderEvent.count({ where: { orderId: id } })).toBe(1); // OFFER_ACCEPTED only
      };

      describe('the accept window runs out while the accept waits for the profile lock', () => {
        const WINDOW = 30;
        /** An ASSIGNED order that is `validForMs` away from the end of its accept window. */
        const nearlyExpired = async (shopperId: string, validForMs: number): Promise<string> => {
          const id = await newOrder(shopperId);
          await db.shopperOrder.update({
            where: { id },
            data: { createdAt: new Date(Date.now() - WINDOW * 60_000 + validForMs) },
          });
          return id;
        };
        const acceptWithWindow = (id: string, shopperId: string) =>
          orderRepo.transition({
            id,
            shopperProfileId: shopperId,
            actorId: 'actor',
            from: 'ASSIGNED',
            to: 'SHOPPER_ACCEPTED',
            eventType: 'SHOPPER_ACCEPTED',
            stamp: 'shopperAcceptedAt',
            acceptWindowMinutes: WINDOW,
          });

        it('refuses the accept, writing nothing, when the window ends during the lock wait', async () => {
          const [target] = await shoppersNeeded(1);
          // The order is created BEFORE the profile lock is taken: creating it needs that row.
          const id = await newOrder(target);
          const blocker = hold(
            (tx) => tx.$queryRaw`SELECT id FROM shopper_profiles WHERE id = ${target} FOR UPDATE`,
          );
          try {
            await blocker.ready;
            // ONE deadline, fixed before the update, from which createdAt is derived: a
            // slow update eats into the time left instead of silently moving the deadline.
            const deadline = Date.now() + 2500;
            await db.shopperOrder.update({
              where: { id },
              data: { createdAt: new Date(deadline - WINDOW * 60_000) },
            });
            const attempt = acceptWithWindow(id, target);
            const attemptSettled = settledFlag(attempt);
            await untilBlockedOn('shopper_profiles');
            expect(Date.now()).toBeLessThan(deadline); // parked while the order was still acceptable
            await sleep(deadline - Date.now() + 200);
            expect(attemptSettled()).toBe(false);
            blocker.release();
            await blocker.done;

            const refused = await attempt;
            expect(refused).toMatchObject({ outcome: 'accept_expired' });
            // The cutoff it judged by: the order was created before it, i.e. it really was stale.
            const created = (await db.shopperOrder.findUniqueOrThrow({ where: { id } })).createdAt;
            expect(created.getTime()).toBeLessThan(
              (refused as { assignedBefore: Date }).assignedBefore.getTime(),
            );
            await untouched(id);
          } finally {
            blocker.release();
            await blocker.done.catch(() => undefined);
          }
        });

        it('refuses the accept when its wait for an ORDER row lock ends without changing the order, past the window', async () => {
          const [target] = await shoppersNeeded(1);
          const id = await newOrder(target);
          // ONE deadline; the order is aged to it BEFORE the row is held (the update would block on it).
          const deadline = Date.now() + 3000;
          await db.shopperOrder.update({
            where: { id },
            data: { createdAt: new Date(deadline - WINDOW * 60_000) },
          });
          // Another transaction holds the order row (and will release it with no change).
          const rowHolder = hold(
            (tx) => tx.$queryRaw`SELECT id FROM shopper_orders WHERE id = ${id} FOR UPDATE`,
          );
          try {
            await rowHolder.ready;
            const attempt = acceptWithWindow(id, target);
            const attemptSettled = settledFlag(attempt);
            await untilBlockedOn('shopper_orders');
            expect(Date.now()).toBeLessThan(deadline); // parked on the order lock, order still valid
            await sleep(deadline - Date.now() + 200); // the window runs out during the wait
            expect(attemptSettled()).toBe(false);
            rowHolder.release();
            await rowHolder.done;

            expect(await attempt).toMatchObject({ outcome: 'accept_expired' });
            await untouched(id);
          } finally {
            rowHolder.release();
            await rowHolder.done.catch(() => undefined);
          }
        });

        it('accepts an order that is still inside its window, and never applies the window to start', async () => {
          const [target] = await shoppersNeeded(1);
          const id = await nearlyExpired(target, 60_000);
          expect((await acceptWithWindow(id, target)).outcome).toBe('transitioned');
          // The window is long gone for this order, but starting is not bound by it.
          await db.shopperOrder.update({
            where: { id },
            data: { createdAt: new Date(Date.now() - 5 * WINDOW * 60_000) },
          });
          expect((await move(id, target, 'SHOPPER_ACCEPTED')).outcome).toBe('transitioned');
        });

        it('through the service: the shopper gets the timeout 409 and the order ends up cancelled and the request reopened', async () => {
          const config = new ShoppingConfigService(new ShoppingConfigRepository(prisma));
          const emit = jest.fn();
          const expiry = new OrderExpiryService(orderRepo, config, { emit } as never);
          const shopperOrders = new ShopperOrdersService(
            new ShopperProfileRepository(prisma),
            orderRepo,
            { log: jest.fn() } as never,
            expiry,
          );
          const rules = await config.getRules();
          const [target] = await shoppersNeeded(1);
          const userId = (await db.shopperProfile.findUniqueOrThrow({ where: { id: target } }))
            .userId;
          const id = await newOrder(target);
          const blocker = hold(
            (tx) => tx.$queryRaw`SELECT id FROM shopper_profiles WHERE id = ${target} FOR UPDATE`,
          );
          try {
            await blocker.ready;
            const deadline = Date.now() + 2500;
            await db.shopperOrder.update({
              where: { id },
              data: {
                createdAt: new Date(deadline - rules.shopperAcceptWindowMinutes * 60_000),
              },
            });
            // The service's own sweep (before the transition) still sees a fresh order.
            const attempt = shopperOrders.accept(userId, id).catch((e: unknown) => e);
            await untilBlockedOn('shopper_profiles');
            expect(Date.now()).toBeLessThan(deadline);
            await sleep(deadline - Date.now() + 200);
            blocker.release();
            await blocker.done;

            expect(await attempt).toMatchObject({
              status: 409,
              message: 'This order was cancelled because it was not accepted in time',
            });
            const order = await db.shopperOrder.findUniqueOrThrow({ where: { id } });
            expect(order).toMatchObject({ state: 'CANCELLED', cancelledBy: 'SYSTEM' });
            expect((await orderRepo.listEvents(id, 'asc')).map((e) => e.type)).toEqual([
              'OFFER_ACCEPTED',
              'ORDER_CANCELLED',
            ]);
            expect(
              (await db.shoppingRequest.findUniqueOrThrow({ where: { id: order.requestId } }))
                .status,
            ).toBe('OPEN');
            expect(emit).toHaveBeenCalledWith(
              'shopping.order.cancelled',
              expect.objectContaining({ orderId: id, cancelledBy: 'SYSTEM' }),
            );
          } finally {
            blocker.release();
            await blocker.done.catch(() => undefined);
          }
        });
      });

      it('through the service, when the window setting changes during the lock wait: still cancelled, and told so', async () => {
        const config = new ShoppingConfigService(new ShoppingConfigRepository(prisma));
        const emit = jest.fn();
        const expiry = new OrderExpiryService(orderRepo, config, { emit } as never);
        const shopperOrders = new ShopperOrdersService(
          new ShopperProfileRepository(prisma),
          orderRepo,
          { log: jest.fn() } as never,
          expiry,
        );
        const rules = await config.getRules();
        const [target] = await shoppersNeeded(1);
        const userId = (await db.shopperProfile.findUniqueOrThrow({ where: { id: target } }))
          .userId;
        const id = await newOrder(target);
        const blocker = hold(
          (tx) => tx.$queryRaw`SELECT id FROM shopper_profiles WHERE id = ${target} FOR UPDATE`,
        );
        try {
          await blocker.ready;
          const deadline = Date.now() + 2500;
          await db.shopperOrder.update({
            where: { id },
            data: { createdAt: new Date(deadline - rules.shopperAcceptWindowMinutes * 60_000) },
          });
          const attempt = shopperOrders.accept(userId, id).catch((e: unknown) => e);
          await untilBlockedOn('shopper_profiles');
          expect(Date.now()).toBeLessThan(deadline);
          // An admin raises the window while the accept is parked: a fresh read would now
          // call this order fresh, but the accept already judged it by the window it read.
          await db.shoppingConfig.update({
            where: { id: 1 },
            data: { shopperAcceptWindowMinutes: 100_000 },
          });
          await sleep(deadline - Date.now() + 200);
          blocker.release();
          await blocker.done;

          expect(await attempt).toMatchObject({
            status: 409,
            message: 'This order was cancelled because it was not accepted in time',
          });
          const order = await db.shopperOrder.findUniqueOrThrow({ where: { id } });
          expect(order).toMatchObject({ state: 'CANCELLED', cancelledBy: 'SYSTEM' }); // the claim is true
          expect(
            (await db.shoppingRequest.findUniqueOrThrow({ where: { id: order.requestId } })).status,
          ).toBe('OPEN');
          expect(emit).toHaveBeenCalledWith(
            'shopping.order.cancelled',
            expect.objectContaining({ orderId: id, cancelledBy: 'SYSTEM' }),
          );
        } finally {
          blocker.release();
          await blocker.done.catch(() => undefined);
          await db.shoppingConfig.update({
            where: { id: 1 },
            data: { shopperAcceptWindowMinutes: rules.shopperAcceptWindowMinutes },
          });
        }
      });

      describe('a shopper suspended after the service checked APPROVED', () => {
        const suspend = (id: string) =>
          db.shopperProfile.update({ where: { id }, data: { accountState: 'SUSPENDED' } });
        const approve = (id: string) =>
          db.shopperProfile.update({ where: { id }, data: { accountState: 'APPROVED' } });

        it('is refused by the transition itself, writing nothing', async () => {
          const [target] = await shoppersNeeded(1);
          const id = await newOrder(target);
          await suspend(target);
          try {
            expect(await move(id, target, 'ASSIGNED')).toEqual({ outcome: 'shopper_unavailable' });
            await untouched(id);
          } finally {
            await approve(target);
          }
        });

        it('suspension commits first: the transition waits for it and is refused', async () => {
          const [target] = await shoppersNeeded(1);
          const id = await newOrder(target);
          const suspension = hold((tx) =>
            tx.shopperProfile.update({
              where: { id: target },
              data: { accountState: 'SUSPENDED' },
            }),
          );
          try {
            await suspension.ready;
            const attempt = move(id, target, 'ASSIGNED');
            const attemptSettled = settledFlag(attempt);
            await untilBlockedOn('shopper_profiles');
            expect(attemptSettled()).toBe(false);
            suspension.release();
            await suspension.done;
            expect(await attempt).toEqual({ outcome: 'shopper_unavailable' });
            await untouched(id);
          } finally {
            suspension.release();
            await suspension.done.catch(() => undefined);
            await approve(target);
          }
        });

        it('transition commits first: the suspension waits for it, and the event stays', async () => {
          const [target] = await shoppersNeeded(1);
          const id = await newOrder(target);
          // Stall the transition after it has taken the profile lock, by holding the order row.
          const stall = hold(
            (tx) => tx.$queryRaw`SELECT id FROM shopper_orders WHERE id = ${id} FOR UPDATE`,
          );
          let suspension: Promise<unknown> | undefined;
          try {
            await stall.ready;
            const attempt = move(id, target, 'ASSIGNED');
            const attemptSettled = settledFlag(attempt);
            await untilBlockedOn('shopper_orders');
            suspension = suspend(target);
            const suspensionSettled = settledFlag(suspension);
            // The suspension must be seen waiting on the profile lock the transition holds;
            // only then is the order lock released. Without the guard it would never wait.
            await untilBlockedOn('shopper_profiles');
            expect(attemptSettled()).toBe(false);
            expect(suspensionSettled()).toBe(false);

            stall.release();
            expect((await attempt).outcome).toBe('transitioned');
            await suspension;

            expect((await db.shopperOrder.findUniqueOrThrow({ where: { id } })).state).toBe(
              'SHOPPER_ACCEPTED',
            );
            expect((await orderRepo.listEvents(id, 'asc')).map((e) => e.type)).toEqual([
              'OFFER_ACCEPTED',
              'SHOPPER_ACCEPTED',
            ]);
          } finally {
            stall.release();
            await stall.done.catch(() => undefined);
            await suspension?.catch(() => undefined);
            await approve(target);
          }
        });
      });

      it('treats another shopper order as not found and changes nothing', async () => {
        const id = await newOrder(shopperA);
        expect(await move(id, shopperB, 'ASSIGNED')).toEqual({ outcome: 'not_found' });
        expect(await move('00000000-0000-4000-8000-000000000000', shopperA, 'ASSIGNED')).toEqual({
          outcome: 'not_found',
        });
        expect((await db.shopperOrder.findUniqueOrThrow({ where: { id } })).state).toBe('ASSIGNED');
        expect(await db.orderEvent.count({ where: { orderId: id } })).toBe(1);
      });
    });

    it('lists orders by filter, scoped to the customer and to the shopper', async () => {
      const { requestId, offers: placed } = await offered([shopperA]);
      const result = await accept(requestId, placed[0].id);
      if (result.outcome !== 'accepted') throw new Error('expected accepted');

      const ids = async (filter?: 'active' | 'completed' | 'cancelled') =>
        (await orderRepo.listForCustomer(customerId, 0, 100, filter)).rows.map((o) => o.id);
      expect(await ids('active')).toContain(result.order.id);
      expect(await ids()).toContain(result.order.id);
      expect(await ids('completed')).not.toContain(result.order.id);
      expect(await ids('cancelled')).not.toContain(result.order.id);

      await db.shopperOrder.update({
        where: { id: result.order.id },
        data: { state: 'COMPLETED' },
      });
      expect(await ids('completed')).toContain(result.order.id);
      expect(await ids('active')).not.toContain(result.order.id);

      expect((await orderRepo.listForCustomer(shopperA, 0, 10)).total).toBe(0);
      expect(
        (await orderRepo.listForShopper(shopperA, 0, 100, 'completed')).rows.map((o) => o.id),
      ).toContain(result.order.id);
      expect(
        (await orderRepo.listForShopper(shopperB, 0, 100)).rows.map((o) => o.id),
      ).not.toContain(result.order.id);
    });

    it('end to end through the services: privacy, financials, events, and the cancel conflict', async () => {
      const config = new ShoppingConfigService(new ShoppingConfigRepository(prisma));
      const audit = { log: jest.fn() };
      const emit = jest.fn();
      const bidding = new ShopperBiddingService(
        new ShopperProfileRepository(prisma),
        requests,
        offers,
        config,
        { emit } as never,
        audit as never,
      );
      const expiry = new OrderExpiryService(orderRepo, config, { emit } as never);
      const customerOrders = new ShoppingOrdersService(
        orderRepo,
        { emit } as never,
        audit as never,
        expiry,
        config,
      );
      const shopperOrders = new ShopperOrdersService(
        new ShopperProfileRepository(prisma),
        orderRepo,
        audit as never,
        expiry,
      );
      const shopperUser = (await db.shopperProfile.findUniqueOrThrow({ where: { id: shopperA } }))
        .userId;
      const otherUser = (await db.shopperProfile.findUniqueOrThrow({ where: { id: shopperB } }))
        .userId;
      const fee = (await config.getRules()).minShopperFee;

      const { id: requestId } = await makeRequest(loc1, [cat1]);
      await db.shoppingRequest.update({
        where: { id: requestId },
        data: { note: 'call me on 08030000000', deliveryAddress: '99 Secret Close' },
      });
      const bid = await bidding.submit(shopperUser, requestId, { shopperFee: fee, etaMinutes: 20 });

      const { data: order } = await customerOrders.acceptOffer(
        customerId,
        requestId,
        bid.id as string,
      );
      expect(order.financials).toEqual({
        ...bid.financials,
        shopperGrossEarnings: undefined,
      });
      expect(order.deliveryAddress.text).toBe('99 Secret Close'); // the customer sees their own address
      expect(emit).toHaveBeenLastCalledWith(
        'shopping.offer.accepted',
        expect.objectContaining({ orderId: order.id, winnerUserId: shopperUser }),
      );

      const seen = await shopperOrders.findOne(shopperUser, order.id);
      expect(seen.financials).toMatchObject({
        customerTotal: order.financials.customerTotal,
        shopperGrossEarnings: fee,
      });
      expect(JSON.stringify(seen)).not.toMatch(/Secret Close|08030000000|latitude|deliveryAddress/);
      await expect(shopperOrders.findOne(otherUser, order.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(customerOrders.findOne(shopperUser, order.id)).rejects.toMatchObject({
        status: 404,
      });

      await expect(shopperOrders.start(shopperUser, order.id)).rejects.toMatchObject({
        status: 409,
      });
      expect((await shopperOrders.accept(shopperUser, order.id)).state).toBe('SHOPPER_ACCEPTED');
      await expect(shopperOrders.accept(shopperUser, order.id)).rejects.toMatchObject({
        status: 409,
      });
      expect((await shopperOrders.start(shopperUser, order.id)).state).toBe('SHOPPING_STARTED');

      const detail = await customerOrders.findOne(customerId, order.id);
      expect(detail.state).toBe('SHOPPING_STARTED');
      expect(detail.events.map((e) => e.type)).toEqual([
        'SHOPPING_STARTED',
        'SHOPPER_ACCEPTED',
        'OFFER_ACCEPTED',
      ]);
      expect(JSON.stringify(detail)).not.toMatch(/actorId|@example\.test/);

      const requestsService = new ShoppingRequestsService(
        requests,
        offers,
        new ShoppingReferenceRepository(prisma),
        config,
        audit as never,
      );
      await expect(requestsService.cancel(customerId, requestId)).rejects.toMatchObject({
        status: 409,
        message: 'Only an open request can be cancelled; this one is assigned',
      });
    });
  });

  describe('orders: cancelling and the accept timeout', () => {
    const orderRepo = new ShopperOrderRepository(prisma);
    const extra: string[] = [];
    /** The offer window, in minutes, a reopened request gets. */
    const reopen = (): number => 30;

    const shoppers = async (n: number): Promise<string[]> => {
      while (extra.length < n) extra.push(await makeShopper(`oc-${extra.length}`, loc1, cat1));
      return extra.slice(0, n);
    };
    const bid = (requestId: string, shopperProfileId: string, fee = 1000) =>
      offers.submit({
        requestId,
        shopperProfileId,
        shopperFee: fee,
        etaMinutes: 20,
        financials: { shopperFee: fee, customerTotal: 12000 + fee },
        acceptanceWindowMinutes: 1440,
      });
    /** A request with offers from the given shoppers, the first one accepted: an ASSIGNED order. */
    const assigned = async (who: string[] = [shopperA, shopperB]) => {
      const { id: requestId } = await makeRequest(loc1, [cat1]);
      const placed = [];
      for (const [i, shopperId] of who.entries())
        placed.push(await bid(requestId, shopperId, 1000 + i));
      const result = await orderRepo.acceptOffer({ requestId, offerId: placed[0].id, customerId });
      if (result.outcome !== 'accepted')
        throw new Error(`expected accepted, got ${result.outcome}`);
      return { requestId, placed, orderId: result.order.id };
    };
    const cancel = (orderId: string, by = customerId, reason?: string) =>
      orderRepo.cancelOrder({
        orderId,
        actor: { kind: 'CUSTOMER', userId: by },
        reason,
        reopenWindowMinutes: reopen(),
      });
    const shopperMove = (id: string, by = shopperA) =>
      orderRepo.transition({
        id,
        shopperProfileId: by,
        actorId: 'actor',
        from: 'ASSIGNED',
        to: 'SHOPPER_ACCEPTED',
        eventType: 'SHOPPER_ACCEPTED',
        stamp: 'shopperAcceptedAt',
      });
    const eventTypes = async (orderId: string): Promise<string[]> =>
      (await orderRepo.listEvents(orderId, 'asc')).map((e) => e.type);

    it('cancels an ASSIGNED order: offer REJECTED, request reopened with a fresh deadline, event written', async () => {
      const { requestId, placed, orderId } = await assigned();
      const before = Date.now();

      const result = await orderRepo.cancelOrder({
        orderId,
        actor: { kind: 'CUSTOMER', userId: customerId },
        reason: 'changed my mind',
        reopenWindowMinutes: 45,
      });

      if (result.outcome !== 'cancelled')
        throw new Error(`expected cancelled, got ${result.outcome}`);
      expect(result.cancelledBy).toBe('CUSTOMER');
      expect(result.shopperUserId).toBe(
        (await db.shopperProfile.findUniqueOrThrow({ where: { id: shopperA } })).userId,
      );
      const order = await db.shopperOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(order).toMatchObject({
        state: 'CANCELLED',
        cancelledBy: 'CUSTOMER',
        cancelReason: 'changed my mind',
      });
      expect(order.cancelledAt).not.toBeNull();
      expect(
        (await db.shoppingOffer.findUniqueOrThrow({ where: { id: placed[0].id } })).state,
      ).toBe('REJECTED');
      expect(
        (await db.shoppingOffer.findUniqueOrThrow({ where: { id: placed[1].id } })).state,
      ).toBe('REJECTED');
      const request = await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(request.status).toBe('OPEN');
      // a fresh 45-minute window, counted from inside the cancel
      expect(request.offerDeadline.getTime()).toBeGreaterThanOrEqual(before + 45 * 60_000);
      expect(request.offerDeadline.getTime()).toBeLessThanOrEqual(Date.now() + 45 * 60_000);
      expect(await eventTypes(orderId)).toEqual(['OFFER_ACCEPTED', 'ORDER_CANCELLED']);
      const event = (await orderRepo.listEvents(orderId, 'desc'))[0];
      expect(event).toMatchObject({
        actorRole: 'CUSTOMER',
        metadata: { cancelledBy: 'CUSTOMER', reason: 'changed my mind' },
      });
    });

    it('then lets OTHER shoppers bid and be accepted: a second order, the first stays CANCELLED, the cancelled shopper is barred', async () => {
      const [, , shopperC] = [shopperA, shopperB, ...(await shoppers(1))];
      const { requestId, placed, orderId: first } = await assigned();
      await cancel(first);

      // The shopper whose order was cancelled may NOT bid again; someone else can.
      await expect(bid(requestId, shopperA, 900)).rejects.toBeInstanceOf(
        ShopperBarredFromRequestError,
      );
      const fresh = await bid(requestId, shopperC, 800);
      const second = await orderRepo.acceptOffer({ requestId, offerId: fresh.id, customerId });
      if (second.outcome !== 'accepted')
        throw new Error(`expected accepted, got ${second.outcome}`);

      expect(second.order.id).not.toBe(first);
      expect(await db.shopperOrder.count({ where: { requestId } })).toBe(2);
      expect((await db.shopperOrder.findUniqueOrThrow({ where: { id: first } })).state).toBe(
        'CANCELLED',
      );
      expect(
        (await db.shopperOrder.findUniqueOrThrow({ where: { id: second.order.id } })).state,
      ).toBe('ASSIGNED');
      expect(
        (await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
      ).toBe('ASSIGNED');
      expect(
        await db.shoppingOffer.count({ where: { requestId, shopperProfileId: shopperA } }),
      ).toBe(
        1, // only the original, REJECTED offer: no re-bid was created
      );
      expect(placed).toHaveLength(2);
    });

    it('retrying the accept of the first, cancelled order finds no live order: the offer is not pending', async () => {
      const { requestId, placed, orderId } = await assigned();
      await cancel(orderId);
      expect(await orderRepo.acceptOffer({ requestId, offerId: placed[0].id, customerId })).toEqual(
        {
          outcome: 'offer_not_pending',
          state: 'REJECTED',
        },
      );
    });

    it('the database allows only one non-cancelled order per request and per offer', async () => {
      const { requestId, placed, orderId } = await assigned();
      const row = (reference: string, offerId: string) => ({
        reference,
        requestId,
        offerId,
        customerId,
        shopperProfileId: shopperA,
        shoppingLocationId: loc1,
        financials: {},
      });
      await expect(
        db.shopperOrder.create({ data: row('SO-DUPREQ01', placed[1].id) }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        db.shopperOrder.create({ data: row('SO-DUPOFR01', placed[0].id) }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await cancel(orderId);
      await expect(
        db.shopperOrder.create({ data: row('SO-AFTERC01', placed[1].id) }),
      ).resolves.toBeDefined();
    });

    it('refuses to cancel once the shopper has accepted, changing nothing', async () => {
      const { requestId, orderId } = await assigned();
      await shopperMove(orderId);
      expect(await cancel(orderId)).toEqual({ outcome: 'conflict', state: 'SHOPPER_ACCEPTED' });
      expect((await db.shopperOrder.findUniqueOrThrow({ where: { id: orderId } })).state).toBe(
        'SHOPPER_ACCEPTED',
      );
      expect(
        (await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
      ).toBe('ASSIGNED');
      expect(await eventTypes(orderId)).toEqual(['OFFER_ACCEPTED', 'SHOPPER_ACCEPTED']);
    });

    it('treats someone else order as not found, and a repeat cancel by the owner as already_cancelled', async () => {
      const { orderId } = await assigned();
      expect(await cancel(orderId, shopperA)).toEqual({ outcome: 'not_found' });
      expect((await cancel(orderId)).outcome).toBe('cancelled');
      const again = await cancel(orderId);
      expect(again.outcome).toBe('already_cancelled');
      expect(again.outcome === 'already_cancelled' && again.order.state).toBe('CANCELLED');
      expect(await eventTypes(orderId)).toEqual(['OFFER_ACCEPTED', 'ORDER_CANCELLED']);
    });

    it('lets exactly one of 8 concurrent cancels win, with one event', async () => {
      const { orderId } = await assigned();
      const results = await Promise.all(Array.from({ length: 8 }, () => cancel(orderId)));
      expect(results.filter((r) => r.outcome === 'cancelled')).toHaveLength(1);
      expect(results.filter((r) => r.outcome === 'already_cancelled')).toHaveLength(7);
      expect(await eventTypes(orderId)).toEqual(['OFFER_ACCEPTED', 'ORDER_CANCELLED']);
    });

    it('lets exactly one of cancel and shopper accept win, 8 times over', async () => {
      for (let i = 0; i < 8; i++) {
        const { requestId, orderId } = await assigned();
        const [cancelled, accepted] = await Promise.all([cancel(orderId), shopperMove(orderId)]);
        const order = await db.shopperOrder.findUniqueOrThrow({ where: { id: orderId } });
        const types = await eventTypes(orderId);
        const request = await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } });
        if (cancelled.outcome === 'cancelled') {
          expect(accepted).toMatchObject({
            outcome: 'conflict',
            state: 'CANCELLED',
            cancelledBy: 'CUSTOMER',
          });
          expect(order.state).toBe('CANCELLED');
          expect(types).toEqual(['OFFER_ACCEPTED', 'ORDER_CANCELLED']);
          expect(request.status).toBe('OPEN');
        } else {
          expect(cancelled).toEqual({ outcome: 'conflict', state: 'SHOPPER_ACCEPTED' });
          expect(accepted.outcome).toBe('transitioned');
          expect(order.state).toBe('SHOPPER_ACCEPTED');
          expect(types).toEqual(['OFFER_ACCEPTED', 'SHOPPER_ACCEPTED']);
          expect(request.status).toBe('ASSIGNED');
        }
      }
    });

    it('hands out the full window counted from AFTER the request-lock wait, not from before it', async () => {
      const { requestId, orderId } = await assigned();
      const owner = hold(
        (tx) => tx.$queryRaw`SELECT id FROM shopping_requests WHERE id = ${requestId} FOR UPDATE`,
      );
      let attempt: ReturnType<typeof orderRepo.cancelOrder> | undefined;
      try {
        await owner.ready;
        attempt = orderRepo.cancelOrder({
          orderId,
          actor: { kind: 'CUSTOMER', userId: customerId },
          reopenWindowMinutes: 30,
        });
        attempt.catch(() => undefined); // observed from the start: an early rejection is not unhandled
        await untilBlockedOn('shopping_requests'); // parked on the lock, already holding its arguments
        await sleep(1500); // a long wait
        const released = Date.now();
        owner.release();
        await owner.done;
        expect((await attempt).outcome).toBe('cancelled');

        const { offerDeadline } = await db.shoppingRequest.findUniqueOrThrow({
          where: { id: requestId },
        });
        // Full 30 minutes from the moment the lock was won: a deadline fixed before the wait
        // would be about 1.5 s short of this.
        expect(offerDeadline.getTime()).toBeGreaterThanOrEqual(released + 30 * 60_000);
      } finally {
        // Release the holder FIRST so the operation can finish, then wait for it as well:
        // it must not outlive this test and write during the next one.
        owner.release();
        await owner.done.catch(() => undefined);
        await attempt?.catch(() => undefined);
      }
    });

    describe('timeout', () => {
      const system = (orderId: string, assignedBefore: Date) =>
        orderRepo.cancelOrder({
          orderId,
          actor: { kind: 'SYSTEM' },
          assignedBefore,
          reopenWindowMinutes: reopen(),
        });

      it('does not cancel an order that is still inside its window', async () => {
        const { orderId } = await assigned();
        expect(await system(orderId, new Date(Date.now() - 60_000))).toEqual({
          outcome: 'not_stale',
        });
        expect((await db.shopperOrder.findUniqueOrThrow({ where: { id: orderId } })).state).toBe(
          'ASSIGNED',
        );
      });

      it('cancels a stale order as SYSTEM: offer EXPIRED, request reopened, no customer reason', async () => {
        const { requestId, placed, orderId } = await assigned();
        const result = await system(orderId, new Date(Date.now() + 1000));
        expect(result.outcome).toBe('cancelled');
        const order = await db.shopperOrder.findUniqueOrThrow({ where: { id: orderId } });
        expect(order).toMatchObject({
          state: 'CANCELLED',
          cancelledBy: 'SYSTEM',
          cancelReason: 'Shopper did not accept in time',
        });
        expect(
          (await db.shoppingOffer.findUniqueOrThrow({ where: { id: placed[0].id } })).state,
        ).toBe('EXPIRED');
        expect(
          (await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
        ).toBe('OPEN');
        expect((await orderRepo.listEvents(orderId, 'desc'))[0]).toMatchObject({
          type: 'ORDER_CANCELLED',
          actorRole: 'SYSTEM',
          actorId: null,
        });
      });

      it('expireStale cancels only stale ASSIGNED orders in scope and reports what it cancelled', async () => {
        const stale = await assigned();
        const accepted = await assigned();
        await shopperMove(accepted.orderId);
        const future = new Date(Date.now() + 1000);

        const scoped = await orderRepo.expireStale({ orderId: stale.orderId }, future, reopen());
        expect(scoped.map((c) => c.order.id)).toEqual([stale.orderId]);
        expect(scoped[0].cancelledBy).toBe('SYSTEM');

        const swept = await orderRepo.expireStale({ customerId }, future, reopen());
        expect(swept.map((c) => c.order.id)).not.toContain(accepted.orderId);
        expect(
          (await db.shopperOrder.findUniqueOrThrow({ where: { id: accepted.orderId } })).state,
        ).toBe('SHOPPER_ACCEPTED');
        expect(
          await orderRepo.expireStale(
            { shopperProfileId: shopperA },
            new Date(Date.now() - 60_000),
            reopen(),
          ),
        ).toEqual([]);
      });

      it('lets exactly one of expiry and shopper accept win, 8 times over', async () => {
        for (let i = 0; i < 8; i++) {
          const { orderId } = await assigned();
          const [expired, accepted] = await Promise.all([
            system(orderId, new Date(Date.now() + 1000)),
            shopperMove(orderId),
          ]);
          const order = await db.shopperOrder.findUniqueOrThrow({ where: { id: orderId } });
          if (expired.outcome === 'cancelled') {
            expect(accepted).toMatchObject({
              outcome: 'conflict',
              state: 'CANCELLED',
              cancelledBy: 'SYSTEM',
            });
            expect(order.state).toBe('CANCELLED');
            expect(await eventTypes(orderId)).toEqual(['OFFER_ACCEPTED', 'ORDER_CANCELLED']);
          } else {
            expect(accepted.outcome).toBe('transitioned');
            expect(expired.outcome).toBe('not_stale');
            expect(order.state).toBe('SHOPPER_ACCEPTED');
            expect(await eventTypes(orderId)).toEqual(['OFFER_ACCEPTED', 'SHOPPER_ACCEPTED']);
          }
        }
      });

      it('lets exactly one of two concurrent expiry sweeps cancel, with one event', async () => {
        const { orderId } = await assigned();
        const future = new Date(Date.now() + 1000);
        const sweeps = await Promise.all([
          orderRepo.expireStale({ orderId }, future, reopen()),
          orderRepo.expireStale({ orderId }, future, reopen()),
          cancel(orderId),
        ]);
        expect(
          sweeps[0].length + sweeps[1].length + (sweeps[2].outcome === 'cancelled' ? 1 : 0),
        ).toBe(1);
        expect(await eventTypes(orderId)).toEqual(['OFFER_ACCEPTED', 'ORDER_CANCELLED']);
      });
    });

    it('end to end through the services: timeout on a shopper accept, customer view, reopened request, notification', async () => {
      const config = new ShoppingConfigService(new ShoppingConfigRepository(prisma));
      const audit = { log: jest.fn() };
      const emit = jest.fn();
      const expiry = new OrderExpiryService(orderRepo, config, { emit } as never);
      const customerOrders = new ShoppingOrdersService(
        orderRepo,
        { emit } as never,
        audit as never,
        expiry,
        config,
      );
      const shopperOrders = new ShopperOrdersService(
        new ShopperProfileRepository(prisma),
        orderRepo,
        audit as never,
        expiry,
      );
      const rules = await config.getRules();
      expect(rules.shopperAcceptWindowMinutes).toBeGreaterThan(0);

      const { requestId, orderId } = await assigned();
      const shopperUser = (await db.shopperProfile.findUniqueOrThrow({ where: { id: shopperA } }))
        .userId;
      // Make the order older than the window.
      await db.shopperOrder.update({
        where: { id: orderId },
        data: { createdAt: new Date(Date.now() - (rules.shopperAcceptWindowMinutes + 1) * 60_000) },
      });

      await expect(shopperOrders.accept(shopperUser, orderId)).rejects.toMatchObject({
        status: 409,
        message: 'This order was cancelled because it was not accepted in time',
      });
      expect(emit).toHaveBeenCalledWith(
        'shopping.order.cancelled',
        expect.objectContaining({ orderId, shopperUserId: shopperUser, cancelledBy: 'SYSTEM' }),
      );
      const detail = await customerOrders.findOne(customerId, orderId);
      expect(detail).toMatchObject({ state: 'CANCELLED', cancelledBy: 'SYSTEM' });
      expect(detail.events.map((e) => e.type)).toEqual(['ORDER_CANCELLED', 'OFFER_ACCEPTED']);
      const listed = await customerOrders.list(customerId, {
        filter: 'cancelled',
        page: 1,
        limit: 100,
      } as never);
      expect(listed.data.map((o) => o.id)).toContain(orderId);
      const request = await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(request.status).toBe('OPEN');
      expect(request.offerDeadline.getTime()).toBeGreaterThan(
        Date.now() + (rules.offerWindowMinutes - 1) * 60_000,
      );

      // The shopper's view of it never carries the customer's reason.
      const seen = await shopperOrders.findOne(shopperUser, orderId);
      expect(seen).toMatchObject({ state: 'CANCELLED', cancelledBy: 'SYSTEM' });
      expect(seen).not.toHaveProperty('cancelReason');
    });

    it('end to end: the customer cancels with a reason the shopper never sees, then cancelling again returns the order', async () => {
      const config = new ShoppingConfigService(new ShoppingConfigRepository(prisma));
      const audit = { log: jest.fn() };
      const emit = jest.fn();
      const expiry = new OrderExpiryService(orderRepo, config, { emit } as never);
      const customerOrders = new ShoppingOrdersService(
        orderRepo,
        { emit } as never,
        audit as never,
        expiry,
        config,
      );
      const shopperOrders = new ShopperOrdersService(
        new ShopperProfileRepository(prisma),
        orderRepo,
        audit as never,
        expiry,
      );
      const { orderId } = await assigned();
      const shopperUser = (await db.shopperProfile.findUniqueOrThrow({ where: { id: shopperA } }))
        .userId;

      const first = await customerOrders.cancelOrder(customerId, orderId, {
        reason: 'call me on 08031112222',
      });
      expect(first.data).toMatchObject({
        state: 'CANCELLED',
        cancelledBy: 'CUSTOMER',
        cancelReason: 'call me on 08031112222',
      });
      expect(first.cancelled).toBe(true);
      expect(emit).toHaveBeenCalledWith(
        'shopping.order.cancelled',
        expect.objectContaining({ orderId, shopperUserId: shopperUser, cancelledBy: 'CUSTOMER' }),
      );
      const again = await customerOrders.cancelOrder(customerId, orderId, {});
      expect(again.cancelled).toBe(false);
      expect(again.data.state).toBe('CANCELLED');

      const text = JSON.stringify([
        await shopperOrders.findOne(shopperUser, orderId),
        await shopperOrders.listEvents(shopperUser, orderId),
      ]);
      expect(text).not.toContain('08031112222');
      expect(text).toContain('ORDER_CANCELLED');
      await expect(shopperOrders.start(shopperUser, orderId)).rejects.toMatchObject({
        status: 409,
      });
    });
  });

  describe('bidding window vs acceptance window, and the re-bid block', () => {
    const orderRepo = new ShopperOrderRepository(prisma);
    const extra: string[] = [];
    const shoppers = async (n: number): Promise<string[]> => {
      while (extra.length < n) extra.push(await makeShopper(`bw-${extra.length}`, loc1, cat1));
      return extra.slice(0, n);
    };
    const bidWith = (requestId: string, shopperProfileId: string, acceptanceWindowMinutes = 1440) =>
      offers.submit({
        requestId,
        shopperProfileId,
        shopperFee: 1000,
        etaMinutes: 20,
        financials: { shopperFee: 1000, customerTotal: 13000 },
        acceptanceWindowMinutes,
      });
    const acceptOffer = (requestId: string, offerId: string) =>
      orderRepo.acceptOffer({ requestId, offerId, customerId });
    /** A request with an accepted offer from `winner`, i.e. an ASSIGNED order. */
    const assignedTo = async (winner: string) => {
      const { id: requestId } = await makeRequest(loc1, [cat1]);
      const offer = await bidWith(requestId, winner);
      const result = await acceptOffer(requestId, offer.id);
      if (result.outcome !== 'accepted')
        throw new Error(`expected accepted, got ${result.outcome}`);
      return { requestId, orderId: result.order.id };
    };
    const customerCancel = (orderId: string) =>
      orderRepo.cancelOrder({
        orderId,
        actor: { kind: 'CUSTOMER', userId: customerId },
        reopenWindowMinutes: 30,
      });
    const systemCancel = (orderId: string) =>
      orderRepo.cancelOrder({
        orderId,
        actor: { kind: 'SYSTEM' },
        assignedBefore: new Date(Date.now() + 1000),
        reopenWindowMinutes: 30,
      });
    const feedIds = async (shopperProfileId: string): Promise<string[]> =>
      (
        await requests.findMatchingForShopper({
          shopperProfileId,
          now: new Date(),
          sortBy: 'createdAt',
          sortOrder: 'asc',
          skip: 0,
          take: 500,
        })
      ).rows.map((r) => r.id);

    describe.each([
      ['the customer cancels the order', customerCancel],
      ['the accept timeout cancels the order', systemCancel],
    ])('when %s', (_label, cancelIt) => {
      it('bars that shopper from the request, hides it from their feed, and leaves everyone else free to bid', async () => {
        const [winner, other] = await shoppers(2);
        const { requestId, orderId } = await assignedTo(winner);
        expect(await feedIds(winner)).not.toContain(requestId); // ASSIGNED: not in anyone's feed
        expect((await cancelIt(orderId)).outcome).toBe('cancelled');

        // the request is open again...
        expect(await feedIds(other)).toContain(requestId);
        // ...but not for the shopper whose order was cancelled
        expect(await feedIds(winner)).not.toContain(requestId);
        expect(await requests.isShopperBarred(requestId, winner)).toBe(true);
        expect(await requests.isShopperBarred(requestId, other)).toBe(false);
        await expect(bidWith(requestId, winner)).rejects.toBeInstanceOf(
          ShopperBarredFromRequestError,
        );
        expect(
          await db.shoppingOffer.count({
            where: { requestId, shopperProfileId: winner, state: 'PENDING' },
          }),
        ).toBe(0);

        // another shopper can still bid
        await expect(bidWith(requestId, other)).resolves.toMatchObject({ state: 'PENDING' });
        // coverage (which answers 404 vs 409) and readability through their old offer are unchanged
        expect((await requests.findCoveredByShopper(requestId, winner))?.id).toBe(requestId);
        expect((await requests.findReadableByShopper(requestId, winner, new Date()))?.id).toBe(
          requestId,
        );
      });
    });

    it('a submit racing the cancel: the cancelled shopper never gets a live offer, a newcomer only after the cancel', async () => {
      const [winner, newcomer] = await shoppers(2);
      for (let i = 0; i < 8; i++) {
        const { requestId, orderId } = await assignedTo(winner);
        const [cancelled, byWinner, byNewcomer] = await Promise.allSettled([
          customerCancel(orderId),
          bidWith(requestId, winner),
          bidWith(requestId, newcomer),
        ]);
        // The cancel itself must have worked: a `not_found` would leave the request ASSIGNED,
        // both bids would be refused as closed, and the checks below would pass for nothing.
        expect(cancelled).toMatchObject({ status: 'fulfilled', value: { outcome: 'cancelled' } });
        expect(
          (await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
        ).toBe('OPEN');
        // Before the cancel commits the request is ASSIGNED (closed); after, the winner is barred.
        expect(byWinner.status).toBe('rejected');
        const reason = (byWinner as PromiseRejectedResult).reason;
        expect(
          [OfferRequestClosedError, ShopperBarredFromRequestError].some((E) => reason instanceof E),
        ).toBe(true);
        expect(
          await db.shoppingOffer.count({
            where: { requestId, shopperProfileId: winner, state: 'PENDING' },
          }),
        ).toBe(0);
        if (byNewcomer.status === 'fulfilled') {
          expect(
            (await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
          ).toBe('OPEN');
        } else {
          expect((byNewcomer as PromiseRejectedResult).reason).toBeInstanceOf(
            OfferRequestClosedError,
          );
        }
      }
    });

    it('the cancel waits for a shared (submit-style) request lock; once it has run, an eligible shopper can bid and the cancelled one is barred', async () => {
      const [winner, newcomer] = await shoppers(2);
      const { requestId, orderId } = await assignedTo(winner);
      // A bid cannot be placed while the request is ASSIGNED, so this does not model a bid
      // that wins: it holds FOR SHARE (the lock a submit takes) and shows the cancel cannot
      // commit underneath it. The surviving-bid ordering is covered by the racing test above.
      const submitLock = hold(
        (tx) => tx.$queryRaw`SELECT id FROM shopping_requests WHERE id = ${requestId} FOR SHARE`,
      );
      try {
        await submitLock.ready;
        const cancel = customerCancel(orderId);
        const cancelSettled = settledFlag(cancel);
        await untilBlockedOn('shopping_requests');
        expect(cancelSettled()).toBe(false); // the cancel cannot commit while a submit holds the lock
        submitLock.release();
        await submitLock.done;
        expect((await cancel).outcome).toBe('cancelled');
        // only now is a bid by someone else possible, and the cancelled shopper is barred
        await expect(bidWith(requestId, newcomer)).resolves.toBeDefined();
        await expect(bidWith(requestId, winner)).rejects.toBeInstanceOf(
          ShopperBarredFromRequestError,
        );
      } finally {
        submitLock.release();
        await submitLock.done.catch(() => undefined);
      }
    });

    describe('offers outlive the bidding deadline', () => {
      it('bid before the deadline; after bidding closes the customer can still accept; offers are not expired at the deadline; no new bids', async () => {
        const [a, b] = await shoppers(2);
        // The normal deadline: setup speed cannot close bidding before the bid is placed.
        const { id: requestId } = await makeRequest(loc1, [cat1]);
        const offer = await bidWith(requestId, a, 60);
        const deadline = (await db.shoppingRequest.findUniqueOrThrow({ where: { id: requestId } }))
          .offerDeadline;
        expect(offer.expiresAt.getTime()).toBe(deadline.getTime() + 60 * 60_000);

        // Close bidding by moving ONLY the persisted bidding deadline into the past.
        await db.shoppingRequest.update({
          where: { id: requestId },
          data: { offerDeadline: new Date(Date.now() - 1000) },
        });

        // the offer did not flip to EXPIRED when bidding closed: its own expiresAt is ahead
        expect(
          (
            await db.shoppingOffer.findUniqueOrThrow({ where: { id: offer.id } })
          ).expiresAt.getTime(),
        ).toBeGreaterThan(Date.now());
        expect(await offers.expireDue(new Date(), { requestId })).toBe(0);
        expect((await db.shoppingOffer.findUniqueOrThrow({ where: { id: offer.id } })).state).toBe(
          'PENDING',
        );
        // no new bid, and the request is gone from the feed
        await expect(bidWith(requestId, b)).rejects.toBeInstanceOf(OfferRequestClosedError);
        expect(await feedIds(b)).not.toContain(requestId);
        // the customer accepts after bidding closed, inside the acceptance window
        expect((await acceptOffer(requestId, offer.id)).outcome).toBe('accepted');
      });

      it('refuses an accept after the offer own expiresAt, and only then does the offer expire', async () => {
        const [a] = await shoppers(1);
        const { id: requestId } = await makeRequest(loc1, [cat1], 30 * 60_000);
        const offer = await bidWith(requestId, a);
        const ended = new Date(Date.now() - 1000);
        await db.shoppingOffer.update({ where: { id: offer.id }, data: { expiresAt: ended } });
        await db.shoppingRequest.update({
          where: { id: requestId },
          data: { offerDeadline: ended },
        });

        expect(await acceptOffer(requestId, offer.id)).toEqual({ outcome: 'offer_expired' });
        expect(await db.shopperOrder.count({ where: { requestId } })).toBe(0);
        expect(await offers.expireDue(new Date(), { requestId })).toBe(1);
        expect((await db.shoppingOffer.findUniqueOrThrow({ where: { id: offer.id } })).state).toBe(
          'EXPIRED',
        );
      });
    });

    describe('the request is lazily EXPIRED only when nothing can be accepted', () => {
      const DAY = 24 * 60 * 60_000;
      const expire = (requestId: string) =>
        requests.expireElapsed({ customerId, requestId }, new Date(), 1440);
      const statusOf = async (id: string) =>
        (await db.shoppingRequest.findUniqueOrThrow({ where: { id } })).status;

      it('not while the acceptance window after the bidding deadline is still running', async () => {
        const { id } = await makeRequest(loc1, [cat1], -10 * 60_000); // bidding closed 10 minutes ago
        expect(await expire(id)).toBe(0);
        expect(await statusOf(id)).toBe('OPEN');
      });

      it('once deadline + window has passed and no offer is acceptable', async () => {
        const { id } = await makeRequest(loc1, [cat1], -2 * DAY);
        expect(await expire(id)).toBe(1);
        expect(await statusOf(id)).toBe('EXPIRED');
        // cancelling it is the existing conflict; accepting anything on it is refused
        expect(await requests.cancel(id, customerId, new Date())).toEqual({
          outcome: 'not_open',
          status: 'EXPIRED',
        });
      });

      it('not while a PENDING offer is still inside its own acceptance window (e.g. after the config changed)', async () => {
        const [a] = await shoppers(1);
        const { id } = await makeRequest(loc1, [cat1], -2 * DAY);
        const offer = await db.shoppingOffer.create({
          data: {
            requestId: id,
            shopperProfileId: a,
            shopperFee: 1000,
            etaMinutes: 20,
            expiresAt: new Date(Date.now() + 60 * 60_000),
            financials: { customerTotal: 13000 },
          },
        });
        expect(await expire(id)).toBe(0);
        expect(await statusOf(id)).toBe('OPEN');
        expect((await acceptOffer(id, offer.id)).outcome).toBe('accepted'); // still acceptable
      });

      it('never touches requests that are not OPEN', async () => {
        const [a] = await shoppers(1);
        const { requestId } = await assignedTo(a);
        await db.shoppingRequest.update({
          where: { id: requestId },
          data: { offerDeadline: new Date(Date.now() - 2 * DAY) },
        });
        expect(await expire(requestId)).toBe(0);
        expect(await statusOf(requestId)).toBe('ASSIGNED');
      });

      it('only ever touches the caller own requests', async () => {
        const { id } = await makeRequest(loc1, [cat1], -2 * DAY);
        expect(
          await requests.expireElapsed({ customerId: shopperA, requestId: id }, new Date(), 1440),
        ).toBe(0);
        expect(await statusOf(id)).toBe('OPEN');
      });

      it('an accept on an offer whose window is already over is refused, whichever of accept and expiry runs first; no order on an EXPIRED request', async () => {
        const [a] = await shoppers(1);
        for (let i = 0; i < 8; i++) {
          const { id } = await makeRequest(loc1, [cat1], -2 * DAY);
          const offer = await db.shoppingOffer.create({
            data: {
              requestId: id,
              shopperProfileId: a,
              shopperFee: 1000,
              etaMinutes: 20,
              expiresAt: new Date(Date.now() - 1000), // its acceptance window is over
              financials: { customerTotal: 13000 },
            },
          });
          const [accepted] = await Promise.all([acceptOffer(id, offer.id), expire(id)]);
          expect(['request_not_open', 'offer_expired']).toContain(accepted.outcome);
          expect(await db.shopperOrder.count({ where: { requestId: id } })).toBe(0);
          expect(await statusOf(id)).toBe('EXPIRED');
        }
      });

      it('a VALID accept in flight when the offer window ends and the sweep runs: the sweep waits, loses, and leaves the request ASSIGNED with exactly one order', async () => {
        const [a] = await shoppers(1);
        const { id } = await makeRequest(loc1, [cat1], -2 * DAY); // bidding closed long ago
        const expiresAt = new Date(Date.now() + 3000);
        const offer = await db.shoppingOffer.create({
          data: {
            requestId: id,
            shopperProfileId: a,
            shopperFee: 1000,
            etaMinutes: 20,
            expiresAt,
            financials: { customerTotal: 13000 },
          },
        });
        const stall = hold(
          (tx) => tx.$queryRaw`SELECT id FROM shopping_offers WHERE id = ${offer.id} FOR UPDATE`,
        );
        let attempt: ReturnType<typeof acceptOffer> | undefined;
        let sweep: Promise<number> | undefined;
        try {
          await stall.ready;
          // The accept starts while the offer is still valid, judges it valid, then stalls on the offer row.
          attempt = acceptOffer(id, offer.id);
          attempt.catch(() => undefined);
          await untilBlockedOn('shopping_offers');
          expect(Date.now()).toBeLessThan(expiresAt.getTime());
          // The offer window now ends while the accept is still in flight...
          await sleep(expiresAt.getTime() - Date.now() + 200);
          // ...so the sweep sees an OPEN request with nothing acceptable, and tries to expire it.
          sweep = expire(id);
          sweep.catch(() => undefined);
          await untilBlockedOn('shopping_requests'); // parked behind the accept's request lock
          expect(await statusOf(id)).toBe('OPEN'); // the accept has not committed yet

          stall.release();
          expect((await attempt).outcome).toBe('accepted');
          expect(await sweep).toBe(0); // it re-checked against the committed ASSIGNED row
          expect(await statusOf(id)).toBe('ASSIGNED'); // never overwritten with EXPIRED
          expect(await db.shopperOrder.count({ where: { requestId: id } })).toBe(1);
        } finally {
          stall.release();
          await stall.done.catch(() => undefined);
          await attempt?.catch(() => undefined);
          await sweep?.catch(() => undefined);
        }
      });
    });
  });

  describe('migration backfill: offers placed before the acceptance window existed', () => {
    const migration = readFileSync(
      join(__dirname, '../../../prisma/migrations/20261125100000_add_shopper_orders/migration.sql'),
      'utf8',
    );
    const backfill = migration.slice(
      migration.indexOf('-- BACKFILL START'),
      migration.indexOf('-- BACKFILL END'),
    );
    const run = (): Promise<number> => db.$executeRawUnsafe(backfill);
    let backfillShopper: string;

    /** A pre-change-style offer: expires_at = the request's bidding deadline. */
    const legacyOffer = async (
      request: { id: string; offerDeadline: Date },
      state: 'PENDING' | 'WITHDRAWN' | 'EXPIRED' = 'PENDING',
    ) =>
      db.shoppingOffer.create({
        data: {
          requestId: request.id,
          shopperProfileId: backfillShopper,
          state,
          shopperFee: 1000,
          etaMinutes: 20,
          expiresAt: request.offerDeadline,
          financials: { customerTotal: 13000 },
        },
      });
    const expiresOf = async (id: string): Promise<number> =>
      (await db.shoppingOffer.findUniqueOrThrow({ where: { id } })).expiresAt.getTime();

    beforeAll(async () => {
      backfillShopper = await makeShopper('backfill', loc1, cat1);
    });

    it('is present in the migration file', () => {
      expect(backfill).toContain('UPDATE "shopping_offers"');
    });

    it('moves live pre-change offers to deadline + window and leaves every other row alone; a second run changes nothing', async () => {
      const window = (await new ShoppingConfigRepository(prisma).get())!
        .offerAcceptanceWindowMinutes;
      const open = await makeRequest(loc1, [cat1], 30 * 60_000); // bidding still open
      const live = await legacyOffer(open);

      const closed = await makeRequest(loc1, [cat1], -30 * 60_000); // bidding closed
      const onClosed = await legacyOffer(closed);

      const openForOthers = await makeRequest(loc1, [cat1], 30 * 60_000);
      const withdrawn = await legacyOffer(openForOthers, 'WITHDRAWN');

      const alreadyNew = await makeRequest(loc1, [cat1], 30 * 60_000);
      const newStyle = await db.shoppingOffer.create({
        data: {
          requestId: alreadyNew.id,
          shopperProfileId: backfillShopper,
          shopperFee: 1000,
          etaMinutes: 20,
          expiresAt: new Date(alreadyNew.offerDeadline.getTime() + window * 60_000),
          financials: { customerTotal: 13000 },
        },
      });

      const assignedRequest = await makeRequest(loc1, [cat1], 30 * 60_000);
      await db.shoppingRequest.update({
        where: { id: assignedRequest.id },
        data: { status: 'ASSIGNED' },
      });
      const onAssigned = await legacyOffer(assignedRequest);

      const before = {
        onClosed: await expiresOf(onClosed.id),
        withdrawn: await expiresOf(withdrawn.id),
        newStyle: await expiresOf(newStyle.id),
        onAssigned: await expiresOf(onAssigned.id),
      };

      await run();

      expect(await expiresOf(live.id)).toBe(open.offerDeadline.getTime() + window * 60_000);
      expect(await expiresOf(onClosed.id)).toBe(before.onClosed);
      expect(await expiresOf(withdrawn.id)).toBe(before.withdrawn);
      expect(await expiresOf(newStyle.id)).toBe(before.newStyle);
      expect(await expiresOf(onAssigned.id)).toBe(before.onAssigned);

      // idempotent: the moved row no longer equals its deadline, so nothing matches again
      const moved = await expiresOf(live.id);
      expect(await run()).toBe(0);
      expect(await expiresOf(live.id)).toBe(moved);
    });
  });

  describe('admin shopping configuration', () => {
    const configRepo = new ShoppingConfigRepository(prisma);
    let adminId: string;
    let original: Awaited<ReturnType<typeof db.shoppingConfig.findUniqueOrThrow>>;

    beforeAll(async () => {
      adminId = await makeUser('config-admin');
      original = await db.shoppingConfig.findUniqueOrThrow({ where: { id: 1 } });
    });
    // The singleton is shared by every test in this suite: put it back exactly.
    afterEach(async () => {
      const { id: _id, ...values } = original;
      void _id;
      await db.shoppingConfig.update({ where: { id: 1 }, data: values });
    });

    const stored = () => db.shoppingConfig.findUniqueOrThrow({ where: { id: 1 } });
    const edit = (patch: Parameters<typeof configRepo.update>[0]) =>
      configRepo.update(patch, adminId, validateShoppingConfig);

    it('applies a partial edit, records who and when, and leaves the other fields alone', async () => {
      const result = await edit({ minShopperFee: 600, vatPercent: 8.25 });
      expect(result).toMatchObject({
        outcome: 'updated',
        before: { minShopperFee: 500, vatPercent: 7.5 },
        after: { minShopperFee: 600, vatPercent: 8.25 },
        record: { minShopperFee: 600, vatPercent: 8.25, updatedBy: { id: adminId } },
      });
      const row = await stored();
      expect(row).toMatchObject({
        minShopperFee: 600,
        maxShopperFee: original.maxShopperFee,
        updatedById: adminId,
      });
      expect(Number(row.vatPercent)).toBe(8.25);
      expect(Number(row.serviceChargePercent)).toBe(Number(original.serviceChargePercent));
    });

    it('validates a partial edit against the STORED other side, writing nothing when it fails', async () => {
      const tooHigh = await edit({ minShopperFee: original.maxShopperFee + 1 });
      const tooLow = await edit({ maxShopperFee: original.minShopperFee - 1 });
      expect(tooHigh).toMatchObject({ outcome: 'invalid', errors: [{ field: 'minShopperFee' }] });
      expect(tooLow).toMatchObject({ outcome: 'invalid' });
      expect(await stored()).toMatchObject({
        minShopperFee: original.minShopperFee,
        maxShopperFee: original.maxShopperFee,
        updatedById: original.updatedById,
      });
    });

    it('writes nothing when the values are already the stored ones', async () => {
      expect(await edit({ deliveryFee: original.deliveryFee })).toMatchObject({
        outcome: 'unchanged',
      });
      expect((await stored()).updatedAt.getTime()).toBe(original.updatedAt.getTime());
    });

    it('lets exactly one of two concurrent edits win when together they would break min <= max, 8 times over', async () => {
      for (let i = 0; i < 8; i++) {
        // stored: min 500, max 5000. Alone, min=4000 is fine and so is max=3000; together they are not.
        const [raisedMin, loweredMax] = await Promise.all([
          edit({ minShopperFee: 4000 }),
          edit({ maxShopperFee: 3000 }),
        ]);
        expect([raisedMin.outcome, loweredMax.outcome].sort()).toEqual(['invalid', 'updated']);
        const row = await stored();
        expect(row.minShopperFee).toBeLessThanOrEqual(row.maxShopperFee);
        // put it back for the next round
        const { id: _id, ...values } = original;
        void _id;
        await db.shoppingConfig.update({ where: { id: 1 }, data: values });
      }
    });

    it('maps a database CHECK violation to an error the service turns into 422, writing nothing', async () => {
      // `validate` deliberately lets everything through, so the database CHECK is the one that refuses
      await expect(
        configRepo.update({ minShopperFee: original.maxShopperFee + 1 }, adminId, () => []),
      ).rejects.toBeInstanceOf(ShoppingConfigConstraintError);
      await expect(
        configRepo.update({ offerWindowMinutes: 0 }, adminId, () => []),
      ).rejects.toBeInstanceOf(ShoppingConfigConstraintError);
      await expect(
        configRepo.update({ shopperAcceptWindowMinutes: 0 }, adminId, () => []),
      ).rejects.toBeInstanceOf(ShoppingConfigConstraintError);
      await expect(
        configRepo.update({ offerAcceptanceWindowMinutes: -5 }, adminId, () => []),
      ).rejects.toBeInstanceOf(ShoppingConfigConstraintError);
      await expect(configRepo.update({ vatPercent: -1 }, adminId, () => [])).rejects.toBeInstanceOf(
        ShoppingConfigConstraintError,
      );
      expect(await stored()).toMatchObject({
        minShopperFee: original.minShopperFee,
        offerWindowMinutes: original.offerWindowMinutes,
      });

      const service = new AdminShoppingConfigService(configRepo, { log: jest.fn() } as never);
      await expect(service.update(adminId, { minShopperFee: 1_000_000_000 })).rejects.toMatchObject(
        { status: 422 },
      );
    });

    it('is visible to the very next getRules() and the next estimate, offer-bound check and window', async () => {
      const rules = new ShoppingConfigService(configRepo);
      const audit = { log: jest.fn() };
      const requestsService = new ShoppingRequestsService(
        requests,
        offers,
        new ShoppingReferenceRepository(prisma),
        rules,
        audit as never,
      );
      const body = {
        locationId: loc1,
        deliveryAddress: { text: '1 Test Street' },
        items: [{ ...item(cat1), substitutionPreference: 'REFUND' }],
      } as never;

      const earlier = await requestsService.create(customerId, body);
      const service = new AdminShoppingConfigService(configRepo, audit as never);
      await service.update(adminId, {
        deliveryFee: 2750,
        offerWindowMinutes: 90,
        maxShopperFee: 800,
      });

      expect(await rules.getRules()).toMatchObject({
        deliveryFee: 2750,
        offerWindowMinutes: 90,
        maxShopperFee: 800,
      });
      const later = await requestsService.create(customerId, body);
      expect(later.estimate.deliveryFee).toBe(2750);
      expect(
        new Date(later.offerDeadline).getTime() - new Date(later.createdAt).getTime(),
      ).toBeGreaterThanOrEqual(89 * 60_000);

      // the request created before the edit keeps its snapshot
      expect((await requestsService.findOne(customerId, earlier.id)).estimate.deliveryFee).toBe(
        original.deliveryFee,
      );

      // and the fee bound applies to the next bid
      const shopperUser = (await db.shopperProfile.findUniqueOrThrow({ where: { id: shopperA } }))
        .userId;
      const bidding = new ShopperBiddingService(
        new ShopperProfileRepository(prisma),
        requests,
        offers,
        rules,
        { emit: jest.fn() } as never,
        audit as never,
      );
      await expect(
        bidding.preview(shopperUser, later.id, { shopperFee: 1000, etaMinutes: 20 }),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        bidding.preview(shopperUser, later.id, { shopperFee: 700, etaMinutes: 20 }),
      ).resolves.toBeDefined();
    });

    it('audits only the changed fields', async () => {
      const audit = { log: jest.fn() };
      const service = new AdminShoppingConfigService(configRepo, audit as never);
      await service.update(adminId, {
        deliveryFee: original.deliveryFee,
        vatPercent: 9,
        offerWindowMinutes: 45,
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: adminId,
          action: 'SHOPPING_CONFIG_UPDATED',
          details: {
            before: {
              vatPercent: Number(original.vatPercent),
              offerWindowMinutes: original.offerWindowMinutes,
            },
            after: { vatPercent: 9, offerWindowMinutes: 45 },
          },
        }),
      );
    });

    it('survives deleting the admin: the row keeps its values and updatedBy goes null', async () => {
      const temp = await makeUser('config-admin-temp');
      await configRepo.update(
        { deliveryFee: original.deliveryFee + 1 },
        temp,
        validateShoppingConfig,
      );
      await db.user.delete({ where: { id: temp } });
      expect((await configRepo.getRecord())?.updatedBy).toBeNull();
    });
  });
});
