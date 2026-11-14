import React, { useState } from 'react';
import { BarChart2, Receipt, AlertCircle, TrendingDown, FileSpreadsheet, Users, Boxes, Eye, Pill } from 'lucide-react';
import { GenericReportView } from '../../../components/reports/GenericReportView';
import { TextInput } from '../../../components/forms/FormControls';
import { useReportFilters, useFilterOptions, FilterSelect, opts } from '../../../components/reports/reportFilters';
import { InvoiceDetailModal } from '../../frontDesk/billing/InvoiceDetailModal';
import { AdmissionSummaryView } from '../../admission/AdmissionSimpleReports';
import { StaffFinancialSources } from './StaffFinancialSources';
import { fetchPharmacyRequestFulfillment, PharmacyRequestFulfillmentRow } from '../../../services/admissionReportsService';
import {
  fetchExpenses,
  EXPENSE_CATEGORY_LABEL,
  PAYMENT_METHOD_LABEL,
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_METHOD_OPTIONS,
  ExpenseRecord,
} from '../../../services/expenseService';
import { formatPKR, formatAmount } from '../../../utils/formatters';
import {
  fetchManagementFilterOptions,
  EMPTY_MANAGEMENT_OPTIONS,
  fetchManagementSummary,
  fetchBillingCollection,
  fetchOutstandingPanel,
  fetchBalanceSettlements,
  fetchStaffPayrollCommission,
  fetchInventoryPharmacy,
  SummaryRecord,
  BillingCollectionRow,
  OutstandingPanelRow,
  BalanceSettlementRow,
  StaffPayrollRow,
} from '../../../services/managementReportsService';

/**
 * Admin / Super Admin management reports (Super Admin_Admin Reporting.pdf,
 * reporting.md §8.3). Same UI as the Front Desk reports: GenericReportView +
 * one row of filters. No KPI cards — every figure is a table row, and every
 * table is `compact` so all money columns stay on screen.
 */

const useOptions = () => useFilterOptions(fetchManagementFilterOptions, EMPTY_MANAGEMENT_OPTIONS);

/** Money column: the currency lives in the header so every amount fits on screen. */
const money = <T,>(header: string, pick: (r: T) => number) => ({
  header: `${header} (PKR)`,
  align: 'right' as const,
  cell: (r: T) => formatAmount(pick(r)),
  excelValue: (r: T) => pick(r),
});
const count = <T,>(header: string, pick: (r: T) => number) => ({
  header,
  align: 'right' as const,
  cell: (r: T) => String(pick(r)),
  excelValue: (r: T) => pick(r),
});

const PAYMENT_METHOD = opts(['CASH', 'Cash'], ['CARD', 'Card'], ['BANK', 'Bank Transfer'], ['ONLINE', 'Online']);
const PAYMENT_STATUS = opts(['UNPAID', 'Unpaid'], ['PARTIALLY_PAID', 'Partially Paid'], ['PAID', 'Paid'], ['VOID', 'Void']);
const OUTSTANDING_STATUS = opts(['UNPAID', 'Unpaid'], ['PARTIALLY_PAID', 'Partially Paid'], ['PAID', 'Patient Paid — Panel Due']);
const PAYER_TYPE = opts(['SELF_PAY', 'Self-Pay'], ['PANEL', 'Panel']);
const CASH_PORTAL = opts(['BILLING', 'Front Desk / Billing'], ['INVENTORY', 'Inventory'], ['PHARMACY', 'Pharmacy']);
const SETTLEMENT_STATUS = opts(
  ['NONE', 'Not Settled'],
  ['SUBMITTED', 'Submitted'],
  ['ACCEPTED', 'Accepted'],
  ['PARTIALLY_ACCEPTED', 'Partially Accepted'],
  ['RETURNED', 'Returned'],
  ['REJECTED', 'Rejected'],
  ['REVERSED', 'Reversed'],
);
const PAYROLL_STATUS = opts(
  ['NOT_GENERATED', 'Not Generated'],
  ['DRAFT', 'Draft'],
  ['GENERATED', 'Generated'],
  ['APPROVED', 'Approved'],
  ['PARTIALLY_PAID', 'Partially Paid'],
  ['PAID', 'Paid'],
);
/** Readable label for a stored code (PAID → Paid), falling back to the code itself. */
const labelOf = (options: { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

const ALERT_STATUS =opts(['ALERTS', 'Alerts only (needs attention)']);

/** Columns for the summary reports, where each row is one figure. */
const SUMMARY_COLUMNS = [
  { header: 'Section', cell: (r: SummaryRecord) => r.section },
  { header: 'Metric', cell: (r: SummaryRecord) => r.metric },
  {
    header: 'Value',
    align: 'right' as const,
    cell: (r: SummaryRecord) => (r.isAmount ? formatPKR(r.value) : String(r.value)),
    excelValue: (r: SummaryRecord) => r.value,
  },
];

/** Row "View" action: the invoice number itself opens the invoice detail the Front Desk uses (saves a column on wide tables). */
const InvoiceLink: React.FC<{ number: string; onClick: () => void }> = ({ number, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title="View invoice"
    className="inline-flex items-center gap-1 font-semibold text-[#08775A] hover:underline text-left whitespace-nowrap"
  >
    <Eye className="h-3 w-3 shrink-0" /> {number}
  </button>
);

// ── #1 Management Summary ─────────────────────────────────────────────────

export const ManagementSummaryReport: React.FC = () => {
  const options = useOptions();
  const { filters, bind, reset } = useReportFilters({ departmentId: '', portalUserId: '', method: '' });
  return (
    <GenericReportView<SummaryRecord>
      title="Management Summary"
      subtitle="Salary and commission generated use approval dates plus posted adjustments; paid uses payment dates; outstanding includes prior balances as of period end. User filters approvals by approver and payments by payer. Collection-Based Operating Profit / Loss uses actual collections net of refunds less operating vouchers and approved salary/commission costs, counted once. Billing and outstanding are independent of payment method. Inventory expenses without departments apply hospital-wide only."
      icon={BarChart2}
      filenamePrefix="Management_Summary"
      tableZoom={1.2}
      compact
      fetchReport={(range) => fetchManagementSummary(range, filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
          <FilterSelect label="Portal / User" options={options.users} {...bind('portalUserId')} />
          <FilterSelect label="Payment Method" options={PAYMENT_METHOD} {...bind('method')} />
        </>
      }
      rowKey={(r) => r.key}
      noTotalColumns={['Value']}
      emptyMessage="No billing or admissions in this period."
      columns={SUMMARY_COLUMNS}
    />
  );
};

// ── #2 Billing & Collection ───────────────────────────────────────────────

export const BillingCollectionReport: React.FC = () => {
  const options = useOptions();
  const { filters, bind, reset } = useReportFilters({ departmentId: '', collectedById: '', method: '', status: '', corporatePanelId: '' });
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  return (
    <>
      <GenericReportView<BillingCollectionRow>
        title="Billing & Collection"
        subtitle="Every Hospital invoice with its discount, collection, payment method and the user who collected it."
        icon={Receipt}
        filenamePrefix="Billing_Collection"
        compact
        fetchReport={(range) => fetchBillingCollection(range, filters)}
        onResetExtraFilters={reset}
        extraFilters={
          <>
            <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
            <FilterSelect label="User / Cashier" options={options.cashiers} {...bind('collectedById')} />
            <FilterSelect label="Payment Method" options={PAYMENT_METHOD} {...bind('method')} />
            <FilterSelect label="Payment Status" options={PAYMENT_STATUS} {...bind('status')} />
            <FilterSelect label="Panel" options={options.panels} {...bind('corporatePanelId')} />
          </>
        }
        rowKey={(r) => r.id}
        emptyMessage="No invoices match these filters."
        columns={[
          { header: 'Invoice #', cell: (r) => r.invoiceNumber },
          { header: 'Date', cell: (r) => r.createdAt },
          { header: 'Patient / Payer', cell: (r) => `${r.patient} (${r.payer})` },
          { header: 'Department', cell: (r) => r.department || '—' },
          money('Gross', (r) => r.gross),
          money('Discount', (r) => r.discount),
          money('Net', (r) => r.net),
          money('Collected', (r) => r.collected),
          money('Outstanding', (r) => r.outstanding),
          {
            header: 'Payment Method',
            cell: (r) => (r.methods ? r.methods.split(', ').map((m) => labelOf(PAYMENT_METHOD, m)).join(', ') : '—'),
          },
          { header: 'Collected By', cell: (r) => r.collectedBy || '—' },
          { header: 'Status', cell: (r) => labelOf(PAYMENT_STATUS, r.status) },
        ]}
        renderCell={(col, row) => (col.header === 'Invoice #' ? <InvoiceLink number={row.invoiceNumber} onClick={() => setInvoiceId(row.id)} /> : col.cell(row))}
      />
      {invoiceId && <InvoiceDetailModal invoiceId={invoiceId} onClose={() => setInvoiceId(null)} onChanged={() => {}} />}
    </>
  );
};

// ── #3 Outstanding / Panel ────────────────────────────────────────────────

export const OutstandingPanelReport: React.FC = () => {
  const options = useOptions();
  const { filters, bind, reset } = useReportFilters({ payerType: '', corporatePanelId: '', departmentId: '', status: '' });
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  return (
    <>
      <GenericReportView<OutstandingPanelRow>
        title="Outstanding / Panel"
        subtitle="Every invoice with money still owed — Self-Pay patient dues and Panel / company receivables."
        icon={AlertCircle}
        filenamePrefix="Outstanding_Panel"
        compact
        fetchReport={(range) => fetchOutstandingPanel(range, filters)}
        onResetExtraFilters={reset}
        extraFilters={
          <>
            <FilterSelect label="Payer Type" options={PAYER_TYPE} {...bind('payerType')} />
            <FilterSelect label="Panel" options={options.panels} {...bind('corporatePanelId')} />
            <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
            <FilterSelect label="Status" options={OUTSTANDING_STATUS} {...bind('status')} />
          </>
        }
        rowKey={(r) => r.id}
        emptyMessage="No outstanding invoices match these filters."
        columns={[
          { header: 'Invoice #', cell: (r) => r.invoiceNumber },
          { header: 'Date', cell: (r) => r.createdAt },
          { header: 'Patient', cell: (r) => r.patient },
          { header: 'Payer Type', cell: (r) => r.payerType },
          { header: 'Panel / Company', cell: (r) => r.panel || '—' },
          { header: 'Department', cell: (r) => r.department || '—' },
          money('Net', (r) => r.net),
          money('Paid', (r) => r.paid),
          money('Patient Due', (r) => r.patientDue),
          money('Panel Due', (r) => r.panelDue),
          money('Total Due', (r) => r.due),
          { header: 'Status', cell: (r) => labelOf(OUTSTANDING_STATUS, r.status) },
        ]}
        renderCell={(col, row) => (col.header === 'Invoice #' ? <InvoiceLink number={row.invoiceNumber} onClick={() => setInvoiceId(row.id)} /> : col.cell(row))}
      />
      {invoiceId && <InvoiceDetailModal invoiceId={invoiceId} onClose={() => setInvoiceId(null)} onChanged={() => {}} />}
    </>
  );
};

// ── #4 Admission & Bed Summary — the shared Admission Summary screen ──────────

export const AdmissionBedReport: React.FC = () => (
  <AdmissionSummaryView
    title="Admission & Bed Summary"
    subtitle="Admissions, discharges, active patients, occupied / available beds and Hospital due by department."
  />
);

// ── #5 Expense Report — read-only view of Expense Management (active entries) ──

export const ExpenseReport: React.FC = () => {
  const options = useOptions();
  const { filters, bind, reset } = useReportFilters({ category: '', paymentMethod: '', createdById: '' });
  return (
    <GenericReportView<ExpenseRecord>
      title="Expense Report"
      subtitle="Date, category, amount, method, details and Entered By. Voided expenses are excluded."
      icon={TrendingDown}
      filenamePrefix="Expense_Report"
      compact
      fetchReport={(range) => fetchExpenses(range, filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <FilterSelect label="Category" options={EXPENSE_CATEGORY_OPTIONS} {...bind('category')} />
          <FilterSelect label="Payment Method" options={EXPENSE_METHOD_OPTIONS} {...bind('paymentMethod')} />
          <FilterSelect label="Entered By" options={options.users} {...bind('createdById')} />
        </>
      }
      rowKey={(r) => r.id}
      emptyMessage="No expenses for these filters."
      columns={[
        { header: 'Date', cell: (r) => r.expenseDateLabel },
        { header: 'Expense #', cell: (r) => r.expenseNumber },
        { header: 'Category', cell: (r) => EXPENSE_CATEGORY_LABEL[r.category] },
        money('Amount', (r) => r.amount),
        { header: 'Payment Method', cell: (r) => PAYMENT_METHOD_LABEL[r.paymentMethod] },
        { header: 'Paid To', cell: (r) => r.paidTo },
        { header: 'Details / Reference', cell: (r) => [r.description, r.reference].filter(Boolean).join(' · ') || '—' },
        { header: 'Entered By', cell: (r) => r.enteredBy },
      ]}
    />
  );
};

// ── #6 Balance Sheet & Account Settlements ────────────────────────────────

export const BalanceSettlementsReport: React.FC = () => {
  const options = useOptions();
  const { filters, bind, reset } = useReportFilters({ portal: '', portalUserId: '', settlementStatus: '' });
  return (
    <GenericReportView<BalanceSettlementRow>
      title="Balance Sheet & Account Settlements"
      subtitle="User-wise cash custody and settlements. Card / Bank / Online is shown separately and never counted as physical cash."
      icon={FileSpreadsheet}
      filenamePrefix="Balance_Settlements"
      compact
      fetchReport={(range) => fetchBalanceSettlements(range, filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <FilterSelect label="Portal" options={CASH_PORTAL} {...bind('portal')} />
          <FilterSelect label="User" options={options.users} {...bind('portalUserId')} />
          <FilterSelect label="Settlement Status" options={SETTLEMENT_STATUS} {...bind('settlementStatus')} />
        </>
      }
      rowKey={(r) => r.key}
      emptyMessage="No cash activity or settlements in this period."
      columns={[
        { header: 'User', cell: (r) => r.user },
        { header: 'Portal', cell: (r) => r.portal },
        money('Opening / Petty Cash', (r) => r.opening + r.pettyCash),
        money('Net Cash Collections', (r) => r.cashCollections),
        money('Expenses / Refunds', (r) => r.expenses + r.refunds),
        money('Card / Bank / Online', (r) => r.nonCash),
        money('Expected Cash', (r) => r.expectedCash),
        money('Physical Submitted', (r) => r.submitted),
        money('Variance', (r) => r.variance),
        money('Accepted', (r) => r.accepted),
        money('Remaining', (r) => r.remaining),
        { header: 'Settlement Status', cell: (r) => labelOf(SETTLEMENT_STATUS, r.settlementStatus) },
      ]}
    />
  );
};

// ── #7 Staff / Payroll / Doctor Commission ────────────────────────────────

const currentMonth = () => new Date().toISOString().slice(0, 7);

/** "MONTHLY_COMMISSION — 60000" → "Monthly Commission — PKR 60,000". */
const formatSalaryBasis = (basis: string | null) => {
  if (!basis) return '—';
  const [kind = '', amount] = basis.split(' — ');
  const label = kind.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return amount ? `${label} — ${formatPKR(Number(amount))}` : label;
};

export const StaffPayrollCommissionReport: React.FC = () => {
  const [sourceRow, setSourceRow] = useState<StaffPayrollRow | null>(null);
  const options = useOptions();
  const { filters, bind, reset } = useReportFilters({ period: currentMonth(), departmentId: '', staffId: '', status: '' });
  return (
    <><GenericReportView<StaffPayrollRow>
      title="Staff / Payroll / Doctor Commission"
      subtitle="Approved attendance and separate salary/commission ledgers for this earning month. Payments and corrections include subsequent settlements; overlapping salary runs are shown in full."
      icon={Users}
      filenamePrefix="Staff_Payroll_Commission"
      compact
      noDateFilter
      fetchReport={() => fetchStaffPayrollCommission(filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <div className="w-44">
            <TextInput label="Payroll Period" type="month" {...bind('period')} />
          </div>
          <FilterSelect label="Department" options={options.departments} {...bind('departmentId')} />
          <FilterSelect label="Staff / Doctor" options={options.staff} {...bind('staffId')} />
          <FilterSelect label="Status" options={PAYROLL_STATUS} {...bind('status')} />
        </>
      }
      rowKey={(r) => r.staffId}
      noTotalColumns={['Attendance Days']}
      emptyMessage="No staff match these filters."
      renderCell={(col, row) => col.header === 'Source Records' ? <button className="text-[#08775A] underline" onClick={() => setSourceRow(row)}>View statements &amp; payments</button> : col.cell(row)}
      columns={[
        { header: 'Emp ID', cell: (r) => r.employeeId },
        { header: 'Staff / Doctor', cell: (r) => r.name },
        { header: 'Category', cell: (r) => r.category },
        { header: 'Department', cell: (r) => r.department || '—' },
        count('Attendance Days', (r) => r.attendanceDays),
        { header: 'Salary Basis', cell: (r) => formatSalaryBasis(r.salaryBasis) },
        money('Payroll Amount', (r) => r.payrollAmount),
        money('Salary Adjustments', (r) => r.salaryAdjustments),
        money('Salary Payable', (r) => r.salaryPayable),
        money('Salary Paid', (r) => r.salaryPaid),
        money('Salary Remaining', (r) => r.salaryRemaining),
        money('Salary Recoverable', (r) => r.salaryOverpaid),
        money('Doctor Commission', (r) => r.commissionAmount),
        money('Commission Reversed', (r) => r.commissionReversed),
        money('Commission Tax', (r) => r.commissionTax),
        money('Commission Adjustments', (r) => r.commissionAdjustments),
        money('Commission Generated', (r) => r.commissionPayable),
        money('Commission Paid', (r) => r.commissionPaid),
        money('Commission Outstanding', (r) => r.commissionRemaining),
        money('Commission Recoverable', (r) => r.commissionOverpaid),
        { header: 'Source Records', cell: (r) => `${r.salarySlipIds.length} salary slips / ${r.commissionAccrualIds.length} service commissions` },
        { header: 'Status', cell: (r) => labelOf(PAYROLL_STATUS, r.status) },
      ]}
    />{sourceRow && <StaffFinancialSources row={sourceRow} onClose={() => setSourceRow(null)} />}</>
  );
};

// ── #8 Inventory / Pharmacy Summary ───────────────────────────────────────

export const InventoryPharmacyReport: React.FC = () => {
  const options = useOptions();
  const { filters, bind, reset } = useReportFilters({ category: '', status: '' });
  return (
    <GenericReportView<SummaryRecord>
      title="Inventory / Pharmacy Summary"
      subtitle="Purchases, stock movement, low stock / expiry and Pharmacy request status. Detailed ledgers stay in their own modules."
      icon={Boxes}
      filenamePrefix="Inventory_Pharmacy_Summary"
      compact
      fetchReport={(range) => fetchInventoryPharmacy(range, filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <FilterSelect label="Category" options={options.stockCategories} {...bind('category')} />
          <FilterSelect label="Status" options={ALERT_STATUS} {...bind('status')} />
        </>
      }
      rowKey={(r) => r.key}
      noTotalColumns={['Value']}
      emptyMessage="Nothing needs attention for these filters."
      columns={SUMMARY_COLUMNS}
    />
  );
};

// ── #9 Pharmacy Inpatient Medicines Report ─────────────────────────────────

const PHARMACY_REQUEST_STATUS_OPTS = opts(
  ['REQUESTED', 'Requested'],
  ['ACCEPTED', 'Accepted'],
  ['PARTIALLY_FULFILLED', 'Partially Fulfilled'],
  ['DISPENSING', 'Dispensing'],
  ['DISPENSED', 'Dispensed'],
  ['INVOICED', 'Invoiced'],
  ['CLEARANCE_SENT', 'Clearance Sent'],
  ['REJECTED', 'Rejected'],
  ['AUTHORIZATION_REQUIRED', 'Authorization Required'],
  ['INTEGRATION_ERROR', 'Integration Error'],
);

const STATUS_BADGE_STYLE: Record<string, string> = {
  REQUESTED: 'bg-amber-50 text-amber-800 border-amber-200',
  ACCEPTED: 'bg-blue-50 text-blue-800 border-blue-200',
  PARTIALLY_FULFILLED: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  DISPENSING: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  DISPENSED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  INVOICED: 'bg-emerald-100 text-emerald-900 border-emerald-300 font-semibold',
  CLEARANCE_SENT: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-800 border-rose-200',
  AUTHORIZATION_REQUIRED: 'bg-purple-50 text-purple-800 border-purple-200',
  INTEGRATION_ERROR: 'bg-red-50 text-red-800 border-red-200',
};

export const PharmacyMedicinesReport: React.FC = () => {
  const { filters, bind, reset } = useReportFilters({
    admissionNumber: '',
    medicine: '',
    status: '',
    approvalStatus: '',
  });

  return (
    <GenericReportView<PharmacyRequestFulfillmentRow>
      title="Pharmacy Inpatient Medicines"
      subtitle="Comprehensive audit of all medicines ordered from Central Pharmacy for admitted patients: quantities requested vs dispensed, fulfillment status, and clearance invoices."
      icon={Pill}
      filenamePrefix="Pharmacy_Inpatient_Medicines"
      compact
      noTotalColumns={['Unit Price (PKR)']}
      fetchReport={(range) => fetchPharmacyRequestFulfillment(range, filters)}
      onResetExtraFilters={reset}
      extraFilters={
        <>
          <div className="w-36">
            <TextInput label="Admission #" placeholder="e.g. ADM-26-0001" {...bind('admissionNumber')} />
          </div>
          <div className="w-48">
            <TextInput label="Medicine" placeholder="Search medicine name…" {...bind('medicine')} />
          </div>
          <FilterSelect label="Request Status" options={PHARMACY_REQUEST_STATUS_OPTS} {...bind('status')} />
          <FilterSelect
            label="Approval / Clearance"
            options={opts(
              ['NOT_REQUIRED', 'Not Required'],
              ['PENDING', 'Pending'],
              ['AUTHORIZED', 'Approved'],
              ['REJECTED', 'Rejected'],
            )}
            {...bind('approvalStatus')}
          />
        </>
      }
      rowKey={(r, i) => `${r.requestRef}-${r.medicine}-${i}`}
      emptyMessage="No medicine requisitions found for the selected period and filters."
      renderCell={(col, row) => {
        const value = col.cell(row);
        if (col.header === 'Medicine') return <span className="font-bold flex items-center gap-1.5"><Pill className="h-3.5 w-3.5 text-emerald-600" />{value}</span>;
        if (col.header === 'Status') return <span className={`inline-block px-2 py-0.5 text-[11px] font-semibold border rounded-md capitalize ${STATUS_BADGE_STYLE[row.requestStatus] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>{value}</span>;
        if (col.header === 'Clearance') return <span className={`inline-block px-2 py-0.5 text-[10.5px] font-bold rounded ${row.pharmacyClearance === 'CLEARED' ? 'bg-emerald-50 text-emerald-700' : row.pharmacyClearance === 'OUTSTANDING' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{value}</span>;
        return value;
      }}
      columns={[
        { header: 'Request #', cell: (r) => r.requestRef },
        { header: 'Requested At', cell: (r) => r.requestedAt },
        { header: 'Admission #', cell: (r) => r.admissionNumber },
        { header: 'Patient', cell: (r) => r.patient },
        { header: 'Medicine', cell: (r) => r.medicine },
        count('Req Qty', (r) => r.requestedQty),
        count('Disp Qty', (r) => r.dispensedQty),
        money('Unit Price', (r) => r.unitPrice),
        money('Total Amount', (r) => r.totalAmount),
        { header: 'Status', cell: (r) => r.requestStatus.replace(/_/g, ' ').toLowerCase() },
        { header: 'Pharmacy Invoice', cell: (r) => r.pharmacyInvoice || '—' },
        { header: 'Clearance', cell: (r) => r.pharmacyClearance },
        { header: 'Instructions / Notes', cell: (r) => r.notes || '—' },
      ]}
    />
  );
};

/** Menu id → screen. Keys must match the `hm_reports` nav group in `constants/portalNavigations.ts`. */
export const MANAGEMENT_REPORT_VIEWS: Record<string, React.FC> = {
  sa_management_summary: ManagementSummaryReport,
  sa_billing_collection: BillingCollectionReport,
  sa_outstanding_panel: OutstandingPanelReport,
  sa_admission_bed: AdmissionBedReport,
  sa_expense: ExpenseReport,
  sa_balance_settlements: BalanceSettlementsReport,
  sa_staff_payroll_commission: StaffPayrollCommissionReport,
  sa_pharmacy_medicines: PharmacyMedicinesReport,
  sa_inventory_pharmacy: InventoryPharmacyReport,
};
