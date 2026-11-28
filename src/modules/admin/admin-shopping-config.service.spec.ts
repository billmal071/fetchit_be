import { AdminShoppingConfigService } from './admin-shopping-config.service';
import {
  MAX_FEE,
  MAX_WINDOW_MINUTES,
  validateShoppingConfig,
} from './admin-shopping-config.validation';
import { ShoppingConfigConstraintError } from '@/database/repositories';
import type { IShoppingConfigRecord, IShoppingFeeRules } from '@/database/repositories';

const RULES: IShoppingFeeRules = {
  minShopperFee: 500,
  maxShopperFee: 5000,
  deliveryFee: 1500,
  serviceChargePercent: 5,
  vatPercent: 7.5,
  priceBufferPercent: 10,
  offerWindowMinutes: 30,
  shopperAcceptWindowMinutes: 30,
  offerAcceptanceWindowMinutes: 1440,
};
const UPDATED_AT = new Date('2026-11-26T10:00:00.000Z');
const record = (over: Partial<IShoppingConfigRecord> = {}): IShoppingConfigRecord => ({
  ...RULES,
  updatedAt: UPDATED_AT,
  updatedBy: { id: 'admin-1', username: 'ada' },
  ...over,
});

describe('validateShoppingConfig', () => {
  it('accepts the seeded values', () => {
    expect(validateShoppingConfig(RULES)).toEqual([]);
  });

  it('accepts the bounds exactly', () => {
    expect(
      validateShoppingConfig({
        ...RULES,
        minShopperFee: 0,
        maxShopperFee: MAX_FEE,
        deliveryFee: MAX_FEE,
        serviceChargePercent: 0,
        vatPercent: 100,
        priceBufferPercent: 100,
        offerWindowMinutes: 1,
        shopperAcceptWindowMinutes: MAX_WINDOW_MINUTES,
        offerAcceptanceWindowMinutes: 1,
      }),
    ).toEqual([]);
  });

  it.each([
    ['minShopperFee more than maxShopperFee', { minShopperFee: 6000 }, 'minShopperFee'],
    ['a negative fee', { deliveryFee: -1 }, 'deliveryFee'],
    ['a fee over the cap', { maxShopperFee: MAX_FEE + 1 }, 'maxShopperFee'],
    ['a fractional fee', { deliveryFee: 10.5 }, 'deliveryFee'],
    ['a percentage over 100', { vatPercent: 100.01 }, 'vatPercent'],
    ['a negative percentage', { serviceChargePercent: -0.01 }, 'serviceChargePercent'],
    ['NaN as a percentage', { priceBufferPercent: Number.NaN }, 'priceBufferPercent'],
    ['a zero window', { offerWindowMinutes: 0 }, 'offerWindowMinutes'],
    [
      'a window over 30 days',
      { shopperAcceptWindowMinutes: MAX_WINDOW_MINUTES + 1 },
      'shopperAcceptWindowMinutes',
    ],
    ['a fractional window', { offerAcceptanceWindowMinutes: 1.5 }, 'offerAcceptanceWindowMinutes'],
  ])('reports %s on the merged result', (_label, over, field) => {
    const errors = validateShoppingConfig({ ...RULES, ...over });
    expect(errors.map((e) => e.field)).toContain(field);
  });
});

describe('AdminShoppingConfigService', () => {
  let repo: { getRecord: jest.Mock; update: jest.Mock };
  let audit: { log: jest.Mock };
  let service: AdminShoppingConfigService;

  beforeEach(() => {
    repo = { getRecord: jest.fn(async () => record()), update: jest.fn() };
    audit = { log: jest.fn() };
    service = new AdminShoppingConfigService(repo as never, audit as never);
  });

  describe('get', () => {
    it('returns the rules, when they changed and who changed them, and nothing else', async () => {
      expect(await service.get()).toEqual({
        ...RULES,
        updatedAt: '2026-11-26T10:00:00.000Z',
        updatedBy: { id: 'admin-1', username: 'ada' },
      });
    });

    it('returns updatedBy null for the seeded values', async () => {
      repo.getRecord.mockResolvedValue(record({ updatedBy: null }));
      expect((await service.get()).updatedBy).toBeNull();
    });

    it('fails with 500 when the config row is missing rather than inventing values', async () => {
      repo.getRecord.mockResolvedValue(null);
      await expect(service.get()).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('update', () => {
    const updated = {
      outcome: 'updated',
      before: { minShopperFee: 500, vatPercent: 7.5 },
      after: { minShopperFee: 700, vatPercent: 8 },
      record: record({ minShopperFee: 700, vatPercent: 8 }),
    };

    it('rejects an empty edit with 400 before touching the repository', async () => {
      await expect(service.update('admin-1', {})).rejects.toMatchObject({ status: 400 });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('hands the repository the patch, the admin id, and the merged-result validator', async () => {
      repo.update.mockResolvedValue(updated);
      await service.update('admin-1', { minShopperFee: 700, vatPercent: 8 });

      const [patch, adminId, validate] = repo.update.mock.calls[0];
      expect(patch).toEqual({ minShopperFee: 700, vatPercent: 8 });
      expect(adminId).toBe('admin-1');
      expect(validate({ ...RULES, minShopperFee: 9999 })).not.toEqual([]);
      expect(validate(RULES)).toEqual([]);
    });

    it('returns the new configuration', async () => {
      repo.update.mockResolvedValue(updated);
      const result = await service.update('admin-1', { minShopperFee: 700, vatPercent: 8 });
      expect(result).toMatchObject({ minShopperFee: 700, vatPercent: 8, maxShopperFee: 5000 });
    });

    it('audits ONLY the changed fields, before and after', async () => {
      repo.update.mockResolvedValue(updated);
      await service.update('admin-1', { minShopperFee: 700, vatPercent: 8 });
      expect(audit.log).toHaveBeenCalledWith({
        userId: 'admin-1',
        action: 'SHOPPING_CONFIG_UPDATED',
        entity: 'ShoppingConfig',
        entityId: '1',
        details: {
          before: { minShopperFee: 500, vatPercent: 7.5 },
          after: { minShopperFee: 700, vatPercent: 8 },
        },
      });
    });

    it('still succeeds when the audit write fails (the edit is already committed)', async () => {
      repo.update.mockResolvedValue(updated);
      audit.log.mockRejectedValue(new Error('db down'));
      await expect(service.update('admin-1', { minShopperFee: 700 })).resolves.toMatchObject({
        minShopperFee: 700,
      });
    });

    it('writes no audit entry when nothing actually changed', async () => {
      repo.update.mockResolvedValue({ outcome: 'unchanged', record: record() });
      await expect(service.update('admin-1', { deliveryFee: 1500 })).resolves.toMatchObject({
        deliveryFee: 1500,
      });
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('422s with the violations when the merged result breaks a rule, auditing nothing', async () => {
      repo.update.mockResolvedValue({
        outcome: 'invalid',
        errors: [
          {
            field: 'minShopperFee',
            message: 'minShopperFee (9000) must not be more than maxShopperFee (5000)',
          },
        ],
      });
      const error = await service.update('admin-1', { minShopperFee: 9000 }).catch((e) => e);
      expect(error.status).toBe(422);
      expect(JSON.stringify(error.getResponse())).toContain('must not be more than maxShopperFee');
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('maps a database CHECK violation to 422, not 500', async () => {
      repo.update.mockRejectedValue(
        new ShoppingConfigConstraintError('shopping_config_fee_bounds'),
      );
      const error = await service.update('admin-1', { minShopperFee: 9000 }).catch((e) => e);
      expect(error.status).toBe(422);
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('does not swallow unrelated errors', async () => {
      repo.update.mockRejectedValue(new Error('connection lost'));
      await expect(service.update('admin-1', { minShopperFee: 700 })).rejects.toThrow(
        'connection lost',
      );
    });

    it('500s when the row is missing', async () => {
      repo.update.mockResolvedValue({ outcome: 'missing' });
      await expect(service.update('admin-1', { minShopperFee: 700 })).rejects.toMatchObject({
        status: 500,
      });
    });
  });
});
