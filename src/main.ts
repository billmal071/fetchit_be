import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { IAppConfig, ISwaggerConfig } from '@/config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Request body size limits
  app.useBodyParser('json', { limit: '10kb' });
  app.useBodyParser('urlencoded', { limit: '10kb', extended: true });

  // Get config service
  const configService = app.get(ConfigService);
  const appConfig = configService.get<IAppConfig>('app');
  const swaggerConfig = configService.get<ISwaggerConfig>('swagger');

  // Validate CORS origins - filter out any malformed URLs
  const rawOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',');
  const origins = rawOrigins
    .map((o) => o.trim())
    .filter((o) => {
      try {
        new URL(o);
        return true;
      } catch {
        return false;
      }
    });

  // Use Winston logger
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // Security - Helmet with Content Security Policy
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Response compression
  app.use(compression());

  // CORS
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  // API Prefix and Versioning
  app.setGlobalPrefix(appConfig?.apiPrefix || 'api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: appConfig?.apiVersion || 'v1',
  });

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger Documentation
  if (swaggerConfig?.enabled) {
    const config = new DocumentBuilder()
      .setTitle(swaggerConfig.title || 'FetchIt API')
      .setDescription(swaggerConfig.description || 'FetchIt Backend API Documentation')
      .setVersion(swaggerConfig.version || '1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .addTag('Authentication', 'User authentication endpoints')
      .addTag('Users', 'User management endpoints')
      .addTag('Health', 'Health check endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = appConfig?.port || 3000;
  await app.listen(port);

  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`API Documentation: http://localhost:${port}/docs`);
  logger.log(`Environment: ${appConfig?.nodeEnv}`);

  // Graceful shutdown on signals
  const shutdown = async (signal: string): Promise<void> => {
    logger.warn(`Received ${signal}. Starting graceful shutdown...`);
    try {
      await app.close();
      logger.log('Application shut down gracefully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled Rejection:', reason);
  });

  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception:', error.stack || error.message);
    setTimeout(() => process.exit(1), 1000);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console -- logger unavailable if bootstrap fails
  console.error('Failed to start application:', error);
  process.exit(1);
});
