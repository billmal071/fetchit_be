import { Module } from '@nestjs/common';
import { AdminVerificationController } from './admin-verification.controller';
import { AdminVerificationService } from './admin-verification.service';
import { AdminShopperVerificationController } from './admin-shopper-verification.controller';
import { AdminShopperVerificationService } from './admin-shopper-verification.service';
import { AdminShoppingConfigController } from './admin-shopping-config.controller';
import { AdminShoppingConfigService } from './admin-shopping-config.service';

@Module({
  controllers: [
    AdminVerificationController,
    AdminShopperVerificationController,
    AdminShoppingConfigController,
  ],
  providers: [
    AdminVerificationService,
    AdminShopperVerificationService,
    AdminShoppingConfigService,
  ],
  exports: [AdminVerificationService, AdminShopperVerificationService, AdminShoppingConfigService],
})
export class AdminModule {}
