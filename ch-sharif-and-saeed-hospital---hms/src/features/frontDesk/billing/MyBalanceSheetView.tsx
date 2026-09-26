import React, { useState, useEffect, useMemo } from 'react';
import {
  Coins,
  Loader2,
  AlertTriangle,
  Banknote,
  CreditCard,
  RotateCcw,
  RefreshCw,
  ArrowRight,
  Wallet,
  ArrowUpRight,
  TrendingDown,
  Clock,
  CheckCircle2,
  Receipt,
  Printer,
} from 'lucide-react';
import { formatPKR, formatDateTimeDDMMYYYY } from '../../../utils/formatters';
import { formatDateISO, getHospitalCurrentDate } from '../../../utils/dateConstants';
import { frontdeskApiService } from '../../../services/frontdeskApiService';
import { useRouter } from '../../../context/RouterContext';
import { useAuth } from '../../../context/AuthContext';
import { printTable, downloadTablePDF, downloadTableExcel, downloadTableCSV, ExportColumn } from '../../../services/tableExportService';
import { ExportButtonGroup } from '../../superAdmin/financeControl/ExportButtonGroup';

interface BalanceSheetTransaction {
  id: string;
  direction: 'IN' | 'OUT';
  amount: number;
  category: string;
  isPhysicalCash: boolean;
  occurredAt: string;
  receiptNumber: string | null;
  invoiceNumber: string | null;
  paymentMethod: string;
}

interface BalanceSheetData {
  summary: {
    expectedPhysicalCash: number;
    /** Guide §5.1 — shortfall carried from the last settlement, already folded into `expectedPhysicalCash`. */
    carriedForwardAmount: number;
    physicalCashIn: number;
    physicalCashOut: number;
    nonPhysicalTotal: number;
    totalCollections: number;
    totalRefunds: number;
    unsettledCount: number;
    pettyCash: number;
    cashCollections: number;
    cashExpenses: number;
    cashRefunds: number;
    settledAmount: number;
    remainingAmount: number;
    settlementCount: number;
    physicalCashCounted: number;
    variance: number;
  };
  period: { mode: 'shift' | 'period'; label: string };
  transactions: BalanceSheetTransaction[];
}

/** reporting.md §2 #8 — Shift (live, settle-able custody) / Day / Custom period. */
type SheetPeriod = 'shift' | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';
const PERIOD_OPTIONS: { value: SheetPeriod; label: string }[] = [
  { value: 'shift', label: 'Current Shift' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'custom', label: 'Custom' },
];

const CATEGORY_LABEL: Record<string, string> = {
  COLLECTION: 'Collection',
  REFUND: 'Refund',
  EXPENSE: 'Expense',
  PURCHASE: 'Purchase',
  PETTY_CASH_ISSUE: 'Petty Cash',
  RECOVERY: 'Recovery',
};

const PRINT_COLUMNS: ExportColumn<BalanceSheetTransaction>[] = [
  { header: 'Receipt #', cell: (t) => t.receiptNumber || '—' },
  { header: 'Invoice Ref', cell: (t) => t.invoiceNumber || '—' },
  { header: 'Category', cell: (t) => CATEGORY_LABEL[t.category] || t.category },
  { header: 'Payment Method', cell: (t) => t.paymentMethod },
  { header: 'Amount', align: 'right', cell: (t) => `${t.direction === 'IN' ? '+' : '-'}${formatPKR(t.amount)}` },
  { header: 'Occurred At', align: 'right', cell: (t) => formatDateTimeDDMMYYYY(t.occurredAt) },
];

/**
 * "My Balance Sheet" (Guide §3) — the logged-in cashier's live, unsettled
 * custody position, backed by `GET /cash/balance-sheet`.
 */
export const MyBalanceSheetView: React.FC = () => {
  const { navigate } = useRouter();
  const { currentUser } = useAuth();
  const [data, setData] = useState<BalanceSheetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const todayISO = formatDateISO(getHospitalCurrentDate());
  const [period, setPeriod] = useState<SheetPeriod>('shift');
  const [fromDate, setFromDate] = useState(todayISO);
  const [toDate, setToDate] = useState(todayISO);

  const load = async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);
    try {
      const raw = await frontdeskApiService.getCashBalance(
        period === 'shift' ? undefined : { preset: period, ...(period === 'custom' ? { fromDate, toDate } : {}) },
      );
      const n = (v: unknown) => Number(v ?? 0);
      setData({
        period: raw.period ?? { mode: 'shift', label: 'Current Shift (unsettled)' },
        summary: {
          pettyCash: n(raw.summary?.pettyCash),
          cashCollections: n(raw.summary?.cashCollections),
          cashExpenses: n(raw.summary?.cashExpenses),
          cashRefunds: n(raw.summary?.cashRefunds),
          settledAmount: n(raw.summary?.settledAmount),
          remainingAmount: n(raw.summary?.remainingAmount),
          settlementCount: n(raw.summary?.settlementCount),
          physicalCashCounted: n(raw.summary?.physicalCashCounted),
          variance: n(raw.summary?.variance),
          expectedPhysicalCash: Number(raw.summary?.expectedPhysicalCash ?? 0),
          carriedForwardAmount: Number(raw.summary?.carriedForwardAmount ?? 0),
          physicalCashIn: Number(raw.summary?.physicalCashIn ?? 0),
          physicalCashOut: Number(raw.summary?.physicalCashOut ?? 0),
          nonPhysicalTotal: Number(raw.summary?.nonPhysicalTotal ?? 0),
          totalCollections: Number(raw.summary?.totalCollections ?? 0),
          totalRefunds: Number(raw.summary?.totalRefunds ?? 0),
          unsettledCount: Number(raw.summary?.unsettledCount ?? 0),
        },
        transactions: (raw.transactions || []).map((t: any) => ({
          id: t.id,
          direction: t.direction,
          amount: Number(t.amount ?? 0),
          category: t.category,
          isPhysicalCash: !!t.isPhysicalCash,
          occurredAt: t.occurredAt,
          receiptNumber: t.receiptNumber,
          invoiceNumber: t.invoiceNumber,
          paymentMethod: t.paymentMethod,
        })),
      });
    } catch (err: any) {
      setLoadError(err?.response?.data?.error?.message || err?.message || 'Failed to load your balance sheet.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Initial load shows the full-page spinner; changing the period afterwards
  // refreshes in place so the filter bar stays on screen.
  const [hasLoaded, setHasLoaded] = useState(false);
  useEffect(() => {
    if (period === 'custom' && (!fromDate || !toDate)) return;
    load(hasLoaded);
    setHasLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, fromDate, toDate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" /> <span>Loading your balance sheet…</span>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-rose-500" />
        <p className="text-sm text-rose-700 font-medium">{loadError}</p>
        <button
          onClick={() => load()}
          className="px-4 py-2 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-semibold rounded-lg cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const { summary, transactions } = data;
  const hasUnsettled = summary.unsettledCount > 0;
  const isShift = data.period.mode === 'shift';

  const inTransactions = transactions.filter((t) => t.direction === 'IN');
  const outTransactions = transactions.filter((t) => t.direction === 'OUT');

  const exportContext = {
    documentTitle: 'My Balance Sheet & Cash Custody',
    documentSubtitle: `Cash Custody — ${currentUser?.name || ''} (${currentUser?.role || ''})`,
    filenamePrefix: 'My_Balance_Sheet',
    columns: PRINT_COLUMNS,
    rows: transactions,
    currentUser,
    periodLabel: data.period.label,
    filters: [
      `Expected Physical Cash: ${formatPKR(summary.expectedPhysicalCash)}`,
      `Total Collections: ${formatPKR(summary.totalCollections)}`,
      `Total Refunds: ${formatPKR(summary.totalRefunds)}`,
    ],
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Header & Export Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">My Balance Sheet</h1>
          <p className="text-xs text-slate-500 mt-0.5">{data.period.label}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <ExportButtonGroup
            disabled={transactions.length === 0}
            onExcel={() => downloadTableExcel(exportContext)}
            onCsv={() => downloadTableCSV(exportContext)}
            onPdf={() => downloadTablePDF(exportContext)}
            onPrint={() => printTable(exportContext)}
          />
          <button
            type="button"
            onClick={() => load(true)}
            disabled={isRefreshing}
            className="h-7.5 px-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 shadow-xs"
            title="Refresh balance sheet"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          {!isShift ? null : hasUnsettled ? (
            <button
              type="button"
              onClick={() => navigate('/front-desk/my_account_settlement')}
              className="h-7.5 px-3.5 rounded-md bg-[#08775A] hover:bg-[#065f46] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <span>Settle Account</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="h-7.5 px-3 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>Settled</span>
            </span>
          )}
        </div>
      </div>

      {/* Period filter — Shift / Day / Custom (reporting.md §2 #8) */}
      <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">Period:</span>
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPeriod(opt.value)}
            disabled={isRefreshing}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-60 ${
              period === opt.value ? 'bg-[#08775A] text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              lang="en-GB"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              aria-label="From date"
              className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#08775A]"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              lang="en-GB"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              aria-label="To date"
              className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#08775A]"
            />
          </div>
        )}
        {isRefreshing && <Loader2 className="h-4 w-4 animate-spin text-slate-400 ml-2" />}
        {!isShift && (
          <span className="ml-auto text-[11px] text-slate-500">Historical view — settle from “Current Shift”.</span>
        )}
      </div>

      {/* Dual Side-by-Side Tables (Payments vs Expenses / Refunds) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Table: Payments / Collections */}
        <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden flex flex-col justify-between">
          <div>
            <div className="bg-[#16a34a] text-white px-3.5 py-2 font-bold text-xs tracking-wide flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5" />
                Payments (Collections)
              </span>
              <span className="text-[11px] font-normal text-emerald-100">
                {inTransactions.length} item{inTransactions.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#f1f5f9] border-b border-slate-300 sticky top-0 z-10 text-slate-800 text-[11px] font-bold uppercase">
                    <th className="w-10 py-2.5 px-2.5 text-center border-r border-slate-300">#</th>
                    <th className="py-2.5 px-3 border-r border-slate-300">Receipt / Ref</th>
                    <th className="py-2.5 px-3 border-r border-slate-300">Category</th>
                    <th className="py-2.5 px-3 border-r border-slate-300">Method</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {inTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-400">
                        No payment records in current custody
                      </td>
                    </tr>
                  ) : (
                    inTransactions.map((t, idx) => (
                      <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2 px-2.5 text-center border-r border-slate-200 text-slate-500 font-mono text-[11px] bg-slate-50/50">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 font-mono text-[11px] font-semibold text-[#08775A] whitespace-nowrap">
                          {t.receiptNumber || t.invoiceNumber || '—'}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 whitespace-nowrap text-slate-700">
                          {CATEGORY_LABEL[t.category] || t.category}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 whitespace-nowrap">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10.5px] font-medium ${t.isPhysicalCash ? 'bg-slate-100 text-slate-700' : 'bg-blue-50 text-blue-700'}`}>
                            {t.paymentMethod}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                          {formatPKR(t.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {/* Footer Total */}
          <div className="border-t border-slate-300 flex items-center justify-between bg-slate-50 text-xs font-bold">
            <span className="py-2.5 px-3.5 text-slate-700 uppercase tracking-wide">Total</span>
            <span className="py-2.5 px-4 bg-[#dcfce7] text-emerald-900 font-mono text-sm border-l border-slate-300">
              {formatPKR(summary.totalCollections)}
            </span>
          </div>
        </div>

        {/* Right Table: Expenses / Refunds */}
        <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden flex flex-col justify-between">
          <div>
            <div className="bg-[#ef4444] text-white px-3.5 py-2 font-bold text-xs tracking-wide flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Expenses &amp; Refunds
              </span>
              <span className="text-[11px] font-normal text-rose-100">
                {outTransactions.length} item{outTransactions.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#f1f5f9] border-b border-slate-300 sticky top-0 z-10 text-slate-800 text-[11px] font-bold uppercase">
                    <th className="w-10 py-2.5 px-2.5 text-center border-r border-slate-300">#</th>
                    <th className="py-2.5 px-3 border-r border-slate-300">Ref / Receipt</th>
                    <th className="py-2.5 px-3 border-r border-slate-300">Expense / Reason</th>
                    <th className="py-2.5 px-3 border-r border-slate-300">Method</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {outTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-400">
                        No expense / refund records in current custody
                      </td>
                    </tr>
                  ) : (
                    outTransactions.map((t, idx) => (
                      <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2 px-2.5 text-center border-r border-slate-200 text-slate-500 font-mono text-[11px] bg-slate-50/50">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 font-mono text-[11px] font-semibold text-rose-600 whitespace-nowrap">
                          {t.receiptNumber || t.invoiceNumber || '—'}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 whitespace-nowrap text-slate-700">
                          {CATEGORY_LABEL[t.category] || t.category}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 whitespace-nowrap">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10.5px] font-medium ${t.isPhysicalCash ? 'bg-slate-100 text-slate-700' : 'bg-blue-50 text-blue-700'}`}>
                            {t.paymentMethod}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-rose-700 whitespace-nowrap">
                          {formatPKR(t.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {/* Footer Total */}
          <div className="border-t border-slate-300 flex items-center justify-between bg-slate-50 text-xs font-bold">
            <span className="py-2.5 px-3.5 text-slate-700 uppercase tracking-wide">Total</span>
            <span className="py-2.5 px-4 bg-[#fee2e2] text-rose-900 font-mono text-sm border-l border-slate-300">
              {formatPKR(summary.totalRefunds)}
            </span>
          </div>
        </div>
      </div>

      {/* Balance Summary Section */}
      <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden">
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 font-bold text-xs text-slate-800 uppercase tracking-wider">
          Balance Summary
        </div>
        <div className="divide-y divide-slate-200 text-xs">
          {[
            // reporting.md §2 #8 line items. Card/Bank/Online is shown for
            // reference only — it is never part of Expected (physical) Cash.
            { label: 'Opening / Petty Cash:', value: summary.pettyCash, tone: 'bg-slate-50 text-slate-900' },
            ...(isShift && summary.carriedForwardAmount > 0
              ? [{ label: 'Previous Balance (Carried Forward):', value: summary.carriedForwardAmount, tone: 'bg-amber-50 text-amber-900' }]
              : []),
            { label: '(+) Cash Collections:', value: summary.cashCollections, tone: 'bg-[#dcfce7] text-emerald-900' },
            { label: '(−) Cash Expenses:', value: summary.cashExpenses, tone: 'bg-[#fee2e2] text-rose-900' },
            { label: '(−) Cash Refunds:', value: summary.cashRefunds, tone: 'bg-[#fee2e2] text-rose-900' },
            { label: 'Non-Cash (Card / Bank / Online) — not physical cash:', value: summary.nonPhysicalTotal, tone: 'bg-blue-50 text-blue-900' },
            { label: 'Expected Cash (Physical):', value: summary.expectedPhysicalCash, tone: 'bg-[#bbf7d0] text-emerald-950', strong: true },
            ...(!isShift
              ? [
                  { label: `Physical Cash Counted (${summary.settlementCount} settlement${summary.settlementCount === 1 ? '' : 's'}):`, value: summary.physicalCashCounted, tone: 'bg-slate-50 text-slate-900' },
                  {
                    label: 'Variance:',
                    value: summary.variance,
                    tone: summary.variance < 0 ? 'bg-rose-50 text-rose-900' : summary.variance > 0 ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-900',
                  },
                  { label: 'Settled:', value: summary.settledAmount, tone: 'bg-emerald-50 text-emerald-900' },
                ]
              : []),
            { label: 'Remaining (Unsettled) Cash:', value: summary.remainingAmount, tone: 'bg-amber-50 text-amber-900', strong: true },
          ].map((line) => (
            <div key={line.label} className={`flex items-center justify-between ${line.strong ? 'bg-slate-50/50' : ''}`}>
              <span className={`py-2 px-4 ${line.strong ? 'text-slate-900 font-bold' : 'text-slate-600 font-medium'}`}>{line.label}</span>
              <span className={`py-2 px-4 font-bold font-mono min-w-44 text-right border-l border-slate-200 ${line.tone} ${line.strong ? 'text-sm font-black' : ''}`}>
                {formatPKR(line.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

