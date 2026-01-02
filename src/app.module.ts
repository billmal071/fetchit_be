import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { WinstonModule } from 'nest-winston';

import { configuration, validateEnv } from '@/config';
import { winstonConfig } from '@/logs';
import { DatabaseModule } from '@/database/database.module';
import { CacheModule } from '@/cache';
import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';
import { HealthModule } from '@/modules/health/health.module';
import { WaitlistModule } from '@/modules/waitlist/waitlist.module';
import { JobsModule } from '@/jobs/jobs.module';
import { GatewaysModule } from '@/gateways/gateways.module';

import { GlobalExceptionFilter } from '@/common/filters';
import { ResponseInterceptor, LoggingInterceptor } from '@/common/interceptors';
import { JwtAuthGuard } from '@/modules/auth/guards';
import { RolesGuard } from '@/common/guards';

@Module({
  imports: [
    // Configuration with Zod validation
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),

    // Logging
    WinstonModule.forRoot(winstonConfig),

    // Rate Limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    // Caching (pluggable: memory or redis based on CACHE_TYPE env)
    CacheModule,

    // Database
    DatabaseModule,

    // Feature Modules
    AuthModule,
    UsersModule,
    HealthModule,
    WaitlistModule,

    // Background Jobs
    JobsModule,

    // WebSocket
    GatewaysModule,
  ],
  providers: [
    // Global Exception Filter
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },

    // Global Response Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },

    // Global Logging Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },

    // Global JWT Auth Guard
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },

    // Global Roles Guard
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },

    // Global Throttler Guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
