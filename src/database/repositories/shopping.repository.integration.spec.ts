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
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ShoppingConfigRepository } from './shopping-config.repository';
import { ShoppingOfferRepository } from './shopping-offer.repository';
import { ShoppingRequestRepository } from './shopping-request.repository';
import { ShopperProfileRepository } from './shopper-profile.repository';
import { ShoppingReferenceRepository } from './shopping-reference.repository';
import { ShoppingConfigService } from '../../modules/shopping-requests/shopping-config.service';
import { ShoppingRequestsService } from '../../modules/shopping-requests/shopping-requests.service';
import { ShopperBiddingService } from '../../modules/shopping-requests/shopper-bidding.service';
import { DuplicateActiveOfferError, OfferRequestClosedError } from './interfaces';

const url = process.env.SHOPPING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('shopping repositories (real Postgres)', () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const prisma = db as unknown as PrismaService;
  const requests = new ShoppingRequestRepository(prisma);
  const offers = new ShoppingOfferRepository(prisma);
  const run = randomUUID().slice(0, 8);

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
      expect(first.expiresAt.getTime()).toBe(first.request.offerDeadline.getTime());

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
});
