import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  UserRepository,
  WaitlistRepository,
  PasswordResetRepository,
  EmailVerificationRepository,
  USER_REPOSITORY,
  WAITLIST_REPOSITORY,
  PASSWORD_RESET_REPOSITORY,
  EMAIL_VERIFICATION_REPOSITORY,
} from './repositories';

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: USER_REPOSITORY,
      useClass: UserRepository,
    },
    {
      provide: WAITLIST_REPOSITORY,
      useClass: WaitlistRepository,
    },
    {
      provide: PASSWORD_RESET_REPOSITORY,
      useClass: PasswordResetRepository,
    },
    {
      provide: EMAIL_VERIFICATION_REPOSITORY,
      useClass: EmailVerificationRepository,
    },
  ],
  exports: [
    PrismaService,
    USER_REPOSITORY,
    WAITLIST_REPOSITORY,
    PASSWORD_RESET_REPOSITORY,
    EMAIL_VERIFICATION_REPOSITORY,
  ],
})
export class DatabaseModule {}
