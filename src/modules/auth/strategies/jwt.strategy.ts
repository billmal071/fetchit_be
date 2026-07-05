import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { EmailNotVerifiedException } from '@/common/exceptions';
import { IJwtPayload, IRequestUser } from '@/common/interfaces';
import { IJwtConfig } from '@/config';
import { UsersService } from '@/modules/users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const jwtConfig = configService.get<IJwtConfig>('jwt');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig?.secret,
    });
  }

  async validate(payload: IJwtPayload): Promise<IRequestUser> {
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // An unverified user is technically not ACTIVE yet. Surface the actionable
    // "verify your email" 403 instead of a generic "account is not active" 401,
    // otherwise this preempts the EmailNotVerifiedException guard on routes like
    // /users/onboard and users get an opaque auth error before verifying.
    if (!user.emailVerified) {
      throw new EmailNotVerifiedException();
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User account is not active');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
