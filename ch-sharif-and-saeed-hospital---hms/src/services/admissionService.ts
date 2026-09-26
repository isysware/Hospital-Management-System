import apiClient from './apiClient';
import { toErrorMessage } from '../utils/apiErrors';
import { formatDisplayDate } from '../utils/dateConstants';
import { getPatientById } from './patientRegistryService';

/**
 * Live Admission service — backed by `/api/v1/admission*`. This is the
 * v7.2 §2.9 relocation (HMS_V7.2_NEW_REQUIREMENTS.md): admission creation
 * now happens at Front Desk (this service is consumed by
 * `features/frontDesk/newAdmission/NewAdmissionView.tsx`), while the
 * Admission Portal keeps managing the stay after handoff — every stay
 * action (check-in, bed transfer, services, medication mode, pharmacy
 * requests, payment requests, clearances, discharge) lives here too.
 *
 * Discharge/clearance functions below reflect the CURRENT backend
 * mechanism — any portal user can grant any of the 3 clearance gates, and
 * discharge goes straight to `DISCHARGED`. The v7.2 doctor-credential
 * re-authentication + Discharge Summary capture (§2.4) is a deliberately
 * separate, not-yet-built pass — this file does not pretend otherwise.
 */

export type MedicationMode = 'SELF' | 'HOSPITAL_MANAGED';
export type AdmissionStatus = 'PLANNED' | 'CONFIRMED' | 'ACTIVE' | 'DISCHARGE_PENDING' | 'DISCHARGED' | 'CANCELLED';
export type ClearanceType = 'CLINICAL' | 'HOSPITAL_BILLING' | 'PHARMACY';
export type ClearanceStatus = 'PENDING' | 'CLEARED' | 'NOT_APPLICABLE';

export interface AdmissionClearance {
  id: string;
  clearanceType: ClearanceType;
  status: ClearanceStatus;
  clearedByLabel?: string;
  clearedAt?: string;
}

export interface AdmissionRecord {
  id: string;
  admissionNumber: string;
  patientName: string;
  patientMrNumber: string;
  payerType: 'Corporate / Panel' | 'Self Pay';
  departmentId: string;
  departmentName: string;
  doctorId: string;
  doctorName: string;
  bedId: string | null;
  bedLabel: string | null;
  status: AdmissionStatus;
  medicationMode: MedicationMode;
  outsourcedFulfillmentMode?: MedicationMode;
  diagnosis: string;
  estimatedAmount: number | null;
  expectedAt: string;
  admittedAt: string;
  dischargedAt: string;
  createdAt: string;
  /** Raw ISO timestamp (unlike `createdAt` above, which is display-formatted) — for client-side date filtering. */
  createdAtIso: string;
  /** Present on list rows (backend already includes it) — lets pages compute discharge-readiness without a second call. */
  clearances?: AdmissionClearance[];
}

export type AdmissionPaymentMethod = 'CASH' | 'CARD' | 'BANK' | 'ONLINE';

export interface CreateAdmissionFormValues {
  panelPatientId: string;
  selfPayEncounterId: string;
  departmentId: string;
  wardId?: string;
  doctorStaffId: string;
  preferredBedId: string;
  expectedAt: string;
  diagnosis: string;
  weightKg: number | '';
  estimatedAmount: number | '';
  medicationMode: MedicationMode;
  outsourcedFulfillmentMode?: MedicationMode;
  notes: string;
  /** Optional advance collected at creation time — posts a real receipt (see `createAdmission`), not just a stored estimate. */
  advanceAmount: number | '';
  paymentMethod: AdmissionPaymentMethod;
  paymentReference: string;
  /** Case authorization/guarantee — required by the backend when the selected panel company's `authorizationRequired` policy is on (panel.md §15 backlog item 2). */
  authorizationNumber?: string;
  authorizationLimit?: number | '';
  authorizationValidUntil?: string;
}

export interface AdmissionAdvanceReceipt {
  id: string;
  receiptNumber: string;
  amount: number;
  method: AdmissionPaymentMethod;
  reference: string;
  collectedAt: string;
}

export interface AdmissionServiceLine {
  id: string;
  serviceName: string;
  serviceCode: string;
  quantity: number;
  lineGross: number;
  discountAmount: number;
  lineNet: number;
  patientShare: number;
  panelReceivable: number;
  discountReason?: string | null;
  performedByName: string;
}

export interface AdmissionInvoiceRow {
  id: string;
  invoiceNumber: string;
  departmentName: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  paidTotal: number;
  outstanding: number;
  status: string;
  lines: AdmissionServiceLine[];
}

export interface AdmissionPharmacyRequestLine {
  medicineId: string;
  medicineName: string;
  requestedQuantity: number;
  notes: string;
}

export type HighCostAuthorizationStatus = 'PENDING' | 'AUTHORIZED' | 'REJECTED';

export interface HighCostMedicineAuthorizationRecord {
  id: string;
  lineTotal: number;
  thresholdAmount: number;
  attendantName?: string;
  attendantRelation?: string;
  attendantConfirmed: boolean;
  managementApprovedAt?: string;
  status: HighCostAuthorizationStatus;
}

export interface AdmissionPharmacyRequestRecord {
  id: string;
  medicineRequestNumber: string;
  status: string;
  requestedByLabel: string;
  requestedAt: string;
  lines: AdmissionPharmacyRequestLine[];
  highCostAuthorization?: HighCostMedicineAuthorizationRecord | null;
}

export interface AdmissionBedTransferRecord {
  id: string;
  fromBedLabel: string;
  toBedLabel: string;
  reason: string;
  transferredByLabel: string;
  transferredAt: string;
}

export interface AdmissionMedicationModeHistoryEntry {
  id: string;
  previousMode: MedicationMode;
  newMode: MedicationMode;
  reason: string;
  changedByLabel: string;
  changedAt: string;
}

export interface AdmissionPaymentRequestSummary {
  id: string;
  requestType: string;
  requestedAmount: number;
  status: string;
  notes: string;
  requestedAt: string;
}

export interface AdmissionDischargeSummary {
  finalDiagnosis: string;
  treatmentSummary: string;
  conditionAtDischarge: string;
  medicinesInstructions: string;
  followUpAdvice?: string;
  followUpDate?: string;
  additionalNotes?: string;
  doctorNameSnapshot: string;
  doctorDepartmentSnapshot?: string;
  authorizedAt: string;
}

export interface AdmissionDetail extends AdmissionRecord {
  clearances: AdmissionClearance[];
  invoices: AdmissionInvoiceRow[];
  pharmacyRequests: AdmissionPharmacyRequestRecord[];
  bedTransfers: AdmissionBedTransferRecord[];
  medicationModeHistory: AdmissionMedicationModeHistoryEntry[];
  paymentRequests: AdmissionPaymentRequestSummary[];
  dischargeSummary?: AdmissionDischargeSummary | null;
  /** Advance/deposit money collected for this admission but not tied to any one department invoice (e.g. the deposit taken at admission creation) — already netted into each `AdmissionInvoiceRow.outstanding` below (oldest invoice first), but exposed here too so a summary total can show it was applied rather than silently vanishing. */
  unallocatedAdvanceTotal: number;
  /** Sum of every invoice's `outstanding` AFTER the advance/deposit above has been netted in — the actual amount still owed, never `sum(total) - sum(paidTotal)` alone (that ignores the advance). */
  totalOutstanding: number;
}

function formatTimestamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dateStr = formatDisplayDate(d);
  const timeStr = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

function toNumber(v: any): number {
  return Number(v ?? 0);
}

function bedLabel(bed: any): string | null {
  if (!bed) return null;
  const wardName = bed.ward?.name || bed.room?.ward?.name || '';
  const roomName = bed.room?.name || '';
  const bedNum = bed.bedNumber
    ? (/^bed\b/i.test(bed.bedNumber.trim()) ? bed.bedNumber.trim() : `Bed ${bed.bedNumber.trim()}`)
    : '';
  const parts = [wardName, roomName, bedNum].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : bed.bedNumber || null;
}

function toAdmissionRecord(raw: Record<string, any>): AdmissionRecord {
  const isPanel = !!raw.panelPatientId;
  const patient = raw.panelPatient || raw.selfPayEncounter;
  const encounterId = raw.selfPayEncounterId || raw.selfPayEncounter?.id;
  let resolvedMr = patient?.mrNumber || '';
  if (!resolvedMr && encounterId) {
    const fromRegistry = getPatientById(encounterId);
    if (fromRegistry?.mrNumber) {
      resolvedMr = fromRegistry.mrNumber;
    } else {
      const rawId = String(encounterId);
      const cleanId = rawId.replace(/\D/g, '').slice(0, 6) || rawId.replace(/-/g, '').slice(0, 6).toUpperCase();
      resolvedMr = `MR-${cleanId.padStart(6, '0')}`;
    }
  }

  return {
    id: raw.id,
    admissionNumber: raw.admissionNumber,
    patientName: patient?.fullName || 'Unknown',
    patientMrNumber: resolvedMr,
    payerType: isPanel ? 'Corporate / Panel' : 'Self Pay',
    departmentId: raw.departmentId,
    departmentName: raw.department?.name || '',
    doctorId: raw.doctorStaffId,
    doctorName: raw.doctor?.fullName || '',
    bedId: raw.bedId || null,
    bedLabel: bedLabel(raw.bed),
    status: raw.status,
    medicationMode: raw.medicationMode,
    outsourcedFulfillmentMode: raw.outsourcedFulfillmentMode ?? 'HOSPITAL_MANAGED',
    diagnosis: raw.diagnosis || '',
    estimatedAmount: raw.estimatedAmount != null ? Number(raw.estimatedAmount) : null,
    expectedAt: raw.expectedAt ? formatTimestamp(raw.expectedAt) : '',
    admittedAt: raw.admittedAt ? formatTimestamp(raw.admittedAt) : '',
    dischargedAt: raw.dischargedAt ? formatTimestamp(raw.dischargedAt) : '',
    createdAt: formatTimestamp(raw.createdAt),
    createdAtIso: raw.createdAt || '',
    clearances: (raw.dischargeClearances || []).map(toClearance),
  };
}

function toClearance(raw: Record<string, any>): AdmissionClearance {
  return {
    id: raw.id,
    clearanceType: raw.clearanceType,
    status: raw.status,
    clearedByLabel: raw.clearedBy?.username,
    clearedAt: raw.clearedAt ? formatTimestamp(raw.clearedAt) : undefined,
  };
}

function toPharmacyRequestRecord(r: Record<string, any>): AdmissionPharmacyRequestRecord {
  return {
    id: r.id,
    medicineRequestNumber: r.medicineRequestNumber,
    status: r.status,
    requestedByLabel: r.requestedBy?.username || '',
    requestedAt: formatTimestamp(r.requestedAt),
    lines: (r.lines || []).map((l: any) => ({
      medicineId: l.medicineId,
      medicineName: l.medicine?.name || '',
      requestedQuantity: toNumber(l.requestedQuantity),
      notes: l.notes || '',
    })),
    highCostAuthorization: r.highCostAuthorization
      ? {
          id: r.highCostAuthorization.id,
          lineTotal: toNumber(r.highCostAuthorization.lineTotal),
          thresholdAmount: toNumber(r.highCostAuthorization.thresholdAmount),
          attendantName: r.highCostAuthorization.attendantName || undefined,
          attendantRelation: r.highCostAuthorization.attendantRelation || undefined,
          attendantConfirmed: !!r.highCostAuthorization.attendantConfirmed,
          managementApprovedAt: r.highCostAuthorization.managementApprovedAt
            ? formatTimestamp(r.highCostAuthorization.managementApprovedAt)
            : undefined,
          status: r.highCostAuthorization.status,
        }
      : null,
  };
}

function toAdmissionDetail(raw: Record<string, any>): AdmissionDetail {
  // An advance/deposit receipt not tied to any one department invoice
  // (`raw.unallocatedAdvanceTotal`, e.g. the deposit collected at admission
  // creation) sits outside every invoice's own `paidTotal` — netting it
  // here (oldest invoice first) means the "Outstanding" a Front Desk/
  // Admission user sees while adding services is money still actually
  // owed, not `total - paidTotal` alone, which ignored the advance
  // entirely and overstated the balance.
  let remainingCredit = toNumber(raw.unallocatedAdvanceTotal);
  const sortedInvoices = [...(raw.hospitalInvoices || [])].sort(
    (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const invoices = sortedInvoices.map((inv: any) => {
    const rawOutstanding = Math.max(0, toNumber(inv.total) - toNumber(inv.paidTotal));
    const creditApplied = Math.min(remainingCredit, rawOutstanding);
    remainingCredit -= creditApplied;
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      departmentName: inv.department?.name || 'Unassigned',
      subtotal: toNumber(inv.subtotal),
      discountTotal: toNumber(inv.discountTotal),
      total: toNumber(inv.total),
      paidTotal: toNumber(inv.paidTotal),
      outstanding: rawOutstanding - creditApplied,
      status: inv.status,
      lines: (inv.lines || []).map((l: any) => ({
        id: l.id,
        serviceName: /ward\s*fixed/i.test(l.serviceRate?.name || '') ? 'Ward Price' : (l.serviceRate?.name || ''),
        serviceCode: (/^ward[-_]fixed/i.test(l.serviceRate?.code || '') || (l.serviceRate?.code || '').includes('-DEL-') || /ward[-_]price/i.test(l.serviceRate?.code || '')) ? '' : (l.serviceRate?.code || ''),
        quantity: toNumber(l.quantity) || 1,
        lineGross: toNumber(l.lineGross),
        discountAmount: toNumber(l.discountAmount),
        discountReason: l.discountReason || null,
        lineNet: toNumber(l.lineNet),
        patientShare: toNumber(l.patientShare),
        panelReceivable: toNumber(l.panelReceivable),
        performedByName: l.performedBy?.fullName || '',
      })),
    };
  });

  return {
    ...toAdmissionRecord(raw),
    clearances: (raw.dischargeClearances || []).map(toClearance),
    invoices,
    unallocatedAdvanceTotal: toNumber(raw.unallocatedAdvanceTotal),
    totalOutstanding: invoices.reduce((sum, inv) => sum + inv.outstanding, 0),
    pharmacyRequests: (raw.pharmacyClearances || []).map(toPharmacyRequestRecord),
    bedTransfers: (raw.bedTransfers || []).map((t: any) => ({
      id: t.id,
      fromBedLabel: bedLabel(t.fromBed) || '',
      toBedLabel: bedLabel(t.toBed) || '',
      reason: t.reason || '',
      transferredByLabel: t.transferredBy?.username || '',
      transferredAt: formatTimestamp(t.transferredAt),
    })),
    medicationModeHistory: (raw.medicationModeHistory || []).map((h: any) => ({
      id: h.id,
      previousMode: h.previousMode,
      newMode: h.newMode,
      reason: h.reason || '',
      changedByLabel: h.changedBy?.username || '',
      changedAt: formatTimestamp(h.changedAt),
    })),
    paymentRequests: (raw.paymentRequests || []).map((p: any) => ({
      id: p.id,
      requestType: p.requestType,
      requestedAmount: toNumber(p.requestedAmount),
      status: p.status,
      notes: p.notes || '',
      requestedAt: formatTimestamp(p.requestedAt),
    })),
    dischargeSummary: raw.dischargeSummary
      ? {
          finalDiagnosis: raw.dischargeSummary.finalDiagnosis,
          treatmentSummary: raw.dischargeSummary.treatmentSummary,
          conditionAtDischarge: raw.dischargeSummary.conditionAtDischarge,
          medicinesInstructions: raw.dischargeSummary.medicinesInstructions,
          followUpAdvice: raw.dischargeSummary.followUpAdvice || undefined,
          followUpDate: raw.dischargeSummary.followUpDate ? String(raw.dischargeSummary.followUpDate).slice(0, 10) : undefined,
          additionalNotes: raw.dischargeSummary.additionalNotes || undefined,
          doctorNameSnapshot: raw.dischargeSummary.doctorNameSnapshot,
          doctorDepartmentSnapshot: raw.dischargeSummary.doctorDepartmentSnapshot || undefined,
          authorizedAt: formatTimestamp(raw.dischargeSummary.authorizedAt),
        }
      : null,
  };
}

export async function fetchAdmissions(params?: { status?: AdmissionStatus; search?: string }): Promise<AdmissionRecord[]> {
  try {
    const res = await apiClient.get<{ data: Record<string, any>[] }>('/admissions', { params });
    return res.data.data.map(toAdmissionRecord);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function fetchAdmissionDetail(id: string): Promise<AdmissionDetail> {
  try {
    const res = await apiClient.get<{ data: Record<string, any> }>(`/admissions/${id}`);
    return toAdmissionDetail(res.data.data);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

/**
 * Front Desk creates the admission file (v7.2 §2.9). Exactly one of
 * `panelPatientId` / `selfPayEncounterId` should be set — the caller
 * resolves which from the selected `Patient.payerType`.
 */
export async function createAdmission(
  values: CreateAdmissionFormValues,
): Promise<{ admission: AdmissionRecord; advanceReceipt: AdmissionAdvanceReceipt | null; invoice: { id: string; invoiceNumber: string } | null }> {
  try {
    const res = await apiClient.post<{ data: { admission: Record<string, any>; advanceReceipt: Record<string, any> | null; invoice: Record<string, any> | null } }>(
      '/admissions',
      {
        panelPatientId: values.panelPatientId || undefined,
        selfPayEncounterId: values.selfPayEncounterId || undefined,
        departmentId: values.departmentId || undefined,
        wardId: values.wardId || undefined,
        doctorStaffId: values.doctorStaffId || undefined,
        preferredBedId: values.preferredBedId || undefined,
        expectedAt: values.expectedAt || undefined,
        diagnosis: values.diagnosis?.trim() || undefined,
        weightKg: values.weightKg === '' ? undefined : Number(values.weightKg),
        estimatedAmount: values.estimatedAmount === '' ? undefined : Number(values.estimatedAmount),
        medicationMode: values.medicationMode || 'HOSPITAL_MANAGED',
        outsourcedFulfillmentMode: values.outsourcedFulfillmentMode || 'HOSPITAL_MANAGED',
        notes: values.notes?.trim() || undefined,
        advanceAmount: values.advanceAmount === '' ? undefined : Number(values.advanceAmount),
        paymentMethod: values.paymentMethod,
        paymentReference: values.paymentReference?.trim() || undefined,
        authorizationNumber: values.authorizationNumber?.trim() || undefined,
        authorizationLimit: values.authorizationLimit === '' || values.authorizationLimit == null ? undefined : Number(values.authorizationLimit),
        authorizationValidUntil: values.authorizationValidUntil || undefined,
      },
    );
    const { admission, advanceReceipt, invoice } = res.data.data;
    return {
      admission: toAdmissionRecord(admission),
      advanceReceipt: advanceReceipt
        ? {
            id: advanceReceipt.id,
            receiptNumber: advanceReceipt.receiptNumber,
            amount: Number(advanceReceipt.amount ?? 0),
            method: advanceReceipt.method,
            reference: advanceReceipt.reference || '',
            collectedAt: formatTimestamp(advanceReceipt.collectedAt),
          }
        : null,
      invoice: invoice
        ? {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
          }
        : null,
    };
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function checkInAdmission(id: string, values: { bedId: string; notes?: string; transferReason?: string }): Promise<AdmissionRecord> {
  try {
    const res = await apiClient.post<{ data: Record<string, any> }>(`/admissions/${id}/check-in`, values);
    return toAdmissionRecord(res.data.data);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function transferAdmissionBed(id: string, values: { targetBedId: string; reason: string }): Promise<void> {
  try {
    await apiClient.post(`/admissions/${id}/bed-transfer`, values);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function addAdmissionService(
  id: string,
  values: { serviceRateId: string; quantity: number; notes?: string; performedByStaffId?: string; arrangementMode?: 'HOSPITAL_MANAGED' | 'SELF' },
): Promise<void> {
  try {
    await apiClient.post(`/admissions/${id}/add-service`, values);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function changeAdmissionMedicationMode(id: string, values: { mode: MedicationMode; reason: string }): Promise<void> {
  try {
    await apiClient.post(`/admissions/${id}/medication-mode`, values);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function requestAdmissionPayment(
  id: string,
  values: { requestType: 'ADVANCE' | 'PARTIAL' | 'FINAL'; requestedAmount: number; notes?: string },
): Promise<void> {
  try {
    await apiClient.post(`/admissions/${id}/request-advance`, values);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function createAdmissionPharmacyRequest(
  id: string,
  values: { notes?: string; lines: { medicineId: string; requestedQuantity: number; notes?: string }[] },
): Promise<AdmissionPharmacyRequestRecord> {
  try {
    const res = await apiClient.post<{ data: Record<string, any> }>(`/admissions/${id}/pharmacy-requests`, values);
    return toPharmacyRequestRecord(res.data.data);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function authorizeHighCostMedicine(
  admissionId: string,
  clearanceId: string,
  values: {
    attendantName?: string;
    attendantRelation?: string;
    attendantContact?: string;
    attendantConfirmed?: boolean;
    managementUsername?: string;
    managementPassword?: string;
    managementReason?: string;
    panelAuthorizationRef?: string;
  },
): Promise<void> {
  try {
    await apiClient.post(`/admissions/${admissionId}/pharmacy-requests/${clearanceId}/authorize`, values);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function rejectHighCostMedicine(admissionId: string, clearanceId: string, reason: string): Promise<void> {
  try {
    await apiClient.post(`/admissions/${admissionId}/pharmacy-requests/${clearanceId}/reject`, { reason });
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function grantAdmissionClearance(id: string, values: { clearanceType: ClearanceType; notes?: string }): Promise<void> {
  try {
    await apiClient.post(`/admissions/${id}/clearances`, values);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function dischargeAdmission(id: string): Promise<{ message: string }> {
  try {
    const res = await apiClient.post<{ data: { message: string } }>(`/admissions/${id}/discharge`, {});
    return res.data.data;
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function clinicalDischarge(
  id: string,
  values: {
    doctorUsername: string;
    doctorPassword: string;
    dischargeSummary: {
      finalDiagnosis: string;
      treatmentSummary: string;
      conditionAtDischarge: string;
      medicinesInstructions: string;
      followUpAdvice?: string;
      followUpDoctorStaffId?: string;
      followUpDate?: string;
      additionalNotes?: string;
    };
  },
): Promise<AdmissionRecord> {
  try {
    const res = await apiClient.post<{ data: { admission: Record<string, any> } }>(`/admissions/${id}/clinical-discharge`, values);
    return toAdmissionRecord(res.data.data.admission);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export interface DischargeDoctor {
  staffId: string;
  employeeId: string;
  fullName: string;
  designation: string | null;
  department: string | null;
}

/** Discharge popup step 1 — checks the doctor's discharge credential and returns who it belongs to. Changes nothing. */
export async function verifyDischargeDoctor(doctorUsername: string, doctorPassword: string): Promise<DischargeDoctor> {
  try {
    const res = await apiClient.post<{ data: DischargeDoctor }>('/admissions/clinical-auth/verify', { doctorUsername, doctorPassword });
    return res.data.data;
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

// ── Super Admin "Close Day" — recurring room/bed accommodation billing ────
export interface HospitalDayCloseRecord {
  id: string;
  businessDate: string;
  admissionsCharged: number;
  totalAmountPosted: number;
  closedByLabel: string;
  closedAt: string;
}

function toDayCloseRecord(raw: any): HospitalDayCloseRecord {
  return {
    id: raw.id,
    businessDate: (raw.businessDate || '').slice(0, 10),
    admissionsCharged: raw.admissionsCharged || 0,
    totalAmountPosted: Number(raw.totalAmountPosted || 0),
    closedByLabel: raw.closedBy?.staff?.fullName || raw.closedBy?.username || '',
    closedAt: formatTimestamp(raw.closedAt),
  };
}

/** Posts today's (or a given date's) room/bed accommodation charge to every ACTIVE, bed-assigned admission. Idempotent server-side — see `admission.service.ts`'s `closeHospitalDay`. */
export async function closeHospitalDay(businessDate?: string): Promise<HospitalDayCloseRecord> {
  try {
    const res = await apiClient.post<{ data: Record<string, any> }>('/admissions/day-close', businessDate ? { businessDate } : {});
    return toDayCloseRecord(res.data.data);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function fetchDayCloseHistory(limit = 10): Promise<HospitalDayCloseRecord[]> {
  try {
    const res = await apiClient.get<{ data: Record<string, any>[] }>('/admissions/day-close/history', { params: { limit } });
    return res.data.data.map(toDayCloseRecord);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}
