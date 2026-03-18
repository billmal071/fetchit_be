import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, ip } = request;
    const userAgent = request.get('user-agent') || '';
    const correlationId = (request.headers['x-correlation-id'] as string) || '-';
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (): void => {
          const response = context.switchToHttp().getResponse();
          const { statusCode } = response;
          const duration = Date.now() - startTime;

          this.logger.log(
            `[${correlationId}] ${method} ${url} ${statusCode} - ${duration}ms - ${ip} - ${userAgent}`,
          );
        },
        error: (error: Error): void => {
          const duration = Date.now() - startTime;
          this.logger.error(
            `[${correlationId}] ${method} ${url} - ${duration}ms - ${ip} - ${userAgent} - ${error.message}`,
          );
        },
      }),
    );
  }
}
