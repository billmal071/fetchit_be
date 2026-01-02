import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider } from '@prisma/client';
import { UsersService } from '@/modules/users/users.service';
import { PrismaService } from '@/database/prisma.service';
import { IAppConfig, IJwtConfig } from '@/config';
import { ITokens } from '@/common/interfaces';
import { BadRequestException } from '@/common/exceptions';

export interface IGoogleUser {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
  picture: string;
  accessToken: string;
}

export interface IOAuthResult {
  tokens: ITokens;
  redirectUrl: string;
  isNewUser: boolean;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly jwtConfig: IJwtConfig;
  private readonly frontendUrl: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.jwtConfig = this.configService.get<IJwtConfig>('jwt') as IJwtConfig;
    const appConfig = this.configService.get<IAppConfig>('app');
    this.frontendUrl = appConfig?.frontendUrl || 'http://localhost:4200';
  }

  async handleGoogleLogin(googleUser: IGoogleUser): Promise<IOAuthResult> {
    let isNewUser = false;

    // Try to find existing user by Google ID
    let user = await this.usersService.findByGoogleId(googleUser.googleId);

    if (!user) {
      // Check if user exists with same email (for account linking)
      const existingUser = await this.usersService.findByEmail(googleUser.email);

      if (existingUser) {
        // Link Google ID to existing account
        if (existingUser.provider === AuthProvider.GOOGLE) {
          // This shouldn't happen, but handle it
          throw new BadRequestException('Account already linked to a different Google account');
        }

        // Link the Google account to existing user
        user = await this.linkGoogleAccount(
          existingUser.id,
          googleUser.googleId,
          googleUser.picture,
        );
        this.logger.log(`Google account linked to existing user: ${googleUser.email}`);
      } else {
        // Create new OAuth user
        const username = this.generateUsername(googleUser.email, googleUser.firstName);
        const newUser = await this.usersService.createOAuthUser({
          email: googleUser.email,
          username,
          googleId: googleUser.googleId,
          avatar: googleUser.picture,
        });

        user = await this.usersService.findById(newUser.id);
        isNewUser = true;
        this.logger.log(`New OAuth user created: ${googleUser.email}`);
      }
    }

    if (!user) {
      throw new BadRequestException('Failed to create or find user');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.usersService.updateRefreshToken(user.id, tokens.refreshToken);
    await this.usersService.updateLastLogin(user.id);

    // Build redirect URL with tokens
    const redirectUrl = `${this.frontendUrl}/auth/oauth-callback?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`;

    this.logger.log(`OAuth login successful for: ${user.email}`);

    return { tokens, redirectUrl, isNewUser };
  }

  private async linkGoogleAccount(
    userId: string,
    googleId: string,
    avatar?: string,
  ): Promise<unknown> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        googleId,
        avatar: avatar || undefined,
        emailVerified: true, // Google verifies email
      },
    });
  }

  private generateUsername(email: string, firstName: string): string {
    const base = firstName?.toLowerCase() || email.split('@')[0];
    const sanitized = base.replace(/[^a-zA-Z0-9_]/g, '');
    const random = Math.random().toString(36).substring(2, 6);
    return `${sanitized}_${random}`;
  }

  private async generateTokens(userId: string, email: string, role: string): Promise<ITokens> {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.jwtConfig.secret,
        expiresIn: this.jwtConfig.expiresIn,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.jwtConfig.refreshSecret,
        expiresIn: this.jwtConfig.refreshExpiresIn,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  getFrontendErrorUrl(error: string): string {
    return `${this.frontendUrl}/auth/oauth-error?error=${encodeURIComponent(error)}`;
  }
}
