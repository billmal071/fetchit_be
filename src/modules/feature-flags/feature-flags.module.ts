import { Global, Module } from '@nestjs/common';
import { FeatureFlagGuard } from './feature-flag.guard';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureFlagsController } from './feature-flags.controller';

/** Global so any controller can use @RequireFeature without importing anything. */
@Global()
@Module({
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagService, FeatureFlagGuard],
  exports: [FeatureFlagService, FeatureFlagGuard],
})
export class FeatureFlagsModule {}
