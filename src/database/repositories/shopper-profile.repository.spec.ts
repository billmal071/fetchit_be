import { ShopperProfileRepository } from './shopper-profile.repository';
import { PrismaService } from '../prisma.service';

describe('ShopperProfileRepository', () => {
  /**
   * A relation set is replaced by delete-then-insert. At Read Committed, two
   * concurrent replacements both delete before either inserts and leave the
   * UNION of the two sets (reproduced against Postgres: 40 of 40 runs). Locking
   * the profile row first serialises them. A real race needs a real database,
   * so this guards the ordering that prevents it.
   */
  describe('replacing relation sets', () => {
    const makeRepo = (): { repo: ShopperProfileRepository; calls: string[] } => {
      const calls: string[] = [];
      const record = (name: string) => async (): Promise<unknown> => {
        calls.push(name);
        return { count: 0 };
      };
      const tx = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
          calls.push(`lock:${strings.join('?').replace(/\s+/g, ' ').trim()}`);
          return [];
        }),
        user: { update: record('user.update') },
        shopperProfileCategory: {
          deleteMany: record('category.delete'),
          createMany: record('category.create'),
        },
        shopperProfileLocation: {
          deleteMany: record('location.delete'),
          createMany: record('location.create'),
        },
        shopperProfileService: {
          deleteMany: record('service.delete'),
          createMany: record('service.create'),
        },
        shopperAvailability: {
          deleteMany: record('availability.delete'),
          createMany: record('availability.create'),
        },
        shopperProfile: { update: record('profile.update') },
      };
      const prisma = {
        $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
      } as unknown as PrismaService;
      return { repo: new ShopperProfileRepository(prisma), calls };
    };

    const everySet = {
      categoryIds: ['c1'],
      locationIds: ['l1'],
      serviceIds: ['s1'],
      availability: [{ weekday: 'MONDAY' as const }],
    };

    it('locks the profile row before any child write on update', async () => {
      const { repo, calls } = makeRepo();

      await repo.update('profile-1', everySet);

      expect(calls[0]).toBe('lock:SELECT id FROM shopper_profiles WHERE id = ? FOR UPDATE');
      expect(calls.indexOf('category.delete')).toBeGreaterThan(0);
      expect(calls.filter((call) => call.startsWith('lock:'))).toHaveLength(1);
    });

    it('locks before the user write and every child write on submitApplication', async () => {
      const { repo, calls } = makeRepo();

      await repo.submitApplication('profile-1', 'user-1', everySet, '+2348012345678');

      const lock = calls.findIndex((call) => call.startsWith('lock:'));
      expect(lock).toBeGreaterThanOrEqual(0);
      for (const write of [
        'user.update',
        'category.delete',
        'location.delete',
        'service.delete',
        'availability.delete',
      ]) {
        expect(calls.indexOf(write)).toBeGreaterThan(lock);
      }
    });
  });
});
