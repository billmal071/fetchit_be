/**
 * Every feature flag the code knows about. The values are the `key` column of the
 * `feature_flags` table; the migration seeds one row per entry here (a test keeps the two
 * in step). Adding a flag = add it here AND seed it in a migration.
 */
export const FEATURE_FLAGS = {
  SHOPPER_MARKETPLACE: 'shopper_marketplace',
  SHOPPER_ORDERS: 'shopper_orders',
  HANDYMAN_APPLICATION_FLOWS: 'handyman_application_flows',
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = Object.values(FEATURE_FLAGS);

/** The error `code` a gated route answers with (HTTP 404) when its flag is off for the caller. */
export const FEATURE_DISABLED_CODE = 'FEATURE_DISABLED';
export const FEATURE_DISABLED_MESSAGE = 'This feature is not available yet';
