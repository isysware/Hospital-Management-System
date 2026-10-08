/**
 * Front Desk discretionary discounts are strictly restricted to Hospital
 * Services — Outsourced Lab / Radiology / Pharmacy charges can never be
 * discounted this way (those departments bill the hospital at cost; a
 * discount here would just move the loss onto the hospital's margin on
 * someone else's service). Shared by `invoices.service.ts` (OPD/encounter
 * invoices) and `admissionBilling.service.ts` (admission invoices) so the
 * eligibility rule can't drift between the two call sites.
 */
export function isEligibleHospitalService(serviceRate: any): boolean {
  return !!serviceRate && serviceRate.selectable === true &&
    serviceRate.billingSource === 'HOSPITAL_SERVICE' &&
    serviceRate.providerType === 'INTERNAL' && serviceRate.discountAllowed !== false;
}

export const DISCOUNT_APPROVAL_PERCENT_THRESHOLD = 15; // > 15% requires Admin approval
export const DISCOUNT_APPROVAL_AMOUNT_THRESHOLD = 1500; // > PKR 1,500 requires Admin approval
