import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService, EmailVerificationService, OAuthService } from './services';
import { SUCCESS_MESSAGES } from '@/common/constants';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Record<string, jest.Mock>;
  let passwordResetService: Record<string, jest.Mock>;
  let emailVerificationService: Record<string, jest.Mock>;
  let oauthService: Record<string, jest.Mock>;

  beforeEach(async () => {
    authService = {
      register: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
      login: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
      logout: jest.fn(),
      refreshTokens: jest.fn().mockResolvedValue({ accessToken: 'at2', refreshToken: 'rt2' }),
    };
    passwordResetService = {
      requestPasswordReset: jest.fn(),
      resetPassword: jest.fn(),
    };
    emailVerificationService = {
      sendVerificationEmail: jest.fn(),
      verifyEmail: jest.fn(),
    };
    oauthService = {
      handleGoogleLogin: jest.fn().mockResolvedValue({ redirectUrl: 'http://redirect.url' }),
      getFrontendErrorUrl: jest.fn().mockReturnValue('http://error.url'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: PasswordResetService, useValue: passwordResetService },
        { provide: EmailVerificationService, useValue: emailVerificationService },
        { provide: OAuthService, useValue: oauthService },
      ],
    }).compile();

    controller = module.get(AuthController);
  });

  it('register should call authService.register and return data with message', async () => {
    const dto = { email: 'a@b.com', password: 'P@ss1234', username: 'user1' } as any;
    const result = await controller.register(dto);
    expect(authService.register).toHaveBeenCalledWith(dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.USER_CREATED);
    expect(result.data).toBeDefined();
  });

  it('login should call authService.login', async () => {
    const dto = { email: 'a@b.com', password: 'P@ss1234' };
    const result = await controller.login(dto);
    expect(authService.login).toHaveBeenCalledWith(dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.LOGIN_SUCCESS);
  });

  it('logout should call authService.logout with user id', async () => {
    const result = await controller.logout({ id: 'u1', email: 'a@b.com', role: 'CUSTOMER' });
    expect(authService.logout).toHaveBeenCalledWith('u1');
    expect(result.message).toBe(SUCCESS_MESSAGES.LOGOUT_SUCCESS);
  });

  it('refreshTokens should call authService.refreshTokens', async () => {
    const result = await controller.refreshTokens(
      { refreshToken: 'rt' },
      { id: 'u1', refreshToken: 'rt' },
    );
    expect(authService.refreshTokens).toHaveBeenCalledWith('u1', 'rt');
    expect(result.data.accessToken).toBeDefined();
  });

  it('forgotPassword should call passwordResetService', async () => {
    const dto = { email: 'a@b.com' };
    const result = await controller.forgotPassword(dto);
    expect(passwordResetService.requestPasswordReset).toHaveBeenCalledWith(dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.PASSWORD_RESET_EMAIL_SENT);
  });

  it('resetPassword should call passwordResetService', async () => {
    const dto = { token: 't', password: 'P@ss1234', confirmPassword: 'P@ss1234' };
    const result = await controller.resetPassword(dto);
    expect(passwordResetService.resetPassword).toHaveBeenCalledWith(dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.PASSWORD_RESET);
  });

  it('sendVerificationEmail should call emailVerificationService', async () => {
    const result = await controller.sendVerificationEmail({ email: 'a@b.com' });
    expect(emailVerificationService.sendVerificationEmail).toHaveBeenCalledWith('a@b.com');
    expect(result.message).toBe(SUCCESS_MESSAGES.EMAIL_VERIFICATION_SENT);
  });

  it('verifyEmail should call emailVerificationService', async () => {
    const dto = { token: 'valid-token' };
    const result = await controller.verifyEmail(dto);
    expect(emailVerificationService.verifyEmail).toHaveBeenCalledWith(dto);
    expect(result.message).toBe(SUCCESS_MESSAGES.EMAIL_VERIFIED);
  });

  it('googleAuthCallback should redirect to redirectUrl on success', async () => {
    const res = { redirect: jest.fn() } as any;
    const googleUser = {
      googleId: 'g1',
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      picture: 'pic',
    };
    await controller.googleAuthCallback(googleUser, res);
    expect(res.redirect).toHaveBeenCalledWith('http://redirect.url');
  });

  it('googleAuthCallback should redirect to error URL on failure', async () => {
    oauthService.handleGoogleLogin.mockRejectedValue(new Error('OAuth failed'));
    const res = { redirect: jest.fn() } as any;
    const googleUser = {
      googleId: 'g1',
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      picture: 'pic',
    };
    await controller.googleAuthCallback(googleUser, res);
    expect(oauthService.getFrontendErrorUrl).toHaveBeenCalledWith('OAuth failed');
    expect(res.redirect).toHaveBeenCalledWith('http://error.url');
  });
});
