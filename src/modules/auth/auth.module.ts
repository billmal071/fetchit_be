import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy, JwtRefreshStrategy, GoogleStrategy } from './strategies';
import { PasswordResetService, EmailVerificationService, OAuthService } from './services';
import { UsersModule } from '@/modules/users/users.module';
import { JobsModule } from '@/jobs/jobs.module';
import { IJwtConfig } from '@/config';

@Module({
  imports: [
    UsersModule,
    JobsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const jwtConfig = configService.get<IJwtConfig>('jwt');
        return {
          secret: jwtConfig?.secret,
          signOptions: {
            expiresIn: jwtConfig?.expiresIn,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordResetService,
    EmailVerificationService,
    OAuthService,
    JwtStrategy,
    JwtRefreshStrategy,
    GoogleStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
