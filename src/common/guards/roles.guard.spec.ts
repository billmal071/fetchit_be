import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { createMockExecutionContext, mockUser } from '@common/test/test-helpers';
import { ROLES_KEY } from '@common/decorators';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  it('should return true when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createMockExecutionContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should return true when roles array is empty', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    const context = createMockExecutionContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should return true when user role matches required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    const context = createMockExecutionContext({
      request: { user: mockUser('ADMIN') },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should return true when user role matches one of multiple required roles', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN', 'CUSTOMER']);
    const context = createMockExecutionContext({
      request: { user: mockUser('CUSTOMER') },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should return false when user role does not match', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    const context = createMockExecutionContext({
      request: { user: mockUser('CUSTOMER') },
    });
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should return false when no user on request', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    const context = createMockExecutionContext({ request: { user: undefined } });
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should return false when user has no role', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    const context = createMockExecutionContext({
      request: { user: { id: '1', email: 'a@b.com' } },
    });
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should use ROLES_KEY with getAllAndOverride', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createMockExecutionContext();
    guard.canActivate(context);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  });
});
