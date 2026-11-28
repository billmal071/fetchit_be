-- CreateEnum
CREATE TYPE "OrderState" AS ENUM ('ASSIGNED', 'SHOPPER_ACCEPTED', 'SHOPPING_STARTED', 'AWAITING_APPROVAL', 'PREPARATION', 'RECEIPT_PENDING', 'SHOPPING_COMPLETED', 'READY_FOR_HANDOFF', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderItemState" AS ENUM ('PENDING', 'FOUND', 'PRICE_CHANGE_REQUESTED', 'PRICE_APPROVED', 'PRICE_REJECTED', 'UNAVAILABLE', 'SUBSTITUTION_REQUESTED', 'SUBSTITUTION_APPROVED', 'SUBSTITUTION_REJECTED', 'PURCHASED', 'REMOVED');

-- AlterTable
ALTER TABLE "shopping_config" ADD COLUMN     "offer_acceptance_window_minutes" INTEGER NOT NULL DEFAULT 1440,
ADD COLUMN     "shopper_accept_window_minutes" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "shopper_orders" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "request_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "shopper_profile_id" TEXT NOT NULL,
    "state" "OrderState" NOT NULL DEFAULT 'ASSIGNED',
    "shopping_location_id" TEXT NOT NULL,
    "handoff_area" VARCHAR(100),
    "handoff_at" TIMESTAMP(3),
    "financials" JSONB NOT NULL,
    "shopper_accepted_at" TIMESTAMP(3),
    "shopping_started_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" VARCHAR(16),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopper_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopper_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "request_item_id" TEXT,
    "position" INTEGER NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "brand" VARCHAR(100) NOT NULL,
    "size" VARCHAR(50) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "notes" TEXT,
    "state" "OrderItemState" NOT NULL DEFAULT 'PENDING',
    "substitution_preference" "SubstitutionPreference" NOT NULL DEFAULT 'REFUND',
    "max_substitute_price" INTEGER,
    "customer_estimated_price" INTEGER NOT NULL,
    "shopper_estimated_price" INTEGER,
    "actual_purchase_price" INTEGER,
    "approved_price" INTEGER,
    "final_purchase_price" INTEGER,

    CONSTRAINT "shopper_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "actor_id" TEXT,
    "actor_role" VARCHAR(32),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopper_orders_reference_key" ON "shopper_orders"("reference");

-- CreateIndex
CREATE INDEX "shopper_orders_customer_id_created_at_idx" ON "shopper_orders"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "shopper_orders_shopper_profile_id_created_at_idx" ON "shopper_orders"("shopper_profile_id", "created_at");

-- CreateIndex
CREATE INDEX "shopper_orders_request_id_shopper_profile_id_idx" ON "shopper_orders"("request_id", "shopper_profile_id");

-- CreateIndex
CREATE INDEX "shopper_orders_offer_id_idx" ON "shopper_orders"("offer_id");

-- CreateIndex
CREATE INDEX "shopper_order_items_order_id_position_idx" ON "shopper_order_items"("order_id", "position");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "shopper_orders" ADD CONSTRAINT "shopper_orders_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "shopping_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_orders" ADD CONSTRAINT "shopper_orders_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "shopping_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_orders" ADD CONSTRAINT "shopper_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_orders" ADD CONSTRAINT "shopper_orders_shopper_profile_id_fkey" FOREIGN KEY ("shopper_profile_id") REFERENCES "shopper_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_orders" ADD CONSTRAINT "shopper_orders_shopping_location_id_fkey" FOREIGN KEY ("shopping_location_id") REFERENCES "shopping_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_order_items" ADD CONSTRAINT "shopper_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shopper_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shopper_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Guard rails: money columns are whole, non-negative NGN.
ALTER TABLE "shopper_order_items"
    ADD CONSTRAINT "shopper_order_items_values" CHECK (
        "quantity" > 0 AND "customer_estimated_price" > 0
        AND ("shopper_estimated_price" IS NULL OR "shopper_estimated_price" >= 0)
        AND ("actual_purchase_price" IS NULL OR "actual_purchase_price" >= 0)
        AND ("approved_price" IS NULL OR "approved_price" >= 0)
        AND ("final_purchase_price" IS NULL OR "final_purchase_price" >= 0)
    );

-- A cancelled order reopens its request, which can then be accepted again, so a
-- request (and an offer) may have SEVERAL orders over time but only one that is
-- not cancelled. Prisma cannot express partial unique indexes; they are
-- maintained here, like "shopping_offers_one_pending_per_shopper".
CREATE UNIQUE INDEX "shopper_orders_one_live_per_request"
    ON "shopper_orders"("request_id") WHERE "state" <> 'CANCELLED';
CREATE UNIQUE INDEX "shopper_orders_one_live_per_offer"
    ON "shopper_orders"("offer_id") WHERE "state" <> 'CANCELLED';

ALTER TABLE "shopping_config"
    ADD CONSTRAINT "shopping_config_accept_window_positive" CHECK ("shopper_accept_window_minutes" > 0);

ALTER TABLE "shopping_config"
    ADD CONSTRAINT "shopping_config_offer_acceptance_window_positive" CHECK ("offer_acceptance_window_minutes" > 0);
