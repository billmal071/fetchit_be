import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider, User, UserStatus } from '@prisma/client';
import { UsersService } from '@/modules/users/users.service';
import { PrismaService } from '@/database/prisma.service';
import { IAppConfig, IJwtConfig } from '@/config';
import { IJwtPayload, ITokens } from '@/common/interfaces';
import { BadRequestException } from '@/common/exceptions';
import { hashToken } from '@/common/utils';
import { REFRESH_SESSION_REPOSITORY, IRefreshSessionRepository } from '@/database/repositories';

export interface IGoogleUser {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
  picture: string;
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
    @Inject(REFRESH_SESSION_REPOSITORY)
    private readonly refreshSessionRepo: IRefreshSessionRepository,
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

    // Bug #13: same check as AuthService.login — a suspended/deactivated
    // account shouldn't come out of OAuth with working tokens either.
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('This account is not active');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email, user.role);
    const payload = this.jwtService.decode<IJwtPayload>(tokens.refreshToken);
    if (!payload?.exp) {
      // Can't happen in practice — this decodes the token signed two lines
      // above — but failing closed here matters: the alternative is
      // silently writing expiresAt as the Unix epoch, which would create a
      // RefreshSession that is dead on arrival with no error surfaced
      // anywhere (see AuthService.decodeExpiry, which throws for the
      // same reason).
      throw new BadRequestException('Failed to generate session for OAuth login');
    }
    await this.refreshSessionRepo.create({
      userId: user.id,
      tokenHash: hashToken(tokens.refreshToken),
      expiresAt: new Date(payload.exp * 1000),
    });
    await this.usersService.updateLastLogin(user.id);

    // Build redirect URL with tokens in URL fragment (hash) to keep them out of
    // server logs, browser history, and Referer headers. isNewUser travels the
    // same way: the frontend needs it to decide whether to show the role
    // picker, and `updateLastLogin` just ran above, so `lastLoginAt` alone
    // can no longer tell a brand-new signup apart from a returning user.
    const redirectUrl =
      `${this.frontendUrl}/auth/oauth-callback#accessToken=${tokens.accessToken}` +
      `&refreshToken=${tokens.refreshToken}&isNewUser=${isNewUser}`;

    this.logger.log(`OAuth login successful for: ${user.email}`);

    return { tokens, redirectUrl, isNewUser };
  }

  private async linkGoogleAccount(
    userId: string,
    googleId: string,
    avatar?: string,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        googleId,
        avatar: avatar || undefined,
        emailVerified: true, // Google verifies email
        // Bug #13: without this, a user who registered by email, never
        // verified, then signs in with Google ends up emailVerified=true
        // but still PENDING (the schema default — regular registration
        // never sets status, only EmailVerificationRepository's own
        // verify flow does). That used to just mean confusing 401s later;
        // now that login/refresh/OAuth all reject non-ACTIVE accounts,
        // it would be a permanent "your account is suspended" lockout
        // with no way out (resend-verification short-circuits on
        // emailVerified already being true, so the normal unlock path
        // never fires either).
        status: UserStatus.ACTIVE,
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
    // See IJwtPayload.jti: without a nonce, two logins in the same second
    // sign byte-identical refresh tokens and collide on RefreshSession's
    // unique tokenHash constraint.
    const refreshPayload = { ...payload, jti: randomUUID() };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.jwtConfig.secret,
        expiresIn: this.jwtConfig.expiresIn,
        algorithm: 'HS256',
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.jwtConfig.refreshSecret,
        expiresIn: this.jwtConfig.refreshExpiresIn,
        algorithm: 'HS256',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  getFrontendErrorUrl(error: string): string {
    // Log the detailed error server-side only; never expose raw messages to the client.
    this.logger.error(`OAuth error: ${error}`);
    const errorCode = this.mapErrorToCode(error);
    return `${this.frontendUrl}/auth/oauth-error?error=${errorCode}`;
  }

  private mapErrorToCode(error: string): string {
    const lower = error.toLowerCase();
    if (lower.includes('already linked') || lower.includes('account exists')) {
      return 'account_exists';
    }
    if (lower.includes('not active')) {
      return 'account_suspended';
    }
    return 'oauth_failed';
  }
}
