import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const CONNECT_TIMEOUT_MS = 10_000;
const BOOT_PING_TIMEOUT_MS = 15_000;

function logDefinitions(): Prisma.LogDefinition[] {
  return process.env.NODE_ENV === 'production'
    ? [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ]
    : [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ];
}

/**
 * Hostname check rather than a substring test on the whole URL, so a password
 * or database name containing "neon.tech" cannot flip the driver.
 */
export function isNeonUrl(connectionString: string): boolean {
  try {
    return new URL(connectionString).hostname.endsWith('.neon.tech');
  } catch {
    // A password containing an unencoded '#', '?' or '@' makes the URL
    // unparseable, and silently falling back to the TCP driver on a box with
    // no outbound 5432 is a 30s-timeout-per-request failure with no clue in
    // the logs. Say so loudly.
    if (connectionString !== '') {
      new Logger(PrismaService.name).warn(
        'DATABASE_URL could not be parsed; falling back to the TCP driver. ' +
          'If this is a Neon URL, percent-encode special characters in the password.',
      );
    }
    return false;
  }
}

export interface IPrismaClientConfig {
  options: Prisma.PrismaClientOptions;
  adapter: PrismaNeon | null;
}

/**
 * The deploy box cannot open outbound TCP 5432 — UpCloud's trial firewall
 * drops it and cannot be changed until the account leaves trial. Neon's
 * serverless driver speaks Postgres over WebSockets on 443, which is open.
 *
 * Only Neon URLs take that path: local Postgres and the CI test container keep
 * Prisma's normal TCP driver. Note that under an adapter Prisma's own pool is
 * bypassed, so `connection_limit` / `pool_timeout` in the URL have no effect —
 * the pg pool's own default (max 10) applies per process instead.
 */
export function buildPrismaClientConfig(
  connectionString = process.env.DATABASE_URL ?? '',
): IPrismaClientConfig {
  const log = logDefinitions();

  if (!isNeonUrl(connectionString)) {
    return { options: { log }, adapter: null };
  }

  neonConfig.webSocketConstructor = ws;
  // pg's default connectionTimeoutMillis is 0 — wait forever. With that, an
  // unreachable endpoint or a suspended Neon project makes the boot-time ping
  // below hang instead of fail, Nest never finishes bootstrapping, nothing
  // listens on the port, and PM2 reports the app "online" indefinitely
  // because the process never exits.
  const adapter = new PrismaNeon(
    new Pool({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS }),
  );

  return { options: { adapter, log }, adapter };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly neonAdapter: PrismaNeon | null;

  constructor() {
    const { options, adapter } = buildPrismaClientConfig();
    super(options);
    this.neonAdapter = adapter;
  }

  get driver(): 'neon-websocket' | 'postgres-tcp' {
    return this.neonAdapter ? 'neon-websocket' : 'postgres-tcp';
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();

    // $connect() is a no-op under a driver adapter: it resolves in
    // milliseconds even when the database is unreachable, so without a real
    // round-trip the app boots "healthy" and then 500s every request. Force
    // one so a bad URL, wrong credential or Neon outage fails at boot — under
    // its own deadline, so a stalled connection fails rather than hangs.
    await this.pingWithTimeout();

    this.logger.log(`Prisma connected to database via ${this.driver}`);
  }

  private async pingWithTimeout(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        this.$queryRaw`SELECT 1`,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Database did not answer within ${BOOT_PING_TIMEOUT_MS}ms (driver: ${this.driver})`,
                ),
              ),
            BOOT_PING_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();

    // $disconnect() does not close an adapter's pool — the Prisma 5.22 runtime
    // never calls adapter.close() — so the WebSocket pool would outlive the
    // Nest app. Matters for watch mode and e2e create/close cycles.
    if (this.neonAdapter) {
      await this.neonAdapter.close();
    }

    this.logger.log('Prisma disconnected from database');
  }

  async cleanDatabase(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('cleanDatabase is not allowed in production');
    }

    const models = Reflect.ownKeys(this).filter(
      (key) => typeof key === 'string' && !key.startsWith('_') && !key.startsWith('$'),
    );

    for (const model of models) {
      const modelName = model as string;
      const delegate = (this as Record<string, unknown>)[modelName] as
        | { deleteMany?: () => Promise<unknown> }
        | undefined;
      if (delegate && typeof delegate.deleteMany === 'function') {
        await delegate.deleteMany();
      }
    }
  }
}
