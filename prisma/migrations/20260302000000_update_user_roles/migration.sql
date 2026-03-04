-- CreateEnum
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'CUSTOMER', 'PERSONAL_SHOPPER', 'HANDYMAN');

-- Convert column to text, remap values, then cast to new enum
ALTER TABLE "users"
  ALTER COLUMN "role" DROP DEFAULT,
  ALTER COLUMN "role" TYPE text;

UPDATE "users" SET "role" = 'CUSTOMER' WHERE "role" IN ('USER', 'MODERATOR');

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::"UserRole_new"),
  ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';

-- Drop old and rename new
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
