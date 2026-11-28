import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_FLAGS } from '@common/constants';
import { FEATURE_FLAG_METADATA } from './feature-flag.metadata';
import { RequireFeature } from './require-feature.decorator';
import { FeatureFlagGuard } from './feature-flag.guard';

class Gated {
  @RequireFeature(FEATURE_FLAGS.SHOPPER_ORDERS)
  gated(): void {}
  open(): void {}
}
@RequireFeature(FEATURE_FLAGS.SHOPPER_MARKETPLACE)
class GatedClass {
  inherits(): void {}
  @RequireFeature(FEATURE_FLAGS.SHOPPER_ORDERS)
  overrides(): void {}
}

const context = (cls: object, handler: () => void, user?: { role: string }): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('FeatureFlagGuard', () => {
  let flags: { isEnabledFor: jest.Mock };
  let guard: FeatureFlagGuard;

  beforeEach(() => {
    flags = { isEnabledFor: jest.fn(async () => true) };
    guard = new FeatureFlagGuard(new Reflector(), flags as never);
  });

  it('checks the flag named on the route against the caller role, and lets them in when on', async () => {
    expect(
      await guard.canActivate(context(Gated, Gated.prototype.gated, { role: 'CUSTOMER' })),
    ).toBe(true);
    expect(flags.isEnabledFor).toHaveBeenCalledWith('shopper_orders', 'CUSTOMER');
  });

  it('answers 404 FEATURE_DISABLED, "not available yet", when the flag is off for the caller', async () => {
    flags.isEnabledFor.mockResolvedValue(false);
    const error = await guard
      .canActivate(context(Gated, Gated.prototype.gated, { role: 'CUSTOMER' }))
      .catch((e) => e);
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toMatchObject({
      message: 'This feature is not available yet',
      code: 'FEATURE_DISABLED',
    });
  });

  it('is a 401, before any flag check, when there is no user', async () => {
    await expect(guard.canActivate(context(Gated, Gated.prototype.gated))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(flags.isEnabledFor).not.toHaveBeenCalled();
  });

  it('does nothing on a route that names no flag', async () => {
    expect(
      await guard.canActivate(context(Gated, Gated.prototype.open, { role: 'CUSTOMER' })),
    ).toBe(true);
    expect(flags.isEnabledFor).not.toHaveBeenCalled();
  });

  it('reads a class-level flag, and a route-level one wins over it', async () => {
    await guard.canActivate(
      context(GatedClass, GatedClass.prototype.inherits, { role: 'CUSTOMER' }),
    );
    expect(flags.isEnabledFor).toHaveBeenLastCalledWith('shopper_marketplace', 'CUSTOMER');
    await guard.canActivate(
      context(GatedClass, GatedClass.prototype.overrides, { role: 'CUSTOMER' }),
    );
    expect(flags.isEnabledFor).toHaveBeenLastCalledWith('shopper_orders', 'CUSTOMER');
  });

  it('exports the metadata key the decorator writes', () => {
    expect(Reflect.getMetadata(FEATURE_FLAG_METADATA, Gated.prototype.gated)).toBe(
      'shopper_orders',
    );
  });
});
