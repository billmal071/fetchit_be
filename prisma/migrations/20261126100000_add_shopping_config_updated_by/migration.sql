-- AlterTable
ALTER TABLE "shopping_config" ADD COLUMN     "updated_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "shopping_config" ADD CONSTRAINT "shopping_config_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

