import { buildPrismaClientConfig, isNeonUrl } from './prisma.service';

/**
 * The deploy box has no outbound TCP 5432, so the Neon WebSocket adapter is
 * load-bearing: if it silently stops being installed, the app cannot reach the
 * database at all. Nothing else in the suite would notice — every other test
 * passes identically with or without the adapter — so assert the wiring here.
 */
describe('buildPrismaClientConfig', () => {
  const neonUrl =
    'postgresql://user:pass@ep-steep-pond-aboesafx-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require';
  const localUrl = 'postgresql://postgres:postgres@localhost:5432/fetchit_test?schema=public';

  it('installs the Neon adapter for a Neon URL', () => {
    const { options, adapter } = buildPrismaClientConfig(neonUrl);

    expect(adapter).not.toBeNull();
    expect(options).toHaveProperty('adapter', adapter);
  });

  it('uses the plain TCP driver for a non-Neon URL', () => {
    const { options, adapter } = buildPrismaClientConfig(localUrl);

    expect(adapter).toBeNull();
    expect(options).not.toHaveProperty('adapter');
  });

  it('falls back to the TCP driver when DATABASE_URL is missing or unparseable', () => {
    expect(buildPrismaClientConfig('').adapter).toBeNull();
    expect(buildPrismaClientConfig('not-a-url').adapter).toBeNull();
  });

  it('always configures log definitions', () => {
    expect(buildPrismaClientConfig(neonUrl).options.log).toBeDefined();
    expect(buildPrismaClientConfig(localUrl).options.log).toBeDefined();
  });
});

describe('isNeonUrl', () => {
  it('matches on hostname, not anywhere in the URL', () => {
    expect(isNeonUrl('postgresql://u:p@ep-x.eu-west-2.aws.neon.tech/db')).toBe(true);
    // A password or database name containing the host must not flip the driver.
    expect(isNeonUrl('postgresql://u:neon.tech@localhost:5432/db')).toBe(false);
    expect(isNeonUrl('postgresql://u:p@localhost:5432/neon.tech')).toBe(false);
  });

  it('rejects a lookalike suffix', () => {
    expect(isNeonUrl('postgresql://u:p@evil-neon.tech.example.com/db')).toBe(false);
  });
});
