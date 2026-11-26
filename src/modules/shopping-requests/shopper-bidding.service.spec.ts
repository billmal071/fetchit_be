import { ShopperBiddingService } from './shopper-bidding.service';
import { ShoppingConfigService } from './shopping-config.service';
import { EVENTS } from '@common/constants';
import { ShoppingOfferSubmittedEvent } from '@common/events';
import { DuplicateActiveOfferError, OfferRequestClosedError } from '@/database/repositories';
import { RULES, makeOfferRow, makeRequestRow } from './testing/fixtures';

describe('ShopperBiddingService', () => {
  let profiles: { ensureByUserId: jest.Mock };
  let requests: Record<string, jest.Mock>;
  let offers: Record<string, jest.Mock>;
  let config: { getRules: jest.Mock };
  let events: { emit: jest.Mock };
  let audit: { log: jest.Mock };
  let service: ShopperBiddingService;

  const profile = (over: object = {}) => ({
    id: 'prof-1',
    accountState: 'APPROVED',
    isOnline: true,
    displayName: 'Amaka O.',
    ...over,
  });
  const bid = { shopperFee: 1000, etaMinutes: 30 };

  beforeEach(() => {
    profiles = { ensureByUserId: jest.fn(async () => profile()) };
    requests = {
      findMatchingForShopper: jest.fn(async () => ({ rows: [makeRequestRow()], total: 1 })),
      findCoveredByShopper: jest.fn(async () => makeRequestRow()),
      findReadableByShopper: jest.fn(async () => makeRequestRow()),
    };
    offers = {
      submit: jest.fn(async () => makeOfferRow()),
      withdraw: jest.fn(async () => true),
      expireDue: jest.fn(async () => 0),
      findOwnedById: jest.fn(async () => makeOfferRow()),
      listForShopper: jest.fn(async () => ({ rows: [makeOfferRow()], total: 1 })),
      findPendingRequestIds: jest.fn(async () => new Set<string>()),
      findPendingByShopperAndRequest: jest.fn(async () => null),
    };
    config = { getRules: jest.fn(async () => RULES) };
    events = { emit: jest.fn() };
    audit = { log: jest.fn() };
    service = new ShopperBiddingService(
      profiles as never,
      requests as never,
      offers as never,
      config as unknown as ShoppingConfigService,
      events as never,
      audit as never,
    );
  });

  describe('eligibility', () => {
    it.each(['REGISTERED', 'ONBOARDING', 'VERIFICATION_PENDING', 'SUSPENDED', 'DEACTIVATED'])(
      '403s every route for a shopper who is %s',
      async (accountState) => {
        profiles.ensureByUserId.mockResolvedValue(profile({ accountState }));
        const calls = [
          service.feed('u', {} as never),
          service.getRequest('u', 'req-1'),
          service.preview('u', 'req-1', bid),
          service.submit('u', 'req-1', bid),
          service.listOffers('u', {} as never),
          service.getOffer('u', 'offer-1'),
          service.withdraw('u', 'offer-1'),
        ];
        for (const call of calls) {
          await expect(call).rejects.toMatchObject({ status: 403 });
        }
        expect(offers.submit).not.toHaveBeenCalled();
        expect(offers.withdraw).not.toHaveBeenCalled();
      },
    );
  });

  describe('feed', () => {
    it('matches for this shopper, sends the filters and paging, and flags requests already bid on', async () => {
      offers.findPendingRequestIds.mockResolvedValue(new Set(['req-1']));

      const result = await service.feed('u', {
        page: 2,
        limit: 5,
        locationId: 'loc-1',
        categoryId: 'cat-1',
        sortBy: 'offerDeadline',
        sortOrder: 'ASC',
      } as never);

      expect(requests.findMatchingForShopper).toHaveBeenCalledWith({
        shopperProfileId: 'prof-1',
        now: expect.any(Date),
        locationId: 'loc-1',
        categoryId: 'cat-1',
        sortBy: 'offerDeadline',
        sortOrder: 'asc',
        skip: 5,
        take: 5,
      });
      expect(result.data[0]).toMatchObject({
        id: 'req-1',
        itemCount: 1,
        estimatedGoodsBudget: 9000,
        handoffArea: 'Lekki Phase 1',
        shoppingLocation: { id: 'loc-1', name: 'Mile 12' },
        categories: [{ id: 'cat-1', name: 'Provisions' }],
        earningsEstimate: 2750,
        earningsRange: { min: 500, max: 5000 },
        hasSubmittedOffer: true,
      });
      expect(result.meta).toMatchObject({ page: 2, limit: 5, total: 1 });
    });

    it('never exposes the exact delivery address, coordinates or customer', async () => {
      const { data } = await service.feed('u', {} as never);
      const text = JSON.stringify(data);
      expect(text).not.toContain('Admiralty');
      expect(text).not.toContain('cust-1');
      expect(text).not.toContain('latitude');
    });

    it('returns an empty page, without querying, for an offline shopper', async () => {
      profiles.ensureByUserId.mockResolvedValue(profile({ isOnline: false }));
      const result = await service.feed('u', {} as never);
      expect(result).toMatchObject({ data: [], meta: { total: 0 } });
      expect(requests.findMatchingForShopper).not.toHaveBeenCalled();
    });
  });

  describe('getRequest', () => {
    it('404s for a request that does not match and has no offer from this shopper', async () => {
      requests.findReadableByShopper.mockResolvedValue(null);
      await expect(service.getRequest('u', 'req-1')).rejects.toMatchObject({ status: 404 });
    });

    it('never exposes the customer free-text note to the shopper', async () => {
      requests.findReadableByShopper.mockResolvedValue(
        makeRequestRow({ note: 'call me on 0803 000 0000' }),
      );
      const feed = await service.feed('u', {} as never);
      const detail = await service.getRequest('u', 'req-1');
      expect(JSON.stringify([feed, detail])).not.toContain('0803');
      expect(detail).not.toHaveProperty('note');
    });

    it('returns items and the shopper own pending offer', async () => {
      offers.findPendingByShopperAndRequest.mockResolvedValue(makeOfferRow());
      const result = await service.getRequest('u', 'req-1');
      expect(result.items[0]).toMatchObject({
        name: 'Milk',
        brand: 'Peak',
        size: '400g',
        quantity: 2,
      });
      expect(result.hasSubmittedOffer).toBe(true);
      expect(result.myOffer).toMatchObject({ id: 'offer-1', shopperFee: 1000 });
    });
  });

  describe('preview', () => {
    it('returns the calculated offer with the shopper earnings and writes nothing', async () => {
      const result = await service.preview('u', 'req-1', { ...bid, note: 'hi' });

      expect(result).toMatchObject({
        id: undefined,
        requestId: 'req-1',
        shopperId: 'prof-1',
        state: 'PENDING',
        shopperFee: 1000,
        etaMinutes: 30,
        note: 'hi',
        financials: { customerTotal: 12171, vatOrTax: 221, shopperGrossEarnings: 1000 },
      });
      expect(offers.submit).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('is idempotent: the same input gives the same answer', async () => {
      expect(await service.preview('u', 'req-1', bid)).toEqual(
        await service.preview('u', 'req-1', bid),
      );
    });
  });

  describe('submit', () => {
    it('stores the server-calculated breakdown, audits, and emits one event for the customer', async () => {
      const result = await service.submit('u', 'req-1', { ...bid, note: 'hi' });

      expect(offers.submit).toHaveBeenCalledWith({
        requestId: 'req-1',
        shopperProfileId: 'prof-1',
        shopperFee: 1000,
        etaMinutes: 30,
        note: 'hi',
        financials: expect.objectContaining({ customerTotal: 12171 }),
        now: expect.any(Date),
      });
      expect(result).toMatchObject({ id: 'offer-1', financials: { shopperGrossEarnings: 1000 } });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SHOPPING_OFFER_SUBMITTED' }),
      );
      expect(events.emit).toHaveBeenCalledTimes(1);
      const [name, event] = events.emit.mock.calls[0];
      expect(name).toBe(EVENTS.SHOPPING_OFFER_SUBMITTED);
      expect(event).toEqual(
        new ShoppingOfferSubmittedEvent(
          'cust-1',
          'req-1',
          'SR-ABC23456',
          'offer-1',
          'Amaka O.',
          1000,
          12171,
        ),
      );
    });

    it('does not trust the client for anything but fee, eta and note', async () => {
      await service.submit('u', 'req-1', { ...bid, deliveryFee: 0, items: [] } as never);
      const sent = offers.submit.mock.calls[0][0];
      expect(sent.financials.deliveryFee).toBe(RULES.deliveryFee);
      expect(sent).not.toHaveProperty('items');
    });

    it('requires the shopper to be online', async () => {
      profiles.ensureByUserId.mockResolvedValue(profile({ isOnline: false }));
      await expect(service.submit('u', 'req-1', bid)).rejects.toMatchObject({ status: 403 });
    });

    it('404s for a request outside the shopper markets or categories', async () => {
      requests.findCoveredByShopper.mockResolvedValue(null);
      await expect(service.submit('u', 'req-1', bid)).rejects.toMatchObject({ status: 404 });
    });

    it.each([
      ['not OPEN', { status: 'CANCELLED' as const }],
      ['past its deadline', { offerDeadline: new Date(Date.now() - 1000) }],
    ])('409s when the request is %s', async (_label, over) => {
      requests.findCoveredByShopper.mockResolvedValue(makeRequestRow(over));
      await expect(service.submit('u', 'req-1', bid)).rejects.toMatchObject({ status: 409 });
      await expect(service.preview('u', 'req-1', bid)).rejects.toMatchObject({ status: 409 });
      expect(offers.submit).not.toHaveBeenCalled();
    });

    it.each([499, 5001, 0])(
      '422s when shopperFee %i is outside the configured range',
      async (shopperFee) => {
        const error = await service.submit('u', 'req-1', { ...bid, shopperFee }).catch((e) => e);
        expect(error.status).toBe(422);
        expect(error.getResponse().details.errors[0]).toMatchObject({
          field: 'shopperFee',
          message: 'shopperFee must be between 500 and 5000',
        });
        expect(offers.submit).not.toHaveBeenCalled();
      },
    );

    it('accepts the bounds exactly, and follows the bounds when the config changes', async () => {
      await expect(
        service.submit('u', 'req-1', { ...bid, shopperFee: 500 }),
      ).resolves.toBeDefined();
      await expect(
        service.submit('u', 'req-1', { ...bid, shopperFee: 5000 }),
      ).resolves.toBeDefined();

      config.getRules.mockResolvedValue({ ...RULES, minShopperFee: 100, maxShopperFee: 200 });
      await expect(
        service.submit('u', 'req-1', { ...bid, shopperFee: 150 }),
      ).resolves.toBeDefined();
      await expect(service.submit('u', 'req-1', { ...bid, shopperFee: 500 })).rejects.toMatchObject(
        { status: 422 },
      );
    });

    it('409s a second active offer (unique index) and writes no audit or event', async () => {
      offers.submit.mockRejectedValue(new DuplicateActiveOfferError());
      await expect(service.submit('u', 'req-1', bid)).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('withdraw'),
      });
      expect(events.emit).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('409s when the request closed between the read and the insert', async () => {
      offers.submit.mockRejectedValue(new OfferRequestClosedError());
      await expect(service.submit('u', 'req-1', bid)).rejects.toMatchObject({ status: 409 });
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('own offers', () => {
    it('lists with the state filter, after expiring due offers', async () => {
      const result = await service.listOffers('u', {
        page: 1,
        limit: 10,
        state: 'PENDING',
      } as never);
      expect(offers.expireDue).toHaveBeenCalledWith(expect.any(Date), {
        shopperProfileId: 'prof-1',
      });
      expect(offers.listForShopper).toHaveBeenCalledWith('prof-1', 0, 10, 'PENDING');
      expect(result.data[0]).toMatchObject({
        id: 'offer-1',
        state: 'PENDING',
        request: { id: 'req-1', hasSubmittedOffer: true },
      });
    });

    it('scopes getOffer to the shopper: someone else offer is a 404', async () => {
      offers.findOwnedById.mockResolvedValue(null);
      await expect(service.getOffer('u', 'offer-9')).rejects.toMatchObject({ status: 404 });
      expect(offers.findOwnedById).toHaveBeenCalledWith('offer-9', 'prof-1');
    });
  });

  describe('withdraw', () => {
    it('withdraws an own pending offer', async () => {
      offers.findOwnedById.mockResolvedValue(makeOfferRow({ state: 'WITHDRAWN' }));
      const result = await service.withdraw('u', 'offer-1');
      expect(offers.withdraw).toHaveBeenCalledWith('offer-1', 'prof-1');
      expect(result.state).toBe('WITHDRAWN');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SHOPPING_OFFER_WITHDRAWN' }),
      );
    });

    it('409s when the offer is not pending any more', async () => {
      offers.withdraw.mockResolvedValue(false);
      offers.findOwnedById.mockResolvedValue(makeOfferRow({ state: 'ACCEPTED' }));
      await expect(service.withdraw('u', 'offer-1')).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('accepted'),
      });
    });

    it('404s for an offer that is not the shopper own', async () => {
      offers.withdraw.mockResolvedValue(false);
      offers.findOwnedById.mockResolvedValue(null);
      await expect(service.withdraw('u', 'offer-9')).rejects.toMatchObject({ status: 404 });
    });
  });
});
