/**
 * HTTP-level test for accepting an offer and the order routes.
 *
 * Boots the real ShoppingRequestsModule (repositories stubbed) behind the
 * production ValidationPipe options, the real RolesGuard, the response
 * interceptor and the exception filter.
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
  SHOPPER_ORDER_REPOSITORY,
  SHOPPER_PROFILE_REPOSITORY,
  SHOPPING_CONFIG_REPOSITORY,
  SHOPPING_OFFER_REPOSITORY,
  SHOPPING_REFERENCE_REPOSITORY,
  SHOPPING_REQUEST_REPOSITORY,
} from '@/database/repositories';
import { ShoppingRequestsModule } from './shopping-requests.module';
import {
  BREAKDOWN,
  RULES,
  makeCustomerOrder,
  makeOrderEvent,
  makeShopperOrder,
} from './testing/fixtures';

const REQ = '3f2b8c1e-9d4a-4b7e-8a51-0c6d2e7f9a10';
const OFFER = '4a3c9d2f-0e5b-4c8f-9b62-1d7e3f8a0b21';
const ORDER = '5b4d0e30-1f6c-4d90-8c73-2e8f409b1c32';

const profiles = { ensureByUserId: jest.fn() };
const orders = {
  acceptOffer: jest.fn(),
  listForCustomer: jest.fn(),
  findOwnedByCustomer: jest.fn(),
  listForShopper: jest.fn(),
  findOwnedByShopper: jest.fn(),
  listEvents: jest.fn(),
  transition: jest.fn(),
  expireStale: jest.fn(),
  cancelOrder: jest.fn(),
};
const requests = { cancel: jest.fn() };
const config = { get: jest.fn() };
const audit = { log: jest.fn() };

@Global()
@Module({
  providers: [
    { provide: SHOPPER_PROFILE_REPOSITORY, useValue: profiles },
    { provide: SHOPPER_ORDER_REPOSITORY, useValue: orders },
    { provide: SHOPPING_REQUEST_REPOSITORY, useValue: requests },
    { provide: SHOPPING_OFFER_REPOSITORY, useValue: {} },
    { provide: SHOPPING_REFERENCE_REPOSITORY, useValue: {} },
    { provide: SHOPPING_CONFIG_REPOSITORY, useValue: config },
    { provide: AuditService, useValue: audit },
  ],
  exports: [
    SHOPPER_PROFILE_REPOSITORY,
    SHOPPER_ORDER_REPOSITORY,
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

describe('orders (HTTP)', () => {
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
    profiles.ensureByUserId.mockResolvedValue({ id: 'prof-1', accountState: 'APPROVED' });
    orders.listEvents.mockResolvedValue([makeOrderEvent()]);
    orders.expireStale.mockResolvedValue([]);
    config.get.mockResolvedValue(RULES);
  });

  const call = async (
    method: string,
    path: string,
    role: string | null,
    body?: unknown,
  ): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  describe('customer: accept an offer', () => {
    const path = `/shopping-requests/${REQ}/offers/${OFFER}/accept`;
    const accepted = {
      outcome: 'accepted',
      order: makeCustomerOrder(),
      winnerUserId: 'winner-user',
      requestReference: 'SR-ABC23456',
      rejected: [{ offerId: 'o2', userId: 'loser-user' }],
    };

    it('is CUSTOMER-only (403 for a shopper)', async () => {
      expect((await call('POST', path, 'PERSONAL_SHOPPER')).status).toBe(403);
      expect(orders.acceptOffer).not.toHaveBeenCalled();
    });

    it('creates the order with 201, the envelope, and the offer breakdown unchanged', async () => {
      orders.acceptOffer.mockResolvedValue(accepted);
      const emit = jest.spyOn(app.get(EventEmitter2), 'emit');

      const { status, json } = await call('POST', path, 'CUSTOMER');

      expect(status).toBe(201);
      expect(json).toMatchObject({
        success: true,
        message: 'Offer accepted; the order has been created',
        data: { id: 'order-1', reference: 'SO-ABC23456', state: 'ASSIGNED', financials: BREAKDOWN },
      });
      expect(orders.acceptOffer).toHaveBeenCalledWith({
        requestId: REQ,
        offerId: OFFER,
        customerId: 'user-1',
      });
      expect(emit).toHaveBeenCalledWith(
        'shopping.offer.accepted',
        expect.objectContaining({ winnerUserId: 'winner-user', rejectedUserIds: ['loser-user'] }),
      );
    });

    it('returns 200 with the same order when the same accepted offer is accepted again', async () => {
      orders.acceptOffer.mockResolvedValue({
        outcome: 'already_accepted',
        order: makeCustomerOrder(),
      });
      const emit = jest.spyOn(app.get(EventEmitter2), 'emit');
      emit.mockClear();
      const { status, json } = await call('POST', path, 'CUSTOMER');
      expect(status).toBe(200);
      expect(json.data).toMatchObject({ id: 'order-1', financials: BREAKDOWN });
      expect(emit).not.toHaveBeenCalledWith('shopping.offer.accepted', expect.anything());
    });

    it('409s when the shopper is no longer available', async () => {
      orders.acceptOffer.mockResolvedValue({ outcome: 'shopper_unavailable' });
      const { status, json } = await call('POST', path, 'CUSTOMER');
      expect(status).toBe(409);
      expect(json.message).toBe('This shopper is no longer available; choose another offer');
    });

    it('does not let the client send order money: any body field is rejected or ignored, never used', async () => {
      orders.acceptOffer.mockResolvedValue(accepted);
      const { status, json } = await call('POST', path, 'CUSTOMER', {
        customerTotal: 1,
        financials: { customerTotal: 1 },
      });
      // The route has no body DTO, so the body is ignored and the order total is the offer's.
      expect(status).toBe(201);
      expect(json.data.financials.customerTotal).toBe(BREAKDOWN.customerTotal);
      expect(orders.acceptOffer.mock.calls[0][0]).toEqual({
        requestId: REQ,
        offerId: OFFER,
        customerId: 'user-1',
      });
    });

    it.each([
      [{ outcome: 'request_not_open', status: 'ASSIGNED' }],
      [{ outcome: 'offer_not_pending', state: 'WITHDRAWN' }],
      [{ outcome: 'offer_expired' }],
    ])('409s on a state conflict: %j', async (result) => {
      orders.acceptOffer.mockResolvedValue(result);
      expect((await call('POST', path, 'CUSTOMER')).status).toBe(409);
    });

    it('404s for a request that is not the caller own, 400 for malformed ids', async () => {
      orders.acceptOffer.mockResolvedValue({ outcome: 'not_found' });
      expect((await call('POST', path, 'CUSTOMER')).status).toBe(404);
      expect(
        (await call('POST', `/shopping-requests/x/offers/${OFFER}/accept`, 'CUSTOMER')).status,
      ).toBe(400);
      expect(
        (await call('POST', `/shopping-requests/${REQ}/offers/y/accept`, 'CUSTOMER')).status,
      ).toBe(400);
    });
  });

  describe('customer: cancelling a request that already has an order', () => {
    it('409s with a clear message when the request is ASSIGNED', async () => {
      requests.cancel.mockResolvedValue({ outcome: 'not_open', status: 'ASSIGNED' });
      const { status, json } = await call('DELETE', `/shopping-requests/${REQ}`, 'CUSTOMER');
      expect(status).toBe(409);
      expect(json.message).toBe('Only an open request can be cancelled; this one is assigned');
    });
  });

  describe('customer: POST /shopping-orders/:id/cancel', () => {
    const path = `/shopping-orders/${ORDER}/cancel`;
    const cancelled = {
      outcome: 'cancelled',
      order: makeCustomerOrder({
        state: 'CANCELLED',
        cancelledBy: 'CUSTOMER',
        cancelReason: 'changed my mind',
      }),
      shopperUserId: 'shopper-user',
      requestReference: 'SR-ABC23456',
      cancelledBy: 'CUSTOMER',
    };

    it('is CUSTOMER-only (403 for a shopper)', async () => {
      expect((await call('POST', path, 'PERSONAL_SHOPPER', {})).status).toBe(403);
      expect(orders.cancelOrder).not.toHaveBeenCalled();
    });

    it('cancels with 200, passes the trimmed reason, reopens with a deadline from the config, and tells the shopper', async () => {
      orders.cancelOrder.mockResolvedValue(cancelled);
      const emit = jest.spyOn(app.get(EventEmitter2), 'emit');
      emit.mockClear();

      const { status, json } = await call('POST', path, 'CUSTOMER', {
        reason: '  changed my mind  ',
      });

      expect(status).toBe(200);
      expect(json).toMatchObject({
        message: 'Order cancelled',
        data: { state: 'CANCELLED', cancelledBy: 'CUSTOMER', cancelReason: 'changed my mind' },
      });
      const input = orders.cancelOrder.mock.calls[0][0];
      expect(input).toMatchObject({
        orderId: ORDER,
        reason: 'changed my mind',
        actor: { kind: 'CUSTOMER', userId: 'user-1' },
      });
      expect(input.reopenDeadline.getTime()).toBeGreaterThan(
        Date.now() + (RULES.offerWindowMinutes - 1) * 60_000,
      );
      expect(emit).toHaveBeenCalledWith(
        'shopping.order.cancelled',
        expect.objectContaining({ shopperUserId: 'shopper-user' }),
      );
    });

    it('accepts an empty body', async () => {
      orders.cancelOrder.mockResolvedValue(cancelled);
      expect((await call('POST', path, 'CUSTOMER')).status).toBe(200);
    });

    it.each([
      ['a reason over 500 characters', { reason: 'x'.repeat(501) }],
      ['a numeric reason', { reason: 5 }],
      ['an unknown field', { reason: 'ok', state: 'COMPLETED' }],
    ])('rejects %s with 400', async (_label, body) => {
      expect((await call('POST', path, 'CUSTOMER', body)).status).toBe(400);
      expect(orders.cancelOrder).not.toHaveBeenCalled();
    });

    it('returns the order with 200 on a repeat, and announces nothing', async () => {
      orders.cancelOrder.mockResolvedValue({
        outcome: 'already_cancelled',
        order: makeCustomerOrder({ state: 'CANCELLED' }),
      });
      const emit = jest.spyOn(app.get(EventEmitter2), 'emit');
      emit.mockClear();
      const { status, json } = await call('POST', path, 'CUSTOMER', {});
      expect(status).toBe(200);
      expect(json.data.state).toBe('CANCELLED');
      expect(emit).not.toHaveBeenCalledWith('shopping.order.cancelled', expect.anything());
    });

    it('409s once the shopper has accepted, 404s for someone else order, 400 for a bad id', async () => {
      orders.cancelOrder.mockResolvedValueOnce({ outcome: 'conflict', state: 'SHOPPER_ACCEPTED' });
      const conflict = await call('POST', path, 'CUSTOMER', {});
      expect(conflict.status).toBe(409);
      expect(conflict.json.message).toBe('The shopper has already accepted this order');
      orders.cancelOrder.mockResolvedValueOnce({ outcome: 'not_found' });
      expect((await call('POST', path, 'CUSTOMER', {})).status).toBe(404);
      expect((await call('POST', '/shopping-orders/x/cancel', 'CUSTOMER', {})).status).toBe(400);
    });
  });

  describe('the accept timeout over HTTP', () => {
    it('cancels a stale order before a shopper accept, which then gets the timeout message', async () => {
      orders.expireStale.mockResolvedValue([
        {
          order: makeCustomerOrder({ state: 'CANCELLED' }),
          shopperUserId: 'shopper-user',
          requestReference: 'SR-ABC23456',
          cancelledBy: 'SYSTEM',
        },
      ]);
      orders.transition.mockResolvedValue({
        outcome: 'conflict',
        state: 'CANCELLED',
        cancelledBy: 'SYSTEM',
      });
      const emit = jest.spyOn(app.get(EventEmitter2), 'emit');
      emit.mockClear();

      const { status, json } = await call(
        'POST',
        `/shopper/orders/${ORDER}/accept`,
        'PERSONAL_SHOPPER',
      );

      expect(status).toBe(409);
      expect(json.message).toBe('This order was cancelled because it was not accepted in time');
      expect(emit).toHaveBeenCalledWith(
        'shopping.order.cancelled',
        expect.objectContaining({ cancelledBy: 'SYSTEM' }),
      );
      const [scope, assignedBefore, reopenDeadline] = orders.expireStale.mock.calls[0];
      expect(scope).toEqual({ orderId: ORDER });
      expect(assignedBefore.getTime()).toBeLessThan(
        Date.now() - (RULES.shopperAcceptWindowMinutes - 1) * 60_000,
      );
      expect(reopenDeadline.getTime()).toBeGreaterThan(Date.now());
    });

    it('sweeps on the customer and shopper order lists too', async () => {
      orders.listForCustomer.mockResolvedValue({ rows: [], total: 0 });
      orders.listForShopper.mockResolvedValue({ rows: [], total: 0 });
      await call('GET', '/shopping-orders', 'CUSTOMER');
      await call('GET', '/shopper/orders', 'PERSONAL_SHOPPER');
      expect(orders.expireStale.mock.calls.map((c) => c[0])).toEqual([
        { customerId: 'user-1' },
        { shopperProfileId: 'prof-1' },
      ]);
    });
  });

  describe('customer: /shopping-orders', () => {
    it.each([
      ['GET', '/shopping-orders'],
      ['GET', `/shopping-orders/${ORDER}`],
      ['GET', `/shopping-orders/${ORDER}/events`],
    ])('%s %s is CUSTOMER-only', async (method, path) => {
      expect((await call(method, path, 'PERSONAL_SHOPPER')).status).toBe(403);
    });

    it('lists with the filter and pagination meta', async () => {
      orders.listForCustomer.mockResolvedValue({ rows: [makeCustomerOrder()], total: 12 });
      const { status, json } = await call(
        'GET',
        '/shopping-orders?filter=active&page=2&limit=5',
        'CUSTOMER',
      );
      expect(status).toBe(200);
      expect(orders.listForCustomer).toHaveBeenCalledWith('user-1', 5, 5, 'active');
      expect(json.meta).toMatchObject({ page: 2, limit: 5, total: 12, totalPages: 3 });
    });

    it('rejects an unknown filter', async () => {
      expect((await call('GET', '/shopping-orders?filter=late', 'CUSTOMER')).status).toBe(400);
    });

    it('returns detail with items, financials, shopper public info and events, without contact details', async () => {
      orders.findOwnedByCustomer.mockResolvedValue(makeCustomerOrder());
      const { status, json } = await call('GET', `/shopping-orders/${ORDER}`, 'CUSTOMER');
      expect(status).toBe(200);
      expect(json.data).toMatchObject({
        items: [{ name: 'Milk' }],
        financials: { customerTotal: 12171 },
        shopper: { displayName: 'Amaka O.' },
        events: [{ type: 'OFFER_ACCEPTED' }],
      });
      expect(JSON.stringify(json)).not.toMatch(/email|phone|actorId/);
    });

    it('404s for an order that is not the caller own; events are scoped the same way', async () => {
      orders.findOwnedByCustomer.mockResolvedValue(null);
      expect((await call('GET', `/shopping-orders/${ORDER}`, 'CUSTOMER')).status).toBe(404);
      expect((await call('GET', `/shopping-orders/${ORDER}/events`, 'CUSTOMER')).status).toBe(404);
    });

    it('lists events newest first', async () => {
      orders.findOwnedByCustomer.mockResolvedValue(makeCustomerOrder());
      const { json } = await call('GET', `/shopping-orders/${ORDER}/events`, 'CUSTOMER');
      expect(json.data).toHaveLength(1);
      expect(orders.listEvents).toHaveBeenCalledWith(ORDER, 'desc');
    });
  });

  describe('shopper: /shopper/orders', () => {
    it.each([
      ['GET', '/shopper/orders'],
      ['GET', `/shopper/orders/${ORDER}`],
      ['GET', `/shopper/orders/${ORDER}/events`],
      ['POST', `/shopper/orders/${ORDER}/accept`],
      ['POST', `/shopper/orders/${ORDER}/start`],
    ])('%s %s is PERSONAL_SHOPPER-only (403 for a customer)', async (method, path) => {
      expect((await call(method, path, 'CUSTOMER')).status).toBe(403);
    });

    it('is 403 for a shopper who is not APPROVED', async () => {
      profiles.ensureByUserId.mockResolvedValue({
        id: 'prof-1',
        accountState: 'VERIFICATION_PENDING',
      });
      expect((await call('GET', '/shopper/orders', 'PERSONAL_SHOPPER')).status).toBe(403);
      expect(
        (await call('POST', `/shopper/orders/${ORDER}/accept`, 'PERSONAL_SHOPPER')).status,
      ).toBe(403);
      expect(orders.transition).not.toHaveBeenCalled();
    });

    it('lists with the filter', async () => {
      orders.listForShopper.mockResolvedValue({ rows: [makeShopperOrder()], total: 1 });
      const { status, json } = await call(
        'GET',
        '/shopper/orders?filter=cancelled',
        'PERSONAL_SHOPPER',
      );
      expect(status).toBe(200);
      expect(orders.listForShopper).toHaveBeenCalledWith('prof-1', 0, 10, 'cancelled');
      expect(json.data[0].id).toBe('order-1');
      expect((await call('GET', '/shopper/orders?filter=x', 'PERSONAL_SHOPPER')).status).toBe(400);
    });

    it('returns the order with earnings and none of the customer address, note or identity', async () => {
      orders.findOwnedByShopper.mockResolvedValue(makeShopperOrder());
      const { status, json } = await call('GET', `/shopper/orders/${ORDER}`, 'PERSONAL_SHOPPER');
      expect(status).toBe(200);
      expect(json.data).toMatchObject({
        extraServices: [],
        receipts: [],
        pendingApprovals: 0,
        financials: { shopperGrossEarnings: 1000 },
      });
      expect(JSON.stringify(json)).not.toMatch(/Admiralty|latitude|0803|cust-1|deliveryAddress/);
    });

    it('404s, not 403, for someone else order or an unknown id', async () => {
      orders.findOwnedByShopper.mockResolvedValue(null);
      orders.transition.mockResolvedValue({ outcome: 'not_found' });
      for (const [method, path] of [
        ['GET', `/shopper/orders/${ORDER}`],
        ['GET', `/shopper/orders/${ORDER}/events`],
        ['POST', `/shopper/orders/${ORDER}/accept`],
        ['POST', `/shopper/orders/${ORDER}/start`],
      ]) {
        expect((await call(method, path, 'PERSONAL_SHOPPER')).status).toBe(404);
      }
      expect((await call('GET', '/shopper/orders/not-a-uuid', 'PERSONAL_SHOPPER')).status).toBe(
        400,
      );
    });

    it('accept and start return 200 with the new state', async () => {
      orders.transition.mockResolvedValueOnce({
        outcome: 'transitioned',
        order: makeShopperOrder({ state: 'SHOPPER_ACCEPTED' }),
      });
      const accept = await call('POST', `/shopper/orders/${ORDER}/accept`, 'PERSONAL_SHOPPER');
      expect(accept.status).toBe(200);
      expect(accept.json).toMatchObject({
        message: 'Order accepted',
        data: { state: 'SHOPPER_ACCEPTED' },
      });

      orders.transition.mockResolvedValueOnce({
        outcome: 'transitioned',
        order: makeShopperOrder({ state: 'SHOPPING_STARTED' }),
      });
      const start = await call('POST', `/shopper/orders/${ORDER}/start`, 'PERSONAL_SHOPPER');
      expect(start.status).toBe(200);
      expect(start.json.data.state).toBe('SHOPPING_STARTED');
    });

    it('409s out of order, with a message the UI can show verbatim', async () => {
      orders.transition.mockResolvedValue({ outcome: 'conflict', state: 'ASSIGNED' });
      const start = await call('POST', `/shopper/orders/${ORDER}/start`, 'PERSONAL_SHOPPER');
      expect(start.status).toBe(409);
      expect(start.json.message).toBe('Accept this order before starting to shop');

      orders.transition.mockResolvedValue({ outcome: 'conflict', state: 'SHOPPER_ACCEPTED' });
      const accept = await call('POST', `/shopper/orders/${ORDER}/accept`, 'PERSONAL_SHOPPER');
      expect(accept.status).toBe(409);
      expect(accept.json.message).toContain('shopper accepted');
    });
  });
});
