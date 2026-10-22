import { plainToInstance } from 'class-transformer';
import { UserResponseDto } from './user-response.dto';

/**
 * Regression for bug #18: the frontend's role-picker gate
 * (`fetchit_fe/src/lib/onboarding.ts`) uses `onboardedAt` when the API sends
 * it, and only falls back to guessing from `lastLoginAt` when it's missing —
 * which is how new accounts skipped the role picker. `@Exclude()` + `plain
 * ToInstance` strips any field without `@Expose()`, so this pins that
 * `onboardedAt` is actually exposed rather than silently dropped again.
 */
describe('UserResponseDto', () => {
  it('exposes onboardedAt', () => {
    const onboardedAt = new Date('2026-01-15T10:30:00.000Z');
    const result = plainToInstance(UserResponseDto, { id: 'u1', onboardedAt });

    expect(result.onboardedAt).toEqual(onboardedAt);
  });

  it('exposes onboardedAt as null when the user never onboarded', () => {
    const result = plainToInstance(UserResponseDto, { id: 'u1', onboardedAt: null });

    expect(result.onboardedAt).toBeNull();
  });
});
