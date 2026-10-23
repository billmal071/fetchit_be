import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { UsersService } from '@/modules/users/users.service';
import { UserResponseDto, CreateUserDto } from '@/modules/users/dto';
import { LoginDto, AuthResponseDto } from './dto';
import { EmailVerificationService } from './services';
import { comparePassword, hashToken } from '@/common/utils';
import { IJwtPayload, ITokens } from '@/common/interfaces';
import { EnvConfig, IJwtConfig } from '@/config';
import {
  EmailNotVerifiedException,
  InvalidCredentialsException,
  InvalidTokenException,
  AccountSuspendedException,
} from '@/common/exceptions/domain.exception';
import { REFRESH_SESSION_REPOSITORY, IRefreshSessionRepository } from '@/database/repositories';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtConfig: IJwtConfig;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly emailVerificationService: EmailVerificationService,
    @Inject(REFRESH_SESSION_REPOSITORY)
    private readonly refreshSessionRepo: IRefreshSessionRepository,
  ) {
    const config: IJwtConfig = {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: this.configService.get<'JWT_EXPIRES_IN'>('JWT_EXPIRES_IN'),
      refreshSecret: this.configService.get('JWT_REFRESH_SECRET'),
      refreshExpiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN'),
    };
    this.jwtConfig = config;
  }

  async register(createUserDto: CreateUserDto): Promise<AuthResponseDto> {
    const user = await this.usersService.create(createUserDto);

    let tokens: ITokens;
    try {
      tokens = await this.generateTokens(user.id, user.email, user.role);
      await this.createSession(user.id, tokens.refreshToken);
    } catch (error) {
      // Roll back user creation so they can retry registration
      await this.usersService.remove(user.id, true).catch((removeError) => {
        this.logger.error(
          `Failed to clean up user after registration failure: ${removeError.message}`,
        );
      });
      throw error;
    }

    // Send verification email (fire and forget - don't block registration)
    this.emailVerificationService
      .sendVerificationEmailByUserId(user.id, user.email, user.username)
      .catch((error) => {
        this.logger.error(`Failed to send verification email: ${error.message}`);
      });

    this.logger.log(`User registered: ${user.id}`);

    return { user, tokens };
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw new InvalidCredentialsException();
    }

    if (user.password === null) {
      throw new InvalidCredentialsException();
    }

    const isPasswordValid = await comparePassword(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new InvalidCredentialsException();
    }

    if (!user.emailVerified) {
      throw new EmailNotVerifiedException();
    }

    // Bug #13: email verification is the only thing that currently sets
    // status to ACTIVE (see EmailVerificationRepository.verifyAndActivateUser),
    // so reaching this point with a non-ACTIVE status means an admin
    // suspended/deactivated the account after verification — reject here
    // with a clear reason instead of issuing tokens the user can't actually
    // use (JwtStrategy would 401 "account is not active" on the very next
    // authenticated request).
    if (user.status !== UserStatus.ACTIVE) {
      throw new AccountSuspendedException();
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.createSession(user.id, tokens.refreshToken);
    await this.usersService.updateLastLogin(user.id);

    this.logger.log(`User logged in: ${user.id}`);

    return {
      user: plainToInstance(UserResponseDto, user),
      tokens,
    };
  }

  /**
   * Bug #12: `logout` used to clear the single `refreshToken` column on
   * `User`, so it had no way to log out just one device — and conversely a
   * second device's login, which overwrote that same column, logged out
   * the first without anyone asking for that. Each login/refresh now owns
   * its own `RefreshSession` row: pass the session's own refresh token to
   * revoke only it, or omit it to revoke every device (the old endpoint's
   * only behavior, kept as the default so existing callers don't change
   * behavior).
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.refreshSessionRepo.revokeByTokenHash(hashToken(refreshToken), userId);
    } else {
      await this.refreshSessionRepo.revokeAllForUser(userId);
    }
    this.logger.log(`User logged out: ${userId}`);
  }

  async refreshTokens(userId: string, refreshToken: string): Promise<ITokens> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new InvalidTokenException('refresh token');
    }

    // Bug #13: a session created while the account was ACTIVE is still
    // valid-looking after an admin suspends it — the token itself doesn't
    // expire just because status changed. Re-check here, not just at
    // login, so a suspended user's existing sessions stop minting fresh
    // access tokens immediately instead of trickling out an "account is
    // not active" 401 from JwtStrategy on whatever request happens next.
    if (user.status !== UserStatus.ACTIVE) {
      throw new AccountSuspendedException();
    }

    // Looked up by the token's own hash (deterministic SHA-256, see
    // hashToken), so a match already proves the token is correct — no
    // separate timingSafeEqual compare needed the way the old single-column
    // design required one (there, the lookup was by userId alone, so the
    // token itself had to be checked after the fact).
    const tokenHash = hashToken(refreshToken);
    const session = await this.refreshSessionRepo.findActiveByTokenHash(tokenHash);
    if (!session || session.userId !== user.id) {
      throw new InvalidTokenException('refresh token');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    // Rotate the same row in place — this is the one that keeps "one row
    // per device" true across a session's lifetime instead of growing a
    // new row every time the access token expires. Conditional on the row
    // still holding `tokenHash` and still being non-revoked: closes the
    // window where a concurrent logout or a second concurrent refresh of
    // this same token raced the read above (see rotate's doc comment).
    const rotated = await this.refreshSessionRepo.rotate(
      session.id,
      tokenHash,
      hashToken(tokens.refreshToken),
      this.decodeExpiry(tokens.refreshToken),
    );
    if (!rotated) {
      throw new InvalidTokenException('refresh token');
    }

    this.logger.log(`Tokens refreshed for: ${userId}`);

    return tokens;
  }

  private async generateTokens(userId: string, email: string, role: string): Promise<ITokens> {
    const payload: IJwtPayload = {
      sub: userId,
      email,
      role,
    };
    // Random nonce so two refresh tokens signed in the same second for the
    // same user don't come out byte-identical — see IJwtPayload.jti.
    const refreshPayload: IJwtPayload = { ...payload, jti: randomUUID() };

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

  private async createSession(userId: string, refreshToken: string): Promise<void> {
    await this.refreshSessionRepo.create({
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: this.decodeExpiry(refreshToken),
    });
  }

  /**
   * Reads the `exp` claim off the token we just signed instead of
   * re-parsing `JWT_REFRESH_EXPIRES_IN` ("7d" etc.) ourselves — keeps the
   * session row's expiry guaranteed consistent with the token's actual
   * expiry with no separate duration-parsing logic to drift out of sync.
   */
  private decodeExpiry(token: string): Date {
    const payload = this.jwtService.decode<IJwtPayload>(token);
    if (!payload?.exp) {
      throw new InvalidTokenException('refresh token');
    }
    return new Date(payload.exp * 1000);
  }
}
