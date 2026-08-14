import { compareToken, comparePassword, hashPassword, hashToken } from './hash.util';

/** A realistic JWT: fixed header, `sub` claim first, signature last. */
const jwt = (sub: string, iat: number, sig: string): string =>
  [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    Buffer.from(JSON.stringify({ sub, email: 'user@example.com', iat })).toString('base64url'),
    sig,
  ].join('.');

describe('hashToken / compareToken', () => {
  const SUB = 'db74157e-42b5-46c2-bd16-0f1538cb5341';

  it('matches a token against its own digest', () => {
    const token = jwt(SUB, 1_700_000_000, 'signature-a');
    expect(compareToken(token, hashToken(token))).toBe(true);
  });

  it('produces a stable digest for the same input', () => {
    const token = jwt(SUB, 1_700_000_000, 'signature-a');
    expect(hashToken(token)).toBe(hashToken(token));
  });

  // The regression this replaced bcrypt for: two refresh tokens issued to the
  // same user share their first 72 bytes, which is all bcrypt ever hashed.
  it('rejects a different token for the same user that shares the first 72 bytes', () => {
    const issued = jwt(SUB, 1_700_000_000, 'signature-a');
    const rotated = jwt(SUB, 1_700_000_900, 'signature-b');

    expect(issued.slice(0, 72)).toBe(rotated.slice(0, 72));
    expect(issued).not.toBe(rotated);
    expect(compareToken(issued, hashToken(rotated))).toBe(false);
  });

  it('rejects a token that differs only in its signature', () => {
    const a = jwt(SUB, 1_700_000_000, 'signature-a');
    const b = jwt(SUB, 1_700_000_000, 'signature-b');
    expect(compareToken(a, hashToken(b))).toBe(false);
  });

  it('rejects an empty or missing stored digest', () => {
    const token = jwt(SUB, 1_700_000_000, 'signature-a');
    expect(compareToken(token, '')).toBe(false);
    expect(compareToken(token, undefined as unknown as string)).toBe(false);
  });

  it('rejects a legacy bcrypt digest instead of throwing', () => {
    const token = jwt(SUB, 1_700_000_000, 'signature-a');
    const legacy = '$2b$12$fDlUJhy6.RkVLVME/lsgZuKPjJ3xN0y6qFq8m0m4c1cJ0m0m4c1cJ';
    expect(compareToken(token, legacy)).toBe(false);
  });

  it('rejects a digest of the right length that is not the token', () => {
    const token = jwt(SUB, 1_700_000_000, 'signature-a');
    expect(compareToken(token, hashToken('unrelated'))).toBe(false);
  });
});

describe('hashPassword / comparePassword', () => {
  it('still round-trips a password through bcrypt', async () => {
    const hashed = await hashPassword('Password@123');
    expect(hashed).toMatch(/^\$2[aby]\$/);
    expect(await comparePassword('Password@123', hashed)).toBe(true);
    expect(await comparePassword('Password@124', hashed)).toBe(false);
  });
});
