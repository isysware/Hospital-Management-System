-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('MANUAL', 'DEVICE', 'IMPORTED');

-- AlterEnum
BEGIN;
CREATE TYPE "AttendanceStatus_new" AS ENUM ('PRESENT', 'HALF_DAY', 'ABSENT', 'PAID_LEAVE', 'UNPAID_LEAVE', 'MISSING_PUNCH');
ALTER TABLE "attendance_records" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "attendance_records" ALTER COLUMN "status" TYPE "AttendanceStatus_new" USING ("status"::text::"AttendanceStatus_new");
ALTER TYPE "AttendanceStatus" RENAME TO "AttendanceStatus_old";
ALTER TYPE "AttendanceStatus_new" RENAME TO "AttendanceStatus";
DROP TYPE "AttendanceStatus_old";
ALTER TABLE "attendance_records" ALTER COLUMN "status" SET DEFAULT 'ABSENT';
COMMIT;

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "marked_by" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "source" "AttendanceSource" NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE INDEX "attendance_records_attendance_date_idx" ON "attendance_records"("attendance_date");

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
