import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  UserRepository,
  WaitlistRepository,
  PasswordResetRepository,
  EmailVerificationRepository,
  HandymanProfileRepository,
  HandymanDocumentRepository,
  ServiceCategoryRepository,
  ServiceRequestRepository,
  ServiceRequestApplicationRepository,
  USER_REPOSITORY,
  WAITLIST_REPOSITORY,
  PASSWORD_RESET_REPOSITORY,
  EMAIL_VERIFICATION_REPOSITORY,
  HANDYMAN_PROFILE_REPOSITORY,
  HANDYMAN_DOCUMENT_REPOSITORY,
  SERVICE_CATEGORY_REPOSITORY,
  SERVICE_REQUEST_REPOSITORY,
  SERVICE_REQUEST_APPLICATION_REPOSITORY,
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
    {
      provide: HANDYMAN_PROFILE_REPOSITORY,
      useClass: HandymanProfileRepository,
    },
    {
      provide: HANDYMAN_DOCUMENT_REPOSITORY,
      useClass: HandymanDocumentRepository,
    },
    {
      provide: SERVICE_CATEGORY_REPOSITORY,
      useClass: ServiceCategoryRepository,
    },
    {
      provide: SERVICE_REQUEST_REPOSITORY,
      useClass: ServiceRequestRepository,
    },
    {
      provide: SERVICE_REQUEST_APPLICATION_REPOSITORY,
      useClass: ServiceRequestApplicationRepository,
    },
  ],
  exports: [
    PrismaService,
    USER_REPOSITORY,
    WAITLIST_REPOSITORY,
    PASSWORD_RESET_REPOSITORY,
    EMAIL_VERIFICATION_REPOSITORY,
    HANDYMAN_PROFILE_REPOSITORY,
    HANDYMAN_DOCUMENT_REPOSITORY,
    SERVICE_CATEGORY_REPOSITORY,
    SERVICE_REQUEST_REPOSITORY,
    SERVICE_REQUEST_APPLICATION_REPOSITORY,
  ],
})
export class DatabaseModule {}
