-- AlterEnum
ALTER TYPE "CashCategory" ADD VALUE 'PHARMACY_SETTLEMENT';

-- CreateTable
CREATE TABLE "hms_pharmacy_settlement_releases" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "payment_reference" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by_id" TEXT NOT NULL,
    "cash_entry_id" TEXT,
    "legacy_expense_id" TEXT,
    "reconciliation_evidence" TEXT,
    "remarks" TEXT,
    "bridge_status" TEXT NOT NULL DEFAULT 'RECONCILIATION_REQUIRED',
    "bridge_delivered_at" TIMESTAMP(3),

    CONSTRAINT "hms_pharmacy_settlement_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hms_pharmacy_settlement_releases_idempotency_key_key" ON "hms_pharmacy_settlement_releases"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "hms_pharmacy_settlement_releases_cash_entry_id_key" ON "hms_pharmacy_settlement_releases"("cash_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "hms_pharmacy_settlement_releases_legacy_expense_id_key" ON "hms_pharmacy_settlement_releases"("legacy_expense_id");

-- CreateIndex
CREATE INDEX "hms_pharmacy_settlement_releases_released_at_idx" ON "hms_pharmacy_settlement_releases"("released_at");

-- CreateIndex
CREATE UNIQUE INDEX "hms_pharmacy_settlement_releases_settlement_id_payment_refe_key" ON "hms_pharmacy_settlement_releases"("settlement_id", "payment_reference");

-- AddForeignKey
ALTER TABLE "hms_pharmacy_settlement_releases" ADD CONSTRAINT "hms_pharmacy_settlement_releases_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "hms_pharmacy_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms_pharmacy_settlement_releases" ADD CONSTRAINT "hms_pharmacy_settlement_releases_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms_pharmacy_settlement_releases" ADD CONSTRAINT "hms_pharmacy_settlement_releases_cash_entry_id_fkey" FOREIGN KEY ("cash_entry_id") REFERENCES "user_cash_balances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hms_pharmacy_settlement_releases" ADD CONSTRAINT "hms_pharmacy_settlement_releases_legacy_expense_id_fkey" FOREIGN KEY ("legacy_expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No historical data is guessed, rewritten, or backfilled by this migration.
ALTER TABLE "hms_pharmacy_settlement_releases"
  ADD CONSTRAINT "pharmacy_release_positive" CHECK (amount > 0),
  ADD CONSTRAINT "pharmacy_release_key" CHECK (length(trim(idempotency_key)) > 0),
  ADD CONSTRAINT "pharmacy_release_method" CHECK (payment_method::text IN ('CASH', 'BANK', 'ONLINE')),
  ADD CONSTRAINT "pharmacy_release_cash_link" CHECK (
    (payment_method::text = 'CASH' AND (cash_entry_id IS NOT NULL OR legacy_expense_id IS NOT NULL)) OR
    (payment_method::text <> 'CASH' AND cash_entry_id IS NULL)),
  ADD CONSTRAINT "pharmacy_release_legacy_evidence" CHECK (
    legacy_expense_id IS NULL OR (reconciliation_evidence IS NOT NULL AND length(trim(reconciliation_evidence)) > 0)),
  ADD CONSTRAINT "pharmacy_release_bridge_status" CHECK (bridge_status IN ('DELIVERED', 'RECONCILIATION_REQUIRED'));

CREATE FUNCTION protect_pharmacy_release_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Pharmacy settlement releases are append-only';
  END IF;
  IF (to_jsonb(NEW) - 'bridge_status' - 'bridge_delivered_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'bridge_status' - 'bridge_delivered_at') THEN
    RAISE EXCEPTION 'Pharmacy settlement release financial history is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pharmacy_release_history_immutable
BEFORE UPDATE OR DELETE ON hms_pharmacy_settlement_releases
FOR EACH ROW EXECUTE FUNCTION protect_pharmacy_release_history();

