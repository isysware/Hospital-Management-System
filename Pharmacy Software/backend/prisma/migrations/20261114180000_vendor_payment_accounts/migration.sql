ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'BANK';
CREATE TABLE "payment_accounts" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "is_active" BOOLEAN NOT NULL DEFAULT true, CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "payment_accounts_name_key" ON "payment_accounts"("name");
ALTER TABLE "cash_ledger_entries" ADD COLUMN "payment_account_id" TEXT, ADD COLUMN "payment_method" "PaymentMethod";
ALTER TABLE "cash_ledger_entries" ADD CONSTRAINT "cash_ledger_entries_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD COLUMN "payment_account_id" TEXT;
ALTER TABLE "vendor_ledger_entries" ADD COLUMN "request_key" TEXT;
CREATE UNIQUE INDEX "vendor_ledger_entries_request_key_key" ON "vendor_ledger_entries"("request_key");
