import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { EmailTemplateService } from '@/emails/email-template.service';

describe('EmailService', () => {
  let service: EmailService;
  let emailProvider: Record<string, jest.Mock>;
  let templateService: Record<string, jest.Mock>;

  beforeEach(async () => {
    emailProvider = { sendEmail: jest.fn() };
    templateService = { renderTemplate: jest.fn().mockResolvedValue('<html>test</html>') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: 'EMAIL_PROVIDER', useValue: emailProvider },
        { provide: EmailTemplateService, useValue: templateService },
      ],
    }).compile();

    service = module.get(EmailService);
  });

  it('should render template and send email', async () => {
    await service.sendEmail({
      to: 'a@b.com',
      subject: 'Test',
      template: 'welcome',
      context: { username: 'user1' },
    });

    expect(templateService.renderTemplate).toHaveBeenCalledWith('welcome', { username: 'user1' });
    expect(emailProvider.sendEmail).toHaveBeenCalledWith({
      to: 'a@b.com',
      subject: 'Test',
      html: '<html>test</html>',
    });
  });

  it('should send welcome email with correct template', async () => {
    await service.sendWelcomeEmail('a@b.com', 'user1');
    expect(templateService.renderTemplate).toHaveBeenCalledWith('welcome', { username: 'user1' });
    expect(emailProvider.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com', subject: 'Welcome to FetchIt!' }),
    );
  });

  it('should send password reset email with correct template', async () => {
    await service.sendPasswordResetEmail('a@b.com', 'http://reset.url', 'user1');
    expect(templateService.renderTemplate).toHaveBeenCalledWith('password-reset', {
      resetUrl: 'http://reset.url',
      username: 'user1',
    });
  });

  it('should send email verification with correct template', async () => {
    await service.sendEmailVerificationEmail('a@b.com', 'http://verify.url', 'user1');
    expect(templateService.renderTemplate).toHaveBeenCalledWith('email-verification', {
      verificationUrl: 'http://verify.url',
      username: 'user1',
    });
  });

  it('should propagate provider errors', async () => {
    emailProvider.sendEmail.mockRejectedValue(new Error('send failed'));
    await expect(
      service.sendEmail({
        to: 'a@b.com',
        subject: 'x',
        template: 'welcome',
        context: {},
      }),
    ).rejects.toThrow('send failed');
  });
});
