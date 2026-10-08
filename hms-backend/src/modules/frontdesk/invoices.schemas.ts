import { z } from 'zod';

export const invoiceIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const encounterIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createEncounterSchema = z.object({
  encounterType: z.enum(['OPD', 'OBSERVATION', 'EMERGENCY', 'CUSTOM']).default('OPD'),
  panelPatientId: z.string().uuid().optional(),
  selfPayEncounterId: z.string().uuid().optional(),
  // Inline temporary patient creation if neither ID is passed
  newSelfPayPatient: z
    .object({
      fullName: z.string().min(1).max(150),
      guardianName: z.string().max(150).optional(),
      gender: z.string().optional(),
      dob: z.coerce.date().optional(),
      cnicOrPassport: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  departmentId: z.string().uuid().optional(),
  doctorStaffId: z.string().uuid().optional(),
  notes: z.string().optional(),
  // Case authorization/guarantee (panel.md §15 backlog item 2) — required
  // up front when the panel company's authorizationRequired policy is on;
  // re-checked against every service line added afterward too.
  authorizationNumber: z.string().trim().max(100).optional(),
  authorizationLimit: z.coerce.number().nonnegative().optional(),
  authorizationValidUntil: z.coerce.date().optional(),
}).refine(
  (data) => data.panelPatientId || data.selfPayEncounterId || data.newSelfPayPatient,
  { message: 'Either panelPatientId, selfPayEncounterId, or newSelfPayPatient is required' },
);

export type CreateEncounterBody = z.infer<typeof createEncounterSchema>;

export const addServiceLineSchema = z.object({
  providerType: z.enum(['INTERNAL', 'OUTSOURCED']).optional(),
  departmentId: z.string().uuid().optional(),
  outsourcedProviderId: z.string().uuid().optional(),
  serviceRateId: z.string().uuid(),
  quantity: z.coerce.number().positive().default(1),
  manualRateOverride: z.coerce.number().positive().optional(),
  overrideReason: z.string().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  discountAmount: z.coerce.number().min(0).optional(),
  discountReason: z.string().optional(),
  performedByStaffId: z.string().uuid().optional(), // Doctor performing the service
});

export type AddServiceLineBody = z.infer<typeof addServiceLineSchema>;

export const applyDiscountSchema = z.object({
  lineItemId: z.string().uuid().optional(), // If targeting a specific line item
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  discountAmount: z.coerce.number().min(0).optional(),
  discountReason: z.string().min(1, 'Reason for discount is required'),
}).refine(
  (data) => (data.discountPercent !== undefined && data.discountPercent > 0) || (data.discountAmount !== undefined && data.discountAmount > 0),
  { message: 'Either discountPercent or discountAmount must be greater than zero' },
);

export type ApplyDiscountBody = z.infer<typeof applyDiscountSchema>;

// Case authorization/guarantee (panel.md §15 backlog item 2) — lets Front
// Desk capture or renew the reference on an already-open panel encounter,
// e.g. when a service line turns out to need it under its own rule even
// though the company-wide policy didn't already require one at intake.
export const setInvoiceAuthorizationSchema = z.object({
  authorizationNumber: z.string().trim().max(100).optional(),
  authorizationLimit: z.coerce.number().nonnegative().optional(),
  authorizationValidUntil: z.coerce.date().optional(),
}).refine(
  (data) => data.authorizationNumber !== undefined || data.authorizationLimit !== undefined || data.authorizationValidUntil !== undefined,
  { message: 'Provide at least one of authorizationNumber, authorizationLimit or authorizationValidUntil' },
);
export type SetInvoiceAuthorizationBody = z.infer<typeof setInvoiceAuthorizationSchema>;

export const approveDiscountSchema = z.object({
  discountApprovalNotes: z.string().optional(),
});

export type ApproveDiscountBody = z.infer<typeof approveDiscountSchema>;

export const collectPaymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than zero'),
  paymentMethod: z.enum(['CASH', 'CARD', 'BANK', 'ONLINE']).default('CASH'),
  reference: z.string().optional(),
});

export type CollectPaymentBody = z.infer<typeof collectPaymentSchema>;

export const refundPaymentSchema = z.object({
  paymentReceiptId: z.string().uuid().optional(),
  amount: z.coerce.number().positive('Refund amount must be greater than zero'),
  refundMethod: z.enum(['CASH', 'CARD', 'BANK', 'ONLINE']).default('CASH'),
  reason: z.string().min(1, 'Refund reason is mandatory'),
});

export type RefundPaymentBody = z.infer<typeof refundPaymentSchema>;

export const listInvoicesQuerySchema = z.object({
  sourceType: z.enum(['APPOINTMENT', 'WALK_IN', 'ADMISSION']).optional(),
  encounterType: z.enum(['OPD', 'OBSERVATION', 'EMERGENCY', 'CUSTOM']).optional(),
  status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID']).optional(),
  panelPatientId: z.string().uuid().optional(),
  selfPayEncounterId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().optional(),
  // Record-type filters for the Discounts / Refunds / Payments-Receipts nav
  // items — server-side, not client-side, so a discounted/refunded invoice
  // outside the latest-100 default window still shows up (§ correctness).
  hasDiscount: z.enum(['true', 'false']).optional(),
  hasRefund: z.enum(['true', 'false']).optional(),
  hasPayment: z.enum(['true', 'false']).optional(),
  isPanel: z.enum(['true', 'false']).optional(),
  corporatePanelId: z.string().uuid().optional(),
  /** Outstanding Balances nav item — UNPAID or PARTIALLY_PAID only (PAID/VOID carry no remaining balance). */
  hasOutstandingBalance: z.enum(['true', 'false']).optional(),
});

export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
