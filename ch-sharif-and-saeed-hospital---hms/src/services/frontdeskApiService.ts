import apiClient from './apiClient';
import { toErrorMessage } from '../utils/apiErrors';
import { formatDisplayDate } from '../utils/dateConstants';

export interface BackendPatient {
  id: string;
  mrn: string;
  fullName: string;
  cnic?: string;
  phone: string;
  gender: string;
  dob?: string;
  address?: string;
  guardianName?: string;
  guardianRelation?: string;
  bloodGroup?: string;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Appointments — real `/api/v1/appointments*` (hms-backend/src/modules/
// frontdesk/appointments.{routes,controller,service,schemas}.ts). Verified
// against the actual route/schema shapes, not guessed — see
// `appointments.schemas.ts`'s `bookAppointmentSchema`/`listAppointmentsQuerySchema`.
// ═══════════════════════════════════════════════════════════════════════

export type AppointmentStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'RESCHEDULED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type AppointmentPaymentMethod = 'CASH' | 'CARD' | 'BANK' | 'ONLINE';

export interface AppointmentReceiptRow {
  id: string;
  receiptNumber: string;
  amount: number;
  method: AppointmentPaymentMethod;
  reference: string;
  isReversed: boolean;
  collectedAt: string;
}

export interface AppointmentRecord {
  id: string;
  slotAtIso: string;
  slotDate: string;
  slotTime: string;
  status: AppointmentStatus;
  notes: string;
  estimatedAmount: number;

  payerType: 'Corporate / Panel' | 'Self Pay';
  patientId: string; // panelPatientId or selfPayEncounterId, whichever applies
  patientName: string;
  patientPhone: string;
  patientMrNumber: string; // panel only, '' for self-pay
  panelId: string;
  panelName: string;
  panelMembershipActive: boolean;

  departmentId: string;
  departmentName: string;
  doctorId: string | null;
  doctorName: string;
  serviceRateId: string;
  serviceName: string;

  advancePaid: number;
  advanceReceipts: AppointmentReceiptRow[];
  invoiceId: string | null;
  invoiceNumber: string;
  invoiceTotal: number;
  invoicePaid: number;
  patientShare: number;
  panelReceivable: number;

  /** Parsed out of the `notes` free-text convention `appointments.service.ts` appends to (best-effort display only). */
  cancellationReason: string;

  createdByLabel: string;
  createdAtIso: string;
  createdAt: string;
  updatedAtIso: string;
}

function formatTs(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDisplayDate(d)}, ${d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`;
}

function toAppointmentRecord(raw: Record<string, any>): AppointmentRecord {
  const isPanel = !!raw.panelPatientId;
  const patient = raw.panelPatient || raw.selfPayEncounter;
  const invoice = Array.isArray(raw.hospitalInvoices) && raw.hospitalInvoices.length > 0 ? raw.hospitalInvoices[0] : null;
  const receipts: AppointmentReceiptRow[] = (raw.paymentReceipts || []).map((r: any) => ({
    id: r.id,
    receiptNumber: r.receiptNumber,
    amount: Number(r.amount ?? 0),
    method: r.method,
    reference: r.reference || '',
    isReversed: !!r.isReversed,
    collectedAt: formatTs(r.collectedAt),
  }));
  const advancePaid = receipts.reduce((sum, r) => sum + r.amount, 0);
  const slotDate = raw.slotAt ? new Date(raw.slotAt) : null;
  const notesStr: string = raw.notes || '';
  const cancelMatch = notesStr.match(/Cancellation Reason:\s*(.+?)(\s*\|\s*|$)/);

  return {
    id: raw.id,
    slotAtIso: raw.slotAt || '',
    slotDate: slotDate ? formatDisplayDate(slotDate) : '',
    slotTime: slotDate ? slotDate.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }) : '',
    status: raw.status,
    notes: raw.notes || '',
    estimatedAmount: Number(raw.estimatedAmount ?? 0),

    payerType: isPanel ? 'Corporate / Panel' : 'Self Pay',
    patientId: raw.panelPatientId || raw.selfPayEncounterId || '',
    patientName: patient?.fullName || 'Unknown',
    patientPhone: patient?.phone || '',
    patientMrNumber: isPanel ? patient?.mrNumber || '' : '',
    panelId: raw.panelPatient?.corporatePanel?.id || '',
    panelName: raw.panelPatient?.corporatePanel?.organizationName || '',
    panelMembershipActive: isPanel ? patient?.status === 'ACTIVE' : true,

    departmentId: raw.departmentId,
    departmentName: raw.department?.name || '',
    doctorId: raw.doctorStaffId,
    doctorName: raw.doctor?.fullName || '',
    serviceRateId: raw.serviceRateId,
    serviceName: raw.serviceRate?.name || '',

    advancePaid,
    advanceReceipts: receipts,
    invoiceId: invoice?.id || null,
    invoiceNumber: invoice?.invoiceNumber || '',
    invoiceTotal: Number(invoice?.total ?? 0),
    invoicePaid: Number(invoice?.paidTotal ?? 0),
    patientShare: Number(invoice?.patientShare ?? 0),
    panelReceivable: Number(invoice?.panelReceivable ?? 0),

    cancellationReason: cancelMatch ? cancelMatch[1].trim() : '',

    createdByLabel: raw.createdByUser?.displayName || raw.createdByUser?.username || '',
    createdAtIso: raw.createdAt || '',
    createdAt: formatTs(raw.createdAt),
    updatedAtIso: raw.updatedAt || '',
  };
}

export interface ListAppointmentsFilters {
  departmentId?: string;
  doctorStaffId?: string;
  date?: string; // YYYY-MM-DD
  status?: AppointmentStatus;
  search?: string;
}

export interface NewSelfPayAppointmentPatient {
  fullName: string;
  guardianName?: string;
  gender?: string;
  dob?: string; // YYYY-MM-DD
  cnicOrPassport?: string;
  phone?: string;
  address?: string;
}

export interface BookAppointmentPayload {
  panelPatientId?: string;
  selfPayEncounterId?: string;
  newSelfPayPatient?: NewSelfPayAppointmentPatient;
  departmentId: string;
  doctorStaffId?: string;
  serviceRateId: string;
  slotAt: string; // ISO datetime
  estimatedAmount?: number;
  advanceAmount?: number;
  paymentMethod?: AppointmentPaymentMethod;
  paymentReference?: string;
  notes?: string;
}

export interface UpdateAppointmentPayload {
  slotAt?: string;
  doctorStaffId?: string | null;
  departmentId?: string;
  serviceRateId?: string;
  estimatedAmount?: number;
  notes?: string;
}

export interface CollectAdvancePayload {
  amount: number;
  paymentMethod: AppointmentPaymentMethod;
  reference?: string;
}

export interface CheckInAppointmentPayload {
  encounterType?: 'OPD' | 'OBSERVATION' | 'EMERGENCY';
  notes?: string;
}


export const appointmentsApiService = {
  async getAppointments(filters?: ListAppointmentsFilters): Promise<AppointmentRecord[]> {
    try {
      const res = await apiClient.get<{ data: Record<string, any>[] }>('/appointments', { params: filters });
      return res.data.data.map(toAppointmentRecord);
    } catch (err) {
      throw new Error(toErrorMessage(err));
    }
  },

  async getAppointmentById(id: string): Promise<AppointmentRecord> {
    try {
      const res = await apiClient.get<{ data: Record<string, any> }>(`/appointments/${id}`);
      return toAppointmentRecord(res.data.data);
    } catch (err) {
      throw new Error(toErrorMessage(err));
    }
  },

  async bookAppointment(payload: BookAppointmentPayload): Promise<{ appointment: AppointmentRecord; advanceReceipt: AppointmentReceiptRow | null }> {
    try {
      const res = await apiClient.post<{ data: { appointment: Record<string, any>; advanceReceipt: Record<string, any> | null } }>(
        '/appointments',
        payload,
      );
      return {
        appointment: toAppointmentRecord(res.data.data.appointment),
        advanceReceipt: res.data.data.advanceReceipt
          ? {
              id: res.data.data.advanceReceipt.id,
              receiptNumber: res.data.data.advanceReceipt.receiptNumber,
              amount: Number(res.data.data.advanceReceipt.amount ?? 0),
              method: res.data.data.advanceReceipt.method,
              reference: res.data.data.advanceReceipt.reference || '',
              isReversed: false,
              collectedAt: formatTs(res.data.data.advanceReceipt.collectedAt),
            }
          : null,
      };
    } catch (err) {
      throw new Error(toErrorMessage(err));
    }
  },

  async updateAppointment(id: string, payload: UpdateAppointmentPayload): Promise<AppointmentRecord> {
    try {
      const res = await apiClient.patch<{ data: Record<string, any> }>(`/appointments/${id}`, payload);
      return toAppointmentRecord(res.data.data);
    } catch (err) {
      throw new Error(toErrorMessage(err));
    }
  },

  async cancelAppointment(id: string, reason: string): Promise<AppointmentRecord> {
    try {
      const res = await apiClient.post<{ data: Record<string, any> }>(`/appointments/${id}/cancel`, { reason });
      return toAppointmentRecord(res.data.data);
    } catch (err) {
      throw new Error(toErrorMessage(err));
    }
  },

  async collectAdvance(id: string, payload: CollectAdvancePayload): Promise<AppointmentReceiptRow> {
    try {
      const res = await apiClient.post<{ data: Record<string, any> }>(`/appointments/${id}/advance`, payload);
      const r = res.data.data;
      return {
        id: r.id,
        receiptNumber: r.receiptNumber,
        amount: Number(r.amount ?? 0),
        method: r.method,
        reference: r.reference || '',
        isReversed: false,
        collectedAt: formatTs(r.collectedAt),
      };
    } catch (err) {
      throw new Error(toErrorMessage(err));
    }
  },

  async checkInAppointment(id: string, payload: CheckInAppointmentPayload): Promise<{ appointment: AppointmentRecord; invoiceId: string | null }> {
    try {
      const res = await apiClient.post<{ data: { appointment: Record<string, any>; invoice: Record<string, any> } }>(
        `/appointments/${id}/check-in`,
        payload,
      );
      return {
        appointment: toAppointmentRecord(res.data.data.appointment),
        invoiceId: res.data.data.invoice?.id || null,
      };
    } catch (err) {
      throw new Error(toErrorMessage(err));
    }
  },
};

export interface BackendInvoice {
  id: string;
  invoiceNumber: string;
  sourceType: string;
  status: string;
  subtotal: string | number;
  discountTotal: string | number;
  taxTotal: string | number;
  total: string | number;
  paidTotal: string | number;
  balanceDue: string | number;
  createdAt: string;
  lines: Array<{
    id: string;
    description: string;
    quantity: number;
    rateSnapshot: string | number;
    lineNet: string | number;
  }>;
}

export const frontdeskApiService = {
  // Patients — use `services/patientRegistryService.ts` instead (this file
  // never had patient methods that matched the real split endpoints —
  // `/patients/panel` for Corporate/Panel and `/patients/encounters` for
  // Self-Pay, never a bare `/patients` — patientRegistryService.ts already
  // implements that correctly and is what NewAdmissionView.tsx uses).

  // Appointments — use `appointmentsApiService` above instead (real, typed,
  // verified against the actual route/schema shapes — see AppointmentsView.tsx).

  // Invoices & Cashiering
  async getInvoices(search?: string, status?: string) {
    const res = await apiClient.get<{ data: BackendInvoice[] }>('/invoices', {
      params: { search, status },
    });
    return res.data.data;
  },

  async getInvoiceById(id: string) {
    const res = await apiClient.get<{ data: BackendInvoice }>(`/invoices/${id}`);
    return res.data.data;
  },

  // NOTE: there is no `POST /invoices` create route on the real backend —
  // invoices come from the encounter/admission billing flow instead
  // (`POST /encounters`, `/encounters/:id/services`, admission services).
  // Unused so far; verify before wiring a real "New Invoice" page to it.
  async createInvoice(data: {
    patientId: string;
    appointmentId?: string;
    sourceType: string;
    lines: Array<{
      serviceRateId?: string;
      description: string;
      quantity: number;
      rate: number;
      doctorStaffId?: string;
    }>;
  }) {
    const res = await apiClient.post<{ data: BackendInvoice }>('/invoices', data);
    return res.data.data;
  },

  async recordPayment(
    invoiceId: string,
    data: {
      amount: number;
      paymentMethod: string;
      referenceNote?: string;
    },
  ) {
    const res = await apiClient.post<{ data: any }>(`/invoices/${invoiceId}/payments`, data);
    return res.data.data;
  },

  /** `GET /cash/balance-sheet` (§4.9). No params = the live unsettled shift (what settlement uses); pass a period for the historical Balance Sheet view. */
  async getCashBalance(period?: { preset: string; fromDate?: string; toDate?: string }) {
    const res = await apiClient.get<{ data: any }>('/cash/balance-sheet', { params: period });
    return res.data.data;
  },
};
