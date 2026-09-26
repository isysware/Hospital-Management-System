import apiClient from './apiClient';
import { toErrorMessage } from '../utils/apiErrors';

/**
 * Panel Billing — Panel Verification, Contract Resolution, Panel Interim
 * Statement, and Panel Remittance (HMS_V7.2_NEW_REQUIREMENTS.md §2.5/§3.3).
 * Backed by `/api/v1/panel-billing*`. Reuses `PanelDiscountRule`'s shape
 * from `panelService.ts` rather than redefining it — Contract Resolution
 * reads the exact same `coveragePercent`/`capAmount`/`preauthorizationRequired`
 * fields Super Admin's discount-rule editor already writes.
 */

export type PanelRemittanceMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'ONLINE';

export interface PanelMembershipVerification {
  panelPatient: {
    id: string;
    mrNumber: string;
    fullName: string;
    panelMemberId?: string;
    membershipStatus?: string;
    membershipValidFrom?: string | null;
    membershipValidTo?: string | null;
    status: string;
    isActive: boolean;
  };
  corporatePanel: {
    id: string;
    code?: string;
    organizationName: string;
    isActive: boolean;
  };
  membershipActive: boolean;
  reasons: string[];
}

export interface ContractResolution {
  serviceRateId: string;
  serviceCode: string;
  serviceName: string;
  quantity: number;
  contractAmount: number;
  grossAmount: number;
  matchedScope: string | null;
  patientShare: number;
  panelReceivable: number;
  discountAmount: number;
  discountReason: string | null;
  coveragePercent: number | null;
  capAmount: number | null;
  preauthorizationRequired: boolean;
  source: 'COVERAGE' | 'LEGACY_DISCOUNT' | 'NOT_COVERED';
}

export interface PanelStatementInvoiceRow {
  hospitalInvoiceId: string;
  invoiceNumber: string;
  createdAt: string; // ISO
  sourceType: string; // WALK_IN | APPOINTMENT | ADMISSION
  encounterType: string | null;
  patientName: string;
  patientMrNumber: string;
  panelMemberId: string | null;
  departmentName: string;
  total: number;
  patientShare: number;
  patientShareCollected: number;
  patientShareOutstanding: number;
  panelReceivable: number;
  panelReceivableRealized: number;
  panelReceivableOutstanding: number;
}

export interface PanelStatement {
  corporatePanelId: string;
  corporatePanelName: string;
  activePatientsCount: number;
  invoices: PanelStatementInvoiceRow[];
  consolidated: {
    patientShare: number;
    patientShareCollected: number;
    patientShareOutstanding: number;
    panelReceivable: number;
    panelReceivableRealized: number;
    panelReceivableOutstanding: number;
  };
}

export interface PanelRemittanceAllocationRow {
  id: string;
  hospitalInvoiceId: string;
  invoiceNumber: string;
  allocatedAmount: number;
}

export interface PanelRemittanceRecord {
  id: string;
  remittanceNumber: string;
  amount: number;
  method: PanelRemittanceMethod;
  reference?: string;
  remarks?: string;
  receivedAt: string;
  receivedByName: string;
  allocations: PanelRemittanceAllocationRow[];
}

function toNumber(v: any): number {
  return Number(v ?? 0);
}

function toContractResolution(raw: Record<string, any>): ContractResolution {
  return {
    serviceRateId: raw.serviceRateId,
    serviceCode: raw.serviceCode,
    serviceName: raw.serviceName,
    quantity: toNumber(raw.quantity) || 1,
    contractAmount: toNumber(raw.contractAmount),
    grossAmount: toNumber(raw.grossAmount ?? raw.contractAmount),
    matchedScope: raw.matchedScope ?? null,
    patientShare: toNumber(raw.patientShare),
    panelReceivable: toNumber(raw.panelReceivable),
    discountAmount: toNumber(raw.discountAmount),
    discountReason: raw.discountReason ?? null,
    coveragePercent: raw.coveragePercent != null ? toNumber(raw.coveragePercent) : null,
    capAmount: raw.capAmount != null ? toNumber(raw.capAmount) : null,
    preauthorizationRequired: !!raw.preauthorizationRequired,
    source: raw.source,
  };
}

function toStatement(raw: Record<string, any>): PanelStatement {
  return {
    corporatePanelId: raw.corporatePanelId,
    corporatePanelName: raw.corporatePanelName,
    activePatientsCount: raw.activePatientsCount ?? 0,
    invoices: (raw.invoices || []).map((inv: any) => ({
      hospitalInvoiceId: inv.hospitalInvoiceId,
      invoiceNumber: inv.invoiceNumber,
      createdAt: inv.createdAt,
      sourceType: inv.sourceType,
      encounterType: inv.encounterType ?? null,
      patientName: inv.panelPatient?.fullName || '',
      patientMrNumber: inv.panelPatient?.mrNumber || '',
      panelMemberId: inv.panelPatient?.panelMemberId || null,
      departmentName: inv.department?.name || 'Unassigned',
      total: toNumber(inv.total),
      patientShare: toNumber(inv.patientShare),
      patientShareCollected: toNumber(inv.patientShareCollected),
      patientShareOutstanding: toNumber(inv.patientShareOutstanding),
      panelReceivable: toNumber(inv.panelReceivable),
      panelReceivableRealized: toNumber(inv.panelReceivableRealized),
      panelReceivableOutstanding: toNumber(inv.panelReceivableOutstanding),
    })),
    consolidated: {
      patientShare: toNumber(raw.consolidated?.patientShare),
      patientShareCollected: toNumber(raw.consolidated?.patientShareCollected),
      patientShareOutstanding: toNumber(raw.consolidated?.patientShareOutstanding),
      panelReceivable: toNumber(raw.consolidated?.panelReceivable),
      panelReceivableRealized: toNumber(raw.consolidated?.panelReceivableRealized),
      panelReceivableOutstanding: toNumber(raw.consolidated?.panelReceivableOutstanding),
    },
  };
}

function toRemittanceRecord(raw: Record<string, any>): PanelRemittanceRecord {
  return {
    id: raw.id,
    remittanceNumber: raw.remittanceNumber,
    amount: toNumber(raw.amount),
    method: raw.method,
    reference: raw.reference || undefined,
    remarks: raw.remarks || undefined,
    receivedAt: raw.receivedAt,
    receivedByName: raw.receivedByUser?.displayName || raw.receivedByUser?.username || 'System',
    allocations: (raw.allocations || []).map((a: any) => ({
      id: a.id,
      hospitalInvoiceId: a.hospitalInvoiceId,
      invoiceNumber: a.hospitalInvoice?.invoiceNumber || '',
      allocatedAmount: toNumber(a.allocatedAmount),
    })),
  };
}

export async function verifyPanelPatient(panelPatientId: string): Promise<PanelMembershipVerification> {
  try {
    const res = await apiClient.get<{ data: PanelMembershipVerification }>(`/panel-billing/verify/${panelPatientId}`);
    return res.data.data;
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function resolveContract(params: {
  panelPatientId: string;
  serviceRateId: string;
  quantity?: number;
}): Promise<ContractResolution> {
  try {
    const res = await apiClient.get<{ data: Record<string, any> }>('/panel-billing/contract-resolution', { params });
    return toContractResolution(res.data.data);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function fetchPanelStatement(corporatePanelId: string, panelPatientId?: string): Promise<PanelStatement> {
  try {
    const res = await apiClient.get<{ data: Record<string, any> }>(`/panel-billing/panels/${corporatePanelId}/statement`, {
      params: panelPatientId ? { panelPatientId } : undefined,
    });
    return toStatement(res.data.data);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function recordPanelRemittance(
  corporatePanelId: string,
  values: {
    amount: number;
    method: PanelRemittanceMethod;
    reference?: string;
    remarks?: string;
    allocations?: { hospitalInvoiceId: string; amount: number }[];
  },
): Promise<PanelRemittanceRecord> {
  try {
    const res = await apiClient.post<{ data: Record<string, any> }>(`/panel-billing/panels/${corporatePanelId}/remittances`, values);
    return toRemittanceRecord(res.data.data);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export interface PanelLedgerEntry {
  date: string;
  type: 'CHARGE' | 'REMITTANCE';
  reference: string;
  description: string;
  patientName: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface PanelLedger {
  corporatePanelId: string;
  corporatePanelName: string;
  entries: PanelLedgerEntry[];
  totals: {
    totalDebit: number;
    totalCredit: number;
    closingBalance: number;
  };
  patientCoPay: {
    total: number;
    collected: number;
    outstanding: number;
  };
}

function toLedger(raw: Record<string, any>): PanelLedger {
  return {
    corporatePanelId: raw.corporatePanelId,
    corporatePanelName: raw.corporatePanelName,
    entries: (raw.entries || []).map((e: any) => ({
      date: e.date,
      type: e.type,
      reference: e.reference,
      description: e.description || '',
      patientName: e.patientName ?? null,
      debit: toNumber(e.debit),
      credit: toNumber(e.credit),
      runningBalance: toNumber(e.runningBalance),
    })),
    totals: {
      totalDebit: toNumber(raw.totals?.totalDebit),
      totalCredit: toNumber(raw.totals?.totalCredit),
      closingBalance: toNumber(raw.totals?.closingBalance),
    },
    patientCoPay: {
      total: toNumber(raw.patientCoPay?.total),
      collected: toNumber(raw.patientCoPay?.collected),
      outstanding: toNumber(raw.patientCoPay?.outstanding),
    },
  };
}

export async function fetchPanelLedger(corporatePanelId: string): Promise<PanelLedger> {
  try {
    const res = await apiClient.get<{ data: Record<string, any> }>(`/panel-billing/panels/${corporatePanelId}/ledger`);
    return toLedger(res.data.data);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

export async function fetchPanelRemittances(corporatePanelId: string): Promise<PanelRemittanceRecord[]> {
  try {
    const res = await apiClient.get<{ data: Record<string, any>[] }>(`/panel-billing/panels/${corporatePanelId}/remittances`);
    return res.data.data.map(toRemittanceRecord);
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}
