import { Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import { WelcomeEmail } from './templates/WelcomeEmail';
import { PasswordResetEmail } from './templates/PasswordResetEmail';
import { EmailVerificationEmail } from './templates/EmailVerificationEmail';
import { ShopperApplicationEmail } from './templates/ShopperApplicationEmail';

export type TemplateName = 'welcome' | 'password-reset' | 'email-verification'
  | 'shopper-approved'
  | 'shopper-needs-update';

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
      case 'shopper-approved':
        return render(
          <ShopperApplicationEmail
            outcome="approved"
            username={String(context.username ?? '')}
          />,
          { pretty: true },
        );
      case 'shopper-needs-update':
        return render(
          <ShopperApplicationEmail
            outcome="needs-update"
            username={String(context.username ?? '')}
            reason={String(context.reason ?? '')}
          />,
          { pretty: true },
        );
      default:
        return `<p>${JSON.stringify(context)}</p>`;
    }
  }
}

