import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import type { FeatureFlagKey } from '@common/constants';
import { FeatureFlagGuard } from './feature-flag.guard';
import { FEATURE_FLAG_METADATA } from './feature-flag.metadata';

/**
 * Gate a controller or a route behind a feature flag. Put it on a class or a method; a
 * method's flag wins over its class's. When the flag is off for the caller the route
 * answers 404 FEATURE_DISABLED ("This feature is not available yet").
 *
 * The guard is attached HERE, as a controller/route guard, and is not global: global
 * guards (JWT, roles) run first, so by the time it runs `request.user` exists and an
 * unauthenticated request has already been answered with 401.
 */
export const RequireFeature = (key: FeatureFlagKey): ReturnType<typeof applyDecorators> =>
  applyDecorators(SetMetadata(FEATURE_FLAG_METADATA, key), UseGuards(FeatureFlagGuard));
