import apiClient from './apiClient';
import { PayrollFilters, PayrollPreview, PayrollRun, SalarySlip } from '../types/payroll';

/**
 * Payroll Run — Daily/Monthly/Custom, attendance-driven (staff.md §19).
 * Every figure comes from `/api/v1/payroll*`; nothing is computed client-side.
 */

export async function previewPayrollRun(filters: PayrollFilters): Promise<PayrollPreview> {
  const res = await apiClient.post<{ data: PayrollPreview }>('/payroll/preview', filters);
  return res.data.data;
}

export async function generatePayrollRun(filters: PayrollFilters): Promise<PayrollRun> {
  const res = await apiClient.post<{ data: PayrollRun }>('/payroll/runs', filters);
  return res.data.data;
}

export async function listPayrollRuns(): Promise<PayrollRun[]> {
  const res = await apiClient.get<{ data: PayrollRun[] }>('/payroll/runs', { params: { pageSize: 100 } });
  return res.data.data;
}

export async function getPayrollRun(id: string): Promise<PayrollRun> {
  const res = await apiClient.get<{ data: PayrollRun }>(`/payroll/runs/${id}`);
  return res.data.data;
}

export async function approvePayrollRun(id: string): Promise<PayrollRun> {
  const res = await apiClient.post<{ data: PayrollRun }>(`/payroll/runs/${id}/approve`, {});
  return res.data.data;
}

export async function paySalarySlip(id: string, body: { amount: number; method: string; reference?: string }): Promise<SalarySlip> {
  const res = await apiClient.post<{ data: SalarySlip }>(`/payroll/slips/${id}/pay`, body);
  return res.data.data;
}
