import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

function prismaClientOptions(): Prisma.PrismaClientOptions {
  const connectionString = process.env.DATABASE_URL ?? '';
  const log: Prisma.LogDefinition[] =
    process.env.NODE_ENV === 'production'
      ? [
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ]
      : [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ];

  // UpCloud trial firewalls allow outbound 443 and drop 5432, and that
  // firewall cannot be changed until the account leaves trial. Neon's
  // serverless driver speaks Postgres over WebSockets on 443.
  if (!connectionString.includes('.neon.tech')) {
    return { log };
  }

  neonConfig.webSocketConstructor = ws;
  return {
    adapter: new PrismaNeon(new Pool({ connectionString })),
    log,
  };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super(prismaClientOptions());
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
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
