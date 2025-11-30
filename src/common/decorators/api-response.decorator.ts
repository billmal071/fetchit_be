import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiResponse,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
  getSchemaPath,
  ApiExtraModels,
} from '@nestjs/swagger';

export class ApiResponseDto<T> {
  success: boolean;
  message: string;
  data: T;
  timestamp: string;
}

export const ApiSuccessResponse = <TModel extends Type<unknown>>(
  model: TModel,
  isArray = false,
): ReturnType<typeof applyDecorators> => {
  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      schema: {
        allOf: [
          {
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Success' },
              data: isArray
                ? { type: 'array', items: { $ref: getSchemaPath(model) } }
                : { $ref: getSchemaPath(model) },
              timestamp: { type: 'string', example: new Date().toISOString() },
            },
          },
        ],
      },
    }),
  );
};

export const ApiCreatedSuccessResponse = <TModel extends Type<unknown>>(
  model: TModel,
): ReturnType<typeof applyDecorators> => {
  return applyDecorators(
    ApiExtraModels(model),
    ApiCreatedResponse({
      schema: {
        allOf: [
          {
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Created successfully' },
              data: { $ref: getSchemaPath(model) },
              timestamp: { type: 'string', example: new Date().toISOString() },
            },
          },
        ],
      },
    }),
  );
};

export const ApiPaginatedResponse = <TModel extends Type<unknown>>(
  model: TModel,
): ReturnType<typeof applyDecorators> => {
  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      schema: {
        allOf: [
          {
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Success' },
              data: {
                type: 'array',
                items: { $ref: getSchemaPath(model) },
              },
              meta: {
                type: 'object',
                properties: {
                  page: { type: 'number', example: 1 },
                  limit: { type: 'number', example: 10 },
                  total: { type: 'number', example: 100 },
                  totalPages: { type: 'number', example: 10 },
                  hasNextPage: { type: 'boolean', example: true },
                  hasPreviousPage: { type: 'boolean', example: false },
                },
              },
              timestamp: { type: 'string', example: new Date().toISOString() },
            },
          },
        ],
      },
    }),
  );
};

export const ApiErrorResponses = (): ReturnType<typeof applyDecorators> => {
  return applyDecorators(
    ApiBadRequestResponse({
      description: 'Bad Request',
      schema: {
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Validation failed' },
          error: { type: 'string', example: 'Bad Request' },
          statusCode: { type: 'number', example: 400 },
          timestamp: { type: 'string', example: new Date().toISOString() },
          path: { type: 'string', example: '/api/v1/users' },
        },
      },
    }),
    ApiUnauthorizedResponse({
      description: 'Unauthorized',
      schema: {
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Unauthorized' },
          error: { type: 'string', example: 'Unauthorized' },
          statusCode: { type: 'number', example: 401 },
          timestamp: { type: 'string', example: new Date().toISOString() },
          path: { type: 'string', example: '/api/v1/users' },
        },
      },
    }),
    ApiForbiddenResponse({
      description: 'Forbidden',
      schema: {
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Forbidden' },
          error: { type: 'string', example: 'Forbidden' },
          statusCode: { type: 'number', example: 403 },
          timestamp: { type: 'string', example: new Date().toISOString() },
          path: { type: 'string', example: '/api/v1/users' },
        },
      },
    }),
    ApiNotFoundResponse({
      description: 'Not Found',
      schema: {
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Resource not found' },
          error: { type: 'string', example: 'Not Found' },
          statusCode: { type: 'number', example: 404 },
          timestamp: { type: 'string', example: new Date().toISOString() },
          path: { type: 'string', example: '/api/v1/users/123' },
        },
      },
    }),
    ApiInternalServerErrorResponse({
      description: 'Internal Server Error',
      schema: {
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Internal server error' },
          error: { type: 'string', example: 'Internal Server Error' },
          statusCode: { type: 'number', example: 500 },
          timestamp: { type: 'string', example: new Date().toISOString() },
          path: { type: 'string', example: '/api/v1/users' },
        },
      },
    }),
  );
};
