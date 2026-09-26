-- The status trigger (20260922160000) compared paid_total with the FULL total.
-- paid_total only ever holds PATIENT cash — a panel company's share is realized
-- separately through panel_remittance_allocations — so a panel invoice whose
-- patient paid their whole share stayed PARTIALLY_PAID (or UNPAID when fully
-- covered) forever, and the application's own status was overwritten.
-- The patient's responsibility is the patient share on a correctly split panel
-- invoice (patient_share + panel_receivable = total), else the full total.
-- Mirrors patientResponsibility() in src/shared/invoicePaymentStatus.ts.
CREATE OR REPLACE FUNCTION derive_hospital_invoice_payment_status() RETURNS trigger AS $$
DECLARE
  due NUMERIC;
BEGIN
  IF NEW.status <> 'VOID' THEN
    due := CASE
      WHEN NEW.panel_patient_id IS NOT NULL AND NEW.patient_share + NEW.panel_receivable = NEW.total
        THEN NEW.patient_share
      ELSE NEW.total
    END;
    NEW.status := CASE WHEN NEW.paid_total >= due THEN 'PAID'::"InvoiceStatus"
      WHEN NEW.paid_total > 0 THEN 'PARTIALLY_PAID'::"InvoiceStatus"
      ELSE 'UNPAID'::"InvoiceStatus" END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-derive every stored status through the corrected trigger.
UPDATE hospital_invoices SET status = status WHERE status <> 'VOID';
