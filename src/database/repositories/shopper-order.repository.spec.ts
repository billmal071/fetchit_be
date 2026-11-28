import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ShopperOrderRepository } from './shopper-order.repository';
import { orderStatesFor } from './interfaces';

const FINANCIALS = { shopperFee: 1000, customerTotal: 12171 };

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
        // Computed per call, so a slow run can never push the default past its expiry.
        expiresAt: over.expiresAt ?? new Date(Date.now() + 60_000),
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
        where: {
          requestId: 'req-1',
          offerId: 'offer-1',
          customerId: 'cust-1',
          state: { not: 'CANCELLED' },
        },
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

describe('ShopperOrderRepository.acceptOffer: locks before judgements, honest rejected list', () => {
  it('judges the deadline after the PROFILE lock wait too: an offer that expires while waiting is refused', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-25T10:00:00Z') });
    try {
      const { tx, repo } = makeTx({ expiresAt: new Date('2026-11-25T10:00:01Z') });
      tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        if (strings.join('?').includes('shopper_profiles')) {
          jest.setSystemTime(new Date('2026-11-25T10:00:05Z')); // the wait for the profile lock outlasts the deadline
          return [{ account_state: 'APPROVED' }];
        }
        return [{ status: 'OPEN' }];
      });
      expect(await repo.acceptOffer(input)).toEqual({ outcome: 'offer_expired' });
      expect(tx.shoppingOffer.updateMany).not.toHaveBeenCalled();
      expect(tx.shopperOrder.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('takes the request lock, then the profile lock, before any state is written', async () => {
    const { tx, repo } = makeTx();
    await repo.acceptOffer(input);
    const sqls = tx.$queryRaw.mock.calls.map((c) =>
      (c[0] as unknown as TemplateStringsArray).join('?'),
    );
    expect(sqls[0]).toContain('shopping_requests');
    expect(sqls[1]).toContain('shopper_profiles');
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.shoppingOffer.updateMany.mock.invocationCallOrder[0],
    );
  });

  it('does not report as rejected a bidder who withdrew between the read and the update', async () => {
    const { tx, repo } = makeTx();
    tx.shoppingOffer.findMany
      .mockResolvedValueOnce([
        { id: 'offer-2', shopperProfile: { userId: 'stays-pending-then-rejected' } },
        { id: 'offer-3', shopperProfile: { userId: 'withdrew-meanwhile' } },
      ])
      // The re-read inside the same transaction: offer-3 is WITHDRAWN, not REJECTED.
      .mockResolvedValueOnce([{ id: 'offer-2' }] as never);

    const result = await repo.acceptOffer(input);

    expect(tx.shoppingOffer.findMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['offer-2', 'offer-3'] }, state: 'REJECTED' },
      select: { id: true },
    });
    expect(result).toMatchObject({
      outcome: 'accepted',
      rejected: [{ offerId: 'offer-2', userId: 'stays-pending-then-rejected' }],
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

  it.each(['SUSPENDED', 'DEACTIVATED', 'VERIFICATION_PENDING'])(
    'refuses a shopper who became %s after the caller checked, writing nothing',
    async (profileState) => {
      const { tx, repo } = makeTx({ profileState });
      expect(await repo.transition(step)).toEqual({ outcome: 'shopper_unavailable' });
      expect(tx.shopperOrder.updateMany).not.toHaveBeenCalled();
      expect(tx.orderEvent.create).not.toHaveBeenCalled();
    },
  );

  it('locks the profile FOR SHARE before the order UPDATE', async () => {
    const { tx, repo } = makeTx();
    tx.shopperOrder.updateMany.mockResolvedValue({ count: 1 });
    await repo.transition(step);
    const sql = (tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('?');
    expect(sql).toContain('shopper_profiles');
    expect(sql).toContain('FOR SHARE');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.shopperOrder.updateMany.mock.invocationCallOrder[0],
    );
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

describe('ShopperOrderRepository.expireStale: what it hands to cancelOrder, and surviving a failure', () => {
  const NOW_ = new Date('2026-11-25T10:00:00Z');
  const REOPEN = new Date('2026-11-25T11:00:00Z');
  const makeRepo = (ids: string[]) => {
    const prisma = { shopperOrder: { findMany: jest.fn(async () => ids.map((id) => ({ id }))) } };
    const repo = new ShopperOrderRepository(prisma as unknown as PrismaService);
    return { repo, prisma, cancelOrder: jest.spyOn(repo, 'cancelOrder') };
  };
  const done = (id: string) =>
    ({
      outcome: 'cancelled',
      order: { id },
      shopperUserId: `shopper-of-${id}`,
      requestReference: 'SR-1',
      cancelledBy: 'SYSTEM',
    }) as never;

  it('cancels every stale order as the SYSTEM, with the cutoff and the reopen deadline', async () => {
    const { repo, cancelOrder } = makeRepo(['order-1', 'order-2']);
    cancelOrder.mockImplementation(async (input) => done(input.orderId));

    await repo.expireStale({ customerId: 'cust-1' }, NOW_, REOPEN);

    expect(cancelOrder.mock.calls.map((c) => c[0])).toEqual([
      {
        orderId: 'order-1',
        actor: { kind: 'SYSTEM' },
        assignedBefore: NOW_,
        reopenDeadline: REOPEN,
      },
      {
        orderId: 'order-2',
        actor: { kind: 'SYSTEM' },
        assignedBefore: NOW_,
        reopenDeadline: REOPEN,
      },
    ]);
  });

  it('keeps the cancellations that committed when a later one throws, logs it, and carries on', async () => {
    const { repo, cancelOrder } = makeRepo(['order-1', 'order-2', 'order-3']);
    cancelOrder.mockImplementation(async (input) => {
      if (input.orderId === 'order-2') throw new Error('deadlock detected');
      return done(input.orderId);
    });
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const result = await repo.expireStale({}, NOW_, REOPEN);

      expect(result.map((c) => c.order.id)).toEqual(['order-1', 'order-3']);
      expect(cancelOrder).toHaveBeenCalledTimes(3);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0][0])).toContain('order-2');
      expect(String(logged.mock.calls[0][0])).toContain('deadlock detected');
    } finally {
      logged.mockRestore();
    }
  });

  it('a failing order is not lost: the next sweep selects it again, since it is still ASSIGNED', async () => {
    const { repo, prisma, cancelOrder } = makeRepo(['order-2']);
    cancelOrder
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation(async (i) => done(i.orderId));
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      expect(await repo.expireStale({}, NOW_, REOPEN)).toEqual([]);
      expect((await repo.expireStale({}, NOW_, REOPEN)).map((c) => c.order.id)).toEqual([
        'order-2',
      ]);
      expect(prisma.shopperOrder.findMany).toHaveBeenCalledTimes(2);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('ShopperOrderRepository.cancelOrder: the SYSTEM cutoff is mandatory', () => {
  const REOPEN = new Date('2026-11-25T11:00:00Z');

  it('throws before opening a transaction when a SYSTEM cancel has no cutoff', async () => {
    const { tx, repo } = makeTx();
    const prisma = (repo as unknown as { prisma: { $transaction: jest.Mock } }).prisma;
    await expect(
      repo.cancelOrder({
        orderId: 'order-1',
        actor: { kind: 'SYSTEM' },
        reopenDeadline: REOPEN,
      } as never),
    ).rejects.toThrow('assignedBefore');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.shopperOrder.updateMany).not.toHaveBeenCalled();
  });

  it('does not accept a SYSTEM cancel without a cutoff at compile time', () => {
    const { repo } = makeTx();
    const attempt = (): Promise<unknown> =>
      // @ts-expect-error assignedBefore is required for the SYSTEM actor
      repo.cancelOrder({ orderId: 'o', actor: { kind: 'SYSTEM' }, reopenDeadline: REOPEN });
    expect(attempt).toBeDefined();
  });

  it('keeps the customer cancel independent of any cutoff', async () => {
    const { tx, repo } = makeTx();
    tx.$queryRaw.mockResolvedValue([{ id: 'req-1' }] as never);
    tx.shopperOrder.updateMany.mockResolvedValue({ count: 0 });
    (tx as Record<string, any>).shopperOrder.findUnique = jest
      .fn()
      .mockResolvedValue({ requestId: 'req-1', customerId: 'cust-1' });
    const result = await repo.cancelOrder({
      orderId: 'order-1',
      actor: { kind: 'CUSTOMER', userId: 'cust-1' },
      reopenDeadline: REOPEN,
    });
    expect(result.outcome).not.toBe('not_stale');
    expect(tx.shopperOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1', state: 'ASSIGNED' } }),
    );
  });
});

describe('ShopperOrderRepository.transition: the accept window is re-checked after the locks', () => {
  const T = new Date('2026-11-25T10:00:00Z');
  const step = {
    id: 'order-1',
    shopperProfileId: 'prof-1',
    actorId: 'user-1',
    from: 'ASSIGNED' as const,
    to: 'SHOPPER_ACCEPTED' as const,
    eventType: 'SHOPPER_ACCEPTED',
    stamp: 'shopperAcceptedAt' as const,
  };

  it('puts the cutoff, from a clock read AFTER the profile lock, into the UPDATE', async () => {
    jest.useFakeTimers({ now: T });
    try {
      const { tx, repo } = makeTx();
      tx.$queryRaw.mockImplementation(async () => {
        jest.setSystemTime(new Date('2026-11-25T10:05:00Z')); // the lock wait took five minutes
        return [{ account_state: 'APPROVED' }];
      });
      tx.shopperOrder.updateMany.mockResolvedValue({ count: 1 });
      await repo.transition({ ...step, acceptWindowMinutes: 30 });

      expect(tx.shopperOrder.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'order-1',
          shopperProfileId: 'prof-1',
          state: 'ASSIGNED',
          createdAt: { gte: new Date('2026-11-25T09:35:00Z') }, // 10:05 - 30 min
        },
        data: { state: 'SHOPPER_ACCEPTED', shopperAcceptedAt: new Date('2026-11-25T10:05:00Z') },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports accept_expired, writing nothing, when the order is still ASSIGNED but past the window', async () => {
    const { tx, repo } = makeTx();
    tx.shopperOrder.updateMany.mockResolvedValue({ count: 0 });
    tx.shopperOrder.findFirst.mockResolvedValue({ state: 'ASSIGNED', cancelledBy: null });

    const result = await repo.transition({ ...step, acceptWindowMinutes: 30 });
    expect(result.outcome).toBe('accept_expired');
    // It hands back the very cutoff it judged by, so the follow-up cancel cannot disagree.
    const where = tx.shopperOrder.updateMany.mock.calls[0][0].where as {
      createdAt: { gte: Date };
    };
    expect(result).toEqual({ outcome: 'accept_expired', assignedBefore: where.createdAt.gte });
    expect(tx.orderEvent.create).not.toHaveBeenCalled();
  });

  it('still reports an ordinary conflict for any other state', async () => {
    const { tx, repo } = makeTx();
    tx.shopperOrder.updateMany.mockResolvedValue({ count: 0 });
    tx.shopperOrder.findFirst.mockResolvedValue({ state: 'SHOPPER_ACCEPTED', cancelledBy: null });
    expect(await repo.transition({ ...step, acceptWindowMinutes: 30 })).toEqual({
      outcome: 'conflict',
      state: 'SHOPPER_ACCEPTED',
      cancelledBy: null,
    });
  });

  it('applies no deadline to the start-shopping step, or when no window is given', async () => {
    const { tx, repo } = makeTx();
    tx.shopperOrder.updateMany.mockResolvedValue({ count: 1 });
    await repo.transition({
      ...step,
      from: 'SHOPPER_ACCEPTED',
      to: 'SHOPPING_STARTED',
      eventType: 'SHOPPING_STARTED',
      stamp: 'shoppingStartedAt',
    });
    expect(tx.shopperOrder.updateMany.mock.calls[0][0].where).toEqual({
      id: 'order-1',
      shopperProfileId: 'prof-1',
      state: 'SHOPPER_ACCEPTED',
    });
  });
});

describe('orderStatesFor', () => {
  it('maps the list filters onto order states', () => {
    expect(orderStatesFor('completed')).toBe('COMPLETED');
    expect(orderStatesFor('cancelled')).toBe('CANCELLED');
    expect(orderStatesFor('active')).toEqual({ notIn: ['COMPLETED', 'CANCELLED'] });
  });
});

describe('ShopperOrderRepository.cancelOrder / expireStale', () => {
  const NOW_ = new Date('2026-11-25T10:00:00Z');
  const REOPEN = new Date('2026-11-25T11:00:00Z');
  const customer = { kind: 'CUSTOMER' as const, userId: 'cust-1' };

  const makeCancelTx = (
    over: { head?: unknown; lock?: unknown[]; updated?: number; current?: unknown } = {},
  ) => {
    const cancelled = {
      id: 'order-1',
      reference: 'SO-ABC23456',
      requestId: 'req-1',
      offerId: 'offer-1',
      shopperProfileId: 'prof-1',
      state: 'CANCELLED',
      request: { reference: 'SR-ABC23456' },
    };
    const tx = {
      $queryRaw: jest.fn(async () => over.lock ?? [{ id: 'req-1' }]),
      shopperOrder: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(
            over.head === undefined ? { requestId: 'req-1', customerId: 'cust-1' } : over.head,
          )
          .mockResolvedValue(
            over.current === undefined ? { ...cancelled, state: 'SHOPPER_ACCEPTED' } : over.current,
          ),
        findUniqueOrThrow: jest.fn(async () => cancelled),
        updateMany: jest.fn(async () => ({ count: over.updated ?? 1 })),
        findMany: jest.fn(async () => [{ id: 'order-1' }, { id: 'order-2' }]),
      },
      shoppingOffer: { updateMany: jest.fn() },
      shoppingRequest: { updateMany: jest.fn() },
      shopperProfile: { findUniqueOrThrow: jest.fn(async () => ({ userId: 'shopper-user' })) },
      orderEvent: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      shopperOrder: tx.shopperOrder,
    };
    return { tx, repo: new ShopperOrderRepository(prisma as unknown as PrismaService) };
  };
  const cancel = (repo: ShopperOrderRepository, over: object = {}) =>
    repo.cancelOrder({ orderId: 'order-1', actor: customer, reopenDeadline: REOPEN, ...over });

  it('locks the request with the OWNER filter for a customer, and without it for the system', async () => {
    const a = makeCancelTx();
    await cancel(a.repo);
    const [customerSql, ...customerValues] = a.tx.$queryRaw.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(customerSql.join('?')).toMatch(/WHERE id = \? AND customer_id = \?\s+FOR UPDATE/);
    expect(customerValues).toEqual(['req-1', 'cust-1']);

    const b = makeCancelTx();
    await b.repo.cancelOrder({
      orderId: 'order-1',
      actor: { kind: 'SYSTEM' },
      assignedBefore: NOW_,
      reopenDeadline: REOPEN,
    });
    const [systemSql] = b.tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray];
    expect(systemSql.join('?')).not.toContain('customer_id');
    expect(systemSql.join('?')).toContain('FOR UPDATE');
  });

  it('takes no lock at all for a missing order or someone else order', async () => {
    const missing = makeCancelTx({ head: null });
    expect(await cancel(missing.repo)).toEqual({ outcome: 'not_found' });
    const other = makeCancelTx({ head: { requestId: 'req-1', customerId: 'someone-else' } });
    expect(await cancel(other.repo)).toEqual({ outcome: 'not_found' });
    expect(missing.tx.$queryRaw).not.toHaveBeenCalled();
    expect(other.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('puts state = ASSIGNED in the UPDATE, and for the system also the staleness test', async () => {
    const a = makeCancelTx();
    await cancel(a.repo, { reason: 'changed my mind' });
    expect(a.tx.shopperOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', state: 'ASSIGNED' },
      data: {
        state: 'CANCELLED',
        cancelledAt: expect.any(Date),
        cancelledBy: 'CUSTOMER',
        cancelReason: 'changed my mind',
      },
    });
    const b = makeCancelTx();
    await b.repo.cancelOrder({
      orderId: 'order-1',
      actor: { kind: 'SYSTEM' },
      assignedBefore: NOW_,
      reopenDeadline: REOPEN,
    });
    expect(b.tx.shopperOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', state: 'ASSIGNED', createdAt: { lt: NOW_ } },
      data: expect.objectContaining({
        cancelledBy: 'SYSTEM',
        cancelReason: 'Shopper did not accept in time',
      }),
    });
  });

  it('on a customer cancel: offer REJECTED, request reopened with the new deadline, event with the reason', async () => {
    const { tx, repo } = makeCancelTx();
    const result = await cancel(repo, { reason: 'changed my mind' });

    expect(tx.shoppingOffer.updateMany).toHaveBeenCalledWith({
      where: { id: 'offer-1', state: 'ACCEPTED' },
      data: { state: 'REJECTED' },
    });
    expect(tx.shoppingRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'ASSIGNED' },
      data: { status: 'OPEN', offerDeadline: REOPEN },
    });
    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        type: 'ORDER_CANCELLED',
        actorId: 'cust-1',
        actorRole: 'CUSTOMER',
        metadata: { cancelledBy: 'CUSTOMER', reason: 'changed my mind' },
      },
    });
    expect(result).toMatchObject({
      outcome: 'cancelled',
      cancelledBy: 'CUSTOMER',
      shopperUserId: 'shopper-user',
      requestReference: 'SR-ABC23456',
    });
  });

  it('on a timeout: offer EXPIRED and an actorless SYSTEM event', async () => {
    const { tx, repo } = makeCancelTx();
    await repo.cancelOrder({
      orderId: 'order-1',
      actor: { kind: 'SYSTEM' },
      assignedBefore: NOW_,
      reopenDeadline: REOPEN,
    });
    expect(tx.shoppingOffer.updateMany).toHaveBeenCalledWith({
      where: { id: 'offer-1', state: 'ACCEPTED' },
      data: { state: 'EXPIRED' },
    });
    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: null,
        actorRole: 'SYSTEM',
        metadata: { cancelledBy: 'SYSTEM', reason: 'Shopper did not accept in time' },
      }),
    });
  });

  it('writes nothing more when it lost: conflict, already_cancelled, and not_stale', async () => {
    const accepted = makeCancelTx({ updated: 0 });
    expect(await cancel(accepted.repo)).toEqual({ outcome: 'conflict', state: 'SHOPPER_ACCEPTED' });
    const done = makeCancelTx({ updated: 0, current: { id: 'order-1', state: 'CANCELLED' } });
    expect(await cancel(done.repo)).toMatchObject({ outcome: 'already_cancelled' });
    const bySystem = makeCancelTx({
      updated: 0,
      current: { id: 'order-1', state: 'CANCELLED', cancelledBy: 'CUSTOMER' },
    });
    expect(
      await bySystem.repo.cancelOrder({
        orderId: 'order-1',
        actor: { kind: 'SYSTEM' },
        assignedBefore: NOW_,
        reopenDeadline: REOPEN,
      }),
    ).toMatchObject({ outcome: 'already_cancelled', order: { cancelledBy: 'CUSTOMER' } });
    const fresh = makeCancelTx({ updated: 0, current: { id: 'order-1', state: 'ASSIGNED' } });
    expect(
      await fresh.repo.cancelOrder({
        orderId: 'order-1',
        actor: { kind: 'SYSTEM' },
        assignedBefore: NOW_,
        reopenDeadline: REOPEN,
      }),
    ).toEqual({ outcome: 'not_stale' });
    for (const t of [accepted.tx, done.tx, bySystem.tx, fresh.tx]) {
      expect(t.shoppingOffer.updateMany).not.toHaveBeenCalled();
      expect(t.shoppingRequest.updateMany).not.toHaveBeenCalled();
      expect(t.orderEvent.create).not.toHaveBeenCalled();
    }
  });

  it('expireStale selects stale ASSIGNED orders in scope and cancels each as the system', async () => {
    const { tx, repo } = makeCancelTx();
    tx.shopperOrder.findUnique.mockResolvedValue({ requestId: 'req-1', customerId: 'cust-1' });
    const result = await repo.expireStale({ customerId: 'cust-1' }, NOW_, REOPEN);

    expect(tx.shopperOrder.findMany).toHaveBeenCalledWith({
      where: { state: 'ASSIGNED', createdAt: { lt: NOW_ }, customerId: 'cust-1' },
      select: { id: true },
    });
    expect(result).toHaveLength(2);
    expect(tx.shopperOrder.updateMany).toHaveBeenCalledTimes(2);
  });
});
