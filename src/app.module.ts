import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { WinstonModule } from 'nest-winston';

import { configuration, validateEnv } from '@/config';
import { winstonConfig } from '@/logs';
import { DatabaseModule } from '@/database/database.module';
import { AuditModule } from '@common/services/audit.module';
import { CacheModule } from '@/cache';
import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';
import { HealthModule } from '@/modules/health/health.module';
import { WaitlistModule } from '@/modules/waitlist/waitlist.module';
import { ServiceCategoriesModule } from '@/modules/service-categories/service-categories.module';
import { HandymanModule } from '@/modules/handyman/handyman.module';
import { ServiceRequestsModule } from '@/modules/service-requests/service-requests.module';
import { AdminModule } from '@/modules/admin/admin.module';
import { JobsModule } from '@/jobs/jobs.module';
import { GatewaysModule } from '@/gateways/gateways.module';

import { GlobalExceptionFilter, PrismaExceptionFilter } from '@/common/filters';
import { ResponseInterceptor, LoggingInterceptor, TimeoutInterceptor } from '@/common/interceptors';
import { ALL_ROUTES, CorrelationIdMiddleware } from '@common/middleware/correlation-id.middleware';
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

    // Event Emitter for internal pub/sub
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
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

    // Audit Logging
    AuditModule,

    // Feature Modules
    AuthModule,
    UsersModule,
    HealthModule,
    WaitlistModule,

    // Feature Modules - Handyman Dashboard
    ServiceCategoriesModule,
    HandymanModule,
    ServiceRequestsModule,
    AdminModule,

    // Background Jobs (resilient to Redis failures)
    JobsModule,

    // WebSocket
    GatewaysModule,
  ],
  providers: [
    // Global Exception Filter (catches all unhandled exceptions)
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },

    // Prisma Exception Filter (catches Prisma-specific errors before GlobalExceptionFilter)
    {
      provide: APP_FILTER,
      useClass: PrismaExceptionFilter,
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

    // Global Timeout Interceptor (30s)
    {
      provide: APP_INTERCEPTOR,
      useValue: new TimeoutInterceptor(30000),
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes(ALL_ROUTES);
  }
}
