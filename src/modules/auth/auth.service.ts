import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { UsersService } from '@/modules/users/users.service';
import { UserResponseDto, CreateUserDto } from '@/modules/users/dto';
import { LoginDto, AuthResponseDto } from './dto';
import { EmailVerificationService } from './services';
import { UnauthorizedException } from '@/common/exceptions';
import { comparePassword } from '@/common/utils';
import { IJwtPayload, ITokens } from '@/common/interfaces';
import { IJwtConfig } from '@/config';
import { ERROR_MESSAGES } from '@/common/constants';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtConfig: IJwtConfig;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {
    this.jwtConfig = this.configService.get<IJwtConfig>('jwt') as IJwtConfig;
  }

  async register(createUserDto: CreateUserDto): Promise<AuthResponseDto> {
    const user = await this.usersService.create(createUserDto);
    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    // Send verification email (fire and forget - don't block registration)
    this.emailVerificationService
      .sendVerificationEmailByUserId(user.id, user.email, user.username)
      .catch((error) => {
        this.logger.error(`Failed to send verification email: ${error.message}`);
      });

    this.logger.log(`User registered: ${user.email}`);

    return {
      user,
      tokens,
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    if (user.password === null) {
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await comparePassword(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    if (user.status !== UserStatus.ACTIVE && user.status !== UserStatus.PENDING) {
      throw new UnauthorizedException('Your account is not active. Please contact support.');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);
    await this.usersService.updateLastLogin(user.id);

    this.logger.log(`User logged in: ${user.email}`);

    return {
      user: plainToInstance(UserResponseDto, user),
      tokens,
    };
  }

  async logout(userId: string): Promise<void> {
    await this.usersService.updateRefreshToken(userId, null);
    this.logger.log(`User logged out: ${userId}`);
  }

  async refreshTokens(userId: string, refreshToken: string): Promise<ITokens> {
    const user = await this.usersService.findById(userId);

    if (!user || !user.refreshToken) {
      throw new UnauthorizedException(ERROR_MESSAGES.TOKEN_INVALID);
    }

    if (user.refreshToken !== refreshToken) {
      throw new UnauthorizedException(ERROR_MESSAGES.TOKEN_INVALID);
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    this.logger.log(`Tokens refreshed for user: ${user.email}`);

    return tokens;
  }

  private async generateTokens(userId: string, email: string, role: string): Promise<ITokens> {
    const payload: IJwtPayload = {
      sub: userId,
      email,
      role,
    };

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

  private async updateRefreshToken(userId: string, refreshToken: string): Promise<void> {
    await this.usersService.updateRefreshToken(userId, refreshToken);
  }
}
