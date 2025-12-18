import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { IApiResponse, IMeta } from '../interfaces';

export interface IResponseData<T> {
  data: T;
  message?: string;
  meta?: IMeta;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, IApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<IApiResponse<T>> {
    return next.handle().pipe(
      map((response: T | IResponseData<T>) => {
        if (this.isResponseData(response)) {
          return {
            success: true,
            message: response.message || 'Success',
            data: response.data,
            ...(response.meta && { meta: response.meta }),
            timestamp: new Date().toISOString(),
          };
        }

        return {
          success: true,
          message: 'Success',
          data: response,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }

  private isResponseData(response: unknown): response is IResponseData<T> {
    return (
      typeof response === 'object' &&
      response !== null &&
      'data' in response &&
      (response as Record<string, unknown>).data !== undefined
    );
  }
}
