import apiClient from './apiClient';
import type { StaffPaymentRecord } from '../features/superAdmin/payroll/StaffPaymentHistory';
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
  payouts: StaffPaymentRecord[];
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
  tax: number;
  payable: number;
  adjustmentsTotal: number;
  overpaid: number;
  commissionRunId: string | null;
  invoiceNumber: string;
  quantity: number;
  eligibleNet: number;
  ruleLabel: string;
  corrections: { amount: string; reason: string; createdAt: string; createdById: string }[];
  reversals: { id: string; reversalAmount: number; reason: string; source: string; reversedAt: string }[];
  periodStart: string;
  createdAt: string;
}

function toAccrual(raw: Record<string, any>): CommissionAccrual {
  const paidTotal = (raw.payouts || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  const reversedTotal = (raw.reversals || []).reduce((sum: number, r: any) => sum + Number(r.reversalAmount), 0);
  const commissionAmount = Number(raw.commissionAmount ?? 0);
  return {
    payouts: raw.payouts ?? [],
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
    remaining: Number(raw.balance?.remaining ?? commissionAmount - reversedTotal - paidTotal),
    tax: Number(raw.balance?.tax ?? 0),
    payable: Number(raw.balance?.payable ?? commissionAmount - reversedTotal),
    adjustmentsTotal: Number(raw.balance?.adjustments ?? 0),
    overpaid: Number(raw.balance?.overpaid ?? 0),
    commissionRunId: raw.commissionRunId ?? null,
    invoiceNumber: raw.invoiceLineItem?.hospitalInvoice?.invoiceNumber ?? '',
    quantity: Number(raw.invoiceLineItem?.quantity ?? 0),
    eligibleNet: Number(raw.ruleSnapshot?.collectedAmount ?? raw.ruleSnapshot?.lineNet ?? 0),
    ruleLabel: raw.ruleSnapshot?.ruleType === 'PERCENTAGE' ? `${raw.ruleSnapshot.rate}%` : `PKR ${raw.ruleSnapshot?.rate ?? 0}/service`,
    corrections: raw.adjustments ?? [],
    reversals: raw.reversals ?? [],
    periodStart: formatDate(raw.periodStart),
    createdAt: formatDate(raw.createdAt),
  };
}

export async function fetchCommissionAccruals(filters?: { staffId?: string; status?: AccrualStatus; startDate?: string; endDate?: string }): Promise<CommissionAccrual[]> {
  const res = await apiClient.get<{ data: Record<string, any>[] }>('/commission/accruals', { params: filters });
  return res.data.data.map(toAccrual);
}

export interface CommissionRunFilters {
  periodType: 'DAILY' | 'MONTHLY' | 'CUSTOM'; periodStart: string; periodEnd: string;
  staffId?: string; departmentId?: string; serviceRateId?: string;
}
export interface CommissionRun {
  id: string; periodType: string; periodStart: string; periodEnd: string;
  status: string; totalAmount: string; generatedAt: string; lines?: CommissionAccrual[];
}
export async function previewCommissionRun(filters: CommissionRunFilters) {
  const { data } = await apiClient.post('/commission/preview', filters);
  return { lines: data.data.lines.map(toAccrual) as CommissionAccrual[], totalAmount: Number(data.data.totalAmount) };
}
export async function generateCommissionRun(filters: CommissionRunFilters): Promise<CommissionRun> {
  const { data } = await apiClient.post('/commission/runs', filters);
  return { ...data.data, lines: data.data.lines.map(toAccrual) };
}
export async function fetchCommissionRuns(): Promise<CommissionRun[]> {
  return (await apiClient.get('/commission/runs')).data.data;
}
export async function getCommissionRun(id: string): Promise<CommissionRun> {
  const { data } = await apiClient.get(`/commission/runs/${id}`);
  return { ...data.data, lines: data.data.lines.map(toAccrual) };
}
export async function approveCommissionRun(id: string): Promise<CommissionRun> {
  const { data } = await apiClient.post(`/commission/runs/${id}/approve`, {});
  return { ...data.data, lines: data.data.lines.map(toAccrual) };
}
export async function adjustCommission(id: string, amount: number, reason: string) {
  return (await apiClient.post(`/commission/accruals/${id}/adjustments`, { amount, reason })).data.data;
}

export async function approveCommissionAccrual(id: string): Promise<CommissionAccrual> {
  const res = await apiClient.post<{ data: Record<string, any> }>(`/commission/accruals/${id}/approve`, {});
  return toAccrual(res.data.data);
}

export async function approveAllCommissionAccruals(staffId?: string): Promise<{ count: number }> {
  const res = await apiClient.post<{ data: { count: number } }>('/commission/accruals/approve-all', {
    staffId: staffId && staffId !== 'All' ? staffId : undefined,
  });
  return res.data.data;
}

export async function payCommissionAccrual(id: string, body: { amount: number; method: string; reference?: string; requestKey: string }): Promise<CommissionAccrual> {
  const res = await apiClient.post<{ data: Record<string, any> }>(`/commission/accruals/${id}/pay`, body);
  return toAccrual(res.data.data);
}
