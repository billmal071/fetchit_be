import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ITokenValidator } from './interfaces/token-validator.interface';

/**
 * Adapter that delegates token validation to Passport's JWT strategy.
 * Keeps Passport as an implementation detail behind the ITokenValidator port.
 */
@Injectable()
export class PassportTokenValidator extends AuthGuard('jwt') implements ITokenValidator {
  async validate(context: ExecutionContext): Promise<boolean> {
    const result = await super.canActivate(context);
    return result as boolean;
  }
}
