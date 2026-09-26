-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "assigned_shift_id" TEXT;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_assigned_shift_id_fkey" FOREIGN KEY ("assigned_shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
