import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { IJwtPayload } from '@/common/interfaces';
import { IJwtConfig } from '@/config';
import { UsersService } from '@/modules/users/users.service';
import { hashToken } from '@/common/utils';
import { REFRESH_SESSION_REPOSITORY, IRefreshSessionRepository } from '@/database/repositories';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    @Inject(REFRESH_SESSION_REPOSITORY)
    private readonly refreshSessionRepo: IRefreshSessionRepository,
  ) {
    const jwtConfig = configService.get<IJwtConfig>('jwt');
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: jwtConfig?.refreshSecret,
      passReqToCallback: true,
    });
  }

  async validate(
    req: Request,
    payload: IJwtPayload,
  ): Promise<{ id: string; email: string; refreshToken: string }> {
    const refreshToken = req.body.refreshToken;
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Bug #12: this used to compare against the single refreshToken column
    // on User — now it looks up the specific RefreshSession row the token
    // belongs to, so a device logging in doesn't implicitly invalidate any
    // other device's session.
    const session = await this.refreshSessionRepo.findActiveByTokenHash(hashToken(refreshToken));
    if (!session || session.userId !== user.id) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      id: user.id,
      email: user.email,
      refreshToken,
    };
  }
}
