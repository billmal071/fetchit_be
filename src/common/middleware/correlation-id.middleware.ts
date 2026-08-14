import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Route pattern matching every request, for MiddlewareConsumer.forRoutes().
 *
 * Not '*': the hoisted path-to-regexp v8 rejects a bare '*', and Nest binds
 * the middleware to nothing without erroring, so the middleware simply stops
 * running. Kept as a constant so the wiring test covers the real value.
 */
export const ALL_ROUTES = '(.*)';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  }
}
