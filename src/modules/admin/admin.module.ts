import { Module } from '@nestjs/common';
import { AdminVerificationController } from './admin-verification.controller';
import { AdminVerificationService } from './admin-verification.service';
import { AdminShopperVerificationController } from './admin-shopper-verification.controller';
import { AdminShopperVerificationService } from './admin-shopper-verification.service';
import { AdminShoppingConfigController } from './admin-shopping-config.controller';
import { AdminShoppingConfigService } from './admin-shopping-config.service';
import { AdminFeatureFlagsController } from './admin-feature-flags.controller';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';

@Module({
  controllers: [
    AdminVerificationController,
    AdminShopperVerificationController,
    AdminShoppingConfigController,
    AdminFeatureFlagsController,
  ],
  providers: [
    AdminVerificationService,
    AdminShopperVerificationService,
    AdminShoppingConfigService,
    AdminFeatureFlagsService,
  ],
  exports: [
    AdminVerificationService,
    AdminShopperVerificationService,
    AdminShoppingConfigService,
    AdminFeatureFlagsService,
  ],
})
export class AdminModule {}
