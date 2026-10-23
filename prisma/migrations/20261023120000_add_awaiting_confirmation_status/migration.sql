-- Bug #10: split the single "mark complete -> COMPLETED" transition both
-- the handyman and the customer could trigger unilaterally into two steps.
-- The handyman now moves a request here; the customer confirms from here
-- to COMPLETED. Adding an enum value, not changing or removing any
-- existing one, so no backfill is needed.
ALTER TYPE "ServiceRequestStatus" ADD VALUE 'AWAITING_CONFIRMATION';
