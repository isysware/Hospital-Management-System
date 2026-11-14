import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, AlertTriangle, Banknote, RotateCcw, RefreshCw, ArrowRight, CheckCircle2 } from 'lucide-react';
import apiClient from '../services/apiClient';
import { formatPKR } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import { exportBalanceSheet } from '../utils/balanceSheetExport';

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
    adjustments: number;
    physicalCashIn: number;
    physicalCashOut: number;
    nonPhysicalTotal: number;
    totalCollections: number;
    totalRefunds: number;
    unsettledCount: number;
    pettyCash: number;
    cashCollections: number;
    cashExpenses: number;
    vendorPayments: number;
    openingCash: number;
    closingCash: number;
    posCashCollections: number;
    hmsCashCollections: number;
    otherCashIn: number;
    otherCashOut: number;
    cashRefunds: number;
    settledAmount: number;
    remainingAmount: number;
    settlementCount: number;
    physicalCashCounted: number;
    variance: number;
  };
  period: { mode: 'shift' | 'period'; label: string };
  transactions: BalanceSheetTransaction[];
  pendingSettlement: boolean;
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
  PETTY_CASH_ISSUED: 'Petty Cash Issued', PETTY_CASH_RECEIVED: 'Petty Cash Received',
  POS_COLLECTION: 'POS Collection', HMS_COLLECTION: 'HMS Collection', REFUND: 'Refund',
  VENDOR_PAYMENT: 'Vendor Payment', EXPENSE_PAYMENT: 'Expense', ADJUSTMENT: 'Adjustment',
};

export const BalanceSheetPage: React.FC<{ onNavigate: (page: string) => void }> = ({ onNavigate }) => {
  const { currentUser } = useAuth();
  const [data, setData] = useState<BalanceSheetData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const today = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
  const [period, setPeriod] = useState<SheetPeriod>('shift');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (period === 'custom' && (!fromDate || !toDate || fromDate > toDate)) {
      setLoadError('Choose a valid From / To date range.');
      setIsRefreshing(false);
      return;
    }
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const { data: response } = await apiClient.get('/cash/balance-sheet', { params: {
        preset: period, ...(period === 'custom' ? { fromDate, toDate } : {}),
      } });
      if (id !== requestId.current) return;
      const raw = response.data;
      const summary = Object.fromEntries(Object.entries(raw.summary).map(([key, value]) => [key, Number(value ?? 0)])) as BalanceSheetData['summary'];
      setData({ period: raw.period, summary, pendingSettlement: raw.pendingSettlement,
        transactions: raw.entries.map((entry: any) => ({
          ...entry, amount: Number(entry.amount), receiptNumber: entry.documentReference,
          invoiceNumber: null,
          paymentMethod: entry.paymentMethod || (entry.isPhysicalCash ? 'CASH' : 'NON-CASH'),
        })),
      });
    } catch (error: any) {
      if (id === requestId.current) setLoadError(error?.response?.data?.error?.message || 'Unable to load balance sheet. Please retry.');
    } finally {
      if (id === requestId.current) setIsRefreshing(false);
    }
  }, [period, fromDate, toDate]);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load]);

  if (!data) return <div className="p-12 flex flex-col items-center gap-3 text-sm text-slate-500">
    {loadError ? <><AlertTriangle className="text-rose-600" /><p role="alert">{loadError}</p><button onClick={() => load()} className="px-4 py-2 bg-emerald-700 text-white rounded-lg">Retry</button></>
      : <><Loader2 className="animate-spin" />Loading balance sheet…</>}
  </div>;
  const { summary, transactions } = data;
  const isShift = data.period.mode === 'shift';
  const hasUnsettled = summary.unsettledCount > 0;
  const inTransactions = transactions.filter(t => t.direction === 'IN');
  const outTransactions = transactions.filter(t => t.direction === 'OUT');
  const exportReport = (kind: 'Excel' | 'CSV' | 'PDF' | 'Print') => {
    void exportBalanceSheet(kind, data, currentUser?.fullName || '', CATEGORY_LABEL).catch(error => setLoadError(error.message));
  };
  return (
    <div className="p-6 sm:p-8 max-w-[1700px] mx-auto space-y-4 animate-in fade-in duration-150">
      {/* Header & Export Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">My Balance Sheet</h1>
          <p className="text-xs text-slate-500 mt-0.5">{data.period.label}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            {(['Excel', 'CSV', 'PDF', 'Print'] as const).map((kind) => (
              <button key={kind} type="button" disabled={isRefreshing || !!loadError} onClick={() => exportReport(kind)}
                title={kind === 'PDF' ? 'Print report / Save as PDF' : `Export ${kind}`}
                className={`px-3 py-1.5 text-xs font-semibold text-white rounded-md disabled:opacity-40 ${kind === 'Excel' ? 'bg-green-600' : kind === 'CSV' ? 'bg-cyan-600' : kind === 'PDF' ? 'bg-red-600' : 'bg-slate-600'}`}>
                {kind}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => load()}
            disabled={isRefreshing}
            className="h-7.5 px-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 shadow-xs"
            title="Refresh balance sheet"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          {!isShift || isRefreshing || loadError ? null : data.pendingSettlement ? (<span className="text-xs font-semibold text-amber-700">Settlement pending review</span>) : hasUnsettled ? (
            <button
              type="button"
              onClick={() => onNavigate('settlements')}
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

      {loadError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{loadError}</div>}
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between">
        <span className="font-bold text-emerald-900">{isShift ? 'Live Cash (after refunds & expenses)' : 'Period Cash Movement (before handovers)'}</span>
        <span className="font-mono text-xl font-bold text-emerald-950">{formatPKR(summary.expectedPhysicalCash)}</span>
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
                        No payment records in this period
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
            <span className="py-2.5 px-3.5 text-slate-700 uppercase tracking-wide">Total Payments</span>
            <span className="py-2.5 px-4 bg-[#dcfce7] text-emerald-900 font-mono text-sm border-l border-slate-300">
              {formatPKR(inTransactions.reduce((sum, t) => sum + t.amount, 0))}
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
                        No expense / refund records in this period
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
              {formatPKR(outTransactions.reduce((sum, t) => sum + t.amount, 0))}
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
            { label: 'Opening / Carry Forward Cash:', value: summary.openingCash, tone: 'bg-slate-50 text-slate-900' },
            { label: 'Vendor / Supplier Payments:', value: summary.vendorPayments, tone: 'bg-rose-50 text-rose-900' },
            { label: 'HMS Pharmacy Cash Collections:', value: summary.hmsCashCollections, tone: 'bg-emerald-50 text-emerald-900' },
            { label: 'Other Authorized Cash In:', value: summary.otherCashIn, tone: 'bg-slate-50 text-slate-900' },
            { label: 'Other Authorized Cash Out:', value: summary.otherCashOut, tone: 'bg-slate-50 text-slate-900' },
            { label: '(+) Cash Sales Collections:', value: summary.posCashCollections, tone: 'bg-[#dcfce7] text-emerald-900' },
            { label: '(−) Operating Expenses:', value: summary.cashExpenses, tone: 'bg-[#fee2e2] text-rose-900' },
            { label: '(−) Cash Refunds:', value: summary.cashRefunds, tone: 'bg-[#fee2e2] text-rose-900' },
            { label: 'Non-Cash (Card / Bank / Online) — not physical cash:', value: summary.nonPhysicalTotal, tone: 'bg-blue-50 text-blue-900' },
            { label: '(+/−) Cash Adjustments:', value: summary.adjustments, tone: 'bg-slate-50 text-slate-900' },
            { label: 'Expected Cash (Physical):', value: summary.closingCash, tone: 'bg-[#bbf7d0] text-emerald-950', strong: true },
            ...(!isShift
              ? [
                  { label: `Physical Cash Counted (${summary.settlementCount} settlement${summary.settlementCount === 1 ? '' : 's'}):`, value: summary.physicalCashCounted, tone: 'bg-slate-50 text-slate-900' },
                  {
                    label: 'Variance:',
                    value: summary.variance,
                    tone: summary.variance < 0 ? 'bg-rose-50 text-rose-900' : summary.variance > 0 ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-900',
                  },
                  { label: 'Accepted Account Settlements:', value: summary.settledAmount, tone: 'bg-emerald-50 text-emerald-900' },
                ]
              : []),
            { label: 'Closing / Remaining Cash:', value: summary.closingCash, tone: 'bg-amber-50 text-amber-900', strong: true },
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
