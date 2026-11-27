/**
 * HTTP-level test for the shopping request / offer routes.
 *
 * Boots the real ShoppingRequestsModule (repositories stubbed) behind the
 * production ValidationPipe options, the real RolesGuard, the response
 * interceptor and the exception filter, so routing, role checks, DTO
 * validation quirks (strict types, whitelist) and status codes are exercised
 * as they are in production.
 */
import { Global, MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { RolesGuard } from '@common/guards/roles.guard';
import { GlobalExceptionFilter } from '@/common/filters';
import { ResponseInterceptor } from '@/common/interceptors';
import { AuditService } from '@common/services/audit.service';
import {
  DuplicateActiveOfferError,
  SHOPPER_PROFILE_REPOSITORY,
  SHOPPING_CONFIG_REPOSITORY,
  SHOPPING_OFFER_REPOSITORY,
  SHOPPING_REFERENCE_REPOSITORY,
  SHOPPING_REQUEST_REPOSITORY,
} from '@/database/repositories';
import { ShoppingRequestsModule } from './shopping-requests.module';
import { RULES, makeOfferRow, makeOfferWithShopper, makeRequestRow } from './testing/fixtures';

const ID = '3f2b8c1e-9d4a-4b7e-8a51-0c6d2e7f9a10';
const LOC = '11111111-1111-4111-8111-111111111111';
const CAT = '22222222-2222-4222-8222-222222222222';

const profiles = { ensureByUserId: jest.fn() };
const requests = {
  create: jest.fn(),
  findOwnedById: jest.fn(),
  listForCustomer: jest.fn(),
  cancel: jest.fn(),
  findMatchingForShopper: jest.fn(),
  findCoveredByShopper: jest.fn(),
  findReadableByShopper: jest.fn(),
};
const offers = {
  submit: jest.fn(),
  withdraw: jest.fn(),
  expireDue: jest.fn(),
  findOwnedById: jest.fn(),
  listForShopper: jest.fn(),
  listForRequest: jest.fn(),
  findPendingRequestIds: jest.fn(),
  findPendingByShopperAndRequest: jest.fn(),
};
const reference = {
  findActiveLocationIds: jest.fn(),
  findActiveCategoryIds: jest.fn(),
};
const configRepo = { get: jest.fn() };
const audit = { log: jest.fn() };

@Global()
@Module({
  providers: [
    { provide: SHOPPER_PROFILE_REPOSITORY, useValue: profiles },
    { provide: SHOPPING_REQUEST_REPOSITORY, useValue: requests },
    { provide: SHOPPING_OFFER_REPOSITORY, useValue: offers },
    { provide: SHOPPING_REFERENCE_REPOSITORY, useValue: reference },
    { provide: SHOPPING_CONFIG_REPOSITORY, useValue: configRepo },
    { provide: AuditService, useValue: audit },
  ],
  exports: [
    SHOPPER_PROFILE_REPOSITORY,
    SHOPPING_REQUEST_REPOSITORY,
    SHOPPING_OFFER_REPOSITORY,
    SHOPPING_REFERENCE_REPOSITORY,
    SHOPPING_CONFIG_REPOSITORY,
    AuditService,
  ],
})
class StubsModule {}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    EventEmitterModule.forRoot(),
    StubsModule,
    ShoppingRequestsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }],
})
class TestAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: Request, _res: ExpressResponse, next: NextFunction) => {
        const role = req.header('x-test-role');
        if (role) {
          (req as Request & { user: unknown }).user = {
            id: 'user-1',
            email: 'u@example.com',
            role,
          };
        }
        next();
      })
      .forRoutes('(.*)');
  }
}

const validItem = {
  name: 'Full Cream Milk Powder',
  brand: 'Peak',
  size: '400g',
  quantity: 2,
  unit: 'tin',
  estimatedUnitPrice: 4500,
  substitutionPreference: 'REFUND',
  maxSubstitutePrice: null,
  categoryId: CAT,
};
const validBody = {
  locationId: LOC,
  deliveryAddress: { text: '12 Admiralty Way', latitude: 6.45, longitude: 3.47 },
  items: [validItem],
  note: 'optional',
};

describe('shopping requests and offers (HTTP)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(TestAppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    configRepo.get.mockResolvedValue(RULES);
    reference.findActiveLocationIds.mockImplementation(async (ids: string[]) => ids);
    reference.findActiveCategoryIds.mockImplementation(async (ids: string[]) => ids);
    requests.create.mockImplementation(async () => makeRequestRow());
    offers.expireDue.mockResolvedValue(0);
    offers.listForRequest.mockResolvedValue([]);
    profiles.ensureByUserId.mockResolvedValue({
      id: 'prof-1',
      accountState: 'APPROVED',
      isOnline: true,
      displayName: 'Amaka O.',
    });
  });

  const call = async (
    method: string,
    path: string,
    role: string | null,
    body?: unknown,
  ): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(role ? { 'x-test-role': role } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  // ------------------------------------------------------------------ customer
  describe('customer: /shopping-requests', () => {
    it.each([
      ['POST', '/shopping-requests', validBody],
      ['GET', '/shopping-requests', undefined],
      ['GET', `/shopping-requests/${ID}`, undefined],
      ['DELETE', `/shopping-requests/${ID}`, undefined],
    ])('%s %s is CUSTOMER-only (403 for a shopper)', async (method, path, body) => {
      expect((await call(method, path, 'PERSONAL_SHOPPER', body)).status).toBe(403);
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('POST creates the request with 201 and the success envelope, computing the estimate', async () => {
      const { status, json } = await call('POST', '/shopping-requests', 'CUSTOMER', validBody);

      expect(status).toBe(201);
      expect(json).toMatchObject({
        success: true,
        message: 'Shopping request created successfully',
        data: { id: 'req-1', reference: 'SR-ABC23456', status: 'OPEN' },
      });
      const input = requests.create.mock.calls[0][0];
      expect(input).toMatchObject({
        customerId: 'user-1',
        estimatedGoodsBudget: 9000,
        estimate: { estimatedTotal: 11096, shopperFeePending: true },
      });
      expect(input.items[0].maxSubstitutePrice).toBeUndefined(); // null for REFUND is accepted and dropped
    });

    it.each([
      ['[[]]', [[]]],
      ['[null]', [null]],
      ["['x']", ['x']],
      ['[1]', [1]],
    ])('POST rejects items %s with 400 and creates nothing', async (_label, items) => {
      expect(
        (await call('POST', '/shopping-requests', 'CUSTOMER', { ...validBody, items })).status,
      ).toBe(400);
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('POST trims string fields before storing them', async () => {
      const item = {
        ...validItem,
        name: '  Milk  ',
        brand: ' Peak ',
        size: ' 400g ',
        unit: ' tin ',
      };
      const body = {
        ...validBody,
        items: [item],
        deliveryAddress: { text: '  12 Admiralty Way  ' },
      };
      expect((await call('POST', '/shopping-requests', 'CUSTOMER', body)).status).toBe(201);
      const input = requests.create.mock.calls[0][0];
      expect(input.deliveryAddress).toBe('12 Admiralty Way');
      expect(input.items[0]).toMatchObject({
        name: 'Milk',
        brand: 'Peak',
        size: '400g',
        unit: 'tin',
      });
    });

    it('POST accepts SIMILAR_UP_TO with a max equal to the unit price and coordinates given together', async () => {
      const item = {
        ...validItem,
        substitutionPreference: 'SIMILAR_UP_TO',
        maxSubstitutePrice: 4500,
      };
      const body = { ...validBody, items: [item], deliveryAddress: { text: 'x' } };
      expect((await call('POST', '/shopping-requests', 'CUSTOMER', body)).status).toBe(201);
    });

    it('POST returns 422 for an amount that would overflow', async () => {
      const item = { ...validItem, quantity: 100, estimatedUnitPrice: 100_000_000 };
      const res = await call('POST', '/shopping-requests', 'CUSTOMER', {
        ...validBody,
        items: [item],
      });
      expect(res.status).toBe(422);
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('POST accepts SIMILAR_UP_TO with a max', async () => {
      const item = {
        ...validItem,
        substitutionPreference: 'SIMILAR_UP_TO',
        maxSubstitutePrice: 5000,
      };
      const { status } = await call('POST', '/shopping-requests', 'CUSTOMER', {
        ...validBody,
        items: [item],
      });
      expect(status).toBe(201);
    });

    it.each([
      ['a missing brand', { ...validItem, brand: undefined }],
      ['a missing size', { ...validItem, size: undefined }],
      ['a quantity sent as a string', { ...validItem, quantity: '2' }],
      ['a fractional price', { ...validItem, estimatedUnitPrice: 4500.5 }],
      ['a price sent as a string', { ...validItem, estimatedUnitPrice: '4500' }],
      ['a zero quantity', { ...validItem, quantity: 0 }],
      ['a numeric name', { ...validItem, name: 123 }],
      [
        'SIMILAR_UP_TO without maxSubstitutePrice',
        { ...validItem, substitutionPreference: 'SIMILAR_UP_TO' },
      ],
      ['REFUND with a maxSubstitutePrice', { ...validItem, maxSubstitutePrice: 100 }],
      ['an unknown substitution preference', { ...validItem, substitutionPreference: 'ANYTHING' }],
      ['an unknown field on the item', { ...validItem, totalPrice: 9000 }],
      ['a whitespace-only name', { ...validItem, name: '   ' }],
      ['a whitespace-only brand', { ...validItem, brand: '\t' }],
      ['a whitespace-only size', { ...validItem, size: ' ' }],
      ['a whitespace-only unit', { ...validItem, unit: '  ' }],
      [
        'SIMILAR_UP_TO with a max below the unit price',
        { ...validItem, substitutionPreference: 'SIMILAR_UP_TO', maxSubstitutePrice: 4499 },
      ],
    ])('POST rejects %s with 400', async (_label, item) => {
      const { status } = await call('POST', '/shopping-requests', 'CUSTOMER', {
        ...validBody,
        items: [item],
      });
      expect(status).toBe(400);
      expect(requests.create).not.toHaveBeenCalled();
    });

    it.each([
      ['no items', { ...validBody, items: [] }],
      [
        'a deliveryAddress that is not an object',
        { ...validBody, deliveryAddress: '12 Admiralty Way' },
      ],
      ['a non-uuid locationId', { ...validBody, locationId: 'lekki' }],
      ['whitespace-only address text', { ...validBody, deliveryAddress: { text: '   ' } }],
      [
        'latitude without longitude',
        { ...validBody, deliveryAddress: { text: 'x', latitude: 6.4 } },
      ],
      [
        'longitude without latitude',
        { ...validBody, deliveryAddress: { text: 'x', longitude: 3.4 } },
      ],
      ['a client-supplied estimate', { ...validBody, estimate: { estimatedTotal: 1 } }],
      ['a client-supplied offerDeadline', { ...validBody, offerDeadline: '2030-01-01T00:00:00Z' }],
    ])('POST rejects %s with 400', async (_label, body) => {
      expect((await call('POST', '/shopping-requests', 'CUSTOMER', body)).status).toBe(400);
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('GET lists the caller own requests with pagination meta (query strings coerced)', async () => {
      requests.listForCustomer.mockResolvedValue({
        rows: [{ ...makeRequestRow(), _count: { offers: 2 } }],
        total: 12,
      });
      const { status, json } = await call(
        'GET',
        '/shopping-requests?page=2&limit=5&status=OPEN',
        'CUSTOMER',
      );

      expect(status).toBe(200);
      expect(requests.listForCustomer).toHaveBeenCalledWith('user-1', 5, 5, 'OPEN');
      expect(json.data[0]).toMatchObject({ id: 'req-1', offerCount: 2 });
      expect(json.meta).toMatchObject({ page: 2, limit: 5, total: 12, totalPages: 3 });
    });

    it('GET rejects a bad status and an out-of-range limit', async () => {
      expect((await call('GET', '/shopping-requests?status=NOPE', 'CUSTOMER')).status).toBe(400);
      expect((await call('GET', '/shopping-requests?limit=500', 'CUSTOMER')).status).toBe(400);
    });

    it('GET :id returns items and offers with breakdown and shopper stats', async () => {
      requests.findOwnedById.mockResolvedValue(makeRequestRow());
      offers.listForRequest.mockResolvedValue([makeOfferWithShopper()]);
      const { status, json } = await call('GET', `/shopping-requests/${ID}`, 'CUSTOMER');

      expect(status).toBe(200);
      expect(requests.findOwnedById).toHaveBeenCalledWith(ID, 'user-1');
      expect(json.data.items).toHaveLength(1);
      expect(json.data.offers[0]).toMatchObject({
        financials: { customerTotal: 12171 },
        shopper: {
          displayName: 'Amaka O.',
          rating: 4.85,
          completedOrders: 61,
          completionRate: 97.5,
        },
      });
    });

    it('GET :id is 400 for a malformed id and 404 for someone else request', async () => {
      expect((await call('GET', '/shopping-requests/not-a-uuid', 'CUSTOMER')).status).toBe(400);
      requests.findOwnedById.mockResolvedValue(null);
      expect((await call('GET', `/shopping-requests/${ID}`, 'CUSTOMER')).status).toBe(404);
    });

    it('DELETE cancels (200) and 409s once it is not open', async () => {
      requests.cancel.mockResolvedValueOnce({
        outcome: 'cancelled',
        request: makeRequestRow({ status: 'CANCELLED' }),
      });
      const ok = await call('DELETE', `/shopping-requests/${ID}`, 'CUSTOMER');
      expect(ok.status).toBe(200);
      expect(ok.json.data.status).toBe('CANCELLED');

      requests.cancel.mockResolvedValueOnce({ outcome: 'not_open', status: 'CANCELLED' });
      expect((await call('DELETE', `/shopping-requests/${ID}`, 'CUSTOMER')).status).toBe(409);
    });
  });

  // ------------------------------------------------------------------- shopper
  describe('shopper: /shopper/requests and /shopper/offers', () => {
    const bid = { shopperFee: 1000, etaMinutes: 30, note: 'on my way' };
    const offerPath = `/shopper/requests/${ID}/offers`;

    it.each([
      ['GET', '/shopper/requests'],
      ['GET', `/shopper/requests/${ID}`],
      ['POST', `/shopper/requests/${ID}/offers/preview`],
      ['POST', `/shopper/requests/${ID}/offers`],
      ['GET', '/shopper/offers'],
      ['GET', `/shopper/offers/${ID}`],
      ['DELETE', `/shopper/offers/${ID}`],
    ])('%s %s is PERSONAL_SHOPPER-only (403 for a customer)', async (method, path) => {
      expect(
        (await call(method, path, 'CUSTOMER', method === 'POST' ? bid : undefined)).status,
      ).toBe(403);
    });

    it('is 403 for a shopper who is not APPROVED', async () => {
      profiles.ensureByUserId.mockResolvedValue({
        id: 'prof-1',
        accountState: 'VERIFICATION_PENDING',
        isOnline: false,
      });
      expect((await call('GET', '/shopper/requests', 'PERSONAL_SHOPPER')).status).toBe(403);
      expect((await call('POST', offerPath, 'PERSONAL_SHOPPER', bid)).status).toBe(403);
      expect(offers.submit).not.toHaveBeenCalled();
    });

    it('GET /shopper/requests returns the matching page and passes the filters through', async () => {
      requests.findMatchingForShopper.mockResolvedValue({ rows: [makeRequestRow()], total: 1 });
      offers.findPendingRequestIds.mockResolvedValue(new Set(['req-1']));

      const { status, json } = await call(
        'GET',
        `/shopper/requests?locationId=${LOC}&categoryId=${CAT}&limit=5&sortBy=offerDeadline&sortOrder=ASC`,
        'PERSONAL_SHOPPER',
      );

      expect(status).toBe(200);
      expect(requests.findMatchingForShopper).toHaveBeenCalledWith(
        expect.objectContaining({
          shopperProfileId: 'prof-1',
          locationId: LOC,
          categoryId: CAT,
          sortBy: 'offerDeadline',
          sortOrder: 'asc',
          skip: 0,
          take: 5,
        }),
      );
      expect(json.data[0]).toMatchObject({
        id: 'req-1',
        itemCount: 1,
        estimatedGoodsBudget: 9000,
        earningsEstimate: 2750,
        hasSubmittedOffer: true,
      });
      expect(JSON.stringify(json)).not.toContain('Admiralty');
      expect(json.meta.total).toBe(1);
    });

    it('GET /shopper/requests rejects bad filters', async () => {
      expect((await call('GET', '/shopper/requests?locationId=x', 'PERSONAL_SHOPPER')).status).toBe(
        400,
      );
      expect(
        (await call('GET', '/shopper/requests?sortBy=customerId', 'PERSONAL_SHOPPER')).status,
      ).toBe(400);
    });

    it('GET /shopper/requests/:id returns items; 404 when not visible to the shopper', async () => {
      requests.findReadableByShopper.mockResolvedValueOnce(makeRequestRow());
      offers.findPendingByShopperAndRequest.mockResolvedValue(null);
      const ok = await call('GET', `/shopper/requests/${ID}`, 'PERSONAL_SHOPPER');
      expect(ok.status).toBe(200);
      expect(ok.json.data.items[0]).toMatchObject({ name: 'Milk', brand: 'Peak' });
      expect(ok.json.data.hasSubmittedOffer).toBe(false);

      requests.findReadableByShopper.mockResolvedValueOnce(null);
      expect((await call('GET', `/shopper/requests/${ID}`, 'PERSONAL_SHOPPER')).status).toBe(404);
    });

    describe('POST .../offers/preview', () => {
      it('is 200 (not 201), side-effect free, and returns the full breakdown', async () => {
        requests.findCoveredByShopper.mockResolvedValue(makeRequestRow());
        const { status, json } = await call(
          'POST',
          `${offerPath}/preview`,
          'PERSONAL_SHOPPER',
          bid,
        );

        expect(status).toBe(200);
        expect(json.data).toMatchObject({
          requestId: ID,
          state: 'PENDING',
          financials: { customerTotal: 12171, shopperGrossEarnings: 1000 },
        });
        expect(json.data.id).toBeUndefined();
        expect(offers.submit).not.toHaveBeenCalled();
        expect(audit.log).not.toHaveBeenCalled();
      });
    });

    describe('POST .../offers', () => {
      beforeEach(() => {
        requests.findCoveredByShopper.mockResolvedValue(makeRequestRow());
        offers.submit.mockResolvedValue(makeOfferRow());
      });

      it('creates the offer with 201 and notifies the customer through the event bus', async () => {
        const emit = jest.spyOn(app.get(EventEmitter2), 'emit');
        const { status, json } = await call('POST', offerPath, 'PERSONAL_SHOPPER', bid);

        expect(status).toBe(201);
        expect(json).toMatchObject({
          message: 'Offer submitted successfully',
          data: { id: 'offer-1', shopperId: 'prof-1', state: 'PENDING', shopperFee: 1000 },
        });
        expect(emit).toHaveBeenCalledWith(
          'shopping.offer.submitted',
          expect.objectContaining({ customerId: 'cust-1' }),
        );
      });

      it.each([
        ['item prices', { ...bid, items: [{ requestItemId: ID, proposedPrice: 100 }] }],
        ['a delivery fee', { ...bid, deliveryFee: 0 }],
        ['services', { ...bid, services: [] }],
        ['a shopperFee sent as a string', { ...bid, shopperFee: '1000' }],
        ['a fractional shopperFee', { ...bid, shopperFee: 1000.5 }],
        ['a negative shopperFee', { ...bid, shopperFee: -1 }],
        ['no etaMinutes', { shopperFee: 1000 }],
        ['a zero etaMinutes', { ...bid, etaMinutes: 0 }],
        ['a numeric note', { ...bid, note: 5 }],
      ])(
        'rejects %s with 400 (the body is { shopperFee, etaMinutes, note? } only)',
        async (_label, body) => {
          expect((await call('POST', offerPath, 'PERSONAL_SHOPPER', body)).status).toBe(400);
          expect(
            (await call('POST', `${offerPath}/preview`, 'PERSONAL_SHOPPER', body)).status,
          ).toBe(400);
          expect(offers.submit).not.toHaveBeenCalled();
        },
      );

      it('is 422 with the bounds for a fee outside the configured range', async () => {
        const { status, json } = await call('POST', offerPath, 'PERSONAL_SHOPPER', {
          ...bid,
          shopperFee: 9999,
        });
        expect(status).toBe(422);
        expect(JSON.stringify(json)).toContain('between 500 and 5000');
      });

      it('is 409 after the deadline and when the request is not OPEN', async () => {
        requests.findCoveredByShopper.mockResolvedValueOnce(
          makeRequestRow({ offerDeadline: new Date(Date.now() - 1000) }),
        );
        expect((await call('POST', offerPath, 'PERSONAL_SHOPPER', bid)).status).toBe(409);
        requests.findCoveredByShopper.mockResolvedValueOnce(
          makeRequestRow({ status: 'CANCELLED' }),
        );
        expect((await call('POST', offerPath, 'PERSONAL_SHOPPER', bid)).status).toBe(409);
      });

      it('is 409 for a second active offer', async () => {
        offers.submit.mockRejectedValue(new DuplicateActiveOfferError());
        const { status, json } = await call('POST', offerPath, 'PERSONAL_SHOPPER', bid);
        expect(status).toBe(409);
        expect(json.message).toContain('withdraw');
      });

      it('is 404 for a request the shopper does not cover', async () => {
        requests.findCoveredByShopper.mockResolvedValue(null);
        expect((await call('POST', offerPath, 'PERSONAL_SHOPPER', bid)).status).toBe(404);
      });
    });

    it('GET /shopper/offers filters by state and pages', async () => {
      offers.listForShopper.mockResolvedValue({ rows: [makeOfferRow()], total: 1 });
      offers.findPendingRequestIds.mockResolvedValue(new Set(['req-1']));
      const { status, json } = await call(
        'GET',
        '/shopper/offers?state=PENDING&page=1&limit=10',
        'PERSONAL_SHOPPER',
      );

      expect(status).toBe(200);
      expect(offers.listForShopper).toHaveBeenCalledWith('prof-1', 0, 10, 'PENDING');
      expect(json.data[0]).toMatchObject({ id: 'offer-1', request: { id: 'req-1' } });
      expect((await call('GET', '/shopper/offers?state=BOGUS', 'PERSONAL_SHOPPER')).status).toBe(
        400,
      );
    });

    it('GET /shopper/offers/:id is scoped to the shopper', async () => {
      offers.findOwnedById.mockResolvedValueOnce(makeOfferRow());
      expect((await call('GET', `/shopper/offers/${ID}`, 'PERSONAL_SHOPPER')).status).toBe(200);
      expect(offers.findOwnedById).toHaveBeenCalledWith(ID, 'prof-1');
      offers.findOwnedById.mockResolvedValueOnce(null);
      expect((await call('GET', `/shopper/offers/${ID}`, 'PERSONAL_SHOPPER')).status).toBe(404);
    });

    it('DELETE /shopper/offers/:id withdraws a pending offer; 409 when it is not pending', async () => {
      offers.withdraw.mockResolvedValueOnce(true);
      offers.findOwnedById.mockResolvedValueOnce(makeOfferRow({ state: 'WITHDRAWN' }));
      const ok = await call('DELETE', `/shopper/offers/${ID}`, 'PERSONAL_SHOPPER');
      expect(ok.status).toBe(200);
      expect(ok.json.data.state).toBe('WITHDRAWN');

      offers.withdraw.mockResolvedValueOnce(false);
      offers.findOwnedById.mockResolvedValueOnce(makeOfferRow({ state: 'ACCEPTED' }));
      expect((await call('DELETE', `/shopper/offers/${ID}`, 'PERSONAL_SHOPPER')).status).toBe(409);
    });
  });
});
