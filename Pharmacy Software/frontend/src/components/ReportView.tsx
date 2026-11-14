import React, { useEffect, useRef, useState } from 'react';
import { Loader2, FileBarChart, Filter, RotateCcw, FileSpreadsheet, Download, FileText, Printer } from 'lucide-react';
import apiClient from '../services/apiClient';
import { formatPKR, formatNumber } from '../utils/format';

export type ReportType =
  | 'SALES_COLLECTION'
  | 'HMS_DISPENSE'
  | 'PURCHASE'
  | 'STOCK_MOVEMENT'
  | 'VENDOR_LEDGER'
  | 'EXPENSE'
  | 'RETURN_REFUND'
  | 'BALANCE_SETTLEMENT';

interface ReportColumn {
  key: string;
  label: string;
  align?: 'right';
  money?: boolean;
  date?: boolean;
  datetime?: boolean;
}

export const REPORT_COLUMNS: Record<ReportType, ReportColumn[]> = {
  SALES_COLLECTION: [
    { key: 'invoiceNumber', label: 'Invoice #' },
    { key: 'channel', label: 'Channel' },
    { key: 'customerName', label: 'Customer / Patient' },
    { key: 'grossSales', label: 'Gross Sales', align: 'right', money: true },
    { key: 'netBilling', label: 'Net Billing (ex tax)', align: 'right', money: true },
    { key: 'taxBilled', label: 'Tax Liability', align: 'right', money: true },
    { key: 'collections', label: 'Collections (payment date)', align: 'right', money: true },
    { key: 'outstanding', label: 'Outstanding', align: 'right', money: true },
    { key: 'recognizedRevenue', label: 'Recognized Revenue', align: 'right', money: true },
    { key: 'recognizedCogs', label: 'Recognized COGS', align: 'right', money: true },
    { key: 'grossProfit', label: 'Gross Profit / Loss', align: 'right', money: true },
    { key: 'recognitionIssues', label: 'History Exceptions' },
    { key: 'status', label: 'Status' },
    { key: 'soldBy', label: 'Sold By' },
    { key: 'collectedBy', label: 'Collected By' },
    { key: 'createdAt', label: 'Date & Time', datetime: true },
  ],
  HMS_DISPENSE: [
    { key: 'requestNumber', label: 'Request #' },
    { key: 'admissionRef', label: 'Admission Ref' },
    { key: 'patientName', label: 'Patient Name' },
    { key: 'medicines', label: 'Medicines' },
    { key: 'status', label: 'Status' },
    { key: 'requestedByExternal', label: 'Requested By' },
    { key: 'dispensedBy', label: 'Dispensed By' },
    { key: 'invoiceNumber', label: 'Invoice #' },
    { key: 'outstanding', label: 'Outstanding', align: 'right', money: true },
    { key: 'clearanceStatus', label: 'Clearance' },
    { key: 'requestedAt', label: 'Request Date', datetime: true },
  ],
  PURCHASE: [
    { key: 'purchaseNumber', label: 'GRN Number' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'purchaseDate', label: 'Date', date: true },
    { key: 'paymentType', label: 'Payment' },
    { key: 'total', label: 'Total Value', align: 'right', money: true },
    { key: 'paidNow', label: 'Paid Now', align: 'right', money: true },
    { key: 'vendorDue', label: 'Vendor Due', align: 'right', money: true },
    { key: 'enteredBy', label: 'Received By' },
    { key: 'createdAt', label: 'Created At', datetime: true },
  ],
  STOCK_MOVEMENT: [
    { key: 'movementType', label: 'Movement Type' },
    { key: 'itemCode', label: 'Item Code' },
    { key: 'medicine', label: 'Medicine' },
    { key: 'batchNumber', label: 'Batch No' },
    { key: 'quantityDelta', label: 'Quantity Delta', align: 'right' },
    { key: 'unitCost', label: 'Unit Cost', align: 'right', money: true },
    { key: 'lineValuation', label: 'Valuation', align: 'right', money: true },
    { key: 'reference', label: 'Reference Ref' },
    { key: 'actor', label: 'Logged By' },
    { key: 'createdAt', label: 'Date & Time', datetime: true },
  ],
  VENDOR_LEDGER: [
    { key: 'vendor', label: 'Vendor' },
    { key: 'entryType', label: 'Entry Type' },
    { key: 'amount', label: 'Amount', align: 'right', money: true },
    { key: 'referenceId', label: 'Reference' },
    { key: 'enteredBy', label: 'Entered By' },
    { key: 'occurredAt', label: 'Date & Time', datetime: true },
  ],
  EXPENSE: [
    { key: 'date', label: 'Expense Date', date: true },
    { key: 'category', label: 'Category' },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', align: 'right', money: true },
    { key: 'paymentMethod', label: 'Payment Method' },
    { key: 'payeeOrVendor', label: 'Payee / Vendor' },
    { key: 'enteredBy', label: 'Entered By' },
    { key: 'approvedBy', label: 'Approved By' },
  ],
  RETURN_REFUND: [
    { key: 'type', label: 'Return Type' },
    { key: 'returnNumber', label: 'Return #' },
    { key: 'originalRef', label: 'Original Ref' },
    { key: 'party', label: 'Customer / Vendor' },
    { key: 'refundAmount', label: 'Refund Amount', align: 'right', money: true },
    { key: 'reason', label: 'Reason' },
    { key: 'processedBy', label: 'Processed By' },
    { key: 'createdAt', label: 'Date & Time', datetime: true },
  ],
  BALANCE_SETTLEMENT: [
    { key: 'submittedBy', label: 'Cashier' },
    { key: 'periodFrom', label: 'From Date', date: true },
    { key: 'periodTo', label: 'To Date', date: true },
    { key: 'expectedCash', label: 'Expected Cash', align: 'right', money: true },
    { key: 'physicalCash', label: 'Physical Cash', align: 'right', money: true },
    { key: 'variance', label: 'Variance', align: 'right', money: true },
    { key: 'varianceReason', label: 'Variance Reason' },
    { key: 'status', label: 'Status' },
    { key: 'reviewedBy', label: 'Reviewed By' },
    { key: 'submittedAt', label: 'Submitted At', datetime: true },
  ],
};

function fmtCell(val: any, col: ReportColumn): string {
  if (val == null || val === '') return '—';
  if (col.money) return formatPKR(val);
  if (col.date) {
    try {
      return new Date(val).toLocaleDateString('en-GB');
    } catch {
      return String(val);
    }
  }
  if (col.datetime) {
    try {
      return new Date(val).toLocaleString('en-GB');
    } catch {
      return String(val);
    }
  }
  return String(val);
}

interface Props {
  type: ReportType;
  title: string;
  subtitle: string;
  onNavigate?: (pageId: string) => void;
  currentPage?: string;
}

export const ALL_REPORTS_LIST = [
  { page: 'reports-sales', type: 'SALES_COLLECTION' as ReportType, label: 'Sales & Collection' },
  { page: 'reports-hms', type: 'HMS_DISPENSE' as ReportType, label: 'HMS Dispense' },
  { page: 'reports-purchase', type: 'PURCHASE' as ReportType, label: 'Purchase Inward' },
  { page: 'reports-stock-movement', type: 'STOCK_MOVEMENT' as ReportType, label: 'Stock Movement Audit' },
  { page: 'reports-vendor-ledger', type: 'VENDOR_LEDGER' as ReportType, label: 'Vendor Payables' },
  { page: 'reports-expense', type: 'EXPENSE' as ReportType, label: 'Operating Expenses' },
  { page: 'reports-returns', type: 'RETURN_REFUND' as ReportType, label: 'Returns & Refunds' },
  { page: 'reports-settlement', type: 'BALANCE_SETTLEMENT' as ReportType, label: 'Drawer Settlement' },
];

/**
 * Report table + date filter + export (Excel/CSV/Print) for ONE report type —
 * each report now lives on its own page/URL rather than behind a type dropdown
 * on a single shared screen. Column definitions and rendering are unchanged
 * from the original single-page ReportsPage, just parameterized by `type`
 * instead of switched via local state.
 */
export const ReportView: React.FC<Props> = ({ type, title, subtitle, onNavigate, currentPage }) => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<Record<string, number | null> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);

  const syncTopToBottom = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (topScrollRef.current && bottomScrollRef.current) {
      bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  };

  const syncBottomToTop = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (topScrollRef.current && bottomScrollRef.current) {
      topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  };

  const load = () => {
    setLoading(true);
    setError(null);
    apiClient
      .get('/reports', { params: { type, from: from || undefined, to: to || undefined } })
      .then((r) => {
        setRows(r.data.data.rows || []);
        setTotals(r.data.data.totals || null);
      })
      .catch(() => setError('Failed to load report data.'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [type]);

  const columns = REPORT_COLUMNS[type];

  const handleExportCsv = () => {
    if (rows.length === 0) return;
    const headerRow = columns.map((c) => `"${c.label}"`).join(',');
    const dataRows = rows.map((r) => columns.map((c) => `"${fmtCell(r[c.key], c).replace(/"/g, '""')}"`).join(','));
    const summaryRows = type === 'SALES_COLLECTION' && totals ? Object.entries(totals).map(([key,value]) => `"Summary: ${key}","${value ?? 'Unavailable'}"`) : [];
    const csvContent = [headerRow, ...dataRows, ...summaryRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${type.toLowerCase()}_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportExcel = () => {
    if (rows.length === 0) return;
    const headerHtml = columns.map((c) => `<th>${c.label}</th>`).join('');
    const rowsHtml = rows
      .map(
        (r) => `
        <tr>
          ${columns.map((c) => `<td>${fmtCell(r[c.key], c)}</td>`).join('')}
        </tr>
      `
      )
      .join('');

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"/></head>
      <body>
        <h2>${title} Report</h2>
        <table border="1">
          <tr style="background:#0e5944;color:#ffffff;font-weight:bold;">${headerHtml}</tr>
          ${rowsHtml}
        </table>
        ${type === 'SALES_COLLECTION' && totals ? `<table>${Object.entries(totals).map(([key,value])=>`<tr><td>${key}</td><td>${value ?? 'Unavailable'}</td></tr>`).join('')}</table>` : ''}
      </body>
      </html>
    `;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${type.toLowerCase()}_report_${new Date().toISOString().slice(0, 10)}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-[1700px] mx-auto">
      {/* Report Switcher Tabs */}
      {onNavigate && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-200/80 -mt-1">
          {ALL_REPORTS_LIST.map((tab) => {
            const isActive = (currentPage === tab.page) || (type === tab.type);
            return (
              <button
                key={tab.page}
                type="button"
                onClick={() => onNavigate(tab.page)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#0e7d5a] text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80">
            Report
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
      </div>

      {type === 'SALES_COLLECTION' && totals && <div className="p-3 bg-emerald-50 rounded-lg text-sm">
        <p>Recognized Revenue: {formatPKR(totals.recognizedRevenue ?? 0)} | COGS: {formatPKR(totals.recognizedCogs ?? 0)} | Operating Expenses: {formatPKR(totals.operatingExpenses ?? 0)} | Operating Profit / Loss: {totals.operatingProfit == null ? 'Unavailable: incomplete history' : formatPKR(totals.operatingProfit)}</p>
        <p>Revenue is recognized only on full payment. Collections follow payment dates; outstanding includes earlier invoices. Tax and stock purchases are excluded from revenue/profit.</p>
        {!!totals.incompleteInvoices && <p role="alert">{totals.incompleteInvoices} invoices need dated collection/return or historical cost evidence. Revenue includes verified amounts only.</p>}
      </div>}
      {/* Filter Toolbar — date range only; the report type is this page's identity, not a dropdown anymore */}
      <div className="bg-white p-3 rounded-xl border border-slate-300/80 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          <div className="w-36">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full h-8.5 px-2.5 text-xs bg-slate-50 hover:bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
            />
          </div>
          <div className="w-36">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full h-8.5 px-2.5 text-xs bg-slate-50 hover:bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0e7d5a]"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={load}
              className="px-3.5 py-1.5 bg-[#0e7d5a] hover:bg-[#0c6b50] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer whitespace-nowrap"
            >
              <Filter className="h-3.5 w-3.5" /> Filter
            </button>
            <button
              type="button"
              onClick={() => {
                setFrom('');
                setTo('');
                load();
              }}
              className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
              title="Reset Date Range"
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-500" /> Reset
            </button>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
          <FileBarChart className="h-3.5 w-3.5 text-emerald-600" />
          <span>
            <strong className="text-slate-800">{rows.length}</strong> records generated
          </span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-emerald-300" />
            <span className="font-bold text-xs sm:text-sm tracking-tight text-white whitespace-nowrap">{title} Statement</span>
            <span className="text-[10px] font-semibold bg-emerald-700/60 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-500/30 whitespace-nowrap">
              Formal Statement
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
              title="Download Excel Worksheet"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
              title="Download CSV"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#dc2626] hover:bg-[#b91c1c] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
              title="Export as PDF via Print"
            >
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
              title="Print Table"
            >
              <Printer className="h-3.5 w-3.5" /> Print
            </button>
          </div>
        </div>

        <div ref={topScrollRef} onScroll={syncTopToBottom} className="overflow-x-auto overflow-y-hidden h-2 bg-slate-100 border-b border-slate-200 scrollbar-thin">
          <div style={{ width: '1400px', height: '1px' }} />
        </div>

        <div ref={bottomScrollRef} onScroll={syncBottomToTop} className="overflow-x-auto max-h-[calc(100vh-380px)] scrollbar-thin">
          <table className="w-full min-w-[1400px] border-collapse text-left text-xs">
            <thead className="bg-[#f8fafc] text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200 uppercase tracking-wider select-none text-xs">
              <tr>
                <th className="py-3 px-3.5 text-center border-r border-slate-200 w-14 whitespace-nowrap">#</th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`py-3 px-4 border-r border-slate-200 last:border-r-0 whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={columns.length + 1} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-[#0e7d5a]" />
                      <span className="text-xs">Generating report data…</span>
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={columns.length + 1} className="py-12 text-center text-rose-600 font-semibold text-xs">
                    {error}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} className="py-12 text-center text-slate-400 text-xs">
                    No records found for the selected report filters.
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-3.5 text-center border-r border-slate-100 text-slate-500 font-semibold text-xs whitespace-nowrap">{i + 1}</td>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`py-3.5 px-4 border-r border-slate-100 last:border-r-0 whitespace-nowrap text-xs ${col.align === 'right' ? 'text-right font-bold text-slate-900' : 'text-slate-900'}`}
                      >
                        {col.key === 'quantityDelta' ? (
                          <span className={`font-bold ${Number(row[col.key]) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {Number(row[col.key]) >= 0 ? '+' : ''}
                            {formatNumber(row[col.key])}
                          </span>
                        ) : (
                          fmtCell(row[col.key], col)
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {totals && !loading && !error && rows.length > 0 && (
              <tfoot className="bg-[#f8fafc] font-bold border-t-2 border-b border-slate-300 text-slate-900 text-xs">
                <tr>
                  <td className="py-4 px-3.5 text-center border-r border-slate-200 whitespace-nowrap">
                    <span className="bg-slate-800 text-white text-[10.5px] font-black px-2.5 py-1 rounded tracking-wider uppercase inline-block">TOTAL</span>
                  </td>
                  {columns.map((col) => (
                    <td key={col.key} className={`py-4 px-4 border-r border-slate-200 last:border-r-0 whitespace-nowrap ${col.align === 'right' ? 'text-right font-bold text-slate-900' : ''}`}>
                      {totals[col.key] != null ? formatPKR(totals[col.key]) : '—'}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
