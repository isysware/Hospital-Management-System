import apiClient from './apiClient';
import { formatDisplayDate } from '../utils/dateConstants';

/**
 * Live Doctor Commission service — backed by `/api/v1/commission/rules`
 * (already-existing backend, unused by the frontend until now). Commission
 * Tax fields are new (HMS_V7.2_NEW_REQUIREMENTS.md §2.7) — independent of
 * any Salary Tax on the doctor's Salary Profile.
 */

export type CommissionRuleType = 'FIXED_PER_SERVICE' | 'PERCENTAGE';
export type CommissionBasis = 'GROSS' | 'NET';
export type CommissionTaxMethod = 'PERCENTAGE' | 'FIXED' | '';

export interface CommissionRule {
  id: string;
  staffId: string;
  doctorName: string;
  doctorDesignation: string;
  serviceRateId: string | null;
  serviceName: string | null;
  ruleType: CommissionRuleType;
  rate: number;
  basis: CommissionBasis;
  commissionTaxMethod: CommissionTaxMethod;
  commissionTaxValue: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface CommissionRuleFormValues {
  staffId: string;
  serviceRateId: string;
  ruleType: CommissionRuleType;
  rate: number | '';
  basis: CommissionBasis;
  commissionTaxMethod: CommissionTaxMethod;
  commissionTaxValue: number | '';
  effectiveFrom: string;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatDisplayDate(d);
}

function toCommissionRule(raw: Record<string, any>): CommissionRule {
  return {
    id: raw.id,
    staffId: raw.staffId,
    doctorName: raw.doctor?.fullName || '',
    doctorDesignation: raw.doctor?.designation || '',
    serviceRateId: raw.serviceRateId || null,
    serviceName: raw.serviceRate?.name || null,
    ruleType: raw.ruleType,
    rate: Number(raw.rate ?? 0),
    basis: raw.basis,
    commissionTaxMethod: raw.commissionTaxMethod || '',
    commissionTaxValue: raw.commissionTaxValue != null ? Number(raw.commissionTaxValue) : null,
    effectiveFrom: formatDate(raw.effectiveFrom),
    effectiveTo: raw.effectiveTo ? formatDate(raw.effectiveTo) : null,
    createdAt: formatDate(raw.createdAt),
  };
}

export async function fetchCommissionRules(staffId?: string): Promise<CommissionRule[]> {
  const res = await apiClient.get<{ data: Record<string, any>[] }>('/commission/rules', {
    params: staffId ? { staffId } : undefined,
  });
  return res.data.data.map(toCommissionRule);
}

export async function createCommissionRule(values: CommissionRuleFormValues): Promise<CommissionRule> {
  const res = await apiClient.post<{ data: Record<string, any> }>('/commission/rules', {
    staffId: values.staffId,
    serviceRateId: values.serviceRateId || undefined,
    ruleType: values.ruleType,
    rate: Number(values.rate) || 0,
    basis: values.basis,
    commissionTaxMethod: values.commissionTaxMethod || undefined,
    commissionTaxValue: values.commissionTaxValue === '' ? undefined : Number(values.commissionTaxValue),
    effectiveFrom: values.effectiveFrom,
  });
  return toCommissionRule(res.data.data);
}

// ── Commission Accruals & Payments (staff.md §14/§20) — the automatic,
// transaction-linked earning behind each rule above, plus the Approve/Pay
// workflow that turns an accrual into an actual `CommissionPayout`.
export type AccrualStatus = 'ACCRUED' | 'GENERATED' | 'APPROVED' | 'PARTIALLY_PAID' | 'PAID';

export interface CommissionAccrual {
  id: string;
  staffId: string;
  doctorName: string;
  doctorEmployeeId: string;
  invoiceLineItemId: string;
  serviceName: string | null;
  commissionAmount: number;
  status: AccrualStatus;
  paidTotal: number;
  reversedTotal: number;
  remaining: number;
  periodStart: string;
  createdAt: string;
}

function toAccrual(raw: Record<string, any>): CommissionAccrual {
  const paidTotal = (raw.payouts || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  const reversedTotal = (raw.reversals || []).reduce((sum: number, r: any) => sum + Number(r.reversalAmount), 0);
  const commissionAmount = Number(raw.commissionAmount ?? 0);
  return {
    id: raw.id,
    staffId: raw.staffId,
    doctorName: raw.doctor?.fullName || '',
    doctorEmployeeId: raw.doctor?.employeeId || raw.doctor?.designation || '',
    invoiceLineItemId: raw.invoiceLineItemId,
    serviceName: raw.invoiceLineItem?.serviceRate?.name || null,
    commissionAmount,
    status: raw.status,
    paidTotal,
    reversedTotal,
    remaining: commissionAmount - reversedTotal - paidTotal,
    periodStart: formatDate(raw.periodStart),
    createdAt: formatDate(raw.createdAt),
  };
}

export async function fetchCommissionAccruals(filters?: { staffId?: string; status?: AccrualStatus }): Promise<CommissionAccrual[]> {
  const res = await apiClient.get<{ data: Record<string, any>[] }>('/commission/accruals', { params: filters });
  return res.data.data.map(toAccrual);
}

export async function approveCommissionAccrual(id: string): Promise<CommissionAccrual> {
  const res = await apiClient.post<{ data: Record<string, any> }>(`/commission/accruals/${id}/approve`, {});
  return toAccrual(res.data.data);
}

export async function payCommissionAccrual(id: string, body: { amount: number; method: string; reference?: string }): Promise<CommissionAccrual> {
  const res = await apiClient.post<{ data: Record<string, any> }>(`/commission/accruals/${id}/pay`, body);
  return toAccrual(res.data.data);
}
