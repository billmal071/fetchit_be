import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ITokenValidator } from './interfaces/token-validator.interface';
import { IS_PUBLIC_KEY } from '@/common/decorators';
import { createMockExecutionContext, mockUser } from '@common/test/test-helpers';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;
  let tokenValidator: jest.Mocked<ITokenValidator>;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    tokenValidator = { validate: jest.fn() };
    guard = new JwtAuthGuard(reflector, tokenValidator);
  });

  it('should return true immediately when @Public() is set on handler', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = createMockExecutionContext();

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(tokenValidator.validate).not.toHaveBeenCalled();
  });

  it('should check IS_PUBLIC_KEY on both handler and class', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    tokenValidator.validate.mockResolvedValue(true);
    const context = createMockExecutionContext();

    await guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  });

  it('should delegate to tokenValidator when route is not public', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    tokenValidator.validate.mockResolvedValue(true);
    const context = createMockExecutionContext({
      request: { user: mockUser() },
    });

    const result = await guard.canActivate(context);

    expect(tokenValidator.validate).toHaveBeenCalledWith(context);
    expect(result).toBe(true);
  });

  it('should return false when tokenValidator returns false', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    tokenValidator.validate.mockResolvedValue(false);
    const context = createMockExecutionContext();

    const result = await guard.canActivate(context);

    expect(result).toBe(false);
  });

  it('should propagate errors from tokenValidator', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    tokenValidator.validate.mockRejectedValue(new Error('Unauthorized'));
    const context = createMockExecutionContext();

    await expect(guard.canActivate(context)).rejects.toThrow('Unauthorized');
  });
});
