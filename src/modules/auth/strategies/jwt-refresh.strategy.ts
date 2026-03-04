import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { IJwtPayload } from '@/common/interfaces';
import { IJwtConfig } from '@/config';
import { UsersService } from '@/modules/users/users.service';
import { compareToken } from '@/common/utils';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
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

    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const isTokenValid = await compareToken(refreshToken, user.refreshToken);
    if (!isTokenValid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      id: user.id,
      email: user.email,
      refreshToken,
    };
  }
}
