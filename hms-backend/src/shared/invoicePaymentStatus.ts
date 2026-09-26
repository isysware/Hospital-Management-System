import { Decimal } from '@prisma/client/runtime/library';

export function invoicePaymentStatus(total: Decimal, paidTotal: Decimal) {
  return paidTotal.greaterThanOrEqualTo(total) ? 'PAID' as const
    : paidTotal.greaterThan(0) ? 'PARTIALLY_PAID' as const : 'UNPAID' as const;
}

interface PayerSplit {
  panelPatientId?: string | null;
  total: Decimal;
  patientShare: Decimal;
  panelReceivable: Decimal;
}

/**
 * What the PATIENT owes on an invoice. `paidTotal` only ever holds patient
 * cash — a company's share is realized separately through panel remittances —
 * so for a correctly split panel invoice the patient's responsibility is the
 * patient share, not the full total. Self-pay (and any legacy panel invoice
 * whose split doesn't reconcile to its total) falls back to the full total.
 */
export function patientResponsibility(inv: PayerSplit): Decimal {
  if (inv.panelPatientId && inv.patientShare.plus(inv.panelReceivable).equals(inv.total)) {
    return inv.patientShare;
  }
  return inv.total;
}

/** Invoice status from the patient's side (Paid / Partially Paid / Unpaid). */
export function patientPaymentStatus(inv: PayerSplit, paidTotal: Decimal) {
  return invoicePaymentStatus(patientResponsibility(inv), paidTotal);
}
