import { ShopperAccountState } from '@prisma/client';
import { ShopperProfileRepository, nextSubmissionTime } from './shopper-profile.repository';
import {
  ApplicationLockedError,
  ProfileEditBlockedError,
  applicationLockedMessage,
} from './interfaces';
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
    const makeRepo = (
      accountState: ShopperAccountState = ShopperAccountState.VERIFICATION_REQUIRES_UPDATE,
    ): { repo: ShopperProfileRepository; calls: string[] } => {
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
        shopperProfile: {
          update: record('profile.update'),
          findUniqueOrThrow: async (): Promise<unknown> => {
            calls.push('profile.readState');
            return { accountState };
          },
        },
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

    /**
     * The service checks the state BEFORE the transaction, so an admin can approve
     * the profile in between. The state must be re-read under the row lock.
     */
    describe('submitApplication state check under the lock', () => {
      it('reads the state after the lock and before any write', async () => {
        const { repo, calls } = makeRepo();

        await repo.submitApplication('profile-1', 'user-1', everySet, '+2348012345678');

        const lock = calls.findIndex((call) => call.startsWith('lock:'));
        const read = calls.indexOf('profile.readState');
        expect(read).toBeGreaterThan(lock);
        expect(calls.indexOf('user.update')).toBeGreaterThan(read);
        expect(calls.indexOf('profile.update')).toBeGreaterThan(read);
      });

      it.each([
        ShopperAccountState.VERIFICATION_PENDING,
        ShopperAccountState.APPROVED,
        ShopperAccountState.SUSPENDED,
        ShopperAccountState.DEACTIVATED,
      ])(
        'rejects inside the transaction when the state is %s, and writes nothing',
        async (state) => {
          const { repo, calls } = makeRepo(state);

          const attempt = repo.submitApplication('profile-1', 'user-1', everySet, '+2348012345678');

          await expect(attempt).rejects.toBeInstanceOf(ApplicationLockedError);
          await expect(attempt).rejects.toThrow(applicationLockedMessage(state));
          expect(calls.filter((call) => call.startsWith('lock:'))).toHaveLength(1);
          expect(
            calls.filter((call) => call !== 'profile.readState' && !call.startsWith('lock:')),
          ).toEqual([]);
        },
      );

      it.each([
        ShopperAccountState.REGISTERED,
        ShopperAccountState.ONBOARDING,
        ShopperAccountState.VERIFICATION_REQUIRES_UPDATE,
      ])('still submits from %s', async (state) => {
        const { repo, calls } = makeRepo(state);

        await repo.submitApplication('profile-1', 'user-1', everySet);

        expect(calls).toContain('profile.update');
      });
    });

    describe('update', () => {
      it.each([
        ShopperAccountState.VERIFICATION_PENDING,
        ShopperAccountState.SUSPENDED,
        ShopperAccountState.DEACTIVATED,
      ])(
        'rejects inside the transaction when the state is %s, and writes nothing',
        async (state) => {
          const { repo, calls } = makeRepo(state);

          await expect(repo.update('profile-1', everySet)).rejects.toBeInstanceOf(
            ProfileEditBlockedError,
          );
          expect(
            calls.filter((call) => call !== 'profile.readState' && !call.startsWith('lock:')),
          ).toEqual([]);
        },
      );

      it.each([
        ShopperAccountState.REGISTERED,
        ShopperAccountState.ONBOARDING,
        ShopperAccountState.VERIFICATION_REQUIRES_UPDATE,
        ShopperAccountState.APPROVED,
      ])('still writes from %s, after the lock and the state read', async (state) => {
        const { repo, calls } = makeRepo(state);

        await repo.update('profile-1', everySet);

        expect(calls.findIndex((c) => c.startsWith('lock:'))).toBe(0);
        expect(calls.indexOf('profile.readState')).toBe(1);
        expect(calls).toContain('profile.update');
      });
    });
  });

  /**
   * Review decisions are bound to submittedAt, so two submissions of one
   * profile must never share a value, even if the clock repeats or steps back.
   */
  describe('nextSubmissionTime', () => {
    const at = (iso: string): Date => new Date(iso);

    it('uses the clock for a first submission', () => {
      const now = at('2026-11-20T10:00:00.000Z');
      expect(nextSubmissionTime(null, now)).toEqual(now);
    });

    it('uses the clock when it is after the previous submission', () => {
      const now = at('2026-11-20T10:00:00.001Z');
      expect(nextSubmissionTime(at('2026-11-20T10:00:00.000Z'), now)).toEqual(now);
    });

    it('moves one millisecond past a previous submission at the same instant', () => {
      const same = at('2026-11-20T10:00:00.000Z');
      expect(nextSubmissionTime(same, same)).toEqual(at('2026-11-20T10:00:00.001Z'));
    });

    it('moves past a previous submission when the clock stepped back', () => {
      const previous = at('2026-11-20T10:00:05.000Z');
      expect(nextSubmissionTime(previous, at('2026-11-20T10:00:01.000Z'))).toEqual(
        at('2026-11-20T10:00:05.001Z'),
      );
    });
  });
});
