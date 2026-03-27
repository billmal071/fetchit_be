import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable, lastValueFrom } from 'rxjs';
import { ITokenValidator } from './interfaces/token-validator.interface';

/**
 * Adapter that delegates token validation to Passport's JWT strategy.
 * Keeps Passport as an implementation detail behind the ITokenValidator port.
 */
@Injectable()
export class PassportTokenValidator extends AuthGuard('jwt') implements ITokenValidator {
  async validate(context: ExecutionContext): Promise<boolean> {
    const result = super.canActivate(context);
    if (result instanceof Observable) {
      return lastValueFrom(result);
    }
    return result;
  }
}
