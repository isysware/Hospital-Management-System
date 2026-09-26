-- DropForeignKey
ALTER TABLE "staff" DROP CONSTRAINT "staff_department_id_fkey";

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "date_of_birth" DATE,
ALTER COLUMN "department_id" DROP NOT NULL,
ALTER COLUMN "designation" DROP NOT NULL;

-- CreateTable
CREATE TABLE "staff_services" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "service_rate_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" TEXT,

    CONSTRAINT "staff_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_services_staff_id_idx" ON "staff_services"("staff_id");

-- CreateIndex
CREATE INDEX "staff_services_service_rate_id_idx" ON "staff_services"("service_rate_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_services_staff_id_service_rate_id_key" ON "staff_services"("staff_id", "service_rate_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_cnic_key" ON "staff"("cnic");

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_service_rate_id_fkey" FOREIGN KEY ("service_rate_id") REFERENCES "service_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
