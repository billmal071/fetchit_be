import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RefreshTokenDto,
  AuthResponseDto,
  TokensDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
  SendVerificationDto,
} from './dto';
import { PasswordResetService, EmailVerificationService, OAuthService } from './services';
import { IGoogleProfile } from './strategies';
import { CreateUserDto } from '@/modules/users/dto';
import { JwtRefreshGuard, GoogleAuthGuard } from './guards';
import { Public, CurrentUser } from '@/common/decorators';
import {
  ApiSuccessResponse,
  ApiCreatedSuccessResponse,
  ApiErrorResponses,
} from '@/common/decorators';
import { SUCCESS_MESSAGES } from '@/common/constants';
import { IRequestUser } from '@/common/interfaces';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly oauthService: OAuthService,
  ) {}

  @Post('register')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Register a new user',
    description: 'Create a new user account with email and password. Sends a verification email.',
  })
  @ApiCreatedSuccessResponse(AuthResponseDto)
  @ApiErrorResponses()
  async register(@Body() createUserDto: CreateUserDto): Promise<{
    data: AuthResponseDto;
    message: string;
  }> {
    const result = await this.authService.register(createUserDto);
    return { data: result, message: SUCCESS_MESSAGES.USER_CREATED };
  }

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with email and password',
    description: 'Authenticate with email and password. Returns JWT access and refresh tokens.',
  })
  @ApiSuccessResponse(AuthResponseDto)
  @ApiErrorResponses()
  async login(@Body() loginDto: LoginDto): Promise<{
    data: AuthResponseDto;
    message: string;
  }> {
    const result = await this.authService.login(loginDto);
    return { data: result, message: SUCCESS_MESSAGES.LOGIN_SUCCESS };
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout current user',
    description: 'Invalidate the current refresh token.',
  })
  @ApiErrorResponses()
  async logout(@CurrentUser() user: IRequestUser): Promise<{ message: string }> {
    await this.authService.logout(user.id);
    return { message: SUCCESS_MESSAGES.LOGOUT_SUCCESS };
  }

  @Post('refresh')
  @Public()
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Exchange a valid refresh token for new access and refresh tokens.',
  })
  @ApiSuccessResponse(TokensDto)
  @ApiErrorResponses()
  async refreshTokens(
    @Body() refreshTokenDto: RefreshTokenDto,
    @CurrentUser() user: { id: string; refreshToken: string },
  ): Promise<{ data: { accessToken: string; refreshToken: string } }> {
    const tokens = await this.authService.refreshTokens(user.id, user.refreshToken);
    return { data: tokens };
  }

  // ==================== Password Reset ====================

  @Post('forgot-password')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request password reset email',
    description: 'Send a password reset email to the registered address.',
  })
  @ApiErrorResponses()
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.passwordResetService.requestPasswordReset(dto);
    return { message: SUCCESS_MESSAGES.PASSWORD_RESET_EMAIL_SENT };
  }

  @Post('reset-password')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password with token',
    description: 'Reset password using a valid reset token from email.',
  })
  @ApiErrorResponses()
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.passwordResetService.resetPassword(dto);
    return { message: SUCCESS_MESSAGES.PASSWORD_RESET };
  }

  // ==================== Email Verification ====================

  @Post('send-verification')
  @Public()
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request email verification link',
    description: 'Resend the email verification link.',
  })
  @ApiErrorResponses()
  async sendVerificationEmail(@Body() dto: SendVerificationDto): Promise<{ message: string }> {
    await this.emailVerificationService.sendVerificationEmail(dto.email);
    return { message: SUCCESS_MESSAGES.EMAIL_VERIFICATION_SENT };
  }

  @Post('verify-email')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify email with token',
    description: 'Verify email address using the token from verification email.',
  })
  @ApiErrorResponses()
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ message: string }> {
    await this.emailVerificationService.verifyEmail(dto);
    return { message: SUCCESS_MESSAGES.EMAIL_VERIFIED };
  }

  // ==================== Google OAuth ====================

  @Get('google')
  @Public()
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({
    summary: 'Initiate Google OAuth flow',
    description: 'Initiate Google OAuth2 authentication flow.',
  })
  async googleAuth(): Promise<void> {
    // Guard redirects to Google
  }

  @Get('google/callback')
  @Public()
  @UseGuards(GoogleAuthGuard)
  @ApiExcludeEndpoint()
  async googleAuthCallback(
    @CurrentUser() googleUser: IGoogleProfile,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const { redirectUrl } = await this.oauthService.handleGoogleLogin({
        googleId: googleUser.googleId,
        email: googleUser.email,
        firstName: googleUser.firstName,
        lastName: googleUser.lastName,
        picture: googleUser.picture,
      });
      res.redirect(redirectUrl);
    } catch (error) {
      const errorUrl = this.oauthService.getFrontendErrorUrl(
        error instanceof Error ? error.message : 'OAuth authentication failed',
      );
      res.redirect(errorUrl);
    }
  }
}
