-- A request now carries its own copy of the offer-acceptance window, taken when it is
-- created (or reopened), so an admin editing shopping_config.offer_acceptance_window_minutes
-- can no longer expire requests that already exist. DEFAULT only lets the column be added to
-- a populated table; it is dropped again below so the application must always supply it.
ALTER TABLE "shopping_requests"
  ADD COLUMN "offer_acceptance_window_minutes" INTEGER NOT NULL DEFAULT 1440;

-- BACKFILL START
-- Existing requests get the CURRENT configured window, so what the lazy expiry does for them
-- today is unchanged by this migration. Idempotent: rows already equal to it are not touched.
UPDATE "shopping_requests" r
SET "offer_acceptance_window_minutes" = c."offer_acceptance_window_minutes"
FROM "shopping_config" c
WHERE c."id" = 1
  AND r."offer_acceptance_window_minutes" IS DISTINCT FROM c."offer_acceptance_window_minutes";
-- BACKFILL END

ALTER TABLE "shopping_requests" ALTER COLUMN "offer_acceptance_window_minutes" DROP DEFAULT;
ALTER TABLE "shopping_requests"
  ADD CONSTRAINT "shopping_requests_offer_acceptance_window_minutes_check"
  CHECK ("offer_acceptance_window_minutes" >= 1);
