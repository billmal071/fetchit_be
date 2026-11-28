-- CreateTable
CREATE TABLE "feature_flags" (
    "key" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowed_roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[],
    "description" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Prisma leaves scalar-list columns nullable; the rule is that a flag always has a (possibly empty) list.
ALTER TABLE "feature_flags" ALTER COLUMN "allowed_roles" SET NOT NULL;

-- The flags the code knows about (FEATURE_FLAGS in src/common/constants/feature-flags.ts), all
-- ENABLED for everyone so that merging this changes nothing. An admin turns them off or limits
-- them to some roles through PATCH /admin/feature-flags/:key.
INSERT INTO "feature_flags" ("key", "enabled", "allowed_roles", "description", "updated_at") VALUES
    ('shopper_marketplace', true, '{}',
     'Personal-shopper marketplace: customers create shopping requests; shoppers browse requests, preview and submit offers, and manage their offers.',
     CURRENT_TIMESTAMP),
    ('shopper_orders', true, '{}',
     'Personal-shopper orders: accepting an offer, the order screens and actions for customers and shoppers, order cancel and the accept timeout.',
     CURRENT_TIMESTAMP),
    ('handyman_application_flows', true, '{}',
     'Handyman application flows: withdrawing a job application and cancelling an assigned job.',
     CURRENT_TIMESTAMP);
