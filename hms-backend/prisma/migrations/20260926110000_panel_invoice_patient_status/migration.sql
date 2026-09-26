-- Panel invoice status is the PATIENT's payment status: `paid_total` only holds
-- patient cash (the company's share is realized through panel remittances), so a
-- correctly split panel invoice is PAID once the patient share is paid. Earlier
-- code compared against the full total, leaving such invoices PARTIALLY_PAID /
-- UNPAID forever. Legacy invoices whose split does not reconcile are left as-is.
UPDATE "hospital_invoices"
SET "status" = (CASE
    WHEN "paid_total" >= "patient_share" THEN 'PAID'
    WHEN "paid_total" > 0 THEN 'PARTIALLY_PAID'
    ELSE 'UNPAID'
  END)::"InvoiceStatus"
WHERE "panel_patient_id" IS NOT NULL
  AND "status" <> 'VOID'
  AND "patient_share" + "panel_receivable" = "total";
