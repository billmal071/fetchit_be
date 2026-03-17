-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PROFILE_COMPLETE', 'DOCUMENTS_SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('GOVERNMENT_ID', 'SELFIE', 'PROOF_OF_ADDRESS');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "service_categories" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handyman_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bio" TEXT,
    "location" VARCHAR(255),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "hourly_rate" DECIMAL(10,2),
    "years_of_experience" INTEGER,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "reviewed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handyman_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handyman_profile_categories" (
    "handyman_profile_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "handyman_profile_categories_pkey" PRIMARY KEY ("handyman_profile_id","category_id")
);

-- CreateTable
CREATE TABLE "handyman_documents" (
    "id" TEXT NOT NULL,
    "handyman_profile_id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "file_url" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handyman_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "location" VARCHAR(255) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "budget_min" DECIMAL(10,2),
    "budget_max" DECIMAL(10,2),
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_handyman_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_request_applications" (
    "id" TEXT NOT NULL,
    "service_request_id" TEXT NOT NULL,
    "handyman_profile_id" TEXT NOT NULL,
    "cover_message" TEXT,
    "proposed_rate" DECIMAL(10,2),
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_request_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_name_key" ON "service_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_slug_key" ON "service_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "handyman_profiles_user_id_key" ON "handyman_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_request_applications_service_request_id_handyman_pr_key" ON "service_request_applications"("service_request_id", "handyman_profile_id");

-- CreateIndex (performance)
CREATE INDEX "handyman_profiles_verification_status_idx" ON "handyman_profiles"("verification_status");

-- CreateIndex (performance)
CREATE INDEX "handyman_documents_handyman_profile_id_idx" ON "handyman_documents"("handyman_profile_id");

-- CreateIndex (performance)
CREATE INDEX "service_requests_customer_id_idx" ON "service_requests"("customer_id");

-- CreateIndex (performance)
CREATE INDEX "service_requests_assigned_handyman_id_idx" ON "service_requests"("assigned_handyman_id");

-- CreateIndex (performance)
CREATE INDEX "service_requests_status_idx" ON "service_requests"("status");

-- AddForeignKey
ALTER TABLE "handyman_profiles" ADD CONSTRAINT "handyman_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_profiles" ADD CONSTRAINT "handyman_profiles_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_profile_categories" ADD CONSTRAINT "handyman_profile_categories_handyman_profile_id_fkey" FOREIGN KEY ("handyman_profile_id") REFERENCES "handyman_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_profile_categories" ADD CONSTRAINT "handyman_profile_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_documents" ADD CONSTRAINT "handyman_documents_handyman_profile_id_fkey" FOREIGN KEY ("handyman_profile_id") REFERENCES "handyman_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handyman_documents" ADD CONSTRAINT "handyman_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assigned_handyman_id_fkey" FOREIGN KEY ("assigned_handyman_id") REFERENCES "handyman_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_applications" ADD CONSTRAINT "service_request_applications_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_applications" ADD CONSTRAINT "service_request_applications_handyman_profile_id_fkey" FOREIGN KEY ("handyman_profile_id") REFERENCES "handyman_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
