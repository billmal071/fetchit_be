import { InternalServerException } from '@common/exceptions/base.exception';
import { ShoppingRequestsService } from './shopping-requests.service';
import { ShoppingConfigService } from './shopping-config.service';
import { CreateShoppingRequestDto } from './dto';
import { RULES, makeOfferWithShopper, makeRequestRow } from './testing/fixtures';

describe('ShoppingRequestsService', () => {
  let requests: Record<string, jest.Mock>;
  let offers: Record<string, jest.Mock>;
  let reference: Record<string, jest.Mock>;
  let config: { getRules: jest.Mock };
  let audit: { log: jest.Mock };
  let service: ShoppingRequestsService;

  const dto = {
    locationId: 'loc-1',
    deliveryAddress: { text: '12 Admiralty Way', latitude: 6.45, longitude: 3.47 },
    handoffArea: 'Lekki Phase 1',
    note: 'gate code 1234',
    items: [
      {
        name: 'Milk',
        brand: 'Peak',
        size: '400g',
        quantity: 2,
        unit: 'tin',
        estimatedUnitPrice: 4500,
        substitutionPreference: 'SIMILAR_UP_TO',
        maxSubstitutePrice: 5000,
        categoryId: 'cat-1',
      },
    ],
  } as unknown as CreateShoppingRequestDto;

  beforeEach(() => {
    requests = {
      create: jest.fn(async () => makeRequestRow()),
      findOwnedById: jest.fn(),
      listForCustomer: jest.fn(),
      cancel: jest.fn(),
      expireElapsed: jest.fn(async () => 0),
    };
    offers = { expireDue: jest.fn(), listForRequest: jest.fn(async () => []) };
    reference = {
      findActiveLocationIds: jest.fn(async (ids: string[]) => ids),
      findActiveCategoryIds: jest.fn(async (ids: string[]) => ids),
    };
    config = { getRules: jest.fn(async () => RULES) };
    audit = { log: jest.fn() };
    service = new ShoppingRequestsService(
      requests as never,
      offers as never,
      reference as never,
      config as unknown as ShoppingConfigService,
      audit as never,
    );
  });

  describe('create', () => {
    it('computes the budget, estimate and deadline on the server from the configured rules', async () => {
      const before = Date.now();
      const result = await service.create('cust-1', dto);

      const input = requests.create.mock.calls[0][0];
      expect(input).toMatchObject({
        customerId: 'cust-1',
        shoppingLocationId: 'loc-1',
        deliveryAddress: '12 Admiralty Way',
        deliveryLatitude: 6.45,
        estimatedGoodsBudget: 9000,
        estimate: {
          estimatedGoodsCost: 9000,
          deliveryFee: 1500,
          platformFee: 450,
          vatOrTax: 146,
          estimatedTotal: 11096,
          priceBuffer: 900,
          shopperFeePending: true,
        },
      });
      const windowMs = input.offerDeadline.getTime() - before;
      expect(windowMs).toBeGreaterThanOrEqual(30 * 60_000);
      expect(windowMs).toBeLessThan(30 * 60_000 + 5000);
      // the request carries its own copy of the live acceptance window
      expect(input.offerAcceptanceWindowMinutes).toBe(RULES.offerAcceptanceWindowMinutes);
      expect(input.items[0]).toMatchObject({
        substitutionPreference: 'SIMILAR_UP_TO',
        maxSubstitutePrice: 5000,
      });
      expect(result.estimate.estimatedTotal).toBe(11096);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SHOPPING_REQUEST_CREATED', entity: 'ShoppingRequest' }),
      );
    });

    describe('amount caps (422, before any write)', () => {
      const withItem = (quantity: number, estimatedUnitPrice: number): CreateShoppingRequestDto =>
        ({
          ...dto,
          items: [
            {
              ...(dto.items[0] as object),
              substitutionPreference: 'REFUND',
              maxSubstitutePrice: undefined,
              quantity,
              estimatedUnitPrice,
            },
          ],
        }) as unknown as CreateShoppingRequestDto;

      it('rejects a goods budget that would overflow int4 (100 x 100000000)', async () => {
        await expect(service.create('cust-1', withItem(100, 100_000_000))).rejects.toMatchObject({
          status: 422,
        });
        expect(requests.create).not.toHaveBeenCalled();
      });

      it('accepts a budget exactly at the cap and rejects one naira above', async () => {
        // goods 900_000_000 keeps the estimated total (goods + fees) under the cap with zero-rate rules.
        config.getRules.mockResolvedValue({
          ...RULES,
          deliveryFee: 0,
          serviceChargePercent: 0,
          vatPercent: 0,
        });
        await expect(service.create('cust-1', withItem(1, 1_000_000_000))).resolves.toBeDefined();
        await expect(service.create('cust-1', withItem(1, 1_000_000_001))).rejects.toMatchObject({
          status: 422,
        });
      });

      it('rejects when goods are under the cap but the estimated total (with fees) is over it', async () => {
        await expect(service.create('cust-1', withItem(1, 999_999_999))).rejects.toMatchObject({
          status: 422,
        });
        expect(requests.create).not.toHaveBeenCalled();
      });

      it('bounds each line on its own', async () => {
        const body = withItem(1, 1);
        (body.items as unknown[]).push({
          ...(body.items[0] as object),
          quantity: 10_000,
          estimatedUnitPrice: 100_001,
        });
        const error = await service.create('cust-1', body).catch((e) => e);
        expect(error.status).toBe(422);
        expect(JSON.stringify(error.getResponse())).toContain('items[1]');
      });
    });

    it('rejects non-finite amounts (a malformed item that reached the service) with 422', async () => {
      const body = { ...dto, items: [[]] } as unknown as CreateShoppingRequestDto;
      await expect(service.create('cust-1', body)).rejects.toMatchObject({ status: 422 });
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown or inactive location with 400 and writes nothing', async () => {
      reference.findActiveLocationIds.mockResolvedValue([]);
      await expect(service.create('cust-1', dto)).rejects.toMatchObject({ status: 400 });
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown category id', async () => {
      reference.findActiveCategoryIds.mockResolvedValue([]);
      await expect(service.create('cust-1', dto)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('cat-1'),
      });
    });

    it('fails with 500 when the fee configuration row is missing rather than guessing rates', async () => {
      config.getRules.mockRejectedValue(new InternalServerException('missing'));
      await expect(service.create('cust-1', dto)).rejects.toMatchObject({ status: 500 });
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('still succeeds when the audit write fails', async () => {
      audit.log.mockRejectedValue(new Error('db down'));
      await expect(service.create('cust-1', dto)).resolves.toMatchObject({ id: 'req-1' });
    });
  });

  describe('findAll', () => {
    it('pages the customer own requests with an offer count', async () => {
      requests.listForCustomer.mockResolvedValue({
        rows: [{ ...makeRequestRow(), _count: { offers: 3 } }],
        total: 11,
      });
      const result = await service.findAll('cust-1', {
        page: 2,
        limit: 5,
        status: 'OPEN',
      } as never);
      expect(requests.listForCustomer).toHaveBeenCalledWith('cust-1', 5, 5, 'OPEN');
      expect(result.data[0]).toMatchObject({ id: 'req-1', offerCount: 3 });
      expect(result.meta).toMatchObject({ page: 2, limit: 5, total: 11, totalPages: 3 });
    });
  });

  describe('findOne', () => {
    it('404s for a request that is not the caller own', async () => {
      requests.findOwnedById.mockResolvedValue(null);
      await expect(service.findOne('someone-else', 'req-1')).rejects.toMatchObject({ status: 404 });
    });

    it('expires due offers, then returns offers with the breakdown and shopper stats', async () => {
      requests.findOwnedById.mockResolvedValue(makeRequestRow());
      offers.listForRequest.mockResolvedValue([makeOfferWithShopper()]);

      const result = await service.findOne('cust-1', 'req-1');

      expect(offers.expireDue).toHaveBeenCalledWith(expect.any(Date), { requestId: 'req-1' });
      expect(result.offerCount).toBe(1);
      expect(result.offers[0]).toMatchObject({
        id: 'offer-1',
        shopperFee: 1000,
        financials: { customerTotal: 12171, vatOrTax: 221 },
        shopper: {
          id: 'prof-1',
          displayName: 'Amaka O.',
          rating: 4.85,
          completedOrders: 61,
          completionRate: 97.5,
        },
      });
      // The shopper's own earnings are not the customer's business.
      expect(result.offers[0].financials).not.toHaveProperty('shopperGrossEarnings');
      expect(JSON.stringify(result)).not.toContain('userId');
    });
  });

  describe('cancel', () => {
    it('cancels an open request', async () => {
      requests.cancel.mockResolvedValue({
        outcome: 'cancelled',
        request: makeRequestRow({ status: 'CANCELLED' }),
      });
      const result = await service.cancel('cust-1', 'req-1');
      expect(result.status).toBe('CANCELLED');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SHOPPING_REQUEST_CANCELLED' }),
      );
    });

    it('409s with a clear message when the request already has an order (ASSIGNED)', async () => {
      requests.cancel.mockResolvedValue({ outcome: 'not_open', status: 'ASSIGNED' });
      await expect(service.cancel('cust-1', 'req-1')).rejects.toMatchObject({
        status: 409,
        message: 'Only an open request can be cancelled; this one is assigned',
      });
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('409s when the request is no longer open and 404s when it is not the caller own', async () => {
      requests.cancel.mockResolvedValueOnce({ outcome: 'not_open', status: 'CANCELLED' });
      await expect(service.cancel('cust-1', 'req-1')).rejects.toMatchObject({ status: 409 });
      requests.cancel.mockResolvedValueOnce({ outcome: 'not_found' });
      await expect(service.cancel('cust-1', 'req-1')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('requests lazily EXPIRE once nothing on them can be accepted', () => {
    it('findOne expires offers, then the request (scoped to it and the caller), before reading it', async () => {
      requests.findOwnedById.mockResolvedValue(makeRequestRow());
      await service.findOne('cust-1', 'req-1');

      expect(requests.expireElapsed).toHaveBeenCalledWith(
        { customerId: 'cust-1', requestId: 'req-1' },
        expect.any(Date),
      );
      expect(requests.expireElapsed.mock.invocationCallOrder[0]).toBeLessThan(
        requests.findOwnedById.mock.invocationCallOrder[0],
      );
      expect(offers.expireDue.mock.invocationCallOrder[0]).toBeLessThan(
        requests.expireElapsed.mock.invocationCallOrder[0],
      );
    });

    it('findAll expires the caller own requests before listing them', async () => {
      requests.listForCustomer.mockResolvedValue({ rows: [], total: 0 });
      await service.findAll('cust-1', {} as never);
      expect(requests.expireElapsed).toHaveBeenCalledWith(
        { customerId: 'cust-1', requestId: undefined },
        expect.any(Date),
      );
      expect(requests.expireElapsed.mock.invocationCallOrder[0]).toBeLessThan(
        requests.listForCustomer.mock.invocationCallOrder[0],
      );
    });

    it('passes no window: the repository uses the one snapshotted on each request, whatever the live setting', async () => {
      config.getRules.mockResolvedValue({ ...RULES, offerAcceptanceWindowMinutes: 15 });
      requests.listForCustomer.mockResolvedValue({ rows: [], total: 0 });
      await service.findAll('cust-1', {} as never);
      expect(requests.expireElapsed.mock.calls[0]).toHaveLength(2);
    });

    it('shows an EXPIRED request with its biddingClosesAt and each offer expiresAt', async () => {
      const row = makeRequestRow({ status: 'EXPIRED' });
      requests.findOwnedById.mockResolvedValue(row);
      offers.listForRequest.mockResolvedValue([makeOfferWithShopper()]);
      const result = await service.findOne('cust-1', 'req-1');
      expect(result.status).toBe('EXPIRED');
      expect(result.biddingClosesAt).toBe(row.offerDeadline.toISOString());
      expect(result.offerDeadline).toBe(result.biddingClosesAt);
      expect(result.offers[0].expiresAt).toEqual(expect.any(String));
    });

    it('cancelling an EXPIRED request is the existing conflict', async () => {
      requests.cancel.mockResolvedValue({ outcome: 'not_open', status: 'EXPIRED' });
      await expect(service.cancel('cust-1', 'req-1')).rejects.toMatchObject({
        status: 409,
        message: 'Only an open request can be cancelled; this one is expired',
      });
    });
  });
});
