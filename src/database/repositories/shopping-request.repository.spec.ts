import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ShoppingOfferRepository } from './shopping-offer.repository';
import { ShoppingRequestRepository, generateReference } from './shopping-request.repository';
import {
  DuplicateActiveOfferError,
  OfferRequestClosedError,
  shopperCoverageWhere,
  shopperMatchWhere,
} from './interfaces';

const NOW = new Date('2026-11-24T10:00:00.000Z');

describe('shopperMatchWhere (the matching rule)', () => {
  const where = shopperMatchWhere('prof-1', NOW);

  it('only offers OPEN requests whose offer window is still running', () => {
    expect(where.status).toBe('OPEN');
    expect(where.offerDeadline).toEqual({ gt: NOW });
  });

  it('requires a market the shopper covers', () => {
    expect(where.shoppingLocation).toEqual({
      shopperProfiles: { some: { shopperProfileId: 'prof-1' } },
    });
  });

  it('requires one item in a covered category, or no categorised item at all', () => {
    expect(where.OR).toEqual([
      {
        items: {
          some: { category: { shopperProfiles: { some: { shopperProfileId: 'prof-1' } } } },
        },
      },
      { items: { none: { categoryId: { not: null } } } },
    ]);
  });

  it('coverage alone has no status or deadline condition', () => {
    const coverage = shopperCoverageWhere('prof-1');
    expect(coverage).not.toHaveProperty('status');
    expect(coverage).not.toHaveProperty('offerDeadline');
    expect(coverage.shoppingLocation).toEqual(where.shoppingLocation);
  });
});

describe('ShoppingRequestRepository', () => {
  const makePrisma = () => {
    const tx = {
      shoppingRequest: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      shoppingOffer: { updateMany: jest.fn() },
    };
    return { ...tx, $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  };

  const feedQuery = {
    shopperProfileId: 'prof-1',
    now: NOW,
    sortBy: 'createdAt' as const,
    sortOrder: 'desc' as const,
    skip: 10,
    take: 5,
  };

  it('feeds findMany and count the same matching where, with a stable order and paging', async () => {
    const prisma = makePrisma();
    const repo = new ShoppingRequestRepository(prisma as unknown as PrismaService);

    await repo.findMatchingForShopper({ ...feedQuery, locationId: 'loc-1', categoryId: 'cat-1' });

    const findArgs = (prisma.shoppingRequest.findMany.mock.calls[0] as unknown[])[0] as {
      where: { AND: unknown[] };
      orderBy: unknown;
      skip: number;
      take: number;
    };
    expect(findArgs.where.AND).toEqual([
      shopperMatchWhere('prof-1', NOW),
      { shoppingLocationId: 'loc-1' },
      { items: { some: { categoryId: 'cat-1' } } },
    ]);
    expect(findArgs.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    expect(findArgs).toMatchObject({ skip: 10, take: 5 });
    expect(prisma.shoppingRequest.count).toHaveBeenCalledWith({ where: findArgs.where });
  });

  it('adds no filter clauses when none are given', async () => {
    const prisma = makePrisma();
    await new ShoppingRequestRepository(prisma as unknown as PrismaService).findMatchingForShopper(
      feedQuery,
    );
    const { where } = (prisma.shoppingRequest.findMany.mock.calls[0] as unknown[])[0] as {
      where: { AND: unknown[] };
    };
    expect(where.AND).toEqual([shopperMatchWhere('prof-1', NOW)]);
  });

  it('findReadableByShopper also allows any request the shopper has bid on', async () => {
    const prisma = makePrisma();
    await new ShoppingRequestRepository(prisma as unknown as PrismaService).findReadableByShopper(
      'req-1',
      'prof-1',
      NOW,
    );
    expect(prisma.shoppingRequest.findFirst.mock.calls[0]).toMatchObject([
      {
        where: {
          id: 'req-1',
          OR: [
            shopperMatchWhere('prof-1', NOW),
            { offers: { some: { shopperProfileId: 'prof-1' } } },
          ],
        },
      },
    ]);
  });

  it('counts only PENDING offers that have not expired when listing for a customer', async () => {
    const prisma = makePrisma();
    await new ShoppingRequestRepository(prisma as unknown as PrismaService).listForCustomer(
      'cust-1',
      0,
      10,
      undefined,
      NOW,
    );
    const args = (prisma.shoppingRequest.findMany.mock.calls[0] as unknown[])[0] as {
      include: { _count: unknown };
    };
    expect(args.include._count).toEqual({
      select: { offers: { where: { state: 'PENDING', expiresAt: { gt: NOW } } } },
    });
  });

  describe('cancel', () => {
    it('makes the OPEN check part of the UPDATE and expires pending offers only when it won', async () => {
      const prisma = makePrisma();
      prisma.shoppingRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.shoppingRequest.findUniqueOrThrow.mockResolvedValue({ id: 'req-1' });
      const repo = new ShoppingRequestRepository(prisma as unknown as PrismaService);

      const result = await repo.cancel('req-1', 'cust-1', NOW);

      expect(prisma.shoppingRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', customerId: 'cust-1', status: 'OPEN' },
        data: { status: 'CANCELLED', cancelledAt: NOW },
      });
      expect(prisma.shoppingOffer.updateMany).toHaveBeenCalledWith({
        where: { requestId: 'req-1', state: 'PENDING' },
        data: { state: 'EXPIRED' },
      });
      expect(result.outcome).toBe('cancelled');
    });

    it('touches no offers when it lost, and says why', async () => {
      const prisma = makePrisma();
      prisma.shoppingRequest.updateMany.mockResolvedValue({ count: 0 });
      prisma.shoppingRequest.findFirst
        .mockResolvedValueOnce({ status: 'CANCELLED' })
        .mockResolvedValueOnce(null);
      const repo = new ShoppingRequestRepository(prisma as unknown as PrismaService);

      expect(await repo.cancel('req-1', 'cust-1', NOW)).toEqual({
        outcome: 'not_open',
        status: 'CANCELLED',
      });
      expect(await repo.cancel('req-1', 'cust-1', NOW)).toEqual({ outcome: 'not_found' });
      expect(prisma.shoppingOffer.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const input = {
      customerId: 'c',
      shoppingLocationId: 'l',
      deliveryAddress: 'a',
      estimatedGoodsBudget: 1,
      estimate: {},
      offerDeadline: NOW,
      items: [],
    };
    const collision = (): Prisma.PrismaClientKnownRequestError =>
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['reference'] },
      });

    it('retries with a new reference on a collision', async () => {
      const prisma = makePrisma();
      prisma.shoppingRequest.create
        .mockRejectedValueOnce(collision())
        .mockResolvedValueOnce({ id: 'ok' });
      const repo = new ShoppingRequestRepository(prisma as unknown as PrismaService);

      await expect(repo.create(input)).resolves.toEqual({ id: 'ok' });
      expect(prisma.shoppingRequest.create).toHaveBeenCalledTimes(2);
    });

    it('does not swallow other errors', async () => {
      const prisma = makePrisma();
      prisma.shoppingRequest.create.mockRejectedValue(new Error('boom'));
      await expect(
        new ShoppingRequestRepository(prisma as unknown as PrismaService).create(input),
      ).rejects.toThrow('boom');
      expect(prisma.shoppingRequest.create).toHaveBeenCalledTimes(1);
    });

    it('generates SR- references from an alphabet without look-alike characters', () => {
      for (let i = 0; i < 200; i++) {
        expect(generateReference()).toMatch(/^SR-[A-HJ-NP-Z2-9]{8}$/);
      }
    });
  });
});

describe('ShoppingOfferRepository.submit', () => {
  const input = {
    requestId: 'req-1',
    shopperProfileId: 'prof-1',
    shopperFee: 1000,
    etaMinutes: 30,
    financials: {},
    now: NOW,
  };
  const makeRepo = (locked: unknown[], create = jest.fn(async () => ({ id: 'offer-1' }))) => {
    const tx = { $queryRaw: jest.fn(async () => locked), shoppingOffer: { create } };
    const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    return { repo: new ShoppingOfferRepository(prisma as unknown as PrismaService), tx, create };
  };
  const later = new Date(NOW.getTime() + 60_000);

  it('locks the request row FOR SHARE before inserting, and expires with the request deadline', async () => {
    const { repo, tx, create } = makeRepo([{ status: 'OPEN', offer_deadline: later }]);
    await repo.submit(input);

    const sql = (tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('?');
    expect(sql).toContain('FOR SHARE');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expiresAt: later }) }),
    );
  });

  it.each([
    ['cancelled', [{ status: 'CANCELLED', offer_deadline: later }]],
    ['past deadline', [{ status: 'OPEN', offer_deadline: NOW }]],
    ['missing', []],
  ])('refuses and writes nothing when the request is %s', async (_label, locked) => {
    const { repo, create } = makeRepo(locked);
    await expect(repo.submit(input)).rejects.toBeInstanceOf(OfferRequestClosedError);
    expect(create).not.toHaveBeenCalled();
  });

  it('maps the partial-unique-index violation to DuplicateActiveOfferError', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );
    const { repo } = makeRepo([{ status: 'OPEN', offer_deadline: later }], create);
    await expect(repo.submit(input)).rejects.toBeInstanceOf(DuplicateActiveOfferError);
  });
});
