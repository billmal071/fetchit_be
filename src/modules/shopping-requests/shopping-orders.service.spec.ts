import { ShoppingOrdersService } from './shopping-orders.service';
import { EVENTS } from '@common/constants';
import { ShoppingOfferAcceptedEvent } from '@common/events';
import { BREAKDOWN, makeCustomerOrder, makeOrderEvent } from './testing/fixtures';

describe('ShoppingOrdersService', () => {
  let orders: Record<string, jest.Mock>;
  let events: { emit: jest.Mock };
  let audit: { log: jest.Mock };
  let service: ShoppingOrdersService;

  const accepted = {
    outcome: 'accepted',
    order: makeCustomerOrder(),
    winnerUserId: 'winner-user',
    requestReference: 'SR-ABC23456',
    rejected: [{ offerId: 'offer-2', userId: 'loser-user' }],
  };

  beforeEach(() => {
    orders = {
      acceptOffer: jest.fn(async () => accepted),
      listForCustomer: jest.fn(),
      findOwnedByCustomer: jest.fn(async () => makeCustomerOrder()),
      listEvents: jest.fn(async () => [makeOrderEvent()]),
    };
    events = { emit: jest.fn() };
    audit = { log: jest.fn() };
    service = new ShoppingOrdersService(orders as never, events as never, audit as never);
  });

  describe('acceptOffer', () => {
    it('passes only ids to the repository: the client supplies no money', async () => {
      await service.acceptOffer('cust-1', 'req-1', 'offer-1');
      expect(orders.acceptOffer).toHaveBeenCalledWith({
        requestId: 'req-1',
        offerId: 'offer-1',
        customerId: 'cust-1',
      });
    });

    it('returns the order with the offer breakdown exactly as quoted and no shopper earnings', async () => {
      const { data: result, created } = await service.acceptOffer('cust-1', 'req-1', 'offer-1');
      expect(created).toBe(true);
      expect(result.financials).toEqual(BREAKDOWN);
      expect(result.financials).not.toHaveProperty('shopperGrossEarnings');
      expect(result.state).toBe('ASSIGNED');
    });

    it('audits, and emits one event naming the winner and the losers', async () => {
      await service.acceptOffer('cust-1', 'req-1', 'offer-1');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SHOPPING_OFFER_ACCEPTED',
          entity: 'ShopperOrder',
          userId: 'cust-1',
        }),
      );
      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith(
        EVENTS.SHOPPING_OFFER_ACCEPTED,
        new ShoppingOfferAcceptedEvent(
          'order-1',
          'SO-ABC23456',
          'req-1',
          'SR-ABC23456',
          'winner-user',
          ['loser-user'],
        ),
      );
    });

    it('still succeeds when the audit write fails', async () => {
      audit.log.mockRejectedValue(new Error('db down'));
      await expect(service.acceptOffer('cust-1', 'req-1', 'offer-1')).resolves.toMatchObject({
        data: { id: 'order-1' },
      });
    });

    it('409s with a clear message when the shopper is no longer available', async () => {
      orders.acceptOffer.mockResolvedValue({ outcome: 'shopper_unavailable' });
      await expect(service.acceptOffer('cust-1', 'req-1', 'offer-1')).rejects.toMatchObject({
        status: 409,
        message: 'This shopper is no longer available; choose another offer',
      });
      expect(events.emit).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('returns the existing order on a retry, flagged as not created, with no second event or audit', async () => {
      orders.acceptOffer.mockResolvedValue({
        outcome: 'already_accepted',
        order: makeCustomerOrder(),
      });
      const result = await service.acceptOffer('cust-1', 'req-1', 'offer-1');
      expect(result.created).toBe(false);
      expect(result.data).toMatchObject({ id: 'order-1', financials: BREAKDOWN });
      expect(events.emit).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('404s when the request is not the caller own or the offer is not on it', async () => {
      orders.acceptOffer.mockResolvedValue({ outcome: 'not_found' });
      await expect(service.acceptOffer('cust-1', 'req-1', 'offer-1')).rejects.toMatchObject({
        status: 404,
      });
      expect(events.emit).not.toHaveBeenCalled();
    });

    it.each([
      [{ outcome: 'request_not_open', status: 'ASSIGNED' }, 'assigned'],
      [{ outcome: 'request_not_open', status: 'CANCELLED' }, 'cancelled'],
      [{ outcome: 'offer_not_pending', state: 'WITHDRAWN' }, 'withdrawn'],
      [{ outcome: 'offer_not_pending', state: 'REJECTED' }, 'rejected'],
      [{ outcome: 'offer_expired' }, 'expired'],
    ])('409s with a readable message for %j', async (result, word) => {
      orders.acceptOffer.mockResolvedValue(result);
      const error = await service.acceptOffer('cust-1', 'req-1', 'offer-1').catch((e) => e);
      expect(error.status).toBe(409);
      expect(error.message).toContain(word);
      expect(events.emit).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('lists the caller own orders with the filter and paging', async () => {
      orders.listForCustomer.mockResolvedValue({ rows: [makeCustomerOrder()], total: 11 });
      const result = await service.list('cust-1', { page: 2, limit: 5, filter: 'active' } as never);
      expect(orders.listForCustomer).toHaveBeenCalledWith('cust-1', 5, 5, 'active');
      expect(result.meta).toMatchObject({ page: 2, limit: 5, total: 11, totalPages: 3 });
    });

    it('shows the customer their address, items, financials, shopper public info and events', async () => {
      const result = await service.findOne('cust-1', 'order-1');
      expect(result).toMatchObject({
        reference: 'SO-ABC23456',
        requestReference: 'SR-ABC23456',
        deliveryAddress: { text: '12 Admiralty Way, Lekki', latitude: 6.45 },
        itemCount: 1,
        financials: { customerTotal: 12171 },
        shopper: { id: 'prof-1', displayName: 'Amaka O.', rating: 4.85, completedOrders: 61 },
        events: [{ type: 'OFFER_ACCEPTED', actorRole: 'CUSTOMER' }],
      });
      expect(result.items[0]).toMatchObject({ customerEstimatedPrice: 4500, state: 'PENDING' });
    });

    it('never exposes the shopper contact details or any actor id', async () => {
      const text = JSON.stringify(await service.findOne('cust-1', 'order-1'));
      for (const leak of ['email', 'phone', 'userId', 'actorId', 'cust-user-id']) {
        expect(text).not.toContain(leak);
      }
    });

    it('leaves the unset price columns out rather than sending zero', async () => {
      const item = (await service.findOne('cust-1', 'order-1')).items[0];
      for (const key of [
        'shopperEstimatedPrice',
        'actualPurchasePrice',
        'approvedPrice',
        'finalPurchasePrice',
      ]) {
        expect(item).not.toHaveProperty(key, 0);
        expect(item[key as keyof typeof item]).toBeUndefined();
      }
    });

    it('404s for an order that is not the caller own, on detail and events', async () => {
      orders.findOwnedByCustomer.mockResolvedValue(null);
      await expect(service.findOne('cust-1', 'x')).rejects.toMatchObject({ status: 404 });
      await expect(service.listEvents('cust-1', 'x')).rejects.toMatchObject({ status: 404 });
      expect(orders.findOwnedByCustomer).toHaveBeenCalledWith('x', 'cust-1');
      expect(orders.listEvents).not.toHaveBeenCalled();
    });

    it('returns events newest first', async () => {
      await service.listEvents('cust-1', 'order-1');
      expect(orders.listEvents).toHaveBeenCalledWith('order-1', 'desc');
    });
  });
});
