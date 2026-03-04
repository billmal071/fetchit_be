import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { IErrorResponse, IValidationError } from '../interfaces';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code: string | undefined;
    let details: IValidationError[] | Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as Record<string, unknown>;
        message = (responseObj.message as string) || message;
        if (typeof responseObj.code === 'string') {
          code = responseObj.code;
        }

        if (Array.isArray(responseObj.message)) {
          message = 'Validation failed';
          details = (responseObj.message as string[]).map((msg) => ({
            field: this.extractFieldFromMessage(msg),
            message: msg,
          }));
        } else if (responseObj.details) {
          details = responseObj.details as Record<string, unknown>;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack);
    }

    const errorResponse: IErrorResponse = {
      success: false,
      message,
      error: this.getErrorName(status),
      statusCode: status,
      ...(code && { code }),
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(details && { details }),
    };

    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} - ${status} - ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`[${request.method}] ${request.url} - ${status} - ${message}`);
    }

    response.status(status).json(errorResponse);
  }

  private getErrorName(status: number): string {
    const errorNames: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };
    return errorNames[status] || 'Error';
  }

  private extractFieldFromMessage(message: string): string {
    const match = message.match(/^(\w+)/);
    return match ? match[1].toLowerCase() : 'unknown';
  }
}
