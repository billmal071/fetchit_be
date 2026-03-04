import { Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import { WelcomeEmail } from './templates/WelcomeEmail';
import { PasswordResetEmail } from './templates/PasswordResetEmail';
import { EmailVerificationEmail } from './templates/EmailVerificationEmail';

export type TemplateName = 'welcome' | 'password-reset' | 'email-verification';

@Injectable()
export class EmailTemplateService {
  async renderTemplate(template: TemplateName, context: Record<string, unknown>): Promise<string> {
    switch (template) {
      case 'welcome':
        return render(
          <WelcomeEmail username={String(context.username ?? '')} />,
          { pretty: true },
        );
      case 'password-reset':
        return render(
          <PasswordResetEmail
            username={String(context.username ?? '')}
            resetUrl={String(context.resetUrl ?? '')}
          />,
          { pretty: true },
        );
      case 'email-verification':
        return render(
          <EmailVerificationEmail
            username={String(context.username ?? '')}
            verificationUrl={String(context.verificationUrl ?? '')}
          />,
          { pretty: true },
        );
      default:
        return `<p>${JSON.stringify(context)}</p>`;
    }
  }
}

