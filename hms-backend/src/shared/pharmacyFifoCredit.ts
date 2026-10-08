import { Decimal } from '@prisma/client/runtime/library';

/**
 * How much of a `[previousPaidTotal, newPaidTotal)` payment window lands on
 * this invoice's PHARMACY-sourced lines. Charges on an admission's single
 * consolidated invoice settle FIFO by posting order (same convention
 * `admissionBillingService.getLedger` uses for its per-line paid/due
 * display) — walk every line in that order, accumulate each line's own
 * `patientShare` into a running position, and credit the overlap between
 * the payment window and each PHARMACY line's span.
 *
 * `lines` must already be ordered by `createdAt` ascending.
 */
export function computePharmacyPortion(
  lines: { billingSource: string; patientShare: Decimal }[],
  previousPaidTotal: Decimal,
  newPaidTotal: Decimal,
): Decimal {
  let cursor = new Decimal(0);
  let pharmacyPortion = new Decimal(0);
  for (const line of lines) {
    const lineStart = cursor;
    const lineEnd = cursor.plus(line.patientShare);
    cursor = lineEnd;
    if (line.billingSource !== 'PHARMACY') continue;
    const overlapStart = Decimal.max(lineStart, previousPaidTotal);
    const overlapEnd = Decimal.min(lineEnd, newPaidTotal);
    if (overlapEnd.greaterThan(overlapStart)) {
      pharmacyPortion = pharmacyPortion.plus(overlapEnd.minus(overlapStart));
    }
  }
  return pharmacyPortion;
}
