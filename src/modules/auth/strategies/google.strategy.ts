import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { IGoogleConfig } from '@/config';

export interface IGoogleProfile {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
  picture: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly configService: ConfigService) {
    const googleConfig = configService.get<IGoogleConfig>('google');

    if (!googleConfig?.callbackUrl) {
      throw new Error(
        'Google OAuth callbackUrl is not configured. Set GOOGLE_CALLBACK_URL in your environment.',
      );
    }

    super({
      clientID: googleConfig?.clientId || '',
      clientSecret: googleConfig?.clientSecret || '',
      callbackURL: googleConfig.callbackUrl,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const { id, name, emails, photos } = profile;

    // Only pass fields needed for account creation/lookup.
    // Google access token is intentionally excluded — it is not stored or used
    // after the initial OAuth handshake.
    const user: IGoogleProfile = {
      googleId: id,
      email: emails?.[0]?.value || '',
      firstName: name?.givenName || '',
      lastName: name?.familyName || '',
      picture: photos?.[0]?.value || '',
    };

    done(null, user);
  }
}
