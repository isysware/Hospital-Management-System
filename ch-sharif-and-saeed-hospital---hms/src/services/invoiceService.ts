import apiClient from './apiClient';
import { formatDisplayDate } from '../utils/dateConstants';
import { getPatientById } from './patientRegistryService';

/**
 * Live Hospital Invoices / Billing service — backed by `/api/v1/invoices*`
 * and `/api/v1/encounters`. This is the pre-v7.2 single-invoice-per-
 * admission/encounter billing model (still the real, tested, working
 * model) — the v7.2 Department Sub-Invoice Split (HMS_V7.2_NEW_REQUIREMENTS.md
 * §2.2) that would replace it with one invoice per (admission × department)
 * is a distinct, larger, not-yet-started schema change; see that doc's
 * open-questions section before attempting it.
 */

export type InvoiceStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
export type EncounterType = 'OPD' | 'OBSERVATION' | 'EMERGENCY' | 'CUSTOM';
export type PaymentMethod = 'CASH' | 'CARD' | 'BANK' | 'ONLINE';

export interface InvoiceLine {
  billingSource?: string;
  id: string;
  serviceName: string;
  serviceCode: string;
  serviceCategory?: string;
  serviceStream?: string;
  departmentName?: string;
  fulfillmentOwnership?: string;
  discountAllowed?: boolean;
  quantity: number;
  rate: number;
  lineGross: number;
  discountAmount: number;
  discountReason: string;
  lineNet: number;
  performedByName: string;
}

export interface PaymentReceiptRow {
  id: string;
  receiptNumber: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  isReversed: boolean;
  collectedByName: string;
  collectedAt: string;
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  sourceType: string;
  encounterType: EncounterType | null;
  status: InvoiceStatus;
  patientName: string;
  patientMr: string;
  payerType: 'Corporate / Panel' | 'Self Pay';
  subtotal: number;
  discountTotal: number;
  total: number;
  paidTotal: number;
  balanceDue: number;
  patientShare: number;
  panelReceivable: number;
  /** True when at least one reversed (refund) receipt has been posted against this invoice. */
  hasRefund: boolean;
  /** Sum of reversed receipt amounts — what has actually been refunded, not the current balance. */
  refundedAmount: number;
  panelName?: string;
  panelMemberId?: string;
  departmentName?: string;
  createdAt: string;
  createdAtIso: string;
}

export interface InvoiceDetail extends InvoiceSummary {
  admissionDepartmentName?: string;
  advancePaid: number;
  lines: InvoiceLine[];
  receipts: PaymentReceiptRow[];
  doctorName: string;
  departmentName: string;
  panelName: string;
  patientPhone?: string;
  patientGuardian?: string;
  patientGender?: string;
  patientAge?: number | string;
  patientCnic?: string;
  admissionNumber?: string;
  admissionMedicationMode?: 'SELF' | 'HOSPITAL_MANAGED';
  admissionEstimatedAmount?: number | null;
  wardName?: string;
  bedNumber?: string;
}

function formatTimestamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dateStr = formatDisplayDate(d);
  const timeStr = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

export function formatServiceName(name?: string | null): string {
  if (!name) return '';
  if (/ward\s*fixed(\s*\/\s*admission\s*fee)?/i.test(name)) {
    return 'Ward Price';
  }
  return name.replace(/\bward\s*fixed\b/gi, 'Ward Price');
}

export function formatServiceCode(code?: string | null): string {
  if (!code) return '';
  if (/^ward[-_]fixed/i.test(code) || code.includes('-DEL-') || /ward[-_]price/i.test(code)) {
    return '';
  }
  return code;
}

function resolveMrNumber(raw: Record<string, any>): string {
  if (raw.panelPatient?.mrNumber) return raw.panelPatient.mrNumber;
  if (raw.selfPayEncounter?.mrNumber) return raw.selfPayEncounter.mrNumber;
  if (raw.patient?.mrNumber) return raw.patient.mrNumber;
  if (raw.mrNumber) return raw.mrNumber;

  const encounterId = raw.panelPatientId || raw.selfPayEncounterId || raw.selfPayEncounter?.id;
  if (encounterId) {
    const fromRegistry = getPatientById(encounterId);
    if (fromRegistry?.mrNumber) return fromRegistry.mrNumber;
  }

  if (raw.selfPayEncounter?.id || raw.selfPayEncounterId) {
    const rawId = String(raw.selfPayEncounter?.id || raw.selfPayEncounterId || '');
    const cleanId = rawId.replace(/\D/g, '').slice(0, 6) || rawId.replace(/-/g, '').slice(0, 6).toUpperCase();
    return `MR-${cleanId.padStart(6, '0')}`;
  }

  return '';
}

function toInvoiceSummary(raw: Record<string, any>): InvoiceSummary {
  const isPanel = !!raw.panelPatientId;
  const patient = raw.panelPatient || raw.selfPayEncounter || raw.admissionRecord?.panelPatient || raw.admissionRecord?.selfPayEncounter;
  const receipts: any[] = Array.isArray(raw.paymentReceipts) ? raw.paymentReceipts : [];
  const reversedReceipts = receipts.filter((r) => r.isReversed);
  const paidTotal = Number(raw.paidTotal ?? 0);
  const patientShare = Number(isPanel ? raw.patientShare ?? 0 : raw.total ?? 0);
  const panelReceivable = Number(raw.panelReceivable ?? 0);
  const balanceDue = Math.max(0, patientShare - paidTotal);
  return {
    id: raw.id,
    invoiceNumber: raw.invoiceNumber,
    sourceType: raw.sourceType,
    encounterType: raw.encounterType || null,
    status: raw.status === 'VOID' ? 'VOID' : balanceDue === 0 ? 'PAID' : paidTotal > 0 ? 'PARTIALLY_PAID' : 'UNPAID',
    patientName: patient?.fullName || 'Walk-in Patient',
    patientMr: resolveMrNumber(raw),
    payerType: isPanel ? 'Corporate / Panel' : 'Self Pay',
    subtotal: Number(raw.subtotal ?? 0),
    discountTotal: Number(raw.discountTotal ?? 0),
    total: Number(raw.total ?? 0),
    paidTotal,
    balanceDue, patientShare, panelReceivable,
    hasRefund: reversedReceipts.length > 0,
    refundedAmount: reversedReceipts.reduce((sum, r) => sum + Math.abs(Number(r.amount ?? 0)), 0),
    panelName: raw.corporatePanel?.organizationName || raw.panelPatient?.corporatePanel?.organizationName || raw.panelName || '',
    panelMemberId: raw.panelPatient?.panelMemberId || '',
    departmentName: raw.department?.name || '',
    createdAt: formatTimestamp(raw.createdAt),
    createdAtIso: raw.createdAt || '',
  };
}

function toInvoiceDetail(raw: Record<string, any>): InvoiceDetail {
  const admissionDoc = raw.admissionRecord?.doctor?.fullName;
  const firstLineDoctor = raw.lines?.[0]?.performedBy?.fullName;
  const doctor = raw.appointment?.doctor?.fullName || admissionDoc || firstLineDoctor || '';
  const admissionDept = raw.admissionRecord?.department?.name;
  const firstLineDept = raw.lines?.[0]?.serviceRate?.departmentName || raw.lines?.[0]?.serviceRate?.category;
  const department = raw.department?.name || raw.appointment?.department?.name || admissionDept || firstLineDept || '';

  return {
    ...toInvoiceSummary(raw),
    admissionDepartmentName: admissionDept,
    doctorName: doctor,
    departmentName: department,
    panelName: raw.panelPatient?.corporatePanel?.name || raw.panelPatient?.corporatePanel?.organizationName || '',
    patientPhone: raw.panelPatient?.primaryPhone || raw.selfPayEncounter?.phone || '',
    patientGuardian: raw.panelPatient?.fatherGuardianName || raw.selfPayEncounter?.guardianName || '',
    patientGender: raw.panelPatient?.gender || raw.selfPayEncounter?.gender || '',
    patientAge: raw.panelPatient?.age || (raw.selfPayEncounter?.dob ? Math.max(0, new Date().getFullYear() - new Date(raw.selfPayEncounter.dob).getFullYear()) : ''),
    patientCnic: raw.panelPatient?.cnic || raw.selfPayEncounter?.cnicOrPassport || '',
    admissionMedicationMode: raw.admissionRecord?.medicationMode,
    admissionNumber: raw.admissionRecord?.admissionNumber || undefined,
    admissionEstimatedAmount: raw.admissionRecord?.estimatedAmount != null ? Number(raw.admissionRecord.estimatedAmount) : null,
    advancePaid: (raw.paymentReceipts || []).filter((r: any) => r.admissionRecordId && !r.admissionPaymentRequestId && !r.isReversed && Number(r.amount) > 0).reduce((sum: number, r: any) => sum + Number(r.amount), 0),
    wardName: raw.admissionRecord?.bed?.room?.ward?.name || undefined,
    bedNumber: raw.admissionRecord?.bed?.bedNumber || undefined,
    lines: (raw.lines || []).filter((l: any) => raw.sourceType !== 'ADMISSION' || l.serviceRate?.code !== 'ADM-ADVANCE').map((l: any) => ({
      id: l.id,
      serviceName: l.descriptionSnapshot || formatServiceName(l.serviceRate?.name || '') || l.billingSource,
      billingSource: l.billingSource,
      serviceCode: formatServiceCode(l.serviceRate?.code || ''),
      serviceCategory: l.serviceRate?.category || '',
      serviceStream: l.serviceRate?.serviceStream || '',
      departmentName: l.serviceRate?.department?.name || '',
      fulfillmentOwnership: l.serviceRate?.department?.fulfillmentOwnership || '',
      discountAllowed: l.serviceRate?.discountAllowed !== false,
      quantity: Number(l.quantity ?? 1),
      rate: Number(l.rateSnapshot ?? 0),
      lineGross: Number(l.lineGross ?? 0),
      discountAmount: Number(l.discountAmount ?? 0),
      discountReason: l.discountReason || '',
      lineNet: Number(l.lineNet ?? 0),
      performedByName: l.performedBy?.fullName || '',
    })),
    receipts: (raw.paymentReceipts || []).map((r: any) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      amount: Number(r.amount ?? 0),
      method: r.method,
      reference: r.referenceNote || '',
      isReversed: !!r.isReversed,
      collectedByName: r.collectedBy?.username || '',
      collectedAt: formatTimestamp(r.collectedAt),
    })),
  };
}

export async function fetchInvoices(params?: {
  status?: InvoiceStatus;
  encounterType?: EncounterType;
  sourceType?: 'APPOINTMENT' | 'WALK_IN' | 'ADMISSION';
  date?: string;
  search?: string;
  /** Server-side record-type filters — hold across the whole table, not just the latest-100 default window. */
  hasDiscount?: boolean;
  hasRefund?: boolean;
  hasPayment?: boolean;
  hasOutstandingBalance?: boolean;
  isPanel?: 'true' | 'false';
  corporatePanelId?: string;
  panelPatientId?: string;
}): Promise<InvoiceSummary[]> {
  const res = await apiClient.get<{ data: Record<string, any>[] }>('/invoices', { params });
  return res.data.data.map(toInvoiceSummary);
}

export async function fetchInvoiceDetail(id: string): Promise<InvoiceDetail> {
  const res = await apiClient.get<{ data: Record<string, any> }>(`/invoices/${id}`);
  return toInvoiceDetail(res.data.data);
}

export async function addServiceLine(
  invoiceId: string,
  values: { serviceRateId: string; quantity: number; performedByStaffId?: string },
): Promise<void> {
  await apiClient.post(`/invoices/${invoiceId}/lines`, values);
}

export async function applyDiscount(
  invoiceId: string,
  values: { lineItemId?: string; discountPercent?: number; discountAmount?: number; discountReason: string },
): Promise<void> {
  await apiClient.post(`/invoices/${invoiceId}/discounts`, values);
}

export async function collectPayment(
  invoiceId: string,
  values: { amount: number; paymentMethod: PaymentMethod; reference?: string },
): Promise<void> {
  await apiClient.post(`/invoices/${invoiceId}/payments`, values);
}

export async function refundPayment(
  invoiceId: string,
  values: { paymentReceiptId?: string; amount: number; refundMethod: PaymentMethod; reason: string },
): Promise<void> {
  await apiClient.post(`/invoices/${invoiceId}/refund`, values);
}

export interface CreateEncounterFormValues {
  encounterType: EncounterType;
  panelPatientId?: string;
  selfPayEncounterId?: string;
  newSelfPayPatient?: {
    fullName: string;
    guardianName?: string;
    gender?: string;
    dob?: string;
    cnicOrPassport?: string;
    phone?: string;
    address?: string;
  };
  departmentId?: string;
  doctorStaffId?: string;
  notes?: string;
  /** Case authorization/guarantee — required by the backend when the selected panel company's `authorizationRequired` policy is on (panel.md §15 backlog item 2). */
  authorizationNumber?: string;
  authorizationLimit?: number;
  authorizationValidUntil?: string;
}

/** `POST /encounters` — Walk-In / Encounter Intake (OPD/Observation/Emergency), creates the invoice shell. */
export async function createEncounter(values: CreateEncounterFormValues): Promise<InvoiceDetail> {
  const res = await apiClient.post<{ data: Record<string, any> }>('/encounters', {
    encounterType: values.encounterType,
    panelPatientId: values.panelPatientId || undefined,
    selfPayEncounterId: values.selfPayEncounterId || undefined,
    newSelfPayPatient: values.newSelfPayPatient || undefined,
    departmentId: values.departmentId || undefined,
    doctorStaffId: values.doctorStaffId || undefined,
    notes: values.notes?.trim() || undefined,
    authorizationNumber: values.authorizationNumber?.trim() || undefined,
    authorizationLimit: values.authorizationLimit,
    authorizationValidUntil: values.authorizationValidUntil || undefined,
  });
  return toInvoiceDetail(res.data.data);
}

