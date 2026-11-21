import { Module } from '@nestjs/common';
import { AdminVerificationController } from './admin-verification.controller';
import { AdminVerificationService } from './admin-verification.service';
import { AdminShopperVerificationController } from './admin-shopper-verification.controller';
import { AdminShopperVerificationService } from './admin-shopper-verification.service';

@Module({
  controllers: [AdminVerificationController, AdminShopperVerificationController],
  providers: [AdminVerificationService, AdminShopperVerificationService],
  exports: [AdminVerificationService, AdminShopperVerificationService],
})
export class AdminModule {}
