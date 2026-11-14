ALTER TABLE "pharmacy_invoice_lines" ADD COLUMN "cost_rate_snapshot" DECIMAL(14,4);
CREATE TABLE "pharmacy_financial_events" (
 "id" TEXT PRIMARY KEY, "invoice_id" TEXT NOT NULL REFERENCES "pharmacy_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "event_key" TEXT NOT NULL UNIQUE, "kind" TEXT NOT NULL, "occurred_at" TIMESTAMP(3),
 "collection_delta" DECIMAL(14,2) NOT NULL DEFAULT 0, "sale_delta" DECIMAL(14,2) NOT NULL DEFAULT 0,
 "tax_delta" DECIMAL(14,2) NOT NULL DEFAULT 0, "gross_delta" DECIMAL(14,2) NOT NULL DEFAULT 0,
 "discount_delta" DECIMAL(14,2) NOT NULL DEFAULT 0, "cost_delta" DECIMAL(14,2) NOT NULL DEFAULT 0,
 "method" TEXT, "actor_id" TEXT, "reference" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "pharmacy_financial_events_invoice_id_occurred_at_idx" ON "pharmacy_financial_events"("invoice_id", "occurred_at");
