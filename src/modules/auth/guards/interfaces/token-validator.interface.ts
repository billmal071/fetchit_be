import { ExecutionContext } from '@nestjs/common';

export const TOKEN_VALIDATOR = 'TOKEN_VALIDATOR';

export interface ITokenValidator {
  /**
   * Validates the request's authentication token and attaches the user to the request.
   * Returns true if authentication succeeds, false otherwise.
   * May throw UnauthorizedException.
   */
  validate(context: ExecutionContext): Promise<boolean>;
}
