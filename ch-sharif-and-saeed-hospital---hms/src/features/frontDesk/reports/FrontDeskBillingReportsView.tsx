import React, { useEffect, useState, useMemo } from 'react';
import { Loader2, AlertCircle, BarChart2, Filter as FilterIcon, RotateCcw } from 'lucide-react';
import { formatPKR } from '../../../utils/formatters';
import {
  fetchFrontDeskBillingReport,
  FrontDeskBillingReport,
  DatePreset,
} from '../../../services/frontdeskBillingReportService';
import { fetchFrontDeskFilterOptions, FilterOption } from '../../../services/frontdeskReportsService';
import { formatDateISO, getHospitalCurrentDate } from '../../../utils/dateConstants';
import { useAuth } from '../../../context/AuthContext';
import {
  downloadTablePDF,
  downloadTableExcel,
  downloadTableCSV,
  printTable,
  ExportColumn,
} from '../../../services/tableExportService';
import { ExportButtonGroup } from '../../superAdmin/financeControl/ExportButtonGroup';
import { Select, TextInput } from '../../../components/forms/FormControls';
import { FilterSelect } from '../../../components/reports/reportFilters';

const PRESET_OPTIONS: { label: string; value: DatePreset }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This Week', value: 'this_week' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Custom Range', value: 'custom' },
];

interface ExportRow {
  category: string;
  metric: string;
  detail: string;
  amountOrCount: string;
}

const EXPORT_COLUMNS: ExportColumn<ExportRow>[] = [
  { header: 'Category', cell: (r) => r.category },
  { header: 'Metric / Channel', cell: (r) => r.metric },
  { header: 'Details / Type', cell: (r) => r.detail },
  { header: 'Value / Amount', align: 'right', cell: (r) => r.amountOrCount },
];

const STATUS_LABEL: Record<string, string> = {
  PAID: 'Paid in Full',
  PARTIALLY_PAID: 'Partially Paid',
  UNPAID: 'Unpaid',
  VOID: 'Void',
  CANCELLED: 'Cancelled',
};

const STATUS_TONE: Record<string, string> = {
  PAID: 'text-emerald-700',
  PARTIALLY_PAID: 'text-amber-700',
  UNPAID: 'text-rose-700',
};

const METHOD_ROWS: { method: 'CASH' | 'CARD' | 'BANK' | 'ONLINE'; label: string; type: string }[] = [
  { method: 'CASH', label: 'Cash', type: 'Counter cash' },
  { method: 'CARD', label: 'Credit / Debit Card', type: 'POS machine' },
  { method: 'BANK', label: 'Bank Transfer', type: 'Hospital bank account' },
  { method: 'ONLINE', label: 'Online / Gateway', type: 'Mobile wallet / gateway' },
];

// Same bordered-grid look as GenericReportView (Encounter Register etc.), one size larger.
const TH = 'py-3 px-4 border-r border-slate-300 last:border-r-0 whitespace-nowrap';
const TD = 'py-3 px-4 border-r border-slate-200 last:border-r-0 whitespace-nowrap text-slate-800';
const TD_NUM = 'py-3 px-3 text-center border-r border-slate-200 text-slate-500 tabular-nums text-xs bg-slate-50/60 w-14';

/** One bordered report table with a section title bar above it. */
const ReportTable: React.FC<{ title: string; note?: string; head: React.ReactNode; foot?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  note,
  head,
  foot,
  children,
}) => (
  <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden">
    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-300 flex items-center justify-between gap-2">
      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{title}</h2>
      {note && <span className="text-xs text-slate-500">{note}</span>}
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="bg-[#f1f5f9] border-b border-slate-300 text-slate-800 text-xs font-bold uppercase tracking-wider">
            <th className={`${TH} w-14 text-center`}>#</th>
            {head}
          </tr>
        </thead>
        <tbody className="text-slate-700">{children}</tbody>
        {foot && (
          <tfoot>
            <tr className="bg-[#f1f5f9] border-t-2 border-slate-300 font-bold text-slate-900">{foot}</tr>
          </tfoot>
        )}
      </table>
    </div>
  </div>
);

const ROW = 'hover:bg-slate-50/90 transition-colors border-b border-slate-200 last:border-b-0';

/**
 * Front Desk / Billing Summary — same theme as the other Front Desk reports
 * (filter bar → banner → export toolbar → bordered tables), with the figures
 * shown as three full-width tables instead of KPI cards.
 */
export const FrontDeskBillingReportsView: React.FC = () => {
  const { currentUser } = useAuth();
  const todayISO = formatDateISO(getHospitalCurrentDate());

  const [preset, setPreset] = useState<DatePreset>('today');
  const [fromDate, setFromDate] = useState(todayISO);
  const [toDate, setToDate] = useState(todayISO);
  const [report, setReport] = useState<FrontDeskBillingReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cashierId, setCashierId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [cashierOptions, setCashierOptions] = useState<FilterOption[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<FilterOption[]>([]);

  useEffect(() => {
    fetchFrontDeskFilterOptions()
      .then((o) => {
        setCashierOptions(o.cashiers);
        setDepartmentOptions(o.departments);
      })
      .catch(() => {
        // Dropdowns stay at "All" — the summary still loads.
      });
  }, []);

  // Closes over the current filter values at click time — Filter re-queries, like GenericReportView.
  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetchFrontDeskBillingReport({
        preset,
        fromDate: preset === 'custom' ? fromDate : undefined,
        toDate: preset === 'custom' ? toDate : undefined,
        cashierId: cashierId || undefined,
        departmentId: departmentId || undefined,
      });
      setReport(data);
    } catch (err: any) {
      setLoadError(err?.response?.data?.error?.message || err?.message || 'Failed to load report.');
    } finally {
      setIsLoading(false);
    }
  };

  // Bumped on mount and by Reset so the fetch runs after the cleared filters are committed.
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  const handleReset = () => {
    setPreset('today');
    setFromDate(todayISO);
    setToDate(todayISO);
    setCashierId('');
    setDepartmentId('');
    setReloadTick((n) => n + 1);
  };

  // Derived financial metrics
  const totalCollections = report?.collections.total ?? 0;
  const totalGross = report?.billing.totalGross ?? 0;
  const totalDiscounts = report?.billing.totalDiscounts ?? 0;
  const totalNet = report?.billing.totalNet ?? 0;
  const totalOutstanding = report?.billing.totalOutstanding ?? 0;
  const totalRefunds = report?.refunds.total ?? 0;
  const totalInvoices = report?.billing.invoiceCount ?? 0;
  const netIntake = totalCollections - totalRefunds;

  const discountRate = totalGross > 0 ? ((totalDiscounts / totalGross) * 100).toFixed(1) : '0.0';
  const collectionRate = totalNet > 0 ? Math.min(100, Math.round((totalCollections / totalNet) * 100)) : 0;

  // Flattened export rows for Excel / CSV / PDF
  const exportRows: ExportRow[] = useMemo(() => {
    if (!report) return [];
    const rows: ExportRow[] = [
      { category: 'Financial Summary', metric: 'Gross Billed', detail: 'Gross charges before discount', amountOrCount: formatPKR(totalGross) },
      { category: 'Financial Summary', metric: 'Total Discounts', detail: `${discountRate}% concession rate`, amountOrCount: formatPKR(totalDiscounts) },
      { category: 'Financial Summary', metric: 'Net Billed', detail: 'Gross billed minus discounts', amountOrCount: formatPKR(totalNet) },
      { category: 'Financial Summary', metric: 'Realized Collections', detail: 'Total payments collected', amountOrCount: formatPKR(totalCollections) },
      { category: 'Financial Summary', metric: 'Total Refunds', detail: 'Refunds and reversals', amountOrCount: formatPKR(totalRefunds) },
      { category: 'Financial Summary', metric: 'Net Hospital Intake', detail: 'Collections minus refunds', amountOrCount: formatPKR(netIntake) },
      { category: 'Financial Summary', metric: 'Outstanding Receivables', detail: 'Unpaid / partially paid balances', amountOrCount: formatPKR(totalOutstanding) },
      { category: 'Payment Methods', metric: 'Cash Collections', detail: 'Physical counter cash', amountOrCount: formatPKR(report.collections.byMethod.CASH) },
      { category: 'Payment Methods', metric: 'Debit / Credit Card', detail: 'POS machine receipts', amountOrCount: formatPKR(report.collections.byMethod.CARD) },
      { category: 'Payment Methods', metric: 'Direct Bank Transfer', detail: 'Hospital bank accounts', amountOrCount: formatPKR(report.collections.byMethod.BANK) },
      { category: 'Payment Methods', metric: 'Online / Gateway', detail: 'Mobile wallet & gateway', amountOrCount: formatPKR(report.collections.byMethod.ONLINE) },
    ];

    Object.entries(report.billing.invoiceCountsByStatus).forEach(([status, count]) => {
      rows.push({
        category: 'Invoice Status',
        metric: status,
        detail: 'Invoice count distribution',
        amountOrCount: `${count} invoices`,
      });
    });

    return rows;
  }, [report, totalGross, totalDiscounts, totalNet, totalCollections, totalRefunds, netIntake, totalOutstanding, discountRate]);

  const exportContext = {
    documentTitle: 'Daily Billing Summary',
    documentSubtitle: `Hospital Billing & Collections Overview — ${report?.period.label || 'Selected Period'}`,
    filenamePrefix: 'Billing_Summary_Report',
    columns: EXPORT_COLUMNS,
    rows: exportRows,
    currentUser,
    periodLabel: report?.period.label,
    filters: [
      `Period: ${report?.period.label || preset}`,
      `Cashier: ${cashierOptions.find((o) => o.value === cashierId)?.label || 'All'}`,
      `Department: ${departmentOptions.find((o) => o.value === departmentId)?.label || 'All'}`,
      `Total Collections: ${formatPKR(totalCollections)}`,
      `Net Billed: ${formatPKR(totalNet)}`,
      `Outstanding: ${formatPKR(totalOutstanding)}`,
    ],
  };

  const summaryRows: { label: string; detail: string; amount: number; tone?: string; strong?: boolean }[] = [
    { label: 'Gross Billed', detail: 'Total patient charges before discount', amount: totalGross },
    { label: 'Discounts', detail: `${discountRate}% of gross billed`, amount: -totalDiscounts, tone: 'text-amber-700' },
    { label: 'Net Billed', detail: 'Gross billed minus discounts', amount: totalNet, strong: true },
    { label: 'Collections', detail: `${collectionRate}% of net billed collected`, amount: totalCollections, tone: 'text-emerald-700' },
    { label: 'Refunds', detail: 'Refunds and reversals', amount: -totalRefunds, tone: 'text-rose-700' },
    { label: 'Net Intake', detail: 'Collections minus refunds', amount: netIntake, strong: true },
    { label: 'Outstanding', detail: 'Unpaid and partially paid balances', amount: totalOutstanding, tone: 'text-rose-700' },
  ];

  const statusEntries = report ? Object.entries(report.billing.invoiceCountsByStatus) : [];

  return (
    <div className="space-y-4 animate-in fade-in duration-150 font-montserrat">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Daily Billing Summary</h1>
        <p className="text-xs text-slate-500 mt-0.5">Billing, collections, discounts, refunds and invoice status for the selected period.</p>
      </div>

      {/* Filter Bar — change filters, then press Filter to re-query */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-end gap-3 flex-wrap">
        <div className="w-44">
          <Select label="Period" options={PRESET_OPTIONS} value={preset} onChange={(e) => setPreset(e.target.value as DatePreset)} />
        </div>
        {preset === 'custom' && (
          <>
            <TextInput label="From" lang="en-GB" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <TextInput label="To" lang="en-GB" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </>
        )}
        <FilterSelect label="Cashier" options={cashierOptions} value={cashierId} onChange={(e) => setCashierId(e.target.value)} />
        <FilterSelect label="Department" options={departmentOptions} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} />
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={load}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-60"
          >
            <FilterIcon className="h-3.5 w-3.5" />
            Filter
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-medium transition-colors disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 flex flex-col items-center gap-2 text-center shadow-xs">
          <AlertCircle className="h-6 w-6 text-rose-500" />
          <p className="text-xs text-rose-700 font-medium">{loadError}</p>
          <button type="button" onClick={load} className="mt-1 text-xs font-semibold text-[#08775A] hover:underline">
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 flex items-center justify-center gap-2 text-slate-400 shadow-xs">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Loading report…</span>
        </div>
      ) : report ? (
        <>
          {/* Theme banner */}
          <div className="bg-gradient-to-r from-[#0a4636] to-[#08775A] text-white px-4 py-2.5 rounded-lg flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2.5 font-bold text-sm tracking-wide text-white">
              <div className="h-6 w-6 rounded bg-white/15 text-white flex items-center justify-center">
                <BarChart2 className="h-3.5 w-3.5" />
              </div>
              <span>Daily Billing Summary</span>
            </div>
            <span className="text-xs text-emerald-100 font-medium bg-white/10 px-2.5 py-0.5 rounded-md">{report.period.label}</span>
          </div>

          {/* Export toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap -mt-1">
            <span className="text-xs text-slate-500">
              {totalInvoices} invoice{totalInvoices === 1 ? '' : 's'} in this period
            </span>
            <ExportButtonGroup
              disabled={exportRows.length === 0}
              onExcel={() => downloadTableExcel(exportContext)}
              onCsv={() => downloadTableCSV(exportContext)}
              onPdf={() => downloadTablePDF(exportContext)}
              onPrint={() => printTable(exportContext)}
            />
          </div>

          {/* 1. Financial summary */}
          <ReportTable
            title="Financial Summary"
            note={report.period.label}
            head={
              <>
                <th className={TH}>Particular</th>
                <th className={TH}>Description</th>
                <th className={`${TH} text-right`}>Amount (PKR)</th>
              </>
            }
          >
            {summaryRows.map((row, i) => (
              <tr key={row.label} className={`${ROW} ${row.strong ? 'bg-slate-50 font-bold text-slate-900' : ''}`}>
                <td className={TD_NUM}>{i + 1}</td>
                <td className={`${TD} font-semibold`}>{row.label}</td>
                <td className={`${TD} text-slate-500 font-normal w-full`}>{row.detail}</td>
                <td className={`${TD} text-right tabular-nums font-bold text-[15px] ${row.tone ?? 'text-slate-900'}`}>
                  {row.amount < 0 ? `(${formatPKR(-row.amount)})` : formatPKR(row.amount)}
                </td>
              </tr>
            ))}
          </ReportTable>

          {/* 2. Collections by payment method */}
          <ReportTable
            title="Collections by Payment Method"
            note={`${collectionRate}% of net billed collected`}
            head={
              <>
                <th className={TH}>Payment Method</th>
                <th className={TH}>Type</th>
                <th className={`${TH} text-right`}>Share %</th>
                <th className={`${TH} text-right`}>Amount (PKR)</th>
              </>
            }
            foot={
              <>
                <td className="py-3 px-3 text-center border-r border-slate-300 text-[11px] uppercase tracking-wider text-slate-600">Total</td>
                <td className={TD} />
                <td className={TD} />
                <td className={`${TD} text-right tabular-nums`}>{totalCollections > 0 ? '100%' : '—'}</td>
                <td className={`${TD} text-right tabular-nums text-[15px] text-emerald-700`}>{formatPKR(totalCollections)}</td>
              </>
            }
          >
            {METHOD_ROWS.map(({ method, label, type }, i) => {
              const amount = report.collections.byMethod[method] ?? 0;
              const share = totalCollections > 0 ? ((amount / totalCollections) * 100).toFixed(1) : '0.0';
              return (
                <tr key={method} className={ROW}>
                  <td className={TD_NUM}>{i + 1}</td>
                  <td className={`${TD} font-semibold text-slate-900`}>{label}</td>
                  <td className={`${TD} text-slate-500 w-full`}>{type}</td>
                  <td className={`${TD} text-right tabular-nums text-slate-500`}>{share}%</td>
                  <td className={`${TD} text-right tabular-nums font-bold text-[15px] text-slate-900`}>{formatPKR(amount)}</td>
                </tr>
              );
            })}
          </ReportTable>

          {/* 3. Invoices by status */}
          <ReportTable
            title="Invoices by Status"
            note={`${totalInvoices} total`}
            head={
              <>
                <th className={TH}>Status</th>
                <th className={TH}>Code</th>
                <th className={`${TH} text-right`}>Share %</th>
                <th className={`${TH} text-right`}>Invoices</th>
              </>
            }
            foot={
              statusEntries.length > 0 ? (
                <>
                  <td className="py-3 px-3 text-center border-r border-slate-300 text-[11px] uppercase tracking-wider text-slate-600">Total</td>
                  <td className={TD} />
                  <td className={TD} />
                  <td className={`${TD} text-right tabular-nums`}>100%</td>
                  <td className={`${TD} text-right tabular-nums`}>{totalInvoices}</td>
                </>
              ) : undefined
            }
          >
            {statusEntries.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-slate-400">
                  No invoices in this period.
                </td>
              </tr>
            ) : (
              statusEntries.map(([status, count], i) => {
                const share = totalInvoices > 0 ? ((count / totalInvoices) * 100).toFixed(1) : '0.0';
                return (
                  <tr key={status} className={ROW}>
                    <td className={TD_NUM}>{i + 1}</td>
                    <td className={`${TD} font-semibold ${STATUS_TONE[status] ?? 'text-slate-700'}`}>{STATUS_LABEL[status] ?? status}</td>
                    <td className={`${TD} tabular-nums text-xs text-slate-500 w-full`}>{status}</td>
                    <td className={`${TD} text-right tabular-nums text-slate-500`}>{share}%</td>
                    <td className={`${TD} text-right tabular-nums font-bold text-[15px] text-slate-900`}>{count}</td>
                  </tr>
                );
              })
            )}
          </ReportTable>
        </>
      ) : null}
    </div>
  );
};
