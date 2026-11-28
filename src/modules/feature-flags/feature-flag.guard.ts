import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_DISABLED_CODE, FEATURE_DISABLED_MESSAGE, FeatureFlagKey } from '@common/constants';
import { BaseException } from '@common/exceptions/base.exception';
import { IRequestUser } from '@common/interfaces';
import { FeatureFlagService } from './feature-flag.service';
import { FEATURE_FLAG_METADATA } from './feature-flag.metadata';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<FeatureFlagKey | undefined>(
      FEATURE_FLAG_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!key) {
      return true;
    }
    const user = context.switchToHttp().getRequest<{ user?: IRequestUser }>().user;
    if (!user) {
      // The global JWT guard normally answers first; this is the backstop.
      throw new UnauthorizedException();
    }
    if (await this.flags.isEnabledFor(key, user.role)) {
      return true;
    }
    // 404, not 403: to the caller the feature simply is not there (yet). The code lets a
    // client tell this apart from a missing record.
    throw new BaseException(
      FEATURE_DISABLED_MESSAGE,
      HttpStatus.NOT_FOUND,
      undefined,
      FEATURE_DISABLED_CODE,
    );
  }
}
