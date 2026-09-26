-- AlterTable
ALTER TABLE "staff_salary_profiles" ADD COLUMN     "fixed_allowance" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "fixed_deduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "payment_method" TEXT;

-- CreateTable
CREATE TABLE "staff_weekly_schedules" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "day_of_week" TEXT NOT NULL,
    "is_working" BOOLEAN NOT NULL DEFAULT true,
    "use_shift_default" BOOLEAN NOT NULL DEFAULT true,
    "start_time" TEXT,
    "end_time" TEXT,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "staff_weekly_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_bank_accounts" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "bank_name" TEXT,
    "branch_name" TEXT,
    "account_title" TEXT,
    "account_number" TEXT,
    "iban" TEXT,
    "wallet_account" TEXT,
    "preferred_for_salary" BOOLEAN NOT NULL DEFAULT true,
    "preferred_for_commission" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "staff_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_weekly_schedules_staff_id_day_of_week_key" ON "staff_weekly_schedules"("staff_id", "day_of_week");

-- CreateIndex
CREATE INDEX "staff_bank_accounts_staff_id_effective_from_idx" ON "staff_bank_accounts"("staff_id", "effective_from");

-- AddForeignKey
ALTER TABLE "staff_weekly_schedules" ADD CONSTRAINT "staff_weekly_schedules_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_bank_accounts" ADD CONSTRAINT "staff_bank_accounts_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
