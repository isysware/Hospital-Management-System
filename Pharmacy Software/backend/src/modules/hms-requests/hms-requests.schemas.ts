import { z } from 'zod';

export const idParamsSchema = z.object({ id: z.string().uuid() });

const requestLineSchema = z.object({
  medicineId: z.string().uuid(),
  requestedQuantity: z.coerce.number().positive(),
  notes: z.string().max(300).optional(),
});

/**
 * pharmacy.md §15 HMS -> Pharmacy data contract. In production this is called
 * by HMS's own backend; until that live integration exists (deferred per
 * project decision), Pharmacy staff can log a request here as a stand-in —
 * same shape, same validation, same downstream flow either way.
 */
export const createRequestBodySchema = z.object({
  externalAdmissionRef: z.string().min(1).max(100),
  externalRequestRef: z.string().max(100).optional(),
  patientNameSnapshot: z.string().max(150).optional(),
  urgency: z.enum(['ROUTINE', 'URGENT', 'STAT', 'HIGH_COST_PENDING']).optional(),
  requestedByExternal: z.string().max(150).optional(),
  isHighCost: z.boolean().optional(),
  isApproved: z.boolean().optional(),
  highCostStatus: z.string().optional(),
  lines: z.array(requestLineSchema).min(1),
});
export type CreateRequestBody = z.infer<typeof createRequestBodySchema>;

export const highCostApprovalCallbackSchema = z.object({
  externalRequestRef: z.string().min(1),
  isApproved: z.boolean(),
  approvedBy: z.string().optional(),
  rejectionReason: z.string().optional(),
});
export type HighCostApprovalCallbackBody = z.infer<typeof highCostApprovalCallbackSchema>;

export const listRequestsQuerySchema = z.object({
  status: z.enum(['REQUESTED', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED', 'DISPENSED']).optional(),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

const fulfillLineSchema = z.object({
  requestLineId: z.string().uuid(),
  dispenseQuantity: z.coerce.number().nonnegative(),
});

/** pharmacy.md §7.1/§7.2 "Accept & Dispense" / "Partial Fulfill" — one action, quantity-driven. */
export const fulfillRequestBodySchema = z.object({
  lines: z.array(fulfillLineSchema).min(1),
});
export type FulfillRequestBody = z.infer<typeof fulfillRequestBodySchema>;

export const rejectRequestBodySchema = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectRequestBody = z.infer<typeof rejectRequestBodySchema>;

export const updateSettingsBodySchema = z.object({
  highValueApprovalEnabled: z.boolean(),
  highValueThreshold: z.coerce.number().nonnegative(),
});
export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;

export const patientCollectedCallbackSchema = z.object({
  pharmacyInvoiceNumber: z.string().min(1),
  collectedAmount: z.coerce.number().refine(v=>v!==0, 'Collection delta cannot be zero'),
  method: z.string().max(40).optional(),
  collectedBy: z.string().max(150).optional(),
  collectedAt: z.string().optional(),
  receiptNumber: z.string().optional(),
});
export type PatientCollectedCallbackBody = z.infer<typeof patientCollectedCallbackSchema>;

export const createSettlementRequestBodySchema = z.object({
  invoiceNumber: z.string().min(1),
  amountRequested: z.coerce.number().positive(),
  remarks: z.string().max(500).optional(),
});
export type CreateSettlementRequestBody = z.infer<typeof createSettlementRequestBodySchema>;

/**
 * Idempotent reconciliation — HMS is the source of truth for how much it has
 * actually collected from the patient (`HmsPharmacyCharge.patientPaid`); this
 * SETS `hmsCollectedAmount` to that authoritative value rather than adding a
 * delta (unlike `patientCollectedCallbackSchema`'s callback), so it's safe to
 * call repeatedly after a `notifyPatientCollected` webhook that silently
 * failed (network blip, server down at that moment, etc.) without ever
 * double-counting.
 */
export const reconcileCollectionBodySchema = z.object({
  collectedAt: z.string().datetime().optional(),
  receiptNumber: z.string().optional(),
  method: z.string().max(40).optional(),
  collectedBy: z.string().max(150).optional(),
  pharmacyInvoiceNumber: z.string().min(1),
  authoritativeCollectedAmount: z.coerce.number().nonnegative(),
});
export type ReconcileCollectionBody = z.infer<typeof reconcileCollectionBodySchema>;

export const releaseSettlementCallbackSchema = z.object({
  settlementNumber: z.string().min(1),
  pharmacyInvoiceNumber: z.string().min(1),
  releasedAmount: z.coerce.number().positive(),
  remainingPayable: z.coerce.number().nonnegative(),
  paymentMethod: z.string().optional(),
  paymentReference: z.string().optional(),
  releasedBy: z.string().optional(),
  releasedAt: z.string().optional(),
  remarks: z.string().optional(),
});
export type ReleaseSettlementCallbackBody = z.infer<typeof releaseSettlementCallbackSchema>;
