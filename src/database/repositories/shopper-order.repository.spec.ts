import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ShopperOrderRepository } from './shopper-order.repository';
import { orderStatesFor } from './interfaces';

const FINANCIALS = { shopperFee: 1000, customerTotal: 12171 };
const FUTURE = new Date(Date.now() + 60_000);

const makeTx = (
  over: {
    offerState?: string;
    expiresAt?: Date;
    locked?: unknown[];
    profileState?: string;
    existingOrder?: unknown;
  } = {},
) => {
  const tx = {
    // The request row lock, or the shopper profile lock, told apart by their SQL.
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
      strings.join('?').includes('shopping_requests')
        ? (over.locked ?? [{ status: 'OPEN' }])
        : [{ account_state: over.profileState ?? 'APPROVED' }],
    ),
    shoppingOffer: {
      findFirst: jest.fn(async () => ({
        id: 'offer-1',
        state: over.offerState ?? 'PENDING',
        expiresAt: over.expiresAt ?? FUTURE,
        shopperProfileId: 'prof-1',
        financials: FINANCIALS,
        shopperProfile: { userId: 'winner-user' },
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => [{ id: 'offer-2', shopperProfile: { userId: 'loser-user' } }]),
      findUniqueOrThrow: jest.fn(async () => ({ state: 'WITHDRAWN' })),
    },
    shoppingRequest: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'req-1',
        reference: 'SR-ABC23456',
        shoppingLocationId: 'loc-1',
        handoffArea: 'Lekki',
        items: [
          {
            id: 'item-1',
            position: 0,
            name: 'Milk',
            brand: 'Peak',
            size: '400g',
            quantity: 2,
            unit: 'tin',
            notes: null,
            substitutionPreference: 'REFUND',
            maxSubstitutePrice: null,
            estimatedUnitPrice: 4500,
          },
        ],
      })),
    },
    shopperOrder: {
      create: jest.fn(async () => ({ id: 'order-1' })),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'order-1' })),
    },
    orderEvent: { create: jest.fn() },
  };
  (tx.shopperOrder as Record<string, jest.Mock>).findFirst = jest.fn(
    async () => over.existingOrder ?? null,
  );
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { tx, repo: new ShopperOrderRepository(prisma as unknown as PrismaService) };
};

const input = { requestId: 'req-1', offerId: 'offer-1', customerId: 'cust-1' };

describe('ShopperOrderRepository.acceptOffer', () => {
  it('locks the request row FOR UPDATE before reading or writing anything else', async () => {
    const { tx, repo } = makeTx();
    await repo.acceptOffer(input);

    const sql = (tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('?');
    expect(sql).toContain('FOR UPDATE');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.shoppingOffer.findFirst.mock.invocationCallOrder[0],
    );
  });

  it('accepts the offer, rejects the rest, assigns the request, and creates the order from the offer', async () => {
    const { tx, repo } = makeTx();
    const result = await repo.acceptOffer(input);

    expect(tx.shoppingOffer.updateMany).toHaveBeenCalledWith({
      where: { id: 'offer-1', state: 'PENDING' },
      data: { state: 'ACCEPTED' },
    });
    expect(tx.shoppingOffer.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['offer-2'] }, state: 'PENDING' },
      data: { state: 'REJECTED' },
    });
    expect(tx.shoppingRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'OPEN' },
      data: { status: 'ASSIGNED' },
    });
    const data = (tx.shopperOrder.create.mock.calls[0] as unknown[])[0] as {
      data: Record<string, any>;
    };
    expect(data.data).toMatchObject({
      requestId: 'req-1',
      offerId: 'offer-1',
      customerId: 'cust-1',
      shopperProfileId: 'prof-1',
      financials: FINANCIALS, // copied, never recomputed
    });
    expect(data.data.reference).toMatch(/^SO-[A-HJ-NP-Z2-9]{8}$/);
    expect(data.data.items.create[0]).toMatchObject({
      name: 'Milk',
      quantity: 2,
      customerEstimatedPrice: 4500,
      requestItemId: 'item-1',
    });
    expect(data.data.items.create[0]).not.toHaveProperty('actualPurchasePrice');
    expect(data.data.events.create).toMatchObject({ type: 'OFFER_ACCEPTED', actorId: 'cust-1' });
    expect(result).toMatchObject({
      outcome: 'accepted',
      winnerUserId: 'winner-user',
      rejected: [{ offerId: 'offer-2', userId: 'loser-user' }],
    });
  });

  it.each([
    [
      'a missing request, or one that is not the caller own (the lock query filters on the owner)',
      { locked: [] },
    ],
  ])('reads %s as not_found and writes nothing', async (_l, over) => {
    const { tx, repo } = makeTx(over);
    expect(await repo.acceptOffer(input)).toEqual({ outcome: 'not_found' });
    expect(tx.shopperOrder.create).not.toHaveBeenCalled();
    expect(tx.shoppingOffer.updateMany).not.toHaveBeenCalled();
  });

  it.each(['ASSIGNED', 'CANCELLED', 'EXPIRED'])('refuses a %s request', async (status) => {
    const { tx, repo } = makeTx({ locked: [{ status }] });
    expect(await repo.acceptOffer(input)).toEqual({ outcome: 'request_not_open', status });
    expect(tx.shopperOrder.create).not.toHaveBeenCalled();
  });

  it('refuses an offer that is not PENDING', async () => {
    const { tx, repo } = makeTx({ offerState: 'WITHDRAWN' });
    expect(await repo.acceptOffer(input)).toEqual({
      outcome: 'offer_not_pending',
      state: 'WITHDRAWN',
    });
    expect(tx.shopperOrder.create).not.toHaveBeenCalled();
  });

  it('judges expiry by the clock read after the lock query', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-25T10:00:00Z') });
    try {
      const { tx, repo } = makeTx({ expiresAt: new Date('2026-11-25T10:00:01Z') });
      tx.$queryRaw.mockImplementation(async () => {
        jest.setSystemTime(new Date('2026-11-25T10:00:05Z')); // the lock wait outlasts the deadline
        return [{ status: 'OPEN' }];
      });
      expect(await repo.acceptOffer(input)).toEqual({ outcome: 'offer_expired' });
      expect(tx.shopperOrder.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a withdraw that won the race as offer_not_pending, before any other write', async () => {
    const { tx, repo } = makeTx();
    tx.shoppingOffer.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await repo.acceptOffer(input)).toEqual({
      outcome: 'offer_not_pending',
      state: 'WITHDRAWN',
    });
    expect(tx.shoppingRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.shopperOrder.create).not.toHaveBeenCalled();
  });

  it('retries the whole transaction on an order reference collision', async () => {
    const { tx, repo } = makeTx();
    tx.shopperOrder.create
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: ['reference'] },
        }),
      )
      .mockResolvedValueOnce({ id: 'order-1' });
    expect((await repo.acceptOffer(input)).outcome).toBe('accepted');
    expect(tx.shopperOrder.create).toHaveBeenCalledTimes(2);
  });
});

describe('ShopperOrderRepository.acceptOffer: owner-scoped lock, shopper availability, retries', () => {
  it('locks only the CALLER own request row: the lock query filters on the owner', async () => {
    const { tx, repo } = makeTx();
    await repo.acceptOffer(input);
    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join('?');
    expect(sql).toMatch(/WHERE id = \? AND customer_id = \?\s+FOR UPDATE/);
    expect(values).toEqual(['req-1', 'cust-1']);
  });

  it.each(['SUSPENDED', 'DEACTIVATED', 'VERIFICATION_PENDING'])(
    'refuses an offer whose shopper is %s, changing nothing',
    async (profileState) => {
      const { tx, repo } = makeTx({ profileState });
      expect(await repo.acceptOffer(input)).toEqual({ outcome: 'shopper_unavailable' });
      expect(tx.shoppingOffer.updateMany).not.toHaveBeenCalled();
      expect(tx.shoppingRequest.updateMany).not.toHaveBeenCalled();
      expect(tx.shopperOrder.create).not.toHaveBeenCalled();
    },
  );

  it('locks the shopper profile row FOR SHARE so a suspension cannot slip in before commit', async () => {
    const { tx, repo } = makeTx();
    await repo.acceptOffer(input);
    const sql = (tx.$queryRaw.mock.calls[1] as unknown as [TemplateStringsArray])[0].join('?');
    expect(sql).toContain('shopper_profiles');
    expect(sql).toContain('FOR SHARE');
  });

  it('returns the existing order when the same offer is accepted again on an ASSIGNED request', async () => {
    const existing = { id: 'order-1', offerId: 'offer-1' };
    const { tx, repo } = makeTx({ locked: [{ status: 'ASSIGNED' }], existingOrder: existing });
    expect(await repo.acceptOffer(input)).toEqual({ outcome: 'already_accepted', order: existing });
    expect(tx.shopperOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId: 'req-1', offerId: 'offer-1', customerId: 'cust-1' },
      }),
    );
    expect(tx.shopperOrder.create).not.toHaveBeenCalled();
  });

  it('still refuses a different offer on an ASSIGNED request', async () => {
    const { repo } = makeTx({ locked: [{ status: 'ASSIGNED' }], existingOrder: null });
    expect(await repo.acceptOffer(input)).toEqual({
      outcome: 'request_not_open',
      status: 'ASSIGNED',
    });
  });
});

describe('ShopperOrderRepository.transition', () => {
  const step = {
    id: 'order-1',
    shopperProfileId: 'prof-1',
    actorId: 'user-1',
    from: 'ASSIGNED' as const,
    to: 'SHOPPER_ACCEPTED' as const,
    eventType: 'SHOPPER_ACCEPTED',
    stamp: 'shopperAcceptedAt' as const,
  };

  it('puts the from-state and the owner in the UPDATE itself and records the event only when it won', async () => {
    const { tx, repo } = makeTx();
    tx.shopperOrder.updateMany.mockResolvedValue({ count: 1 });
    const result = await repo.transition(step);

    expect(tx.shopperOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', shopperProfileId: 'prof-1', state: 'ASSIGNED' },
      data: { state: 'SHOPPER_ACCEPTED', shopperAcceptedAt: expect.any(Date) },
    });
    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        type: 'SHOPPER_ACCEPTED',
        actorId: 'user-1',
        actorRole: 'PERSONAL_SHOPPER',
      }),
    });
    expect(result.outcome).toBe('transitioned');
  });

  it('writes no event and reports the current state when it lost, or not_found for another shopper', async () => {
    const { tx, repo } = makeTx();
    tx.shopperOrder.updateMany.mockResolvedValue({ count: 0 });
    tx.shopperOrder.findFirst
      .mockResolvedValueOnce({ state: 'SHOPPER_ACCEPTED' })
      .mockResolvedValueOnce(null);

    expect(await repo.transition(step)).toEqual({ outcome: 'conflict', state: 'SHOPPER_ACCEPTED' });
    expect(await repo.transition(step)).toEqual({ outcome: 'not_found' });
    expect(tx.orderEvent.create).not.toHaveBeenCalled();
  });
});

describe('orderStatesFor', () => {
  it('maps the list filters onto order states', () => {
    expect(orderStatesFor('completed')).toBe('COMPLETED');
    expect(orderStatesFor('cancelled')).toBe('CANCELLED');
    expect(orderStatesFor('active')).toEqual({ notIn: ['COMPLETED', 'CANCELLED'] });
  });
});
