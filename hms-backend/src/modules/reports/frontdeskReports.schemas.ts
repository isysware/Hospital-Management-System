import { z } from 'zod';

/** Same date-range shape as `dashboard.schemas.ts` — kept consistent across every report in the app. */
const dateRangeSchema = z.object({
  preset: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'custom']).default('today'),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const encounterRegisterQuerySchema = dateRangeSchema.extend({
  departmentId: z.string().uuid().optional(),
  doctorStaffId: z.string().uuid().optional(),
  encounterType: z.enum(['OPD', 'OBSERVATION', 'EMERGENCY', 'CUSTOM']).optional(),
  status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID']).optional(),
});
export type EncounterRegisterQuery = z.infer<typeof encounterRegisterQuerySchema>;

export const invoiceRegisterQuerySchema = dateRangeSchema.extend({
  createdById: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  sourceType: z.enum(['APPOINTMENT', 'WALK_IN', 'ADMISSION']).optional(),
  payerType: z.enum(['PANEL', 'SELF_PAY']).optional(),
  corporatePanelId: z.string().uuid().optional(),
  status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID']).optional(),
});
export type InvoiceRegisterQuery = z.infer<typeof invoiceRegisterQuerySchema>;

export const collectionReportQuerySchema = dateRangeSchema.extend({
  collectedById: z.string().uuid().optional(),
  method: z.enum(['CASH', 'CARD', 'BANK', 'ONLINE']).optional(),
  source: z.enum(['ADMISSION', 'VISIT']).optional(),
  /** Receipt Status — ACTIVE (default) or REVERSED receipts. */
  receiptStatus: z.enum(['ACTIVE', 'REVERSED']).optional(),
});
export type CollectionReportQuery = z.infer<typeof collectionReportQuerySchema>;

export const outstandingInvoicesQuerySchema = dateRangeSchema.extend({
  departmentId: z.string().uuid().optional(),
  payerType: z.enum(['PANEL', 'SELF_PAY']).optional(),
  status: z.enum(['UNPAID', 'PARTIALLY_PAID']).optional(),
  minOutstanding: z.coerce.number().optional(),
});
export type OutstandingInvoicesQuery = z.infer<typeof outstandingInvoicesQuerySchema>;

export const discountReportQuerySchema = dateRangeSchema.extend({
  departmentId: z.string().uuid().optional(),
  corporatePanelId: z.string().uuid().optional(),
});
export type DiscountReportQuery = z.infer<typeof discountReportQuerySchema>;

export const refundVoidReportQuerySchema = dateRangeSchema.extend({
  portalUserId: z.string().uuid().optional(),
  type: z.enum(['REFUND', 'VOID']).optional(),
});
export type RefundVoidReportQuery = z.infer<typeof refundVoidReportQuerySchema>;

export const departmentRevenueQuerySchema = dateRangeSchema.extend({
  departmentId: z.string().uuid().optional(),
});
export type DepartmentRevenueQuery = z.infer<typeof departmentRevenueQuerySchema>;

export const admissionPaymentCollectionQuerySchema = dateRangeSchema.extend({
  admissionRecordId: z.string().uuid().optional(),
  /** Free-text Admission No search (partial, case-insensitive). */
  admissionNumber: z.string().trim().max(50).optional(),
  departmentId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'FULFILLED', 'PARTIALLY_FULFILLED', 'CANCELLED']).optional(),
  collectedById: z.string().uuid().optional(),
  method: z.enum(['CASH', 'CARD', 'BANK', 'ONLINE']).optional(),
});
export type AdmissionPaymentCollectionQuery = z.infer<typeof admissionPaymentCollectionQuerySchema>;

export const invoiceLedgerParamsSchema = z.object({ invoiceId: z.string().uuid() });

export const panelPayerReportQuerySchema = dateRangeSchema.extend({
  corporatePanelId: z.string().uuid().optional(),
});
export type PanelPayerReportQuery = z.infer<typeof panelPayerReportQuerySchema>;

export const receiptExceptionLogQuerySchema = dateRangeSchema.extend({
  collectedById: z.string().uuid().optional(),
});
export type ReceiptExceptionLogQuery = z.infer<typeof receiptExceptionLogQuerySchema>;

export const cashierPerformanceQuerySchema = dateRangeSchema;
export type CashierPerformanceQuery = z.infer<typeof cashierPerformanceQuerySchema>;

/** reporting.md §2 #7 — ONE combined Discounts / Refunds / Voids exception report, narrowed by a Type filter. */
export const financialExceptionsQuerySchema = dateRangeSchema.extend({
  type: z.enum(['DISCOUNT', 'REFUND', 'VOID']).optional(),
  performedById: z.string().uuid().optional(),
});
export type FinancialExceptionsQuery = z.infer<typeof financialExceptionsQuerySchema>;

/** reporting.md §2 #1 — Daily Billing Summary: Period + Cashier + Department. */
export const billingSummaryQuerySchema = dateRangeSchema.extend({
  cashierId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});
export type BillingSummaryQuery = z.infer<typeof billingSummaryQuerySchema>;
