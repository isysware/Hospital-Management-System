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

export interface IncomeExpenseLedgerRow {
  id: string;
  date: string;
  reference: string;
  transactionType: 'REVENUE' | 'COLLECTION' | 'EXPENSE' | 'CONSUMABLE' | 'PAYROLL' | 'COMMISSION' | 'REFUND' | 'SETTLEMENT';
  typeLabel: string;
  patientPayeeDescription: string;
  encounterInvoiceRef: string;
  departmentId?: string;
  department: string;
  portalUserId?: string;
  portalUser: string;
  portal: string;
  status: string;
  statusLabel: string;
  grossBilling: number;
  discountCredit: number;
  tax: number;
  netRevenue: number;
  collectionsReceived: number;
  recognizedExpense: number;
  expensePaid: number;
  cashIn: number;
  cashOut: number;
  outstandingPayable: number;
  paymentMethod: string;
  details?: Record<string, any>;
}

export interface IncomeExpenseLedgerColumnTotals {
  grossBilling: number;
  discountCredit: number;
  tax: number;
  netRevenue: number;
  collectionsReceived: number;
  recognizedExpense: number;
  expensePaid: number;
  cashIn: number;
  cashOut: number;
  outstandingPayable: number;
}

export interface IncomeExpenseLedgerExecutiveTotals {
  hospitalRevenue: {
    grossEarnedBilling: number;
    discounts: number;
    netEarnedRevenue: number;
    taxAmount: number;
  };
  collectionsReceivables: {
    totalCollections: number;
    cashCollections: number;
    cardBankOnlineCollections: number;
    refunds: number;
    netCollections: number;
    closingOutstanding: number;
  };
  hospitalCosts: {
    directConsumables: number;
    staffPayrollRecognized: number;
    doctorCommissionEarned: number;
    approvedHospitalExpenses: number;
    inventoryOperatingExpenses: number;
    totalOperatingCosts: number;
    hasIncompleteCost: boolean;
    missingCostCount: number;
  };
  profit: {
    grossProfit: number;
    operatingProfit: number;
    operatingMargin: number;
  };
  cashMovement: {
    totalCustomerCollections: number;
    cashCollections?: number;
    cardBankOnlineCollections?: number;
    actualPaidOperatingExpenses: number;
    cashPaidOperatingExpenses?: number;
    nonCashPaidOperatingExpenses?: number;
    nonOperatingCashOutflows: number;
    netCashMovement: number;
    netPhysicalCashMovement?: number;
    netTotalFundsMovement?: number;
    currentRemainingCustomerDues: number;
  };
  payables: {
    payrollPaid: number;
    payrollOutstanding: number;
    commissionPaid: number;
    commissionOutstanding: number;
    expensePaid: number;
    expenseOutstanding: number;
  };
}

export interface IncomeExpenseLedgerResponse {
  period: { label: string; start: string; end: string };
  totalRecords: number;
  page: number;
  limit: number;
  totalPages: number;
  items: IncomeExpenseLedgerRow[];
  columnTotals: IncomeExpenseLedgerColumnTotals;
  totals: IncomeExpenseLedgerExecutiveTotals;
}

export interface IncomeExpenseLedgerFilters {
  departmentId?: string;
  portal?: string;
  portalUserId?: string;
  transactionType?: string;
  method?: string;
  status?: string;
  search?: string;
}

export async function fetchIncomeExpenseLedger(
  range: RangeParams | null,
  filters?: IncomeExpenseLedgerFilters,
  page = 1,
  limit = 25,
  exportAll = false,
): Promise<IncomeExpenseLedgerResponse> {
  const query = {
    ...params(range, filters as ReportFilters),
    page,
    limit,
    search: filters?.search,
    exportAll: exportAll ? true : undefined,
  };
  return await get<IncomeExpenseLedgerResponse>('income-expense-ledger', query);
}

export async function fetchManagementSummary(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<SummaryRecord>> {
  const d = await get<any>('summary', params(range, filters));
  const s = d.summary;
  const hospital = [
    record('Billing', 'Gross Billing', s.grossBilling, true),
    record('Billing', 'Discounts', s.discounts, true),
    record('Billing', 'Net Patient Billing (All Streams)', s.totalBilling, true),
    record('Billing', 'Actual Collections', s.collections, true),
    record('Billing', 'Outstanding', s.outstanding, true),
    record('Expenses', 'Hospital Expenses (Expense Management)', s.hospitalExpenses, true),
    record('Expenses', 'Inventory Operating Expenses', s.expenses, true),
    record('Direct Costs', 'Direct Consumable Costs', s.directServiceCosts, true),
    record('Salary Payroll', 'Total Salary Generated', s.salaryGenerated, true),
    record('Salary Payroll', 'Salary Paid', s.salaryPaid, true),
    record('Salary Payroll', 'Salary Outstanding', s.salaryOutstanding, true),
    record('Doctor Commission', 'Total Commission Generated', s.commissionGenerated, true),
    record('Doctor Commission', 'Commission Paid', s.commissionPaid, true),
    record('Doctor Commission', 'Commission Outstanding', s.commissionOutstanding, true),
    record('Financial Summary', 'Net Earned Hospital Revenue', s.netEarnedRevenue ?? s.totalBilling, true),
    record('Financial Summary', 'Gross Profit', s.grossProfit, true),
    record('Financial Summary', 'Total Applicable Operating Costs', s.totalOperatingCosts, true),
    record('Financial Summary', 'Operating Profit / (Loss) [Accrual]', s.operatingResult, true),
    record('Financial Summary', 'Actual Cash Collections (Custody)', s.collectedIncome, true),
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
  periodBilled: number;
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
      ...toNumbers<BillingCollectionRow>(r, ['gross', 'discount', 'net', 'periodBilled', 'collected', 'outstanding']),
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
  settlementIn: number;
  settlementOut: number;
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
      toNumbers<BalanceSettlementRow>(r, [
        'opening',
        'pettyCash',
        'cashCollections',
        'settlementIn',
        'settlementOut',
        'expenses',
        'refunds',
        'nonCash',
        'expectedCash',
        'submitted',
        'variance',
        'accepted',
        'remaining',
      ]),
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

// ── #4 Operating Profit (P&L) ─────────────────────────────────────────────

export interface OperatingProfitRecord {
  key: string;
  item: string;
  amount: number;
  note: string;
}

export interface OperatingProfitStatementRow {
  key: string;
  section: string;
  label: string;
  type: string;
  unit: 'percent' | 'currency';
  current: number | null;
  prior: number | null;
  percentOfRevenue: number | null;
  variance: number | null;
  sourceCount: number;
}

export interface StatementLedgerEntry {
  id: string;
  date: string;
  reference: string;
  category: string;
  department: string;
  description: string;
  actor: string;
  revenue: number;
  cost: number;
  status: string;
  details: Record<string, any>;
}

export interface OutsourcedStreamEntry {
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  providerName: string | null;
  currentBilling: number;
  currentPayable: number;
  priorBilling: number | null;
  priorPayable: number | null;
  billingVariance?: number | null;
  payableVariance?: number | null;
}

export interface PharmacyStreamEntry {
  currentBilling: number | null;
  priorBilling: number | null;
  available: boolean;
}

export interface OperatingProfitStatementResponse {
  period: { start: string; end: string; label: string };
  priorPeriod: { start: string; end: string; label: string } | null;
  rows: OperatingProfitStatementRow[];
  warnings: string[];
  incomplete: boolean;
  ledger: {
    items: StatementLedgerEntry[];
    page: number;
    limit: number;
    totalRecords: number;
    totalPages: number;
    recognizedRevenue: number;
    recognizedCost: number;
  };
  summary?: {
    revenue: number;
    grossBilling: number;
    discounts: number;
    directCost: number;
    grossProfit: number;
    payroll: number;
    doctorCommission: number;
    otherOperatingExpenses: number;
    totalCosts: number;
    operatingProfit: number;
    marginPercentage: number;
    hasIncompleteCost: boolean;
    totalOutsourcedBilling?: number;
    totalOutsourcedPayable?: number;
    pharmacyBilling?: number | null;
  };
  outsourcedStreams?: OutsourcedStreamEntry[];
  pharmacyStream?: PharmacyStreamEntry;
}

export interface OperatingProfitFilters {
  preset?: string;
  fromDate?: string;
  toDate?: string;
  departmentId?: string;
  comparison?: 'previous' | 'none';
  view?: 'statement' | 'ledger';
  category?: string;
  page?: number;
  limit?: number;
  exportAll?: boolean;
}

export async function fetchOperatingProfitStatement(
  filters: OperatingProfitFilters
): Promise<OperatingProfitStatementResponse> {
  const q: Record<string, any> = {
    preset: filters.preset || 'today',
    comparison: filters.comparison || 'previous',
    view: filters.view || 'statement',
    page: filters.page || 1,
    limit: filters.limit || 25,
  };
  if (filters.fromDate) q.fromDate = filters.fromDate;
  if (filters.toDate) q.toDate = filters.toDate;
  if (filters.departmentId) q.departmentId = filters.departmentId;
  if (filters.category) q.category = filters.category;
  if (filters.exportAll) q.exportAll = 'true';

  return get<OperatingProfitStatementResponse>('operating-profit', q);
}

export async function fetchOperatingProfit(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<OperatingProfitRecord>> {
  const d = await get<any>('operating-profit', params(range, filters));
  const s = d?.summary || {};
  const n = (v: any) => Number(v ?? 0);
  return {
    periodLabel: d?.period?.label || 'Current Period',
    rows: [
      { key: 'revenue', item: '1. Net Earned Hospital Revenue', amount: n(s.revenue), note: 'Gross billing minus approved discounts (Accrual)' },
      { key: 'directCost', item: '2. Less: Direct Consumable Costs', amount: n(s.directCost), note: s.hasIncompleteCost ? `Clinical consumables issued to departments [INCOMPLETE: ${s.missingCostCount} items missing cost rate]` : 'Clinical consumables issued to departments at historical cost' },
      { key: 'grossProfit', item: '3. Gross Profit', amount: n(s.grossProfit), note: s.hasIncompleteCost ? 'Net Revenue minus Direct Consumables [INCOMPLETE COST RATE DATA]' : 'Net Revenue minus Direct Consumables' },
      { key: 'payroll', item: '4. Less: Staff Payroll Cost', amount: n(s.payroll), note: 'Total approved staff salaries for the period' },
      { key: 'doctorCommission', item: '5. Less: Doctor Commission Expense', amount: n(s.doctorCommission), note: 'Net earned doctor commissions on collected receipts' },
      { key: 'otherOpex', item: '6. Less: Other Operating Expenses', amount: n(s.otherOperatingExpenses), note: 'Approved hospital vouchers and inventory operating expenses' },
      { key: 'operatingProfit', item: '7. Operating Profit / (Loss)', amount: n(s.operatingProfit), note: s.hasIncompleteCost ? `Gross Profit − Payroll − Commissions − Other OPEX [AFFECTED BY INCOMPLETE DIRECT COST]` : 'Gross Profit − Payroll − Commissions − Other OPEX' },
    ],
  };
}

// ── #3 Detailed Expense ───────────────────────────────────────────────────

export interface DetailedExpenseRow {
  id: string;
  date: string;
  source: string;
  category: string;
  voucherRef: string;
  department: string;
  description: string;
  amount: number;
  paidAmount?: number;
  outstandingAmount?: number;
  costStatus?: string;
  enteredBy: string;
}

export async function fetchDetailedExpenses(range: RangeParams, filters?: ReportFilters): Promise<ReportResult<DetailedExpenseRow>> {
  const d = await get<any>('detailed-expenses', params(range, filters));
  return {
    periodLabel: d.period.label,
    rows: d.rows.map((r: any) => toNumbers<DetailedExpenseRow>(r, ['amount', 'paidAmount', 'outstandingAmount'])),
  };
}
