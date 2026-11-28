import { ShopperOrdersService } from './shopper-orders.service';
import { BREAKDOWN, makeOrderEvent, makeShopperOrder } from './testing/fixtures';

describe('ShopperOrdersService', () => {
  let profiles: { ensureByUserId: jest.Mock };
  let orders: Record<string, jest.Mock>;
  let audit: { log: jest.Mock };
  let expiry: {
    sweep: jest.Mock;
    announce: jest.Mock;
    windows: jest.Mock;
    cancelAfterAcceptTimeout: jest.Mock;
  };
  let service: ShopperOrdersService;

  beforeEach(() => {
    profiles = {
      ensureByUserId: jest.fn(async () => ({ id: 'prof-1', accountState: 'APPROVED' })),
    };
    orders = {
      listForShopper: jest.fn(async () => ({ rows: [makeShopperOrder()], total: 1 })),
      findOwnedByShopper: jest.fn(async () => makeShopperOrder()),
      listEvents: jest.fn(async () => [makeOrderEvent()]),
      transition: jest.fn(async () => ({
        outcome: 'transitioned',
        order: makeShopperOrder({ state: 'SHOPPER_ACCEPTED' }),
      })),
    };
    audit = { log: jest.fn() };
    expiry = {
      sweep: jest.fn(async () => undefined),
      announce: jest.fn(),
      windows: jest.fn(async () => ({ acceptWindowMinutes: 30, offerWindowMinutes: 45 })),
      cancelAfterAcceptTimeout: jest.fn(async () => 'CANCELLED_BY_SYSTEM'),
    };
    service = new ShopperOrdersService(
      profiles as never,
      orders as never,
      audit as never,
      expiry as never,
    );
  });

  it.each(['REGISTERED', 'VERIFICATION_PENDING', 'SUSPENDED', 'DEACTIVATED'])(
    '403s every route for a shopper who is %s, touching no order',
    async (accountState) => {
      profiles.ensureByUserId.mockResolvedValue({ id: 'prof-1', accountState });
      for (const call of [
        service.list('u', {} as never),
        service.findOne('u', 'order-1'),
        service.listEvents('u', 'order-1'),
        service.accept('u', 'order-1'),
        service.start('u', 'order-1'),
      ]) {
        await expect(call).rejects.toMatchObject({ status: 403 });
      }
      expect(orders.transition).not.toHaveBeenCalled();
      expect(orders.findOwnedByShopper).not.toHaveBeenCalled();
    },
  );

  describe('reads', () => {
    it('lists only the shopper own orders, with the filter', async () => {
      const result = await service.list('u', { page: 1, limit: 10, filter: 'completed' } as never);
      expect(orders.listForShopper).toHaveBeenCalledWith('prof-1', 0, 10, 'completed');
      expect(result.data[0]).toMatchObject({ id: 'order-1', itemCount: 1 });
    });

    it('returns items, empty extraServices and receipts, zero pending approvals, and the earnings', async () => {
      const order = await service.findOne('u', 'order-1');
      expect(order).toMatchObject({
        extraServices: [],
        receipts: [],
        pendingApprovals: 0,
        financials: { ...BREAKDOWN, shopperGrossEarnings: BREAKDOWN.shopperFee },
      });
      expect(order.items[0]).toMatchObject({
        name: 'Milk',
        quantity: 2,
        customerEstimatedPrice: 4500,
      });
    });

    it('never exposes the address, coordinates, customer note or customer identity', async () => {
      const text = JSON.stringify(await service.findOne('u', 'order-1'));
      for (const leak of [
        'Admiralty',
        'latitude',
        'longitude',
        '0803',
        '"note"',
        'cust-1',
        'customerId',
        'deliveryAddress',
      ]) {
        expect(text).not.toContain(leak);
      }
      expect(text).toContain('Lekki Phase 1'); // the coarse area is fine
    });

    it('404s, not 403, for an order that is not assigned to this shopper', async () => {
      orders.findOwnedByShopper.mockResolvedValue(null);
      await expect(service.findOne('u', 'x')).rejects.toMatchObject({ status: 404 });
      await expect(service.listEvents('u', 'x')).rejects.toMatchObject({ status: 404 });
      expect(orders.findOwnedByShopper).toHaveBeenCalledWith('x', 'prof-1');
    });

    it('returns events newest first without actor ids', async () => {
      const events = await service.listEvents('u', 'order-1');
      expect(orders.listEvents).toHaveBeenCalledWith('order-1', 'desc');
      expect(JSON.stringify(events)).not.toContain('cust-user-id');
    });
  });

  describe('accept', () => {
    it('moves ASSIGNED to SHOPPER_ACCEPTED with the matching event, as one conditional step', async () => {
      const result = await service.accept('u', 'order-1');
      expect(orders.transition).toHaveBeenCalledWith({
        id: 'order-1',
        shopperProfileId: 'prof-1',
        actorId: 'u',
        from: 'ASSIGNED',
        to: 'SHOPPER_ACCEPTED',
        eventType: 'SHOPPER_ACCEPTED',
        stamp: 'shopperAcceptedAt',
        acceptWindowMinutes: 30,
      });
      expect(result.state).toBe('SHOPPER_ACCEPTED');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_SHOPPER_ACCEPTED' }),
      );
    });

    it.each(['SHOPPER_ACCEPTED', 'SHOPPING_STARTED', 'COMPLETED', 'CANCELLED'])(
      '409s with a UI-showable message when the order is %s (also how a lost race looks)',
      async (state) => {
        orders.transition.mockResolvedValue({ outcome: 'conflict', state });
        const error = await service.accept('u', 'order-1').catch((e) => e);
        expect(error.status).toBe(409);
        expect(error.message).toContain(state.toLowerCase().replace(/_/g, ' '));
        expect(audit.log).not.toHaveBeenCalled();
      },
    );

    it('403s, writing no audit, when the shopper was suspended after the service check', async () => {
      orders.transition.mockResolvedValue({ outcome: 'shopper_unavailable' });
      await expect(service.accept('u', 'order-1')).rejects.toMatchObject({ status: 403 });
      await expect(service.start('u', 'order-1')).rejects.toMatchObject({ status: 403 });
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('404s for an order that is not the shopper own', async () => {
      orders.transition.mockResolvedValue({ outcome: 'not_found' });
      await expect(service.accept('u', 'x')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('start', () => {
    it('moves SHOPPER_ACCEPTED to SHOPPING_STARTED', async () => {
      orders.transition.mockResolvedValue({
        outcome: 'transitioned',
        order: makeShopperOrder({ state: 'SHOPPING_STARTED' }),
      });
      const result = await service.start('u', 'order-1');
      expect(orders.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'SHOPPER_ACCEPTED',
          to: 'SHOPPING_STARTED',
          eventType: 'SHOPPING_STARTED',
          stamp: 'shoppingStartedAt',
        }),
      );
      expect(result.state).toBe('SHOPPING_STARTED');
    });

    it('tells the shopper to accept first when the order is still ASSIGNED', async () => {
      orders.transition.mockResolvedValue({ outcome: 'conflict', state: 'ASSIGNED' });
      const error = await service.start('u', 'order-1').catch((e) => e);
      expect(error.status).toBe(409);
      expect(error.message).toBe('Accept this order before starting to shop');
    });

    it('409s from any later state', async () => {
      orders.transition.mockResolvedValue({ outcome: 'conflict', state: 'SHOPPING_STARTED' });
      await expect(service.start('u', 'order-1')).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('shopping started'),
      });
    });
  });

  describe('the accept window is re-checked inside the accept', () => {
    it('passes the configured window to the accept step only, not to start', async () => {
      await service.accept('u', 'order-1');
      expect(orders.transition).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: 'ASSIGNED', acceptWindowMinutes: 30 }),
      );
      orders.transition.mockResolvedValue({
        outcome: 'transitioned',
        order: makeShopperOrder({ state: 'SHOPPING_STARTED' }),
      });
      await service.start('u', 'order-1');
      expect(orders.transition.mock.calls.at(-1)![0]).not.toHaveProperty('acceptWindowMinutes');
    });

    describe('when the window ran out while the accept waited', () => {
      const cutoff = new Date('2026-11-25T09:40:00Z');
      beforeEach(() => {
        orders.transition.mockResolvedValue({ outcome: 'accept_expired', assignedBefore: cutoff });
      });

      it('confirms a SYSTEM cancellation before claiming one, using the transition cutoff and the same windows', async () => {
        expiry.cancelAfterAcceptTimeout.mockResolvedValue('CANCELLED_BY_SYSTEM');
        await expect(service.accept('u', 'order-1')).rejects.toMatchObject({
          status: 409,
          message: 'This order was cancelled because it was not accepted in time',
        });
        expect(expiry.cancelAfterAcceptTimeout).toHaveBeenCalledWith('order-1', cutoff, 45);
        expect(audit.log).not.toHaveBeenCalled();
      });

      it('does NOT claim a cancellation when the cancel failed or matched nothing', async () => {
        expiry.cancelAfterAcceptTimeout.mockResolvedValue('NOT_CANCELLED');
        const error = await service.accept('u', 'order-1').catch((e) => e);
        expect(error.status).toBe(409);
        expect(error.message).toBe(
          'This order was not accepted in time and can no longer be accepted. It will be cancelled shortly.',
        );
        expect(error.message).not.toMatch(/was cancelled/);
      });

      it('reports the customer cancel message when the customer cancelled first', async () => {
        expiry.cancelAfterAcceptTimeout.mockResolvedValue('CANCELLED_BY_CUSTOMER');
        await expect(service.accept('u', 'order-1')).rejects.toMatchObject({
          status: 409,
          message: 'This order was cancelled by the customer',
        });
      });

      it('uses ONE window value for the whole accept, even if the config changes between calls', async () => {
        expiry.windows
          .mockResolvedValueOnce({ acceptWindowMinutes: 30, offerWindowMinutes: 45 })
          .mockResolvedValue({ acceptWindowMinutes: 999, offerWindowMinutes: 999 });
        expiry.cancelAfterAcceptTimeout.mockResolvedValue('CANCELLED_BY_SYSTEM');
        await service.accept('u', 'order-1').catch(() => undefined);

        expect(expiry.windows).toHaveBeenCalledTimes(1);
        const windows = { acceptWindowMinutes: 30, offerWindowMinutes: 45 };
        expect(expiry.sweep).toHaveBeenCalledWith({ orderId: 'order-1' }, windows);
        expect(orders.transition).toHaveBeenCalledWith(
          expect.objectContaining({ acceptWindowMinutes: 30 }),
        );
        expect(expiry.cancelAfterAcceptTimeout).toHaveBeenCalledWith('order-1', cutoff, 45);
      });
    });
  });

  describe('the lazy timeout and cancelled orders', () => {
    it('sweeps before every read and before acting, so a late accept loses', async () => {
      orders.listForShopper.mockResolvedValue({ rows: [], total: 0 });
      await service.list('u', {} as never);
      expect(expiry.sweep).toHaveBeenLastCalledWith({ shopperProfileId: 'prof-1' });
      for (const call of [
        () => service.findOne('u', 'order-1'),
        () => service.listEvents('u', 'order-1'),
        () => service.accept('u', 'order-1'),
        () => service.start('u', 'order-1'),
      ]) {
        expiry.sweep.mockClear();
        await call().catch(() => undefined);
        expect(expiry.sweep.mock.calls[0][0]).toEqual({ orderId: 'order-1' });
      }
      orders.transition.mockClear();
      await service.accept('u', 'order-1');
      expect(expiry.sweep.mock.invocationCallOrder.at(-1)!).toBeLessThan(
        orders.transition.mock.invocationCallOrder[0],
      );
    });

    it.each([
      ['SYSTEM', 'This order was cancelled because it was not accepted in time'],
      ['CUSTOMER', 'This order was cancelled by the customer'],
    ])(
      '409s accept and start with a clear message when the order was cancelled by %s',
      async (cancelledBy, message) => {
        orders.transition.mockResolvedValue({
          outcome: 'conflict',
          state: 'CANCELLED',
          cancelledBy,
        });
        await expect(service.accept('u', 'order-1')).rejects.toMatchObject({
          status: 409,
          message,
        });
        await expect(service.start('u', 'order-1')).rejects.toMatchObject({ status: 409, message });
      },
    );

    it('shows who cancelled but never the customer reason, on the order or in the events', async () => {
      orders.findOwnedByShopper.mockResolvedValue(
        makeShopperOrder({
          state: 'CANCELLED',
          cancelledBy: 'CUSTOMER',
          cancelReason: 'call me on 0803 111 2222',
          cancelledAt: new Date('2026-11-25T11:00:00Z'),
        }),
      );
      orders.listEvents.mockResolvedValue([
        makeOrderEvent({
          id: 'ev-2',
          type: 'ORDER_CANCELLED',
          actorRole: 'CUSTOMER',
          metadata: { cancelledBy: 'CUSTOMER', reason: 'call me on 0803 111 2222' },
        }),
      ]);
      const order = await service.findOne('u', 'order-1');
      const events = await service.listEvents('u', 'order-1');
      expect(order).toMatchObject({
        state: 'CANCELLED',
        cancelledBy: 'CUSTOMER',
        cancelledAt: '2026-11-25T11:00:00.000Z',
      });
      expect(events[0]).toMatchObject({
        type: 'ORDER_CANCELLED',
        metadata: { cancelledBy: 'CUSTOMER' },
      });
      expect(JSON.stringify([order, events])).not.toContain('0803');
      expect(order).not.toHaveProperty('cancelReason');
    });
  });
});
