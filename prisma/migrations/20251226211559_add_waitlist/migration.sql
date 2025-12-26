-- CreateEnum
CREATE TYPE "WaitlistRole" AS ENUM ('USER', 'HANDYMAN', 'SHOPPER');

-- CreateEnum
CREATE TYPE "HowFindHelp" AS ENUM ('FRIENDS_FAMILY', 'WHATSAPP', 'SOCIAL_MEDIA', 'STRUGGLE');

-- CreateEnum
CREATE TYPE "FirstService" AS ENUM ('HANDYMAN', 'PERSONAL_SHOPPER', 'BOTH');

-- CreateEnum
CREATE TYPE "WillingToPay" AS ENUM ('YES', 'MAYBE', 'NO');

-- CreateEnum
CREATE TYPE "MonthlyBudget" AS ENUM ('BUDGET_1000_3000', 'BUDGET_3000_5000', 'BUDGET_5000_PLUS');

-- CreateEnum
CREATE TYPE "UsedOwnMoney" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "MaxSpendingAmount" AS ENUM ('UNDER_10000', 'AMOUNT_10000_30000', 'AMOUNT_30000_PLUS');

-- CreateEnum
CREATE TYPE "PayoutSpeed" AS ENUM ('IMMEDIATELY', 'SAME_DAY', 'WITHIN_24_HOURS');

-- CreateTable
CREATE TABLE "waitlist" (
    "id" TEXT NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "role" "WaitlistRole" NOT NULL,
    "how_find_help" "HowFindHelp",
    "first_service" "FirstService",
    "frustration" TEXT,
    "main_skill" VARCHAR(100),
    "willing_to_pay" "WillingToPay",
    "monthly_budget" "MonthlyBudget",
    "used_own_money" "UsedOwnMoney",
    "max_spending_amount" "MaxSpendingAmount",
    "payout_speed" "PayoutSpeed",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_email_key" ON "waitlist"("email");
