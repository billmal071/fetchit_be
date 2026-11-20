-- CreateEnum
CREATE TYPE "ShopperAccountState" AS ENUM ('REGISTERED', 'ONBOARDING', 'VERIFICATION_PENDING', 'VERIFICATION_REQUIRES_UPDATE', 'APPROVED', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "shopping_categories" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "icon" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopping_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_locations" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopping_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extra_services" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "fee" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extra_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopper_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_state" "ShopperAccountState" NOT NULL DEFAULT 'REGISTERED',
    "display_name" VARCHAR(100),
    "bio" TEXT,
    "years_of_experience" INTEGER,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "rating" DECIMAL(3,2),
    "completed_orders" INTEGER NOT NULL DEFAULT 0,
    "completion_rate" DECIMAL(5,2),
    "payout_account_verified" BOOLEAN NOT NULL DEFAULT false,
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopper_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopper_profile_categories" (
    "shopper_profile_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "shopper_profile_categories_pkey" PRIMARY KEY ("shopper_profile_id","category_id")
);

-- CreateTable
CREATE TABLE "shopper_profile_locations" (
    "shopper_profile_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,

    CONSTRAINT "shopper_profile_locations_pkey" PRIMARY KEY ("shopper_profile_id","location_id")
);

-- CreateTable
CREATE TABLE "shopper_profile_services" (
    "shopper_profile_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,

    CONSTRAINT "shopper_profile_services_pkey" PRIMARY KEY ("shopper_profile_id","service_id")
);

-- CreateTable
CREATE TABLE "shopper_availability" (
    "id" TEXT NOT NULL,
    "shopper_profile_id" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),

    CONSTRAINT "shopper_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopping_categories_name_key" ON "shopping_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_categories_slug_key" ON "shopping_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "shopping_locations_name_key" ON "shopping_locations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "extra_services_name_key" ON "extra_services"("name");

-- CreateIndex
CREATE UNIQUE INDEX "shopper_profiles_user_id_key" ON "shopper_profiles"("user_id");

-- CreateIndex
CREATE INDEX "shopper_profiles_account_state_idx" ON "shopper_profiles"("account_state");

-- CreateIndex
CREATE UNIQUE INDEX "shopper_availability_shopper_profile_id_weekday_key" ON "shopper_availability"("shopper_profile_id", "weekday");

-- AddForeignKey
ALTER TABLE "shopper_profiles" ADD CONSTRAINT "shopper_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_profile_categories" ADD CONSTRAINT "shopper_profile_categories_shopper_profile_id_fkey" FOREIGN KEY ("shopper_profile_id") REFERENCES "shopper_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_profile_categories" ADD CONSTRAINT "shopper_profile_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "shopping_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_profile_locations" ADD CONSTRAINT "shopper_profile_locations_shopper_profile_id_fkey" FOREIGN KEY ("shopper_profile_id") REFERENCES "shopper_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_profile_locations" ADD CONSTRAINT "shopper_profile_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "shopping_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_profile_services" ADD CONSTRAINT "shopper_profile_services_shopper_profile_id_fkey" FOREIGN KEY ("shopper_profile_id") REFERENCES "shopper_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_profile_services" ADD CONSTRAINT "shopper_profile_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "extra_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_availability" ADD CONSTRAINT "shopper_availability_shopper_profile_id_fkey" FOREIGN KEY ("shopper_profile_id") REFERENCES "shopper_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: dev defaults for the reference data the shopper onboarding form is built
-- from. These mirror the FE's placeholder option lists; they are ordinary rows
-- (admin-editable), not constants. Idempotent: re-running changes nothing.
-- Extra services are NOT seeded: their fees are Fetchit-configured and no
-- catalogue has been decided.
INSERT INTO "shopping_categories" ("id", "name", "slug", "updated_at") VALUES
    (gen_random_uuid(), 'Food & Groceries', 'food-groceries', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Fashion', 'fashion', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Home Appliances', 'home-appliances', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Electronics', 'electronics', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Beauty & Personal Care', 'beauty-personal-care', CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "shopping_locations" ("id", "name", "city", "state", "updated_at") VALUES
    (gen_random_uuid(), 'Balogun Market', 'Lagos', 'Lagos', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Mile 12 Market', 'Lagos', 'Lagos', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Computer Village', 'Ikeja', 'Lagos', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Mushin Market', 'Lagos', 'Lagos', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Yaba', 'Lagos', 'Lagos', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Ikeja', 'Ikeja', 'Lagos', CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Lekki', 'Lagos', 'Lagos', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
