import { z } from 'zod';

const dateRangeSchema = z.object({
  preset: z.enum(['today', 'yesterday', 'this_week', 'this_month', 'custom']).default('today'),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const admissionDailySummaryQuerySchema = dateRangeSchema.extend({
  departmentId: z.string().uuid().optional(),
});
export type AdmissionDailySummaryQuery = z.infer<typeof admissionDailySummaryQuerySchema>;

export const admissionRegisterQuerySchema = dateRangeSchema.extend({
  departmentId: z.string().uuid().optional(),
  doctorStaffId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
  status: z.enum(['PLANNED', 'CONFIRMED', 'ACTIVE', 'DISCHARGE_PENDING', 'DISCHARGED', 'CANCELLED']).optional(),
  payerType: z.enum(['PANEL', 'SELF_PAY']).optional(),
});
export type AdmissionRegisterQuery = z.infer<typeof admissionRegisterQuerySchema>;

export const inpatientCensusQuerySchema = z.object({
  asOf: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
});
export type InpatientCensusQuery = z.infer<typeof inpatientCensusQuerySchema>;

export const bedOccupancyQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
});
export type BedOccupancyQuery = z.infer<typeof bedOccupancyQuerySchema>;

export const bedTransferHistoryQuerySchema = dateRangeSchema.extend({
  admissionRecordId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});
export type BedTransferHistoryQuery = z.infer<typeof bedTransferHistoryQuerySchema>;

export const lengthOfStayQuerySchema = dateRangeSchema.extend({
  departmentId: z.string().uuid().optional(),
  doctorStaffId: z.string().uuid().optional(),
  status: z.enum(['PLANNED', 'CONFIRMED', 'ACTIVE', 'DISCHARGE_PENDING', 'DISCHARGED', 'CANCELLED']).optional(),
});
export type LengthOfStayQuery = z.infer<typeof lengthOfStayQuerySchema>;

export const admissionRecordIdParamsSchema = z.object({ admissionRecordId: z.string().uuid() });

export const serviceConsumptionQuerySchema = dateRangeSchema.extend({
  departmentId: z.string().uuid().optional(),
});
export type ServiceConsumptionQuery = z.infer<typeof serviceConsumptionQuerySchema>;

export const inpatientOutstandingQuerySchema = dateRangeSchema.extend({
  departmentId: z.string().uuid().optional(),
  payerType: z.enum(['PANEL', 'SELF_PAY']).optional(),
  status: z.enum(['PLANNED', 'CONFIRMED', 'ACTIVE', 'DISCHARGE_PENDING', 'DISCHARGED', 'CANCELLED']).optional(),
});
export type InpatientOutstandingQuery = z.infer<typeof inpatientOutstandingQuerySchema>;

export const dischargeClearanceQuerySchema = dateRangeSchema.extend({
  departmentId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
  doctorStaffId: z.string().uuid().optional(),
  clinicalStatus: z.enum(['READY', 'NOT_READY']).optional(),
  hospitalClearance: z.enum(['PENDING', 'CLEARED', 'NOT_APPLICABLE']).optional(),
  pharmacyClearance: z.enum(['PENDING', 'CLEARED', 'NOT_APPLICABLE']).optional(),
});
export type DischargeClearanceQuery = z.infer<typeof dischargeClearanceQuerySchema>;

// ── reporting.md §3 — simplified 7-report Admission set ──────────────────
const admissionStatusEnum = z.enum(['PLANNED', 'CONFIRMED', 'ACTIVE', 'DISCHARGE_PENDING', 'DISCHARGED', 'CANCELLED']);

/** #1 Admission Summary — From/To, Department, Ward, Doctor, Status. */
export const admissionSummaryQuerySchema = dateRangeSchema.extend({
  departmentId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
  doctorStaffId: z.string().uuid().optional(),
  status: admissionStatusEnum.optional(),
});
export type AdmissionSummaryQuery = z.infer<typeof admissionSummaryQuerySchema>;

/** #3 Inpatient Census / Bed — As-of Date, Department, Ward, Room/Bed, Bed Status. One row per bed. */
export const censusBedQuerySchema = z.object({
  asOf: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
  roomBed: z.string().trim().max(50).optional(),
  bedStatus: z.enum(['OCCUPIED', 'AVAILABLE', 'RESERVED', 'OUT_OF_SERVICE']).optional(),
});
export type CensusBedQuery = z.infer<typeof censusBedQuerySchema>;

/** #4 Transfer / Length of Stay — From/To, Admission No, Department, Ward, Doctor. */
export const transferLosQuerySchema = dateRangeSchema.extend({
  admissionNumber: z.string().trim().max(50).optional(),
  departmentId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
  doctorStaffId: z.string().uuid().optional(),
});
export type TransferLosQuery = z.infer<typeof transferLosQuerySchema>;

/** #5 Running Hospital Bill / Payment Status — From/To, Admission No, Department, Payment Status, Hospital Clearance. */
export const hospitalBillStatusQuerySchema = dateRangeSchema.extend({
  admissionNumber: z.string().trim().max(50).optional(),
  departmentId: z.string().uuid().optional(),
  paymentStatus: z.enum(['PAID', 'PARTIALLY_PAID', 'UNPAID', 'NO_CHARGES']).optional(),
  clearanceStatus: z.enum(['PENDING', 'CLEARED', 'NOT_APPLICABLE']).optional(),
});
export type HospitalBillStatusQuery = z.infer<typeof hospitalBillStatusQuerySchema>;

/** #6 Pharmacy Request & Fulfillment — From/To, Admission No, Medicine, Request Status, Approval Status. */
export const pharmacyRequestFulfillmentQuerySchema = dateRangeSchema.extend({
  admissionNumber: z.string().trim().max(50).optional(),
  medicine: z.string().trim().max(100).optional(),
  status: z
    .enum(['REQUESTED', 'ACCEPTED', 'PARTIALLY_FULFILLED', 'REJECTED', 'DISPENSING', 'DISPENSED', 'INVOICED', 'CLEARANCE_SENT', 'INTEGRATION_ERROR', 'AUTHORIZATION_REQUIRED'])
    .optional(),
  approvalStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'AUTHORIZED', 'REJECTED']).optional(),
});
export type PharmacyRequestFulfillmentQuery = z.infer<typeof pharmacyRequestFulfillmentQuerySchema>;
