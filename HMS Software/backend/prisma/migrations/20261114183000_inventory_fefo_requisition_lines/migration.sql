-- AlterTable
ALTER TABLE "department_requisition_lines" ADD COLUMN IF NOT EXISTS "batch_no" TEXT,
ADD COLUMN IF NOT EXISTS "expiry_date" DATE,
ADD COLUMN IF NOT EXISTS "cost_rate" DECIMAL(14,2);

