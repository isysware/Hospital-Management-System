import apiClient from './apiClient';
import { toErrorMessage } from '../utils/apiErrors';
import { formatPKR, formatDateTimeDDMMYYYY } from '../utils/formatters';
import type { ReportDatePreset, ReportResult } from '../components/reports/GenericReportView';
import type { FilterOption } from '../components/reports/reportFilters';

/**
 * Admin / Super Admin management report fetchers — `/api/v1/reports/management/*`
 * (`hms-backend/src/modules/reports/managementReports.*`, reporting.md §8.3).
 * Each returns `GenericReportView`'s `ReportResult<T>` directly.
 */

type RangeParams = { preset: ReportDatePreset; fromDate?: string; toDate?: string };
export type ReportFilters = Record<string, string | undefined>;

function params(range: RangeParams | null, extra?: ReportFilters) {
  const dates = range
    ? { preset: range.preset, ...(range.preset === 'custom' ? { fromDate: range.fromDate, toDate: range.toDate } : {}) }
    : {};
  return { ...dates, ...Object.fromEntries(Object.entries(extra ?? {}).filter(([, v]) => v)) };
}

async function get<T>(path: string, query: Record<string, unknown>): Promise<T> {
  try {
    const res = await apiClient.get<{ data: T }>(`/reports/management/${path}`, { params: query });
    return res.data.data;
  } catch (err) {
    throw new Error(toErrorMessage(err));
  }
}

/** Decimal fields arrive as strings — convert the listed keys to numbers. */
function toNumbers<T>(row: any, keys: string[]): T {
  const out = { ...row };
  for (const k of keys) out[k] = Number(row[k] ?? 0);
  return out as T;
}

// ── Filter options ────────────────────────────────────────────────────────

export interface ManagementFilterOptions {
  departments: FilterOption[];
  doctors: FilterOption[];
  wards: FilterOption[];
  users: FilterOption[];
  cashiers: FilterOption[];
  cashUsers: FilterOption[];
  panels: FilterOption[];
  staff: FilterOption[];
  stockCategories: FilterOption[];
}

export const EMPTY_MANAGEMENT_OPTIONS: ManagementFilterOptions = {
  departments: [], doctors: [], wards: [], users: [], cashiers: [], cashUsers: [], panels: [], staff: [], stockCategories: [],
};

export const fetchManagementFilterOptions = () => get<ManagementFilterOptions>('filter-options', {});

// ── Summary records (no KPI cards — every figure is a table row) ───────────

/** One figure in a summary report. `isAmount` decides PKR vs plain-count formatting. */
export interface SummaryRecord {
  key: string;
  section: string;
  metric: string;
  value: number;
  isAmount: boolean;
}

const record = (section: string, metric: string, value: unknown, isAmount: boolean): SummaryRecord => ({
  key: `${section}|${metric}`,
  section,
  metric,
  value: Number(value ?? 0),
  isAmount,
});

// ── #1 Management Summary ─────────────────────────────────────────────────

export async function fetchManagementSummary(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<SummaryRecord>> {
  const d = await get<any>('summary', params(range, filters));
  const s = d.summary;
  const hospital = [
    record('Billing', 'Gross Billing', s.grossBilling, true),
    record('Billing', 'Discounts', s.discounts, true),
    record('Billing', 'Net Billing', s.totalBilling, true),
    record('Billing', 'Actual Collections', s.collections, true),
    record('Billing', 'Outstanding', s.outstanding, true),
    record('Expenses', 'Hospital Expenses (Expense Management)', s.hospitalExpenses, true),
    record('Expenses', 'Inventory Operating Expenses', s.expenses, true),
    record('Salary Payroll', 'Total Salary Generated', s.salaryGenerated, true),
    record('Salary Payroll', 'Salary Paid', s.salaryPaid, true),
    record('Salary Payroll', 'Salary Outstanding', s.salaryOutstanding, true),
    record('Doctor Commission', 'Total Commission Generated', s.commissionGenerated, true),
    record('Doctor Commission', 'Commission Paid', s.commissionPaid, true),
    record('Doctor Commission', 'Commission Outstanding', s.commissionOutstanding, true),
    record('Financial Summary', 'Collected Income', s.collectedIncome, true),
    record('Financial Summary', 'Total Applicable Operating Costs', s.totalOperatingCosts, true),
    record('Financial Summary', 'Collection-Based Operating Profit / Loss', s.operatingResult, true),
    record('Admissions & Beds', 'Active Admissions', s.activeAdmissions, false),
    record('Admissions & Beds', 'Occupied Beds', s.occupiedBeds, false),
    record('Admissions & Beds', 'Available Beds', s.availableBeds, false),
    record('Settlements', 'Pending Settlements (awaiting review)', s.pendingSettlements, false),
  ];
  const byDepartment = d.rows.flatMap((r: any) => {
    const section = `Department — ${r.department}`;
    return [
      record(section, 'Invoices', r.invoices, false),
      record(section, 'Net Billing', r.net, true),
      record(section, 'Actual Collections', r.collected, true),
      record(section, 'Outstanding', r.outstanding, true),
      record(section, 'Active Admissions', r.activeAdmissions, false),
    ];
  });
  return { periodLabel: d.period.label, rows: [...hospital, ...byDepartment] };
}

// ── #2 Billing & Collection ───────────────────────────────────────────────

export interface BillingCollectionRow {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  patient: string;
  payer: string;
  department: string | null;
  gross: number;
  discount: number;
  net: number;
  collected: number;
  outstanding: number;
  methods: string;
  collectedBy: string;
  status: string;
}

export async function fetchBillingCollection(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<BillingCollectionRow>> {
  const d = await get<any>('billing-collection', params(range, filters));
  return {
    periodLabel: d.period.label,
    rows: d.rows.map((r: any) => ({
      ...toNumbers<BillingCollectionRow>(r, ['gross', 'discount', 'net', 'collected', 'outstanding']),
      createdAt: formatDateTimeDDMMYYYY(r.createdAt),
    })),
  };
}

// ── #3 Outstanding / Panel ────────────────────────────────────────────────

export interface OutstandingPanelRow {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  patient: string;
  payerType: string;
  panel: string | null;
  department: string | null;
  net: number;
  paid: number;
  patientDue: number;
  panelDue: number;
  due: number;
  status: string;
}

export async function fetchOutstandingPanel(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<OutstandingPanelRow>> {
  const d = await get<any>('outstanding-panel', params(range, filters));
  return {
    periodLabel: d.period.label,
    rows: d.rows.map((r: any) => ({ ...toNumbers<OutstandingPanelRow>(r, ['net', 'paid', 'patientDue', 'panelDue', 'due']), createdAt: formatDateTimeDDMMYYYY(r.createdAt) })),
  };
}

// ── #6 Balance Sheet & Account Settlements ────────────────────────────────

export interface BalanceSettlementRow {
  key: string;
  user: string;
  portal: string;
  opening: number;
  pettyCash: number;
  cashCollections: number;
  expenses: number;
  refunds: number;
  nonCash: number;
  expectedCash: number;
  submitted: number;
  variance: number;
  accepted: number;
  remaining: number;
  settlementStatus: string;
}

export async function fetchBalanceSettlements(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<BalanceSettlementRow>> {
  const d = await get<any>('balance-settlements', params(range, filters));
  return {
    periodLabel: d.period.label,
    rows: d.rows.map((r: any) =>
      toNumbers<BalanceSettlementRow>(r, ['opening', 'pettyCash', 'cashCollections', 'expenses', 'refunds', 'nonCash', 'expectedCash', 'submitted', 'variance', 'accepted', 'remaining']),
    ),
  };
}

// ── #7 Staff / Payroll / Doctor Commission ────────────────────────────────

export interface StaffPayrollRow {
  salaryStatements: FinancialSource[];
  commissionStatements: FinancialSource[];
  staffId: string;
  employeeId: string;
  name: string;
  category: string;
  department: string | null;
  attendanceDays: number;
  salaryBasis: string | null;
  payrollAmount: number;
  commissionAmount: number;
  salaryAdjustments: number; salaryPayable: number; salaryPaid: number; salaryRemaining: number; salaryOverpaid: number;
  commissionTax: number; commissionReversed: number; commissionAdjustments: number; commissionPayable: number;
  commissionPaid: number; commissionRemaining: number; commissionOverpaid: number;
  salarySlipIds: string[]; commissionAccrualIds: string[]; payrollRunIds: string[]; commissionRunIds: string[];
  status: string;
}

export interface FinancialSource {
  id: string; status: string; payrollRunId?: string | null; commissionRunId?: string | null;
  balance: { payable: string; paid: string; remaining: string; overpaid: string };
  payments?: { amount: string; method: string; paidAt: string; reference?: string; paidById: string }[];
  payouts?: { amount: string; method: string; paidAt: string; reference?: string; paidById: string }[];
  correctionEntries?: { amount: string; reason: string; createdAt: string; createdById: string }[];
  adjustments?: { amount: string; reason: string; createdAt: string; createdById: string }[];
  reversals?: { reversalAmount: string; reason: string; reversedAt: string; reversedById: string }[];
}

/** Payroll Period is a month (YYYY-MM), not a date range. */
export async function fetchStaffPayrollCommission(filters?: ReportFilters): Promise<ReportResult<StaffPayrollRow>> {
  const d = await get<any>('staff-payroll-commission', params(null, filters));
  return {
    periodLabel: d.period.label,
    rows: d.rows.map((r: any) => toNumbers<StaffPayrollRow>(r, ['attendanceDays', 'payrollAmount', 'commissionAmount',
      'salaryAdjustments', 'salaryPayable', 'salaryPaid', 'salaryRemaining', 'salaryOverpaid',
      'commissionTax', 'commissionReversed', 'commissionAdjustments', 'commissionPayable', 'commissionPaid', 'commissionRemaining', 'commissionOverpaid'])),
  };
}

// ── #8 Inventory / Pharmacy Summary ───────────────────────────────────────

export async function fetchInventoryPharmacy(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<SummaryRecord>> {
  const d = await get<any>('inventory-pharmacy', params(range, filters));
  return { periodLabel: d.period.label, rows: d.rows.map((r: any) => record(r.section, r.metric, r.value, r.isAmount)) };
}
