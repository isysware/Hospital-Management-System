-- CreateEnum
CREATE TYPE "CollectionOwner" AS ENUM ('PHARMACY_RETAIL', 'HMS_FRONT_DESK');

-- CreateEnum
CREATE TYPE "InternalSettlementStatus" AS ENUM ('NOT_DUE', 'PENDING', 'REQUESTED', 'PARTIALLY_RELEASED', 'SETTLED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "cash_ledger_entries" DROP CONSTRAINT "cash_ledger_entries_payment_account_id_fkey";

-- DropForeignKey
ALTER TABLE "pharmacy_invoices" DROP CONSTRAINT "pharmacy_invoices_medicine_request_id_fkey";

-- DropIndex
DROP INDEX "medicine_batches_medicine_id_batch_number_key";

-- DropIndex
DROP INDEX "pharmacy_invoices_medicine_request_id_key";

-- AlterTable
ALTER TABLE "pharmacy_invoice_lines" ADD COLUMN     "dispense_event_id" TEXT,
ADD COLUMN     "dispensed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dispensed_by" TEXT,
ADD COLUMN     "external_request_ref" TEXT,
ADD COLUMN     "medicine_request_id" TEXT,
ADD COLUMN     "request_line_id" TEXT;

-- AlterTable
ALTER TABLE "pharmacy_invoices" ADD COLUMN     "collection_owner" "CollectionOwner" NOT NULL DEFAULT 'PHARMACY_RETAIL',
ADD COLUMN     "external_admission_ref" TEXT,
ADD COLUMN     "hms_collected_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hms_receivable" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hms_settled_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "internal_settlement_status" "InternalSettlementStatus";

-- AlterTable
ALTER TABLE "pharmacy_settings" ADD COLUMN     "address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "footer_message" TEXT,
ADD COLUMN     "footer_powered_by" TEXT,
ADD COLUMN     "footer_terms" TEXT,
ADD COLUMN     "hospital_name" TEXT,
ADD COLUMN     "pharmacy_subtitle" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "hms_receivable_settlements" (
    "id" TEXT NOT NULL,
    "settlement_number" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "external_admission_ref" TEXT NOT NULL,
    "patient_name_snapshot" TEXT,
    "invoice_number" TEXT NOT NULL,
    "invoice_total" DECIMAL(14,2) NOT NULL,
    "hms_collected" DECIMAL(14,2) NOT NULL,
    "amount_requested" DECIMAL(14,2) NOT NULL,
    "amount_released" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remaining_receivable" DECIMAL(14,2) NOT NULL,
    "status" "InternalSettlementStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "payment_method" TEXT,
    "payment_reference" TEXT,
    "release_remarks" TEXT,

    CONSTRAINT "hms_receivable_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hms_receivable_settlements_settlement_number_key" ON "hms_receivable_settlements"("settlement_number");

-- CreateIndex
CREATE INDEX "cash_ledger_entries_reference_table_reference_id_idx" ON "cash_ledger_entries"("reference_table", "reference_id");

-- CreateIndex
CREATE INDEX "cash_ledger_entries_category_idx" ON "cash_ledger_entries"("category");

-- CreateIndex
CREATE INDEX "medicine_batches_medicine_id_batch_number_idx" ON "medicine_batches"("medicine_id", "batch_number");

-- CreateIndex
CREATE INDEX "medicine_batches_expiry_date_idx" ON "medicine_batches"("expiry_date");

-- CreateIndex
CREATE INDEX "medicine_masters_name_idx" ON "medicine_masters"("name");

-- CreateIndex
CREATE INDEX "medicine_masters_is_active_idx" ON "medicine_masters"("is_active");

-- CreateIndex
CREATE INDEX "medicine_masters_category_id_idx" ON "medicine_masters"("category_id");

-- CreateIndex
CREATE INDEX "medicine_masters_created_at_idx" ON "medicine_masters"("created_at");

-- CreateIndex
CREATE INDEX "pharmacy_invoice_lines_invoice_id_dispense_event_id_idx" ON "pharmacy_invoice_lines"("invoice_id", "dispense_event_id");

-- CreateIndex
CREATE INDEX "pharmacy_invoice_lines_medicine_id_idx" ON "pharmacy_invoice_lines"("medicine_id");

-- CreateIndex
CREATE INDEX "pharmacy_invoice_lines_batch_id_idx" ON "pharmacy_invoice_lines"("batch_id");

-- CreateIndex
CREATE INDEX "pharmacy_invoices_channel_external_admission_ref_idx" ON "pharmacy_invoices"("channel", "external_admission_ref");

-- CreateIndex
CREATE INDEX "pharmacy_invoices_created_at_idx" ON "pharmacy_invoices"("created_at");

-- CreateIndex
CREATE INDEX "pharmacy_invoices_status_idx" ON "pharmacy_invoices"("status");

-- CreateIndex
CREATE INDEX "pharmacy_invoices_dispensed_by_idx" ON "pharmacy_invoices"("dispensed_by");

-- CreateIndex
CREATE INDEX "pharmacy_payments_invoice_id_idx" ON "pharmacy_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "pharmacy_payments_paid_at_idx" ON "pharmacy_payments"("paid_at");

-- CreateIndex
CREATE INDEX "purchases_created_at_idx" ON "purchases"("created_at");

-- CreateIndex
CREATE INDEX "purchases_vendor_id_idx" ON "purchases"("vendor_id");

-- CreateIndex
CREATE INDEX "purchases_status_idx" ON "purchases"("status");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_medicine_id_idx" ON "stock_ledger_entries"("medicine_id");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_batch_id_idx" ON "stock_ledger_entries"("batch_id");

-- AddForeignKey
ALTER TABLE "cash_ledger_entries" ADD CONSTRAINT "cash_ledger_entries_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms_receivable_settlements" ADD CONSTRAINT "hms_receivable_settlements_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "pharmacy_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms_receivable_settlements" ADD CONSTRAINT "hms_receivable_settlements_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
