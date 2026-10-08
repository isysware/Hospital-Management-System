import apiClient from './apiClient';
import { toErrorMessage } from '../utils/apiErrors';
import { getPatientById, getAllPatients } from './patientRegistryService';

function resolveMrNumber(raw: Record<string, any>): string | null {
  if (raw.panelPatient?.mrNumber) return raw.panelPatient.mrNumber;
  if (raw.selfPayEncounter?.mrNumber) return raw.selfPayEncounter.mrNumber;

  const encounterId = raw.selfPayEncounterId || raw.selfPayEncounter?.id || raw.patientId;
  if (encounterId) {
    const fromRegistry = getPatientById(String(encounterId));
    if (fromRegistry?.mrNumber) return fromRegistry.mrNumber;
  }

  if (raw.patientName) {
    const name = String(raw.patientName).trim().toLowerCase();
    const matched = getAllPatients().find((p) => p.fullName?.trim().toLowerCase() === name);
    if (matched?.mrNumber) return matched.mrNumber;
  }

  if (raw.mrNumber) return raw.mrNumber;
  // If backend returned a valid MR number that isn't a synthetic UUID hash
  if (raw.patientMrNumber && !raw.patientMrNumber.startsWith('MR-8') && !raw.patientMrNumber.startsWith('MR-26-')) {
    return raw.patientMrNumber;
  }

  if (encounterId) {
    const rawId = String(encounterId);
    const cleanId = rawId.replace(/\D/g, '').slice(0, 6) || rawId.replace(/-/g, '').slice(0, 6).toUpperCase();
    return `MR-${cleanId.padStart(6, '0')}`;
  }

  return raw.patientMrNumber || null;
}

/**
 * Front Desk's consolidated view + payment collection over an admission's
 * multiple department invoices — backed by `/api/v1/admission-billing/:id/*`
 * (HMS_V7.2_NEW_REQUIREMENTS.md §2.2/§2.10/§2.11). Each department invoice
 * stays independently owned; this is the presentation/allocation layer, not
 * a merge — the "consolidated" totals here are a display sum only.
 */

export type PaymentMethod = 'CASH' | 'CARD' | 'BANK' | 'ONLINE';

export interface DepartmentInvoiceLine {
  id: string;
  billingSource?: string;
  serviceName: string;
  quantity: number;
  lineGross: number;
  discountAmount: number;
  lineNet: number;
  patientShare: number;
  panelReceivable: number;
  performedByName: string;
  /** Hospital Services only — Pharmacy / Outsourced Lab & Radiology lines are never eligible (computed server-side, see `applyDiscount`). */
  isDiscountEligible: boolean;
}

export interface DepartmentInvoiceRow {
  id: string;
  invoiceNumber: string;
  departmentName: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  paidTotal: number;
  outstanding: number;
  patientShare: number;
  panelReceivable: number;
  status: string;
  panelPatientId: string | null;
  /** Whether this invoice has at least one Hospital Services line AND isn't a panel-patient invoice — i.e. discounting is possible at all. */
  isDiscountEligibleInvoice: boolean;
  lines: DepartmentInvoiceLine[];
  pharmacyDetails?: {
    pharmacyInvoiceNumber: string;
    items: any[];
    dispensedBy: string | null;
    dispensedAt: string | null;
    patientPaymentStatus: string;
    settlementStatus: string;
  } | null;
}

export interface AdmissionStatement {
  admissionId: string;
  admissionNumber: string;
  status: string;
  isNotFinalDischargeInvoice: boolean;
  departmentInvoices: DepartmentInvoiceRow[];
  consolidated: {
    subtotal: number;
    discountTotal: number;
    total: number;
    paidTotal: number;
    patientShare: number;
    panelReceivable: number;
    outstanding: number;
  };
  /** Advance/deposit receipts collected for this admission but not tied to any one department invoice (e.g. the deposit taken at admission creation) — already netted into `departmentInvoices[].outstanding` and `consolidated.outstanding` (oldest invoice first). */
  unallocatedCreditTotal: number;
  /** Portion of `unallocatedCreditTotal` not yet consumed by any outstanding invoice — a genuine available credit for this admission. */
  availableCredit: number;
  pharmacyCharge?: {
    id: string;
    pharmacyInvoiceNumber: string;
    subtotal: number;
    taxTotal: number;
    discountTotal: number;
    totalAmount: number;
    patientPaid: number;
    patientOutstanding: number;
    patientPaymentStatus: string;
    settlementStatus: string;
    items: any[];
    dispensedBy: string | null;
    dispensedAt: string | null;
  } | null;
}

function toNumber(v: any): number {
  return Number(v ?? 0);
}

function normalize(raw: Record<string, any>): AdmissionStatement {
  return {
    admissionId: raw.admissionId,
    admissionNumber: raw.admissionNumber,
    status: raw.status,
    isNotFinalDischargeInvoice: !!raw.isNotFinalDischargeInvoice,
    departmentInvoices: (raw.departmentInvoices || []).map((inv: any) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      departmentName: inv.department?.name || 'Unassigned',
      subtotal: toNumber(inv.subtotal),
      discountTotal: toNumber(inv.discountTotal),
      total: toNumber(inv.total),
      paidTotal: toNumber(inv.paidTotal),
      outstanding: toNumber(inv.outstanding),
      patientShare: toNumber(inv.patientShare),
      panelReceivable: toNumber(inv.panelReceivable),
      status: inv.status,
      panelPatientId: inv.panelPatientId ?? null,
      isDiscountEligibleInvoice: !!inv.isDiscountEligibleInvoice,
      pharmacyDetails: inv.pharmacyDetails || null,
      lines: (inv.lines || []).map((l: any) => ({
        id: l.id,
        billingSource: l.billingSource,
        serviceName: l.descriptionSnapshot || l.serviceRate?.name || '',
        quantity: Number(l.quantity ?? 1),
        lineGross: toNumber(l.lineGross),
        discountAmount: toNumber(l.discountAmount),
        lineNet: toNumber(l.lineNet),
        patientShare: toNumber(l.patientShare),
        panelReceivable: toNumber(l.panelReceivable),
        performedByName: l.performedBy?.fullName || '',
        isDiscountEligible: !!l.isDiscountEligible,
      })),
    })),
    consolidated: {
      subtotal: toNumber(raw.consolidated?.subtotal),
      discountTotal: toNumber(raw.consolidated?.discountTotal),
      total: toNumber(raw.consolidated?.total),
      paidTotal: toNumber(raw.consolidated?.paidTotal),
      patientShare: toNumber(raw.consolidated?.patientShare),
      panelReceivable: toNumber(raw.consolidated?.panelReceivable),
      outstanding: toNumber(raw.consolidated?.outstanding),
    },
    unallocatedCreditTotal: toNumber(raw.unallocatedCreditTotal),
    availableCredit: toNumber(raw.availableCredit),
    pharmacyCharge: raw.pharmacyCharge ? {
      id: raw.pharmacyCharge.id,
      pharmacyInvoiceNumber: raw.pharmacyCharge.pharmacyInvoiceNumber,
      subtotal: toNumber(raw.pharmacyCharge.subtotal),
      taxTotal: toNumber(raw.pharmacyCharge.taxTotal),
      discountTotal: toNumber(raw.pharmacyCharge.discountTotal),
      totalAmount: toNumber(raw.pharmacyCharge.totalAmount),
      patientPaid: toNumber(raw.pharmacyCharge.patientPaid),
      patientOutstanding: toNumber(raw.pharmacyCharge.patientOutstanding),
      patientPaymentStatus: raw.pharmacyCharge.patientPaymentStatus,
      settlementStatus: raw.pharmacyCharge.settlementStatus,
      items: raw.pharmacyCharge.items || [],
      dispensedBy: raw.pharmacyCharge.dispensedBy,
      dispensedAt: raw.pharmacyCharge.dispensedAt,
    } : null,
  };
}

export async function fetchAdmissionStatement(admissionId: string): Promise<AdmissionStatement> {
  try {
    const res = await apiClient.get<{ data: Record<string, any> }>(`/admission-billing/${admissionId}/statement`);
    return normalize(res.data.data);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

/**
 * Manual "Resync to Pharmacy" — for when the automatic webhook inside
 * `collectPayment` silently failed to tell the standalone Pharmacy system
 * how much of this admission's bill was actually collected (network blip,
 * Pharmacy backend unreachable at that moment). Re-sends the already-correct
 * amount HMS has on file; safe to click more than once.
 */
export async function resyncPharmacyCollection(admissionId: string): Promise<void> {
  try {
    await apiClient.post(`/pharmacy-bridge/charges/${admissionId}/resync`);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

/**
 * Front Desk discretionary discount on an admission's running bill —
 * strictly Hospital Services only (ward/room, doctor fee, procedures);
 * Pharmacy and Outsourced Lab/Radiology lines are never eligible (enforced
 * server-side in `admissionBilling.service.ts`'s `applyDiscount`).
 */
export async function applyAdmissionDiscount(
  admissionId: string,
  values: {
    lineItemId?: string;
    discountPercent?: number;
    discountAmount?: number;
    discountReason: string;
  },
): Promise<void> {
  try {
    await apiClient.post(`/admission-billing/${admissionId}/discounts`, values);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function collectAdmissionPayment(
  admissionId: string,
  values: {
    amount: number;
    paymentMethod: PaymentMethod;
    reference?: string;
    allocations?: { invoiceId: string; amount: number }[];
  },
): Promise<{ allocations: { invoiceId: string | null; amount: number }[] }> {
  try {
    const res = await apiClient.post<{ data: { allocations: { invoiceId: string | null; amount: string | number }[] } }>(
      `/admission-billing/${admissionId}/collect-payment`,
      values,
    );
    return { allocations: res.data.data.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: Number(a.amount) })) };
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

/**
 * Admission Patient Records + Running Ledger (Front Desk) — one row per
 * checked-in admission (not per department invoice), and one flattened
 * chronological ledger per admission across every department invoice's
 * lines AND every payment receipt (allocated or unallocated advance/
 * deposit) — backed by `/api/v1/admission-billing/records` and
 * `/api/v1/admission-billing/:id/ledger`.
 */

export type AdmissionBillingStatus = 'NO_CHARGES' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface AdmissionPatientRecordRow {
  id: string;
  admissionNumber: string;
  patientName: string;
  patientMrNumber: string | null;
  payerType: 'PANEL' | 'SELF_PAY';
  admittedAt: string | null;
  ward: string | null;
  room: string | null;
  bed: string | null;
  currentCharges: number;
  totalPaid: number;
  outstanding: number;
  availableCredit: number;
  clinicalStatus: string;
  billingStatus: AdmissionBillingStatus;
}

export interface AdmissionLedgerEntry {
  date: string;
  type: string;
  department: string | null;
  description: string;
  qty: number | null;
  rate: number | null;
  grossAmount?: number;
  discountAmount?: number;
  discountReason?: string | null;
  debit: number;
  credit: number;
  paidAmount?: number;
  dueAmount?: number;
  status?: 'PAID' | 'UNPAID' | 'PARTIAL' | 'SELF' | 'REQUESTED';
  runningBalance: number;
  reference: string;
  postedBy: string | null;
}

export interface AdmissionReceiptSummary {
  id: string;
  receiptNumber: string;
  amount: number;
  method: string;
  reference?: string | null;
  collectedAt: string;
  collectedByName?: string | null;
}

export interface AdmissionLedgerPanelFigures {
  grossCharges: number;
  patientShare: number;
  panelReceivable: number;
  patientPaid: number;
  panelRealized: number;
  patientOutstanding: number;
  panelOutstanding: number;
}

export interface AdmissionLedger {
  departmentName?: string | null;
  departmentId?: string;
  medicationMode?: 'SELF' | 'HOSPITAL_MANAGED';
  admissionId: string;
  admissionNumber: string;
  status: string;
  payerType: 'PANEL' | 'SELF_PAY';
  patientName: string;
  patientMrNumber: string | null;
  panelName: string | null;
  admittedAt: string | null;
  ward: string | null;
  room: string | null;
  bed: string | null;
  finalBillNumber: string | null;
  finalBillGeneratedAt: string | null;
  entries: AdmissionLedgerEntry[];
  receipts?: AdmissionReceiptSummary[];
  summary: {
    totalCharges: number;
    totalPaid: number;
    outstandingBalance: number;
    availableCredit: number;
  };
  panel: AdmissionLedgerPanelFigures | null;
}

function toRecordRow(raw: Record<string, any>): AdmissionPatientRecordRow {
  return {
    id: raw.id,
    admissionNumber: raw.admissionNumber,
    patientName: raw.patientName,
    patientMrNumber: resolveMrNumber(raw),
    payerType: raw.payerType,
    admittedAt: raw.admittedAt,
    ward: raw.ward ?? null,
    room: raw.room ?? null,
    bed: raw.bed ?? null,
    currentCharges: toNumber(raw.currentCharges),
    totalPaid: toNumber(raw.totalPaid),
    outstanding: toNumber(raw.outstanding),
    availableCredit: toNumber(raw.availableCredit),
    clinicalStatus: raw.clinicalStatus,
    billingStatus: raw.billingStatus,
  };
}

function toLedger(raw: Record<string, any>): AdmissionLedger {
  return {
    departmentName: raw.departmentName ?? null,
    departmentId: raw.departmentId,
    admissionId: raw.admissionId,
    admissionNumber: raw.admissionNumber,
    status: raw.status,
    payerType: raw.payerType,
    patientName: raw.patientName,
    patientMrNumber: resolveMrNumber(raw),
    panelName: raw.panelName ?? null,
    admittedAt: raw.admittedAt,
    ward: raw.ward ?? null,
    room: raw.room ?? null,
    bed: raw.bed ?? null,
    medicationMode: raw.medicationMode,
    finalBillNumber: raw.finalBillNumber ?? null,
    finalBillGeneratedAt: raw.finalBillGeneratedAt ?? null,
    entries: (raw.entries || []).map((e: any) => ({
      date: e.date,
      type: e.type,
      department: e.department ?? null,
      description: e.description,
      qty: e.qty != null ? toNumber(e.qty) : null,
      rate: e.rate != null ? toNumber(e.rate) : null,
      grossAmount: e.grossAmount != null ? toNumber(e.grossAmount) : undefined,
      discountAmount: e.discountAmount != null ? toNumber(e.discountAmount) : undefined,
      discountReason: e.discountReason ?? null,
      debit: toNumber(e.debit),
      credit: toNumber(e.credit),
      paidAmount: e.paidAmount != null ? toNumber(e.paidAmount) : toNumber(e.credit),
      dueAmount: e.dueAmount != null ? toNumber(e.dueAmount) : Math.max(0, toNumber(e.debit) - toNumber(e.credit)),
      status: e.status || (toNumber(e.dueAmount) <= 0 ? 'PAID' : 'UNPAID'),
      runningBalance: toNumber(e.runningBalance),
      reference: e.reference,
      postedBy: e.postedBy ?? null,
    })),
    receipts: (raw.receipts || []).map((r: any) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      amount: toNumber(r.amount),
      method: r.method,
      reference: r.reference ?? null,
      collectedAt: r.collectedAt,
      collectedByName: r.collectedByName ?? null,
    })),
    summary: {
      totalCharges: toNumber(raw.summary?.totalCharges),
      totalPaid: toNumber(raw.summary?.totalPaid),
      outstandingBalance: toNumber(raw.summary?.outstandingBalance),
      availableCredit: toNumber(raw.summary?.availableCredit),
    },
    panel: raw.panel
      ? {
          grossCharges: toNumber(raw.panel.grossCharges),
          patientShare: toNumber(raw.panel.patientShare),
          panelReceivable: toNumber(raw.panel.panelReceivable),
          patientPaid: toNumber(raw.panel.patientPaid),
          panelRealized: toNumber(raw.panel.panelRealized),
          patientOutstanding: toNumber(raw.panel.patientOutstanding),
          panelOutstanding: toNumber(raw.panel.panelOutstanding),
        }
      : null,
  };
}

export async function fetchAdmissionRecords(): Promise<AdmissionPatientRecordRow[]> {
  try {
    const res = await apiClient.get<{ data: Record<string, any>[] }>('/admission-billing/records');
    return res.data.data.map(toRecordRow);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function fetchAdmissionLedger(admissionId: string, readOnly = false): Promise<AdmissionLedger> {
  try {
    const res = await apiClient.get<{ data: Record<string, any> }>(`${readOnly ? "/admissions" : "/admission-billing"}/${admissionId}/ledger`);
    return toLedger(res.data.data);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function generateFinalBill(admissionId: string): Promise<AdmissionLedger> {
  try {
    const res = await apiClient.post<{ data: Record<string, any> }>(`/admission-billing/${admissionId}/generate-final-bill`, {});
    return toLedger(res.data.data);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}
