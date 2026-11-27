-- CreateEnum
CREATE TYPE "ShoppingRequestStatus" AS ENUM ('OPEN', 'ASSIGNED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubstitutionPreference" AS ENUM ('REFUND', 'SIMILAR_UP_TO');

-- CreateEnum
CREATE TYPE "ShoppingOfferState" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "shopping_requests" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "ShoppingRequestStatus" NOT NULL DEFAULT 'OPEN',
    "shopping_location_id" TEXT NOT NULL,
    "handoff_area" VARCHAR(100),
    "delivery_address" TEXT NOT NULL,
    "delivery_latitude" DOUBLE PRECISION,
    "delivery_longitude" DOUBLE PRECISION,
    "note" TEXT,
    "estimated_goods_budget" INTEGER NOT NULL,
    "estimate" JSONB NOT NULL,
    "offer_deadline" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopping_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_request_items" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "brand" VARCHAR(100) NOT NULL,
    "size" VARCHAR(50) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "estimated_unit_price" INTEGER NOT NULL,
    "notes" TEXT,
    "substitution_preference" "SubstitutionPreference" NOT NULL DEFAULT 'REFUND',
    "max_substitute_price" INTEGER,
    "category_id" TEXT,

    CONSTRAINT "shopping_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_offers" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "shopper_profile_id" TEXT NOT NULL,
    "state" "ShoppingOfferState" NOT NULL DEFAULT 'PENDING',
    "shopper_fee" INTEGER NOT NULL,
    "eta_minutes" INTEGER NOT NULL,
    "note" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "financials" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopping_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "min_shopper_fee" INTEGER NOT NULL,
    "max_shopper_fee" INTEGER NOT NULL,
    "delivery_fee" INTEGER NOT NULL,
    "service_charge_percent" DECIMAL(5,2) NOT NULL,
    "vat_percent" DECIMAL(5,2) NOT NULL,
    "price_buffer_percent" DECIMAL(5,2) NOT NULL,
    "offer_window_minutes" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopping_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopping_requests_reference_key" ON "shopping_requests"("reference");

-- CreateIndex
CREATE INDEX "shopping_requests_customer_id_created_at_idx" ON "shopping_requests"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "shopping_requests_status_shopping_location_id_offer_deadlin_idx" ON "shopping_requests"("status", "shopping_location_id", "offer_deadline");

-- CreateIndex
CREATE INDEX "shopping_request_items_request_id_idx" ON "shopping_request_items"("request_id");

-- CreateIndex
CREATE INDEX "shopping_request_items_category_id_idx" ON "shopping_request_items"("category_id");

-- CreateIndex
CREATE INDEX "shopping_offers_request_id_state_idx" ON "shopping_offers"("request_id", "state");

-- CreateIndex
CREATE INDEX "shopping_offers_shopper_profile_id_state_created_at_idx" ON "shopping_offers"("shopper_profile_id", "state", "created_at");

-- AddForeignKey
ALTER TABLE "shopping_requests" ADD CONSTRAINT "shopping_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_requests" ADD CONSTRAINT "shopping_requests_shopping_location_id_fkey" FOREIGN KEY ("shopping_location_id") REFERENCES "shopping_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_request_items" ADD CONSTRAINT "shopping_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "shopping_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_request_items" ADD CONSTRAINT "shopping_request_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "shopping_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_offers" ADD CONSTRAINT "shopping_offers_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "shopping_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_offers" ADD CONSTRAINT "shopping_offers_shopper_profile_id_fkey" FOREIGN KEY ("shopper_profile_id") REFERENCES "shopper_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One ACTIVE (PENDING) offer per shopper per request. A withdrawn, rejected or
-- expired offer does not count, so a shopper may bid again after withdrawing.
-- Prisma cannot express a partial unique index; it is maintained here.
CREATE UNIQUE INDEX "shopping_offers_one_pending_per_shopper"
    ON "shopping_offers"("request_id", "shopper_profile_id")
    WHERE "state" = 'PENDING';

-- Guard rails on the fee configuration.
ALTER TABLE "shopping_config"
    ADD CONSTRAINT "shopping_config_singleton" CHECK ("id" = 1),
    ADD CONSTRAINT "shopping_config_fee_bounds" CHECK ("min_shopper_fee" >= 0 AND "max_shopper_fee" >= "min_shopper_fee"),
    ADD CONSTRAINT "shopping_config_non_negative" CHECK (
        "delivery_fee" >= 0 AND "service_charge_percent" >= 0 AND "vat_percent" >= 0
        AND "price_buffer_percent" >= 0 AND "offer_window_minutes" > 0
    );

ALTER TABLE "shopping_requests"
    ADD CONSTRAINT "shopping_requests_budget_non_negative" CHECK ("estimated_goods_budget" >= 0);

ALTER TABLE "shopping_request_items"
    ADD CONSTRAINT "shopping_request_items_values" CHECK (
        "quantity" > 0 AND "estimated_unit_price" > 0
        AND ("max_substitute_price" IS NULL OR "max_substitute_price" > 0)
    );

ALTER TABLE "shopping_offers"
    ADD CONSTRAINT "shopping_offers_values" CHECK ("shopper_fee" >= 0 AND "eta_minutes" > 0);

-- Placeholder defaults. Product has not signed these off; edit the row to change them.
INSERT INTO "shopping_config" (
    "id", "min_shopper_fee", "max_shopper_fee", "delivery_fee",
    "service_charge_percent", "vat_percent", "price_buffer_percent",
    "offer_window_minutes", "updated_at"
) VALUES (1, 500, 5000, 1500, 5.00, 7.50, 10.00, 30, CURRENT_TIMESTAMP);
