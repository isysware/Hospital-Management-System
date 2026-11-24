import apiClient from './apiClient';
import { formatDisplayDate } from '../utils/dateConstants';

/**
 * Pharmacy ↔ HMS inter-entity settlement — money the HMS Front Desk
 * collected from admitted patients on Pharmacy's behalf (admission-linked
 * dispenses) that Pharmacy has requested back. Backed by
 * `/api/v1/pharmacy-bridge/settlements`. Releasing a payment is restricted
 * server-side to SUPER_ADMIN / ADMIN only (`pharmacy-bridge.service.ts`'s
 * `releaseSettlement`) — this screen is reachable only from the Super
 * Admin / Admin portals (`SuperAdminModuleView`'s shared nav), never Front
 * Desk or Admission.
 */

export type SettlementPaymentMethod = 'CASH' | 'BANK' | 'ONLINE';

export const SETTLEMENT_PAYMENT_METHOD_LABELS: Record<SettlementPaymentMethod, string> = {
  CASH: 'Cash',
  BANK: 'Bank Transfer',
  ONLINE: 'Online / Other',
};

export interface PharmacySettlement {
  bridgeStatus?: string;
  reconciliationRequired?: boolean;
  id: string;
  settlementNumber: string;
  pharmacyInvoiceNumber: string;
  patientName: string;
  admissionNumber: string | null;
  requestedAmount: number;
  releasedAmount: number;
  remainingAmount: number;
  status: 'REQUESTED' | 'PARTIALLY_RELEASED' | 'SETTLED' | 'REJECTED';
  paymentMethod: SettlementPaymentMethod | null;
  paymentReference: string | null;
  remarks: string | null;
  requestedByExternal: string | null;
  requestedAt: string;
  releasedByName: string | null;
  releasedAt: string | null;
}

function toNumber(v: any): number {
  return Number(v ?? 0);
}

function formatTimestamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dateStr = formatDisplayDate(d);
  const timeStr = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

function toSettlement(raw: Record<string, any>): PharmacySettlement {
  const admission = raw.pharmacyCharge?.admissionRecord;
  return {
    bridgeStatus: raw.release?.bridgeStatus,
    reconciliationRequired: Boolean(raw.reconciliationRequired),
    id: raw.id,
    settlementNumber: raw.settlementNumber,
    pharmacyInvoiceNumber: raw.pharmacyInvoiceNumber,
    patientName: admission?.panelPatient?.fullName || admission?.selfPayEncounter?.fullName || 'Unknown Patient',
    admissionNumber: admission?.admissionNumber || null,
    requestedAmount: toNumber(raw.requestedAmount),
    releasedAmount: toNumber(raw.releasedAmount),
    remainingAmount: toNumber(raw.remainingAmount),
    status: raw.status,
    paymentMethod: raw.paymentMethod || null,
    paymentReference: raw.paymentReference || null,
    remarks: raw.remarks || null,
    requestedByExternal: raw.requestedByExternal || null,
    requestedAt: formatTimestamp(raw.requestedAt),
    releasedByName: raw.releasedByUser?.displayName || raw.releasedByUser?.username || null,
    releasedAt: formatTimestamp(raw.releasedAt),
  };
}

export async function fetchPharmacySettlements(): Promise<PharmacySettlement[]> {
  const res = await apiClient.get<{ data: Record<string, any>[] }>('/pharmacy-bridge/settlements');
  return res.data.data.map(toSettlement);
}

export async function releasePharmacySettlement(
  settlementId: string,
  values: {
    releasedAmount: number;
    idempotencyKey: string;
    paymentMethod: SettlementPaymentMethod;
    paymentReference?: string;
    remarks?: string;
  },
): Promise<PharmacySettlement> {
  const res = await apiClient.post<{ data: Record<string, any> }>(`/pharmacy-bridge/settlements/${settlementId}/release`, values);
  return toSettlement(res.data.data);
}
