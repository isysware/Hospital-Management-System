import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Receipt,
  Search,
  RotateCcw,
  Eye,
  Filter,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  FileSpreadsheet,
  Download,
  Printer,
  X,
} from 'lucide-react';
import apiClient from '../services/apiClient';
import { useAuth } from '../context/AuthContext';
import { formatPKR, formatDateTime } from '../utils/format';
import { exportToCSV, exportToExcel, printFinancialReport } from '../utils/reportExportUtils';
import { ALL_REPORTS_LIST } from '../components/ReportView';

type PeriodPreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'custom' | 'all_time';

const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'custom', label: 'Custom Range' },
  { value: 'all_time', label: 'All Time' },
];

const TYPE_OPTIONS = [
  { value: 'ALL', label: 'All Transaction Types' },
  { value: 'INCOME', label: 'Sales / Recognized Income' },
  { value: 'COLLECTION', label: 'Actual Collections Received' },
  { value: 'EXPENSE', label: 'Operating Expenses' },
];

const CHANNEL_OPTIONS = [
  { value: 'ALL', label: 'All Channels' },
  { value: 'RETAIL', label: 'Retail Walk-In POS' },
  { value: 'HMS', label: 'HMS Inpatient Dispense' },
  { value: 'EXPENSE', label: 'Operating Overheads' },
];

const PAYMENT_METHODS = [
  { value: 'ALL', label: 'All Payment Methods' },
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Debit / Credit Card' },
  { value: 'BANK', label: 'Bank Transfer' },
  { value: 'ONLINE', label: 'Online / Digital' },
];

function getPKTDate(): Date {
  return new Date(Date.now() + 5 * 3600000);
}

function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface UnifiedLedgerRow {
  id: string;
  date: string;
  reference: string;
  sourceType: 'INVOICE' | 'COLLECTION' | 'RETURN' | 'EXPENSE';
  transactionType: 'Original Sale' | 'Outstanding Invoice Collection' | 'Return / Refund' | 'Operating Expense';
  channel: 'RETAIL' | 'HMS' | 'EXPENSE';
  description: string;
  income: number;
  collections: number;
  expenses: number;
  paymentMethod: string;
  outstanding: number;
  user: string;
  status: string;
  invoiceRef?: string;
  receiptNumber?: string;
  raw: any;
}

interface Props {
  onNavigate?: (pageId: string) => void;
}

export const PharmacyIncomeExpenseReportPage: React.FC<Props> = ({ onNavigate }) => {
  const { currentUser } = useAuth();
  const isSales = currentUser?.role === 'SALES_DISPENSING';
  const todayISO = formatDateISO(getPKTDate());

  // Filter States
  const [preset, setPreset] = useState<PeriodPreset>('today');
  const [fromDate, setFromDate] = useState<string>(todayISO);
  const [toDate, setToDate] = useState<string>(todayISO);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [channelFilter, setChannelFilter] = useState<string>('ALL');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');

  // Applied Filter State for query
  const [appliedFilters, setAppliedFilters] = useState({
    preset: 'today' as PeriodPreset,
    fromDate: todayISO,
    toDate: todayISO,
    typeFilter: 'ALL',
    channelFilter: 'ALL',
    methodFilter: 'ALL',
    search: '',
  });

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(25);

  // Detail Modal
  const [detailRow, setDetailRow] = useState<UnifiedLedgerRow | null>(null);

  // Sync date inputs on preset change
  const handlePresetChange = (p: PeriodPreset) => {
    setPreset(p);
    const today = getPKTDate();
    const todayStr = formatDateISO(today);

    if (p === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (p === 'yesterday') {
      const y = new Date(today.getTime() - 86400000);
      const yStr = formatDateISO(y);
      setFromDate(yStr);
      setToDate(yStr);
    } else if (p === 'this_week') {
      const d = new Date(today);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      setFromDate(formatDateISO(d));
      setToDate(todayStr);
    } else if (p === 'this_month') {
      setFromDate(`${todayStr.slice(0, 7)}-01`);
      setToDate(todayStr);
    } else if (p === 'last_month') {
      const curYear = parseInt(todayStr.slice(0, 4), 10);
      const curMonth = parseInt(todayStr.slice(5, 7), 10);
      const lastMonth = curMonth === 1 ? 12 : curMonth - 1;
      const lastYear = curMonth === 1 ? curYear - 1 : curYear;
      const mStr = String(lastMonth).padStart(2, '0');
      const start = `${lastYear}-${mStr}-01`;
      const lastDay = new Date(lastYear, lastMonth, 0).getDate();
      setFromDate(start);
      setToDate(`${lastYear}-${mStr}-${String(lastDay).padStart(2, '0')}`);
    } else if (p === 'all_time') {
      setFromDate('2024-01-01');
      setToDate(todayStr);
    }
  };

  const handleApply = () => {
    setAppliedFilters({
      preset,
      fromDate,
      toDate,
      typeFilter,
      channelFilter,
      methodFilter,
      search,
    });
    setPage(1);
  };

  const handleReset = () => {
    const todayStr = formatDateISO(getPKTDate());
    setPreset('today');
    setFromDate(todayStr);
    setToDate(todayStr);
    setTypeFilter('ALL');
    setChannelFilter('ALL');
    setMethodFilter('ALL');
    setSearch('');
    setAppliedFilters({
      preset: 'today',
      fromDate: todayStr,
      toDate: todayStr,
      typeFilter: 'ALL',
      channelFilter: 'ALL',
      methodFilter: 'ALL',
      search: '',
    });
    setPage(1);
  };

  // Query Backend using OPERATING_PROFIT report to get unified transactions (invoices + expenses) + canonical totals
  const { data: queryData, isLoading, error } = useQuery({
    queryKey: ['pharmacy-income-expense-report', appliedFilters.fromDate, appliedFilters.toDate],
    queryFn: async () => {
      const res = await apiClient.get('/reports', {
        params: {
          type: 'OPERATING_PROFIT',
          from: appliedFilters.fromDate ? `${appliedFilters.fromDate}T00:00:00+05:00` : undefined,
          to: appliedFilters.toDate ? `${appliedFilters.toDate}T23:59:59.999+05:00` : undefined,
        },
      });
      return res.data?.data;
    },
    staleTime: 30 * 1000,
  });

  const totals = queryData?.totals;
  const rawInvoices: any[] = queryData?.invoices || [];
  const rawExpenses: any[] = queryData?.expenses || [];

  // Build Unified Ledger Rows with Multi-Collection Split
  const allLedgerRows = useMemo<UnifiedLedgerRow[]>(() => {
    const rows: UnifiedLedgerRow[] = [];

    // Helper to format ISO date string to PKT YYYY-MM-DD
    const toDateKey = (d: string | Date | undefined) => {
      if (!d) return '';
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return '';
      return new Date(dt.getTime() + 5 * 3600000).toISOString().slice(0, 10);
    };

    // 1. Invoices & Detailed Payment Collections
    rawInvoices.forEach((inv) => {
      const net = Number(inv.netBilling || inv.grossSales || inv.total || 0);
      const invoiceDay = toDateKey(inv.createdAt);

      const rawPayments: any[] = (inv.payments || []).slice().sort((a: any, b: any) =>
        new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime() || String(a.id).localeCompare(String(b.id))
      );

      const rawEvents: any[] = (inv.financialEvents || []).slice().sort((a: any, b: any) =>
        new Date(a.occurredAt || 0).getTime() - new Date(b.occurredAt || 0).getTime() || String(a.id).localeCompare(String(b.id))
      );

      // If no payments breakdown returned, use single-row fallback
      if (rawPayments.length === 0 && rawEvents.length === 0) {
        const col = Number(inv.collections || 0);
        const out = Number(inv.outstanding || 0);
        rows.push({
          id: `inv-${inv.invoiceNumber}`,
          date: inv.createdAt,
          reference: inv.invoiceNumber,
          sourceType: 'INVOICE',
          transactionType: 'Original Sale',
          channel: inv.channel === 'HMS' ? 'HMS' : 'RETAIL',
          description: inv.customerName || (inv.channel === 'HMS' ? 'HMS Inpatient Prescription' : 'Walk-In Customer'),
          income: net,
          collections: col,
          expenses: 0,
          paymentMethod: inv.paymentMethod || (col > 0 ? 'CASH' : 'CREDIT'),
          outstanding: out,
          user: inv.collectedBy || inv.soldBy || 'Staff',
          status: inv.status || 'POSTED',
          invoiceRef: inv.invoiceNumber,
          receiptNumber: inv.invoiceNumber,
          raw: inv,
        });
        return;
      }

      // Classify Initial Payments (made on invoice creation date) vs Subsequent Outstanding Collections
      const firstPositivePayment = rawPayments.find((p: any) => Number(p.amount) > 0);
      const isInitialPayment = (p: any) => {
        if (p.isInitial === true) return true;
        if (p.isInitial === false) return false;
        const pDay = toDateKey(p.paidAt);
        if (new Date(p.paidAt).getTime() === new Date(inv.createdAt).getTime()) return true;
        if (p.id === firstPositivePayment?.id && pDay === invoiceDay) return true;
        return false;
      };

      const initialPayments = rawPayments.filter(isInitialPayment);
      const subsequentPayments = rawPayments.filter((p: any) => !isInitialPayment(p));

      // Initial HMS event on creation day
      const firstHmsEvent = rawEvents.find(
        (e: any) => (e.kind || '').startsWith('HMS_') && e.occurredAt && Number(e.collectionDelta) > 0
      );
      const isInitialHms = firstHmsEvent && toDateKey(firstHmsEvent.occurredAt) === invoiceDay;
      const initialHmsEvent = isInitialHms ? firstHmsEvent : null;
      const subsequentEvents = rawEvents.filter((e: any) => e.id !== initialHmsEvent?.id);

      const initialCollected =
        initialPayments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0) +
        Number(initialHmsEvent?.collectionDelta || 0);

      const initialReceipt = [
        ...initialPayments.map((p: any) => p.reference || `PAY-${String(p.id || '').slice(0, 8).toUpperCase()}`),
        initialHmsEvent?.reference,
      ].filter(Boolean).join(', ') || inv.invoiceNumber;

      const initialMethod = [
        ...initialPayments.map((p: any) => p.method),
        initialHmsEvent?.method,
      ].filter(Boolean).join(', ') || (initialCollected > 0 ? 'CASH' : 'CREDIT');

      const initialCollector = [
        ...initialPayments.map((p: any) => p.collectedByName),
        initialHmsEvent ? (initialHmsEvent.actorId || 'HMS Front Desk') : null,
      ].filter(Boolean).join(', ') || inv.collectedBy || inv.soldBy || 'Staff';

      let runningBalance = net - initialCollected;
      const initialOutstanding = Math.max(0, runningBalance);

      // 1. Original Sale Row
      rows.push({
        id: `inv-${inv.invoiceNumber}`,
        date: inv.createdAt,
        reference: inv.invoiceNumber,
        sourceType: 'INVOICE',
        transactionType: 'Original Sale',
        channel: inv.channel === 'HMS' ? 'HMS' : 'RETAIL',
        description: inv.customerName || (inv.channel === 'HMS' ? 'HMS Inpatient Prescription' : 'Walk-In Customer'),
        income: net,
        collections: initialCollected,
        expenses: 0,
        paymentMethod: initialMethod,
        outstanding: initialOutstanding,
        user: inv.soldBy || initialCollector,
        status: initialOutstanding <= 0 ? 'PAID' : (initialCollected > 0 ? 'PARTIALLY_PAID' : 'UNPAID'),
        invoiceRef: inv.invoiceNumber,
        receiptNumber: initialReceipt,
        raw: inv,
      });

      // 2. Subsequent Outstanding Invoice Collections
      subsequentPayments.forEach((p: any) => {
        const pAmt = Number(p.amount || 0);
        runningBalance = Math.max(0, runningBalance - pAmt);
        const outstandingAfterReceipt = runningBalance;
        const pReceipt = p.reference || `PAY-${String(p.id || '').slice(0, 8).toUpperCase()}`;
        const pCollector = p.collectedByName || 'Staff';

        rows.push({
          id: `pay-${p.id}`,
          date: p.paidAt,
          reference: pReceipt,
          sourceType: 'COLLECTION',
          transactionType: 'Outstanding Invoice Collection',
          channel: inv.channel === 'HMS' ? 'HMS' : 'RETAIL',
          description: `Outstanding Collection — ${inv.invoiceNumber}${inv.customerName ? ` (${inv.customerName})` : ''}`,
          income: 0,
          collections: pAmt,
          expenses: 0,
          paymentMethod: p.method || 'CASH',
          outstanding: outstandingAfterReceipt,
          user: pCollector,
          status: outstandingAfterReceipt <= 0 ? 'PAID' : 'COLLECTED',
          invoiceRef: inv.invoiceNumber,
          receiptNumber: pReceipt,
          raw: { ...p, linkedInvoice: inv },
        });
      });

      // 3. Subsequent Returns & Reconciliations
      subsequentEvents.forEach((e: any) => {
        if (e.kind === 'RETURN') {
          const saleDelta = Number(e.saleDelta || 0);
          const colDelta = Number(e.collectionDelta || 0);
          runningBalance = Math.max(0, runningBalance + saleDelta - colDelta);
          const evtRef = e.reference || `EVT-${String(e.id || '').slice(0, 8).toUpperCase()}`;

          rows.push({
            id: `evt-${e.id}`,
            date: e.occurredAt,
            reference: evtRef,
            sourceType: 'RETURN',
            transactionType: 'Return / Refund',
            channel: inv.channel === 'HMS' ? 'HMS' : 'RETAIL',
            description: `Sales Return — ${inv.invoiceNumber}${inv.customerName ? ` (${inv.customerName})` : ''}`,
            income: saleDelta,
            collections: colDelta,
            expenses: 0,
            paymentMethod: e.method || 'CASH',
            outstanding: runningBalance,
            user: e.actorId || 'Staff',
            status: 'REFUNDED',
            invoiceRef: inv.invoiceNumber,
            receiptNumber: evtRef,
            raw: { ...e, linkedInvoice: inv },
          });
        } else if (Number(e.collectionDelta || 0) !== 0) {
          const colDelta = Number(e.collectionDelta || 0);
          runningBalance = Math.max(0, runningBalance - colDelta);
          const evtRef = e.reference || `EVT-${String(e.id || '').slice(0, 8).toUpperCase()}`;

          rows.push({
            id: `evt-${e.id}`,
            date: e.occurredAt,
            reference: evtRef,
            sourceType: 'COLLECTION',
            transactionType: 'Outstanding Invoice Collection',
            channel: inv.channel === 'HMS' ? 'HMS' : 'RETAIL',
            description: `HMS Collection — ${inv.invoiceNumber}${inv.customerName ? ` (${inv.customerName})` : ''}`,
            income: 0,
            collections: colDelta,
            expenses: 0,
            paymentMethod: e.method || 'CASH',
            outstanding: runningBalance,
            user: e.actorId || 'HMS Front Desk',
            status: runningBalance <= 0 ? 'PAID' : 'COLLECTED',
            invoiceRef: inv.invoiceNumber,
            receiptNumber: evtRef,
            raw: { ...e, linkedInvoice: inv },
          });
        }
      });
    });

    // 4. Operating Expenses
    rawExpenses.forEach((exp) => {
      const amt = Number(exp.amount || 0);
      rows.push({
        id: `exp-${exp.id || exp.expenseNumber}`,
        date: exp.date || exp.createdAt,
        reference: exp.expenseNumber || 'EXP-GEN',
        sourceType: 'EXPENSE',
        transactionType: 'Operating Expense',
        channel: 'EXPENSE',
        description: `${exp.category || 'Operating Expense'}${exp.description ? ` · ${exp.description}` : ''}${exp.payeeOrVendor ? ` (${exp.payeeOrVendor})` : ''}`,
        income: 0,
        collections: 0,
        expenses: amt,
        paymentMethod: exp.paymentMethod || 'CASH',
        outstanding: 0,
        user: exp.enteredBy || exp.approvedBy || 'Staff',
        status: exp.approvedBy ? 'APPROVED' : 'PENDING',
        raw: exp,
      });
    });

    // Sort descending by date (newest transactions first)
    return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.id.localeCompare(a.id));
  }, [rawInvoices, rawExpenses]);

  // Apply In-Memory Filters (Date Range, Search, Type, Channel, Method)
  const filteredRows = useMemo(() => {
    return allLedgerRows.filter((r) => {
      // Date Filter: accurately evaluate row's actual transaction date in PKT
      if (r.date) {
        const dt = new Date(r.date);
        if (!isNaN(dt.getTime())) {
          const rowDateStr = new Date(dt.getTime() + 5 * 3600000).toISOString().slice(0, 10);
          if (appliedFilters.fromDate && rowDateStr < appliedFilters.fromDate) return false;
          if (appliedFilters.toDate && rowDateStr > appliedFilters.toDate) return false;
        }
      }

      // Type Filter
      if (appliedFilters.typeFilter === 'INCOME' && r.income <= 0) return false;
      if (appliedFilters.typeFilter === 'COLLECTION' && r.collections <= 0) return false;
      if (appliedFilters.typeFilter === 'EXPENSE' && r.expenses <= 0) return false;

      // Channel Filter
      if (appliedFilters.channelFilter !== 'ALL' && r.channel !== appliedFilters.channelFilter) return false;

      // Method Filter
      if (appliedFilters.methodFilter !== 'ALL' && !r.paymentMethod.toUpperCase().includes(appliedFilters.methodFilter)) return false;

      // Search Filter
      if (appliedFilters.search.trim()) {
        const q = appliedFilters.search.toLowerCase();
        const matchesRef = r.reference.toLowerCase().includes(q);
        const matchesInvRef = r.invoiceRef ? r.invoiceRef.toLowerCase().includes(q) : false;
        const matchesDesc = r.description.toLowerCase().includes(q);
        const matchesUser = r.user.toLowerCase().includes(q);
        const matchesStatus = r.status.toLowerCase().includes(q);
        const matchesType = r.transactionType.toLowerCase().includes(q);
        if (!matchesRef && !matchesInvRef && !matchesDesc && !matchesUser && !matchesStatus && !matchesType) return false;
      }

      return true;
    });
  }, [allLedgerRows, appliedFilters]);

  // Pagination slice
  const totalRecords = filteredRows.length;
  const totalPages = Math.ceil(totalRecords / limit) || 1;
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * limit;
    return filteredRows.slice(start, start + limit);
  }, [filteredRows, page, limit]);

  // Dynamic Page-Level Totals for Footer
  const filteredTotals = useMemo(() => {
    let inc = 0;
    let col = 0;
    let exp = 0;
    const seenInvoices = new Set<string>();
    let out = 0;

    filteredRows.forEach((r) => {
      inc += r.income;
      col += r.collections;
      exp += r.expenses;
      const invRef = r.invoiceRef || (r.sourceType === 'INVOICE' ? r.reference : null);
      if (invRef && !seenInvoices.has(invRef)) {
        seenInvoices.add(invRef);
        const currentInvOutstanding = Number(r.raw?.linkedInvoice?.outstanding ?? r.raw?.outstanding ?? 0);
        out += currentInvOutstanding;
      }
    });

    return {
      income: inc,
      collections: col,
      expenses: exp,
      netCash: col - exp,
      outstanding: out,
    };
  }, [filteredRows]);

  // Export Handlers
  const handleExport = (format: 'excel' | 'csv' | 'print') => {
    const columns = [
      { header: 'Date & Time', format: (r: UnifiedLedgerRow) => formatDateTime(r.date) },
      { header: 'Reference ID', key: 'reference' },
      { header: 'Linked Invoice', format: (r: UnifiedLedgerRow) => r.invoiceRef || '—' },
      { header: 'Transaction Type', key: 'transactionType' },
      { header: 'Channel / Source', key: 'channel' },
      { header: 'Description / Customer / Payee', key: 'description' },
      { header: 'Recognized Income (PKR)', format: (r: UnifiedLedgerRow) => (r.income !== 0 ? formatPKR(r.income) : '—'), numeric: true },
      { header: 'Actual Collections (PKR)', format: (r: UnifiedLedgerRow) => (r.collections !== 0 ? formatPKR(r.collections) : '—'), numeric: true },
      { header: 'Operating Expenses (PKR)', format: (r: UnifiedLedgerRow) => (r.expenses > 0 ? formatPKR(r.expenses) : '—'), numeric: true },
      { header: 'Payment Method', key: 'paymentMethod' },
      { header: 'Remaining Balance (PKR)', format: (r: UnifiedLedgerRow) => formatPKR(r.outstanding), numeric: true },
      { header: 'Recorded / Collected By', key: 'user' },
      { header: 'Status', key: 'status' },
    ];

    const periodLabel = `${appliedFilters.fromDate} to ${appliedFilters.toDate}`;
    const summaryRows = [
      { label: 'Total Customer Collections (Net of Customer Returns & Reversals)', value: formatPKR(totals?.collections ?? filteredTotals.collections) },
      { label: 'Actual Paid Operating Expenses (Utilities, Rent, Consumables & Overheads)', value: formatPKR(totals?.operatingExpenses ?? filteredTotals.expenses) },
      { label: 'Net Cash Movement (Collections − Expenses)', value: formatPKR(Number(totals?.collections ?? filteredTotals.collections) - Number(totals?.operatingExpenses ?? filteredTotals.expenses)) },
      { label: 'Current Remaining Customer Dues (Outstanding Receivables)', value: formatPKR(totals?.outstanding ?? filteredTotals.outstanding) },
    ];

    const opts = {
      title: 'Pharmacy Income & Expense Report',
      subtitle: 'Transactional financial ledger of medicine sales, collections, and operating overheads',
      periodLabel,
      userName: currentUser?.fullName || currentUser?.username,
      filename: 'Pharmacy_Income_Expense',
      columns,
      data: filteredRows,
      summaryRows,
    };

    if (format === 'excel') exportToExcel(opts);
    else if (format === 'csv') exportToCSV(opts);
    else if (format === 'print') printFinancialReport(opts);
  };

  return (
    <div className="min-w-0 max-w-full space-y-4 p-4 sm:p-6 lg:p-8 max-w-[1700px] mx-auto">
      {/* ── Top Report Switcher Tabs (Management/Admins) ─────────────── */}
      {onNavigate && !isSales && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-200 -mt-1">
          {ALL_REPORTS_LIST.map((tab) => {
            const isActive = tab.page === 'reports-income-expense';
            return (
              <button
                key={tab.page}
                type="button"
                onClick={() => onNavigate(tab.page)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  isActive
                    ? 'bg-[#0c6b50] text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Page Header (Exact HMS-Style Simple Heading & Subtitle) ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Income &amp; Expense</h1>
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
              (Accrual &amp; Cash)
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Consolidated pharmacy medicine sales, collections, recognized expenses, payments and outstanding balances.
          </p>
        </div>
      </div>

      {/* ── Advanced Filter Panel (Compact Bordered Card) ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-2.5">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 pb-1.5 border-b border-slate-100">
          <Filter className="h-3.5 w-3.5 text-[#0c6b50]" />
          <span>Advanced Ledger Filters</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* 1. Period Preset */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Period</label>
            <select
              value={preset}
              onChange={(e) => handlePresetChange(e.target.value as PeriodPreset)}
              className="w-full h-8.5 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0c6b50]"
            >
              {PERIOD_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* 2. From Date */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">From Date</label>
            <input
              type="date"
              value={fromDate}
              disabled={preset !== 'custom'}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full h-8.5 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0c6b50]"
            />
          </div>

          {/* 3. To Date */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">To Date</label>
            <input
              type="date"
              value={toDate}
              disabled={preset !== 'custom'}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full h-8.5 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0c6b50]"
            />
          </div>

          {/* 4. Transaction Type */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Transaction Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full h-8.5 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0c6b50]"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* 5. Channel / Source */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Channel / Source</label>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="w-full h-8.5 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0c6b50]"
            >
              {CHANNEL_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* 6. Payment Method */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Payment Method</label>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="w-full h-8.5 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0c6b50]"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={handleReset}
            title="Reset all filters"
            className="h-8 px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="h-8 px-4 rounded-lg bg-[#0c6b50] hover:bg-[#09523d] text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <Filter className="h-3.5 w-3.5" />
            <span>Apply Filters</span>
          </button>
        </div>
      </div>

      {/* ── ERP Table Container Card ── */}
      <div className="bg-white rounded-xl border border-slate-300 shadow-xs overflow-hidden">
        {/* Table Subheader Bar with Search & Export Buttons (matching HMS) */}
        <div className="p-3.5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/80">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">Income &amp; Expense Ledger</h2>
            <span className="text-xs text-slate-500 font-medium">
              ({totalRecords} records)
            </span>
            <span className="text-xs text-slate-400 font-medium border-l border-slate-200 pl-2">
              Period: <span className="font-semibold text-slate-700">{appliedFilters.fromDate} to {appliedFilters.toDate}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search reference, customer, payee…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApply()}
                className="w-64 h-8 pl-8 pr-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0c6b50]"
              />
            </div>

            {/* Export Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleExport('excel')}
                disabled={filteredRows.length === 0}
                className="h-8 px-2.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('csv')}
                disabled={filteredRows.length === 0}
                className="h-8 px-2.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5 text-blue-600" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('print')}
                disabled={filteredRows.length === 0}
                className="h-8 px-2.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Printer className="h-3.5 w-3.5 text-slate-600" />
                <span>Print / PDF</span>
              </button>
            </div>
          </div>
        </div>

        {/* Table View */}
        {isLoading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-500">
            <div className="h-8 w-8 border-2 border-[#0c6b50] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-semibold">Loading daily income &amp; expense transactions…</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-800">Failed to load Income &amp; Expense data.</p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-20 text-center">
            <Receipt className="h-10 w-10 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-700">No transactions found for the selected filters.</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Try adjusting the period, channel, or transaction type.</p>
          </div>
        ) : (
          <div className="w-full min-w-0 max-w-full overflow-x-auto" role="region" aria-label="Income and expense transactions" tabIndex={0}>
            <table className="w-full min-w-[1300px] table-fixed border-collapse text-left text-xs [&_td]:align-middle [&_th]:align-middle [&_th]:whitespace-normal [&_th]:break-normal [&_th]:leading-4">
              <colgroup>
                <col style={{ width: 44 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 230 }} />
                <col style={{ width: 125 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 44 }} />
              </colgroup>
              <thead>
                <tr className="bg-[#f1f5f9] border-b border-slate-300 text-slate-800 text-[11px] font-bold uppercase tracking-wider sticky top-0 z-10 whitespace-nowrap">
                  <th className="w-12 py-2.5 px-3 text-center border-r border-slate-300 font-bold text-slate-700">#</th>
                  <th className="py-2.5 px-3 text-left border-r border-slate-300">Date &amp; Time</th>
                  <th className="py-2.5 px-3 text-left border-r border-slate-300">Reference ID</th>
                  <th className="py-2.5 px-3 text-left border-r border-slate-300">Channel / Type</th>
                  <th className="py-2.5 px-3 text-left border-r border-slate-300">Description / Payee</th>
                  <th className="py-2.5 px-3 text-left border-r border-slate-300">Status</th>
                  <th className="py-2.5 px-3 text-right border-r border-slate-300">Recognized Income</th>
                  <th className="py-2.5 px-3 text-right border-r border-slate-300">Collections</th>
                  <th className="py-2.5 px-3 text-right border-r border-slate-300">Expenses</th>
                  <th className="py-2.5 px-3 text-left border-r border-slate-300">Payment Method</th>
                  <th className="py-2.5 px-3 text-right border-r border-slate-300">Outstanding</th>
                  <th className="py-2.5 px-3 text-left border-r border-slate-300">Staff / Collector</th>
                  <th className="py-2.5 px-2 text-center w-12">View</th>
                </tr>
              </thead>
              <tbody className="text-slate-800 font-medium">
                {paginatedRows.map((row, idx) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-200 hover:bg-slate-50/90 transition-colors cursor-pointer text-slate-800 last:border-b-0"
                    onClick={() => setDetailRow(row)}
                  >
                    {/* Serial Number */}
                    <td className="py-2.5 px-3 text-center border-r border-slate-200 text-slate-500 font-mono text-[11px] bg-slate-50/60 whitespace-nowrap">
                      {(page - 1) * limit + idx + 1}
                    </td>

                    {/* Date & Time */}
                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-slate-700 text-[11.5px] border-r border-slate-200">
                      {formatDateTime(row.date)}
                    </td>

                    {/* Reference ID */}
                    <td className="py-2.5 px-3 whitespace-normal font-mono font-semibold text-[#0c6b50] text-[11.5px] hover:underline border-r border-slate-200">
                      <div>{row.reference}</div>
                      {row.invoiceRef && row.invoiceRef !== row.reference && (
                        <div className="text-[10px] text-slate-500 font-mono font-normal">
                          Inv: {row.invoiceRef}
                        </div>
                      )}
                    </td>

                    {/* Channel / Type (Clean ERP Plain Text, NO Pill Boxes or Background Colors) */}
                    <td className="py-2.5 px-3 whitespace-normal text-xs border-r border-slate-200">
                      <div className="font-semibold text-slate-800 leading-tight">
                        {row.transactionType === 'Outstanding Invoice Collection' ? 'Collection' : row.transactionType}
                      </div>
                      <div className="text-[10px] text-slate-400 font-medium mt-0.5 leading-tight">
                        {row.channel === 'HMS' ? 'HMS Dispense' : row.channel === 'RETAIL' ? 'Retail POS' : 'Expense Overheads'}
                      </div>
                    </td>

                    {/* Description / Customer / Payee */}
                    <td className="py-2.5 px-3 max-w-[230px] truncate border-r border-slate-200 overflow-hidden" title={row.description}>
                      <div className="font-bold text-slate-900 text-xs truncate block">{row.description}</div>
                    </td>

                    {/* Status (Formatted Clean Text, NO Overflow) */}
                    <td className="py-2.5 px-3 whitespace-nowrap text-xs border-r border-slate-200">
                      {row.status.toUpperCase() === 'PAID' || row.status.toUpperCase() === 'COMPLETED' || row.status.toUpperCase() === 'APPROVED' || row.status.toUpperCase() === 'COLLECTED' ? (
                        <span className="font-bold text-emerald-600">
                          {row.status.toUpperCase() === 'COLLECTED' ? 'Collected' : 'Paid'}
                        </span>
                      ) : row.status.toUpperCase() === 'PARTIALLY_PAID' || row.status.toUpperCase() === 'PARTIAL' ? (
                        <span className="font-bold text-amber-600">Partially Paid</span>
                      ) : row.status.toUpperCase() === 'REFUNDED' || row.status.toUpperCase() === 'REVERSED' || row.status.toUpperCase() === 'VOID' ? (
                        <span className="font-bold text-rose-600">Refunded</span>
                      ) : row.status.toUpperCase() === 'UNPAID' ? (
                        <span className="font-semibold text-slate-400">Unpaid</span>
                      ) : (
                        <span className="font-semibold text-slate-500">{row.status}</span>
                      )}
                    </td>

                    {/* Recognized Income */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap text-xs font-mono font-semibold border-r border-slate-200 text-slate-900">
                      {row.income > 0 ? formatPKR(row.income) : <span className="text-slate-400 font-normal">—</span>}
                    </td>

                    {/* Collections */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap text-xs font-mono font-semibold border-r border-slate-200 text-emerald-700">
                      {row.collections > 0 ? `+${formatPKR(row.collections)}` : <span className="text-slate-400 font-normal">—</span>}
                    </td>

                    {/* Expenses */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap text-xs font-mono font-semibold border-r border-slate-200 text-rose-700">
                      {row.expenses > 0 ? `-${formatPKR(row.expenses)}` : <span className="text-slate-400 font-normal">—</span>}
                    </td>

                    {/* Payment Method */}
                    <td className="py-2.5 px-3 whitespace-normal text-slate-700 text-xs border-r border-slate-200">
                      {row.paymentMethod || '—'}
                    </td>

                    {/* Outstanding */}
                    <td className="py-2.5 px-3 text-right whitespace-nowrap text-xs font-mono font-semibold border-r border-slate-200 text-amber-700">
                      {row.outstanding > 0 ? formatPKR(row.outstanding) : <span className="text-slate-400 font-normal">0.00</span>}
                    </td>

                    {/* Staff / Collector */}
                    <td className="py-2.5 px-3 whitespace-normal text-slate-700 text-xs border-r border-slate-200 truncate" title={row.user}>
                      {row.user}
                    </td>

                    {/* View Action */}
                    <td className="py-2.5 px-2 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailRow(row);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-[#0c6b50] hover:bg-emerald-50 transition-colors cursor-pointer"
                        title="View details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* ── Table Column-Wise Totals Row (Matching HMS tfoot) ── */}
              <tfoot>
                <tr className="bg-[#f1f5f9] font-bold text-slate-900 border-t-2 border-slate-300 text-xs whitespace-nowrap sticky bottom-0">
                  <td colSpan={6} className="py-2.5 px-3 text-right uppercase tracking-wider text-slate-700 text-[10.5px] font-bold border-r border-slate-300">
                    Matching Report Rows:
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 border-r border-slate-300">
                    {formatPKR(filteredTotals.income)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 border-r border-slate-300">
                    {filteredTotals.collections > 0 ? `+${formatPKR(filteredTotals.collections)}` : formatPKR(0)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-700 border-r border-slate-300">
                    {filteredTotals.expenses > 0 ? `-${formatPKR(filteredTotals.expenses)}` : formatPKR(0)}
                  </td>
                  <td className="py-2.5 px-3 text-center border-r border-slate-300 text-slate-400 font-normal">
                    —
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700 border-r border-slate-300">
                    {formatPKR(filteredTotals.outstanding)}
                  </td>
                  <td colSpan={2} className="py-2.5 px-3 text-center text-slate-400 font-normal">
                    —
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ── Financial Summary (Compact Full-Width Rows, matching HMS M01) ── */}
        <table className="w-full border-collapse bg-white text-xs border-t border-slate-200" aria-label="Income and expense summary footer">
          <tbody>
            <tr className="text-slate-700 hover:bg-slate-50/50">
              <th scope="row" className="border border-slate-200 px-4 py-2 text-left font-semibold">
                Total Customer Collections (Net of Customer Returns &amp; Reversals)
              </th>
              <td className="w-48 whitespace-nowrap border border-slate-200 px-4 py-2 text-right font-mono font-bold tabular-nums text-slate-900">
                {formatPKR(totals?.collections ?? filteredTotals.collections)}
              </td>
            </tr>
            <tr className="text-slate-700 hover:bg-slate-50/50">
              <th scope="row" className="border border-slate-200 px-4 py-2 text-left font-semibold">
                Actual Paid Operating Expenses (Utilities, Rent, Consumables &amp; Overheads)
              </th>
              <td className="w-48 whitespace-nowrap border border-slate-200 px-4 py-2 text-right font-mono font-bold tabular-nums text-slate-900">
                {formatPKR(totals?.operatingExpenses ?? filteredTotals.expenses)}
              </td>
            </tr>
            <tr className="bg-emerald-50 text-[#0c6b50] font-bold hover:bg-emerald-100/50">
              <th scope="row" className="border border-slate-200 px-4 py-2 text-left font-bold">
                Net Cash Movement (Collections − Paid Expenses)
              </th>
              <td className="w-48 whitespace-nowrap border border-slate-200 px-4 py-2 text-right font-mono font-bold tabular-nums">
                {formatPKR(Number(totals?.collections ?? filteredTotals.collections) - Number(totals?.operatingExpenses ?? filteredTotals.expenses))}
              </td>
            </tr>
            <tr className="text-slate-700 hover:bg-slate-50/50">
              <th scope="row" className="border border-slate-200 px-4 py-2 text-left font-semibold">
                Current Remaining Customer Dues (Outstanding Receivables)
              </th>
              <td className="w-48 whitespace-nowrap border border-slate-200 px-4 py-2 text-right font-mono font-bold tabular-nums text-amber-700">
                {formatPKR(totals?.outstanding ?? filteredTotals.outstanding)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── Pagination Footer Bar (Default 25 Rows, matching HMS) ── */}
        {totalRecords > 0 && (
          <div className="p-3 border-t border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span>Show</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="h-7 px-2 rounded border border-slate-200 bg-white font-semibold text-slate-800"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>entries · Page {page} of {totalPages} ({totalRecords} records)</span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-700 font-semibold disabled:opacity-40 hover:bg-slate-100 flex items-center gap-1 cursor-pointer transition"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Previous</span>
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-700 font-semibold disabled:opacity-40 hover:bg-slate-100 flex items-center gap-1 cursor-pointer transition"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Transaction Detail Modal ── */}
      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-[#0c6b50]" />
                <h3 className="font-bold text-sm text-slate-900">Transaction Details</h3>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-800">
                  {detailRow.reference}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDetailRow(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 pb-3 border-b border-slate-150">
                <div>
                  <span className="text-slate-500 block text-[11px]">Date &amp; Time</span>
                  <span className="font-medium text-slate-900">{formatDateTime(detailRow.date)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Transaction Type</span>
                  <span className="font-semibold text-slate-900">{detailRow.transactionType}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Reference / Receipt</span>
                  <span className="font-mono font-medium text-[#0c6b50]">{detailRow.reference}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Payment Method</span>
                  <span className="font-medium text-slate-900">{detailRow.paymentMethod}</span>
                </div>
                {detailRow.invoiceRef && (
                  <div>
                    <span className="text-slate-500 block text-[11px]">Linked Invoice</span>
                    <span className="font-mono font-medium text-slate-800">{detailRow.invoiceRef}</span>
                  </div>
                )}
                <div>
                  <span className="text-slate-500 block text-[11px]">Channel / Source</span>
                  <span className="font-medium text-slate-900">
                    {detailRow.channel === 'HMS' ? 'HMS Inpatient Dispense' : detailRow.channel === 'RETAIL' ? 'Retail Walk-In POS' : 'Operating Expenses'}
                  </span>
                </div>
              </div>

              {detailRow.sourceType === 'COLLECTION' ? (
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between text-slate-600">
                    <span>Transaction Class:</span>
                    <span className="font-semibold text-blue-700">Outstanding Invoice Collection</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 text-emerald-700 font-bold">
                    <span>Actual Collection Received:</span>
                    <span className="font-mono">+{formatPKR(detailRow.collections)}</span>
                  </div>
                  <div className="flex justify-between text-amber-700 font-semibold border-t border-slate-200 pt-1.5">
                    <span>Remaining Balance After Receipt:</span>
                    <span className="font-mono">{formatPKR(detailRow.outstanding)}</span>
                  </div>
                  {detailRow.raw?.linkedInvoice?.outstanding != null && (
                    <div className="flex justify-between text-slate-500 text-[11px]">
                      <span>Current Invoice Balance:</span>
                      <span className="font-mono">{formatPKR(Number(detailRow.raw.linkedInvoice.outstanding))}</span>
                    </div>
                  )}
                </div>
              ) : detailRow.sourceType === 'RETURN' ? (
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between text-slate-600">
                    <span>Transaction Class:</span>
                    <span className="font-semibold text-amber-700">Sales Return / Customer Refund</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 text-rose-700 font-bold">
                    <span>Refund Paid Out / Reversed:</span>
                    <span className="font-mono">{formatPKR(detailRow.collections)}</span>
                  </div>
                  <div className="flex justify-between text-slate-700 font-semibold border-t border-slate-200 pt-1.5">
                    <span>Remaining Balance:</span>
                    <span className="font-mono">{formatPKR(detailRow.outstanding)}</span>
                  </div>
                </div>
              ) : detailRow.sourceType === 'INVOICE' ? (
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Gross Sales Value:</span>
                    <span className="font-mono font-medium">{formatPKR(detailRow.raw?.grossSales ?? detailRow.income)}</span>
                  </div>
                  {Number(detailRow.raw?.discount || 0) > 0 && (
                    <div className="flex justify-between text-rose-600">
                      <span>Discount / Returns:</span>
                      <span className="font-mono">−{formatPKR(detailRow.raw.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold text-slate-900">
                    <span>Recognized Net Income:</span>
                    <span className="font-mono">{formatPKR(detailRow.income)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>Initial Collection at Sale:</span>
                    <span className="font-mono">+{formatPKR(detailRow.collections)}</span>
                  </div>
                  <div className="flex justify-between text-amber-700 font-semibold border-t border-slate-200 pt-1.5">
                    <span>Remaining Balance After Sale:</span>
                    <span className="font-mono">{formatPKR(detailRow.outstanding)}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Expense Category:</span>
                    <span className="font-semibold text-slate-900">{detailRow.raw?.category || 'Operating Expense'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Payee / Vendor:</span>
                    <span className="font-medium">{detailRow.raw?.payeeOrVendor || '—'}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-rose-700">
                    <span>Approved Expense Amount:</span>
                    <span className="font-mono">−{formatPKR(detailRow.expenses)}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2 text-[11px] text-slate-500">
                <div>
                  <span>Handled / Recorded By: </span>
                  <strong className="text-slate-800">{detailRow.user}</strong>
                </div>
                <div>
                  <span>Status: </span>
                  <strong className="text-slate-800">{detailRow.status}</strong>
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 text-right">
              <button
                type="button"
                onClick={() => setDetailRow(null)}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
