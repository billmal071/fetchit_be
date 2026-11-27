import { ShopperOrdersService } from './shopper-orders.service';
import { BREAKDOWN, makeOrderEvent, makeShopperOrder } from './testing/fixtures';

describe('ShopperOrdersService', () => {
  let profiles: { ensureByUserId: jest.Mock };
  let orders: Record<string, jest.Mock>;
  let audit: { log: jest.Mock };
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
    service = new ShopperOrdersService(profiles as never, orders as never, audit as never);
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
});
