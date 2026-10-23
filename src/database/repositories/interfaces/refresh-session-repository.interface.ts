import { RefreshSession } from '@prisma/client';

/**
 * Refresh Session Repository Interface
 *
 * One row per device/login (bug #12) instead of a single `refreshToken`
 * column on `User`, so logging in on a second device no longer invalidates
 * the first. Deliberately not extending IBaseRepository — nothing here
 * needs a bare id-keyed update/delete, only the session-lifecycle
 * operations below.
 */
export interface IRefreshSessionRepository {
  /**
   * Create a new session row (login/register/refresh rotation).
   */
  create(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<RefreshSession>;

  /**
   * Find a non-revoked, non-expired session by its token hash.
   */
  findActiveByTokenHash(tokenHash: string): Promise<RefreshSession | null>;

  /**
   * Revoke one session by its token hash, scoped to its owner (logout of a
   * single device) — without the userId check, anyone holding another
   * user's refresh token string could silently kill that user's session.
   */
  revokeByTokenHash(tokenHash: string, userId: string): Promise<void>;

  /**
   * Rotate a session in place: same row, new token hash and expiry. Keeps
   * "one row per device" true across the life of a session instead of
   * accumulating a new row on every refresh.
   *
   * Conditional on the row still holding `expectedOldTokenHash` and still
   * being non-revoked — matches this codebase's established
   * conditional-updateMany race-safety pattern (see e.g.
   * HandymanService.startRequest). Without it: (a) a logout racing a
   * refresh could "win" the read but lose the write, silently handing back
   * a refresh token for a session that was just revoked; (b) two
   * concurrent refreshes of the same token would both succeed, the second
   * overwriting the first's rotation with no way to detect it. Returns
   * null if the row no longer matches (lost race) instead of throwing —
   * the caller decides what that means.
   */
  rotate(
    id: string,
    expectedOldTokenHash: string,
    newTokenHash: string,
    newExpiresAt: Date,
  ): Promise<RefreshSession | null>;

  /**
   * Revoke every active session for a user (logout of all devices).
   */
  revokeAllForUser(userId: string): Promise<void>;
}

export const REFRESH_SESSION_REPOSITORY = Symbol('REFRESH_SESSION_REPOSITORY');
