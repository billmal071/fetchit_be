import * as bcrypt from 'bcrypt';
import { createHash, timingSafeEqual } from 'crypto';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

/**
 * Hashes a refresh token for storage.
 *
 * Deliberately NOT bcrypt. bcrypt silently truncates its input at 72 bytes,
 * and every JWT we issue to a given user shares an identical first 72 bytes
 * (the fixed header plus the start of the `sub` claim). Under bcrypt, every
 * refresh token that user ever held therefore compared as equal, so a single
 * leaked token stayed valid forever and rotation did nothing.
 *
 * SHA-256 is the right primitive here: refresh tokens are already
 * high-entropy secrets, so the slow, salted hashing that protects
 * low-entropy passwords buys nothing and costs a round of bcrypt per request.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of a token against a stored `hashToken` digest. */
export function compareToken(token: string, hashedToken: string): boolean {
  const candidate = Buffer.from(hashToken(token), 'hex');
  const stored = Buffer.from(hashedToken ?? '', 'hex');

  // Also the path for legacy bcrypt digests, which are not valid hex and so
  // never match. Those sessions are invalidated and must log in again.
  if (stored.length !== candidate.length) return false;

  return timingSafeEqual(candidate, stored);
}
