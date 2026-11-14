-- DropIndex
DROP INDEX "doctor_commission_accruals_invoice_line_item_id_key";

-- AlterTable
ALTER TABLE "doctor_commission_accruals" ADD COLUMN     "collection_event_id" TEXT;

-- AlterTable
ALTER TABLE "commission_reversals" ADD COLUMN     "collection_event_id" TEXT,
ADD COLUMN     "tax_amount" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "commission_collection_events" (
    "id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "invoice_line_item_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "collected_amount" DECIMAL(14,2) NOT NULL,
    "commission_amount" DECIMAL(14,2) NOT NULL,
    "rule_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_collection_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_collection_events_source_key_key" ON "commission_collection_events"("source_key");

-- CreateIndex
CREATE INDEX "commission_collection_events_invoice_line_item_id_occurred__idx" ON "commission_collection_events"("invoice_line_item_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_commission_accruals_collection_event_id_key" ON "doctor_commission_accruals"("collection_event_id");

-- CreateIndex
CREATE INDEX "doctor_commission_accruals_invoice_line_item_id_idx" ON "doctor_commission_accruals"("invoice_line_item_id");

-- AddForeignKey
ALTER TABLE "doctor_commission_accruals" ADD CONSTRAINT "doctor_commission_accruals_collection_event_id_fkey" FOREIGN KEY ("collection_event_id") REFERENCES "commission_collection_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_reversals" ADD CONSTRAINT "commission_reversals_collection_event_id_fkey" FOREIGN KEY ("collection_event_id") REFERENCES "commission_collection_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_collection_events" ADD CONSTRAINT "commission_collection_events_invoice_line_item_id_fkey" FOREIGN KEY ("invoice_line_item_id") REFERENCES "invoice_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
