import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../frontend/src/services/apiClient', () => ({ default: api }));
import { fetchManagementSummary } from '../../frontend/src/services/managementReportsService';
it('uses identical numeric staff and financial rows for the management table and its shared exports', async () => {
  api.get.mockResolvedValue({ data: { data: { period: { label: 'Today' }, rows: [], summary: {
    salaryGenerated: '2000', salaryPaid: '900', salaryOutstanding: '1100',
    commissionGenerated: '500', commissionPaid: '200', commissionOutstanding: '300',
    totalBilling: '10000', collectedIncome: '8500', hospitalExpenses: '1000', expenses: '500', totalOperatingCosts: '4000', operatingResult: '4500',
  } } } });
  const report = await fetchManagementSummary({ preset: 'today' }, { departmentId: 'dept', portalUserId: 'payer' });
  expect(report.rows.filter(r => r.section === 'Salary Payroll').map(r => r.value)).toEqual([2000, 900, 1100]);
  expect(report.rows.filter(r => r.section === 'Doctor Commission').map(r => r.value)).toEqual([500, 200, 300]);
  expect(report.rows.filter(r => r.section === 'Financial Summary').map(r => r.value)).toEqual([8500, 4000, 4500]);
  expect(new Set(report.rows.map(r => r.key)).size).toBe(report.rows.length);
  expect(api.get).toHaveBeenCalledWith('/reports/management/summary', { params: { preset: 'today', departmentId: 'dept', portalUserId: 'payer' } });
});
