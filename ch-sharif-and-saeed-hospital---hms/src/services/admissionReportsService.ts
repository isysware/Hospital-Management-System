import apiClient from './apiClient';
import { toErrorMessage } from '../utils/apiErrors';
import { formatPKR, formatDateTimeDDMMYYYY } from '../utils/formatters';
import type { ReportDatePreset, ReportResult } from '../components/reports/GenericReportView';

/**
 * Admission report fetchers — backed by `/api/v1/reports/admission/*`
 * (`hms-backend/src/modules/reports/admissionReports.*`). Reporting Guide
 * v7.5 §5. Admission has no cashier Balance Sheet / Account Settlement —
 * these are case lifecycle, bed and read-only financial status only.
 */

type RangeParams = { preset: ReportDatePreset; fromDate?: string; toDate?: string };

/** Filter-row values keyed by backend query param — empty string means "All" and is dropped. */
export type ReportFilters = Record<string, string | undefined>;

function params(range: RangeParams, extra?: ReportFilters) {
  return { preset: range.preset, ...(range.preset === 'custom' && range.fromDate ? { fromDate: range.fromDate } : {}), ...(range.preset === 'custom' && range.toDate ? { toDate: range.toDate } : {}), ...Object.fromEntries(Object.entries(extra ?? {}).filter(([, v]) => v)) };
}

async function get<T>(url: string, query: Record<string, any>): Promise<T> {
  try {
    const res = await apiClient.get<{ data: T }>(url, { params: query });
    return res.data.data;
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function fetchAdmissionDailySummary(range: RangeParams): Promise<ReportResult<{ metric: string; value: string }>> {
  const d = await get<any>('/reports/admission/daily-summary', params(range));
  const rows = [
    { metric: 'Admissions Today', value: String(d.admissionsToday) },
    { metric: 'Active Admissions', value: String(d.activeAdmissions) },
    { metric: 'Pending Admissions', value: String(d.pendingAdmissions) },
    { metric: 'Discharges Today', value: String(d.dischargesToday) },
    { metric: 'Pending Discharge Clearance', value: String(d.pendingDischargeClearance) },
    { metric: 'Beds Occupied', value: `${d.bedsOccupied} / ${d.totalBeds}` },
    { metric: 'Beds Available', value: String(d.bedsAvailable) },
    { metric: 'Average Length of Stay', value: `${d.averageLengthOfStayDays} days` },
    { metric: 'Outstanding Inpatient Balance', value: formatPKR(d.outstandingInpatientBalance) },
  ];
  return { periodLabel: d.period.label, rows };
}

export interface AdmissionRegisterRow {
  id: string;
  admissionNumber: string;
  patient: string;
  payer: string;
  doctor: string | null;
  department: string;
  ward: string | null;
  bed: string | null;
  admittedAt: string | null;
  dischargedAt: string | null;
  status: string;
  createdBy: string | null;
}

export async function fetchAdmissionRegister(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<AdmissionRegisterRow>> {
  const d = await get<any>('/reports/admission/register', params(range, filters));
  return {
    periodLabel: d.period.label,
    kpis: [
      { label: 'Admissions', value: String(d.summary.admissionsCount) },
      { label: 'Active', value: String(d.summary.active), accent: 'positive' },
      { label: 'Discharged', value: String(d.summary.discharged) },
      { label: 'Panel / Self-Pay', value: `${d.summary.panel} / ${d.summary.selfPay}` },
    ],
    rows: d.rows.map((r: any) => ({ ...r, admittedAt: r.admittedAt ? formatDateTimeDDMMYYYY(r.admittedAt) : '—', dischargedAt: r.dischargedAt ? formatDateTimeDDMMYYYY(r.dischargedAt) : '—' })),
  };
}

export interface CensusRow {
  admissionNumber: string;
  patient: string;
  doctor: string | null;
  department: string;
  ward: string | null;
  room: string | null;
  bed: string | null;
  admittedAt: string;
  hospitalDue: number;
  pharmacyClearance: string;
  dischargeReady: boolean;
}

export async function fetchInpatientCensus(filters?: { departmentId?: string; wardId?: string }): Promise<ReportResult<CensusRow>> {
  const d = await get<any>('/reports/admission/census', filters || {});
  return {
    periodLabel: `As of ${formatDateTimeDDMMYYYY(d.asOf)}`,
    kpis: [{ label: 'Active Census', value: String(d.activeCensus) }],
    rows: d.rows.map((r: any) => ({ ...r, admittedAt: formatDateTimeDDMMYYYY(r.admittedAt), hospitalDue: Number(r.hospitalDue) })),
  };
}

export interface BedOccupancyRow {
  ward: string;
  capacity: number;
  occupied: number;
  available: number;
  occupancyPercent: number;
}

export async function fetchBedOccupancy(filters?: { departmentId?: string; wardId?: string }): Promise<ReportResult<BedOccupancyRow>> {
  const d = await get<any>('/reports/admission/bed-occupancy', filters || {});
  return {
    kpis: [
      { label: 'Beds Occupied', value: String(d.summary.bedsOccupied) },
      { label: 'Beds Available', value: String(d.summary.bedsAvailable) },
      { label: 'Occupancy %', value: `${d.summary.occupancyPercent}%` },
    ],
    rows: d.rows,
  };
}

export interface BedTransferRow {
  admissionNumber: string;
  patient: string;
  fromWard: string | null;
  fromBed: string | null;
  toWard: string | null;
  toBed: string;
  transferredAt: string;
  reason: string | null;
  changedBy: string;
}

export async function fetchBedTransferHistory(range: RangeParams): Promise<ReportResult<BedTransferRow>> {
  const d = await get<any>('/reports/admission/bed-transfers', params(range));
  return {
    periodLabel: d.period.label,
    kpis: [{ label: 'Transfer Count', value: String(d.transferCount) }],
    rows: d.rows.map((r: any) => ({ ...r, transferredAt: formatDateTimeDDMMYYYY(r.transferredAt) })),
  };
}

export interface LengthOfStayRow {
  admissionNumber: string;
  patient: string;
  department: string;
  admittedAt: string;
  dischargedAt: string | null;
  lengthOfStayDays: number;
  status: string;
}

export async function fetchLengthOfStay(range: RangeParams): Promise<ReportResult<LengthOfStayRow>> {
  const d = await get<any>('/reports/admission/length-of-stay', params(range));
  return {
    periodLabel: d.period.label,
    kpis: [
      { label: 'Average LOS', value: `${d.summary.averageLosDays} days` },
      { label: 'Longest Current Stay', value: `${d.summary.longestCurrentStayDays} days` },
      { label: 'Discharged', value: String(d.summary.dischargedCount) },
    ],
    rows: d.rows.map((r: any) => ({ ...r, admittedAt: formatDateTimeDDMMYYYY(r.admittedAt), dischargedAt: r.dischargedAt ? formatDateTimeDDMMYYYY(r.dischargedAt) : '—' })),
  };
}

export interface ServiceConsumptionRow {
  department: string;
  service: string;
  qty: number;
  gross: number;
  discount: number;
  net: number;
  admissionCount: number;
}

export async function fetchServiceConsumption(range: RangeParams): Promise<ReportResult<ServiceConsumptionRow>> {
  const d = await get<any>('/reports/admission/service-consumption', params(range));
  return {
    periodLabel: d.period.label,
    rows: d.rows.map((r: any) => ({ ...r, qty: Number(r.qty), gross: Number(r.gross), discount: Number(r.discount), net: Number(r.net) })),
  };
}

export interface InpatientOutstandingRow {
  admissionNumber: string;
  patient: string;
  hospitalNet: number;
  hospitalPaid: number;
  hospitalOutstanding: number;
  admissionStatus: string;
  invoiceStatus: string;
}

export async function fetchInpatientOutstanding(range: RangeParams): Promise<ReportResult<InpatientOutstandingRow>> {
  const d = await get<any>('/reports/admission/outstanding', params(range));
  return {
    periodLabel: d.period.label,
    kpis: [
      { label: 'Total Hospital Outstanding', value: formatPKR(d.summary.totalHospitalOutstanding), accent: 'warning' },
      { label: 'Active Outstanding', value: formatPKR(d.summary.activeOutstanding) },
      { label: 'Discharged Outstanding', value: formatPKR(d.summary.dischargedOutstanding) },
    ],
    rows: d.rows.map((r: any) => ({ ...r, hospitalNet: Number(r.hospitalNet), hospitalPaid: Number(r.hospitalPaid), hospitalOutstanding: Number(r.hospitalOutstanding) })),
  };
}

export interface DischargeClearanceRow {
  admissionNumber: string;
  patient: string;
  department: string;
  doctor: string | null;
  admissionStatus: string;
  clinicalReady: boolean;
  hospitalClearance: string;
  hospitalDue: number;
  balanceStatus: 'SETTLED' | 'CREDIT' | 'OUTSTANDING';
  pharmacyClearance: string;
  dischargeReady: boolean;
  completedBy: string | null;
  dischargeDate: string | null;
}

export async function fetchDischargeClearance(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<DischargeClearanceRow>> {
  const d = await get<any>('/reports/admission/discharge-clearance', params(range, filters));
  return {
    periodLabel: d.period.label,
    kpis: [
      { label: 'Clinical Ready', value: String(d.summary.clinicalReady) },
      { label: 'Hospital Cleared', value: String(d.summary.hospitalCleared) },
      { label: 'Pharmacy Cleared', value: String(d.summary.pharmacyCleared) },
      { label: 'Fully Discharge-Ready', value: String(d.summary.fullyDischargeReady), accent: 'positive' },
    ],
    rows: d.rows.map((r: any) => ({ ...r, hospitalDue: Number(r.hospitalDue), dischargeDate: r.dischargeDate ? formatDateTimeDDMMYYYY(r.dischargeDate) : '—' })),
  };
}

export async function fetchRunningHospitalBill(admissionRecordId: string) {
  try {
    const res = await apiClient.get<{ data: any }>(`/reports/admission/${admissionRecordId}/running-bill`);
    const d = res.data.data;
    return {
      admissionNumber: d.admissionNumber,
      patient: d.patient,
      summary: {
        hospitalSubtotal: Number(d.summary.hospitalSubtotal),
        hospitalDiscount: Number(d.summary.hospitalDiscount),
        hospitalPaymentsReceived: Number(d.summary.hospitalPaymentsReceived),
        hospitalOutstanding: Number(d.summary.hospitalOutstanding),
      },
      rows: d.rows.map((r: any) => ({ ...r, occurredAt: formatDateTimeDDMMYYYY(r.occurredAt), qty: Number(r.qty), rate: Number(r.rate), gross: Number(r.gross), discount: Number(r.discount), net: Number(r.net), runningBalance: Number(r.runningBalance) })),
    };
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

// ── reporting.md §3 — simplified 7-report Admission set ──────────────────

export interface AdmissionSummaryRow {
  department: string;
  admissions: number;
  discharges: number;
  active: number;
  pendingDischarge: number;
  hospitalOutstanding: number;
}

/** #1 Admission Summary — the portal's only KPI-strip report. */
export async function fetchAdmissionSummary(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<AdmissionSummaryRow>> {
  const d = await get<any>('/reports/admission/summary', params(range, filters));
  const s = d.summary;
  return {
    periodLabel: d.period.label,
    kpis: [
      { label: 'Admissions', value: String(s.admissions) },
      { label: 'Discharges', value: String(s.discharges) },
      { label: 'Active Patients', value: String(s.activePatients), accent: 'positive' },
      { label: 'Pending Discharge', value: String(s.pendingDischarge), accent: 'warning' },
      { label: 'Beds Occupied / Available', value: `${s.occupiedBeds} / ${s.availableBeds}` },
      { label: 'Hospital Outstanding', value: formatPKR(Number(s.hospitalOutstanding)), accent: 'negative' },
    ],
    rows: d.rows.map((r: any) => ({ ...r, hospitalOutstanding: Number(r.hospitalOutstanding) })),
  };
}

export interface CensusBedRow {
  ward: string;
  room: string | null;
  bed: string;
  bedStatus: string;
  admissionNumber: string | null;
  patient: string | null;
  department: string | null;
  doctor: string | null;
  admittedAt: string | null;
  hospitalDue: number;
}

/** #3 Inpatient Census / Bed — one row per bed, occupant as of `asOf` (blank = now). */
export async function fetchCensusBeds(filters?: ReportFilters): Promise<ReportResult<CensusBedRow>> {
  const d = await get<any>('/reports/admission/census-beds', params({ preset: 'today' }, filters));
  return {
    periodLabel: `${d.periodLabel} · ${d.summary.occupied} occupied / ${d.summary.available} available of ${d.summary.totalBeds}`,
    rows: d.rows.map((r: any) => ({ ...r, admittedAt: r.admittedAt ? formatDateTimeDDMMYYYY(r.admittedAt) : null, hospitalDue: Number(r.hospitalDue) })),
  };
}

export interface TransferLosRow {
  admissionNumber: string;
  patient: string;
  department: string;
  doctor: string | null;
  admittedAt: string | null;
  dischargedAt: string | null;
  losDays: number;
  status: string;
  from: string | null;
  to: string | null;
  transferredAt: string | null;
  reason: string | null;
  transferredBy: string | null;
}

/** #4 Transfer / Length of Stay. */
export async function fetchTransferLos(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<TransferLosRow>> {
  const d = await get<any>('/reports/admission/transfer-los', params(range, filters));
  const fmt = (v: string | null) => (v ? formatDateTimeDDMMYYYY(v) : null);
  return {
    periodLabel: d.period.label,
    rows: d.rows.map((r: any) => ({ ...r, admittedAt: fmt(r.admittedAt), dischargedAt: fmt(r.dischargedAt), transferredAt: fmt(r.transferredAt), losDays: Number(r.losDays) })),
  };
}

export interface HospitalBillStatusRow {
  id: string;
  admissionNumber: string;
  patient: string;
  payer: string;
  department: string;
  admissionStatus: string;
  hospitalCharges: number;
  paymentsCollected: number;
  hospitalOutstanding: number;
  paymentStatus: string;
  latestReceipt: string | null;
  latestReceiptAt: string | null;
  latestRequestStatus: string | null;
  hospitalClearance: string;
}

/** #5 Running Hospital Bill / Payment Status — read-only; Pharmacy bill never included. */
export async function fetchHospitalBillStatus(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<HospitalBillStatusRow>> {
  const d = await get<any>('/reports/admission/hospital-bill-status', params(range, filters));
  return {
    periodLabel: d.period.label,
    rows: d.rows.map((r: any) => ({
      ...r,
      hospitalCharges: Number(r.hospitalCharges),
      paymentsCollected: Number(r.paymentsCollected),
      hospitalOutstanding: Number(r.hospitalOutstanding),
      latestReceiptAt: r.latestReceiptAt ? formatDateTimeDDMMYYYY(r.latestReceiptAt) : null,
    })),
  };
}

export interface PharmacyRequestFulfillmentRow {
  requestRef: string;
  requestedAt: string;
  admissionNumber: string;
  patient: string;
  medicine: string;
  requestedQty: number;
  dispensedQty: number;
  requestStatus: string;
  notes: string | null;
  pharmacyInvoice: string | null;
  pharmacyClearance: string;
  approvalStatus: string;
}

/** #6 Pharmacy Request & Fulfillment. */
export async function fetchPharmacyRequestFulfillment(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<PharmacyRequestFulfillmentRow>> {
  const d = await get<any>('/reports/admission/pharmacy-request-fulfillment', params(range, filters));
  return {
    periodLabel: d.period.label,
    rows: d.rows.map((r: any) => ({ ...r, requestedAt: formatDateTimeDDMMYYYY(r.requestedAt), requestedQty: Number(r.requestedQty), dispensedQty: Number(r.dispensedQty) })),
  };
}

export interface AdmissionFilterOptions {
  departments: { value: string; label: string }[];
  doctors: { value: string; label: string }[];
  wards: { value: string; label: string }[];
}

let admissionOptionsPromise: Promise<AdmissionFilterOptions> | null = null;

/** Dropdown sources for every Admission report filter row — fetched once per session and shared. */
export function fetchAdmissionFilterOptions(): Promise<AdmissionFilterOptions> {
  if (!admissionOptionsPromise) {
    admissionOptionsPromise = get<AdmissionFilterOptions>('/reports/admission/filter-options', {}).catch((err) => {
      admissionOptionsPromise = null;
      throw err;
    });
  }
  return admissionOptionsPromise;
}
