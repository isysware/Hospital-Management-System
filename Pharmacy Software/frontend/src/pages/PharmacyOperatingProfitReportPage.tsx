import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  RotateCcw,
  Eye,
  Filter,
  FileSpreadsheet,
  Download,
  Printer,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  Receipt,
} from 'lucide-react';
import apiClient from '../services/apiClient';
import { useAuth } from '../context/AuthContext';
import { formatPKR, formatDateTime } from '../utils/format';
import { exportToCSV, exportToExcel, printFinancialReport } from '../utils/reportExportUtils';
import { ALL_REPORTS_LIST } from '../components/ReportView';

type PeriodPreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'custom';

const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'custom', label: 'Custom Range' },
];

function getPKTDate(): Date {
  return new Date(Date.now() + 5 * 3600000);
}

function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getPriorPeriodRange(fromStr: string, toStr: string, preset: PeriodPreset): { from: string; to: string; label: string } {
  const fromD = new Date(fromStr);
  const toD = new Date(toStr);
  const durationMs = toD.getTime() - fromD.getTime() + 86400000;

  if (preset === 'today') {
    const y = new Date(fromD.getTime() - 86400000);
    const yStr = formatDateISO(y);
    return { from: yStr, to: yStr, label: 'Yesterday' };
  }
  if (preset === 'yesterday') {
    const d2 = new Date(fromD.getTime() - 86400000);
    const d2Str = formatDateISO(d2);
    return { from: d2Str, to: d2Str, label: 'Prior Day' };
  }
  if (preset === 'this_month') {
    const curYear = parseInt(fromStr.slice(0, 4), 10);
    const curMonth = parseInt(fromStr.slice(5, 7), 10);
    const lastMonth = curMonth === 1 ? 12 : curMonth - 1;
    const lastYear = curMonth === 1 ? curYear - 1 : curYear;
    const mStr = String(lastMonth).padStart(2, '0');
    const start = `${lastYear}-${mStr}-01`;
    const lastDay = new Date(lastYear, lastMonth, 0).getDate();
    const end = `${lastYear}-${mStr}-${String(lastDay).padStart(2, '0')}`;
    return { from: start, to: end, label: 'Last Month' };
  }

  // Generic prior window of equal duration
  const priorToD = new Date(fromD.getTime() - 86400000);
  const priorFromD = new Date(priorToD.getTime() - durationMs + 86400000);
  return {
    from: formatDateISO(priorFromD),
    to: formatDateISO(priorToD),
    label: `${formatDateISO(priorFromD)} to ${formatDateISO(priorToD)}`,
  };
}

export interface StatementRow {
  key: string;
  label: string;
  section: string;
  type: 'LINE' | 'SUBTOTAL' | 'NET RESULT' | 'INFORMATIONAL';
  current: number;
  prior: number | null;
  percentOfRevenue: number | null;
  variance: number | null;
}

interface Props {
  onNavigate?: (pageId: string) => void;
}

export const PharmacyOperatingProfitReportPage: React.FC<Props> = ({ onNavigate }) => {
  const { currentUser } = useAuth();
  const isSales = currentUser?.role === 'SALES_DISPENSING';
  const todayISO = formatDateISO(getPKTDate());

  // Filter States
  const [preset, setPreset] = useState<PeriodPreset>('today');
  const [fromDate, setFromDate] = useState<string>(todayISO);
  const [toDate, setToDate] = useState<string>(todayISO);
  const [comparison, setComparison] = useState<'previous' | 'none'>('previous');

  // Applied Filters
  const [appliedFilters, setAppliedFilters] = useState({
    preset: 'today' as PeriodPreset,
    fromDate: todayISO,
    toDate: todayISO,
    comparison: 'previous' as 'previous' | 'none',
  });

  // View state
  const [activeView, setActiveView] = useState<'statement' | 'ledger'>('statement');
  const [ledgerCategory, setLedgerCategory] = useState<string>('ALL');
  const [ledgerSearch, setLedgerSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(25);
  const [detailEntry, setDetailEntry] = useState<any | null>(null);

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
    }
  };

  const handleApply = () => {
    setAppliedFilters({
      preset,
      fromDate,
      toDate,
      comparison,
    });
    setPage(1);
  };

  const handleReset = () => {
    const todayStr = formatDateISO(getPKTDate());
    setPreset('today');
    setFromDate(todayStr);
    setToDate(todayStr);
    setComparison('previous');
    setAppliedFilters({
      preset: 'today',
      fromDate: todayStr,
      toDate: todayStr,
      comparison: 'previous',
    });
    setPage(1);
  };

  // Compute Prior Range
  const priorRange = useMemo(() => {
    if (appliedFilters.comparison === 'none') return null;
    return getPriorPeriodRange(appliedFilters.fromDate, appliedFilters.toDate, appliedFilters.preset);
  }, [appliedFilters]);

  // Query Current Period Data
  const { data: currentData, isLoading: currentLoading, error: currentError } = useQuery({
    queryKey: ['pharmacy-op-current', appliedFilters.fromDate, appliedFilters.toDate],
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

  // Query Prior Period Data (if comparison enabled)
  const { data: priorData, isLoading: priorLoading } = useQuery({
    queryKey: ['pharmacy-op-prior', priorRange?.from, priorRange?.to],
    queryFn: async () => {
      if (!priorRange) return null;
      const res = await apiClient.get('/reports', {
        params: {
          type: 'OPERATING_PROFIT',
          from: `${priorRange.from}T00:00:00+05:00`,
          to: `${priorRange.to}T23:59:59.999+05:00`,
        },
      });
      return res.data?.data;
    },
    enabled: !!priorRange,
    staleTime: 30 * 1000,
  });

  const loading = currentLoading || (!!priorRange && priorLoading);
  const error = currentError ? 'Failed to generate Operating Profit (P&L) Statement.' : null;

  // Breakdown objects from backend calculations
  const curB = currentData?.breakdown;
  const priB = priorData?.breakdown;
  const curV = currentData?.vendorSummary;
  const priV = priorData?.vendorSummary;

  // Compute Variance Helper
  const calcVar = (cur: number, pri: number | null | undefined): number | null => {
    if (pri == null || pri === 0) return null;
    return ((cur - pri) / Math.abs(pri)) * 100;
  };

  // Build the 6-Column Statement Rows matching HMS Super Admin M04
  const statementSections = useMemo(() => {
    const netRevenue = Number(curB?.netBilling ?? curB?.recognizedRevenue ?? 0);
    const pct = (val: number) => (netRevenue > 0 ? (val / netRevenue) * 100 : null);

    const curGross = Number(curB?.grossSales ?? 0);
    const priGross = priB ? Number(priB.grossSales ?? 0) : null;

    const curDisc = Number(curB?.discounts ?? 0);
    const priDisc = priB ? Number(priB.discounts ?? 0) : null;

    const curNetRev = netRevenue;
    const priNetRev = priB ? Number(priB.netBilling ?? priB.recognizedRevenue ?? 0) : null;

    const curCogs = Number(curB?.medicineCogs ?? 0);
    const priCogs = priB ? Number(priB.medicineCogs ?? 0) : null;

    const curGrossProfit = curNetRev - curCogs;
    const priGrossProfit = priB && priNetRev != null && priCogs != null ? priNetRev - priCogs : null;

    const curOpExp = Number(curB?.operatingExpenses ?? 0);
    const priOpExp = priB ? Number(priB.operatingExpenses ?? 0) : null;

    const curLosses = Number(currentData?.totals?.inventoryLosses ?? 0);
    const priLosses = priB ? Number(priorData?.totals?.inventoryLosses ?? 0) : null;

    const curTotalOverheads = curOpExp + curLosses;
    const priTotalOverheads = priOpExp != null ? priOpExp + (priLosses ?? 0) : null;

    const curNetOpProfit = curGrossProfit - curTotalOverheads;
    const priNetOpProfit = priGrossProfit != null && priTotalOverheads != null ? priGrossProfit - priTotalOverheads : null;

    // Vendor movements
    const curVendPay = Number(curV?.totalVendorPayments ?? 0);
    const priVendPay = priV ? Number(priV.totalVendorPayments ?? 0) : null;

    const curSuppRef = Number(curV?.supplierRefundsReceived ?? 0);
    const priSuppRef = priV ? Number(priV.supplierRefundsReceived ?? 0) : null;

    const curVendOut = Number(curV?.vendorOutstanding ?? 0);
    const priVendOut = priV ? Number(priV.vendorOutstanding ?? 0) : null;

    const curSuppAdv = Number(curV?.supplierAdvances ?? 0);
    const priSuppAdv = priV ? Number(priV.supplierAdvances ?? 0) : null;

    return [
      {
        sectionName: '1. PHARMACY OPERATING REVENUE',
        rows: [
          {
            key: 'grossSales',
            label: 'Gross Medicine Sales (Retail POS & HMS Dispensed)',
            section: '1. PHARMACY OPERATING REVENUE',
            type: 'LINE' as const,
            current: curGross,
            prior: priGross,
            percentOfRevenue: pct(curGross),
            variance: calcVar(curGross, priGross),
          },
          {
            key: 'discounts',
            label: 'Sales Discounts, Patient Returns & Reversals',
            section: '1. PHARMACY OPERATING REVENUE',
            type: 'LINE' as const,
            current: -curDisc,
            prior: priDisc != null ? -priDisc : null,
            percentOfRevenue: pct(-curDisc),
            variance: calcVar(curDisc, priDisc),
          },
          {
            key: 'netRevenue',
            label: 'Net Pharmacy Operating Revenue (excl. sales tax)',
            section: '1. PHARMACY OPERATING REVENUE',
            type: 'SUBTOTAL' as const,
            current: curNetRev,
            prior: priNetRev,
            percentOfRevenue: 100,
            variance: calcVar(curNetRev, priNetRev),
          },
        ],
      },
      {
        sectionName: '2. COST OF GOODS SOLD (COGS)',
        rows: [
          {
            key: 'medicineCogs',
            label: 'Dispensed Medicine Costs (Historical FIFO/Batch Stock Cost)',
            section: '2. COST OF GOODS SOLD (COGS)',
            type: 'LINE' as const,
            current: curCogs,
            prior: priCogs,
            percentOfRevenue: pct(curCogs),
            variance: calcVar(curCogs, priCogs),
          },
          {
            key: 'grossProfit',
            label: 'Gross Profit (Net Revenue − Matched COGS)',
            section: '2. COST OF GOODS SOLD (COGS)',
            type: 'SUBTOTAL' as const,
            current: curGrossProfit,
            prior: priGrossProfit,
            percentOfRevenue: pct(curGrossProfit),
            variance: calcVar(curGrossProfit, priGrossProfit),
          },
        ],
      },
      {
        sectionName: '3. OPERATING OVERHEADS & EXPENSES',
        rows: [
          {
            key: 'operatingExpenses',
            label: 'Pharmacy Operating Expenses (Utilities, Rent, Consumables, Admin)',
            section: '3. OPERATING OVERHEADS & EXPENSES',
            type: 'LINE' as const,
            current: curOpExp,
            prior: priOpExp,
            percentOfRevenue: pct(curOpExp),
            variance: calcVar(curOpExp, priOpExp),
          },
          {
            key: 'inventoryLosses',
            label: 'Damaged & Expired Medicine Stock Losses',
            section: '3. OPERATING OVERHEADS & EXPENSES',
            type: 'LINE' as const,
            current: curLosses,
            prior: priLosses,
            percentOfRevenue: pct(curLosses),
            variance: calcVar(curLosses, priLosses),
          },
          {
            key: 'totalOverheads',
            label: 'Total Operating Overheads & Costs',
            section: '3. OPERATING OVERHEADS & EXPENSES',
            type: 'SUBTOTAL' as const,
            current: curTotalOverheads,
            prior: priTotalOverheads,
            percentOfRevenue: pct(curTotalOverheads),
            variance: calcVar(curTotalOverheads, priTotalOverheads),
          },
        ],
      },
      {
        sectionName: '4. NET OPERATING RESULT',
        rows: [
          {
            key: 'netOperatingProfit',
            label: 'NET OPERATING PROFIT / (LOSS)',
            section: '4. NET OPERATING RESULT',
            type: 'NET RESULT' as const,
            current: curNetOpProfit,
            prior: priNetOpProfit,
            percentOfRevenue: pct(curNetOpProfit),
            variance: calcVar(curNetOpProfit, priNetOpProfit),
          },
        ],
      },
      {
        sectionName: '5. VENDOR PAYMENTS & BALANCES (INFORMATIONAL — EXCLUDED FROM P&L)',
        rows: [
          {
            key: 'vendorPayments',
            label: 'Total Vendor Payments (Cash & Bank Outflow — Capital settlement, not an expense)',
            section: '5. VENDOR PAYMENTS & BALANCES (INFORMATIONAL — EXCLUDED FROM P&L)',
            type: 'INFORMATIONAL' as const,
            current: curVendPay,
            prior: priVendPay,
            percentOfRevenue: null,
            variance: calcVar(curVendPay, priVendPay),
          },
          {
            key: 'supplierRefunds',
            label: 'Supplier Refunds Received',
            section: '5. VENDOR PAYMENTS & BALANCES (INFORMATIONAL — EXCLUDED FROM P&L)',
            type: 'INFORMATIONAL' as const,
            current: curSuppRef,
            prior: priSuppRef,
            percentOfRevenue: null,
            variance: calcVar(curSuppRef, priSuppRef),
          },
          {
            key: 'vendorOutstanding',
            label: 'Vendor Outstanding Payables Balance',
            section: '5. VENDOR PAYMENTS & BALANCES (INFORMATIONAL — EXCLUDED FROM P&L)',
            type: 'INFORMATIONAL' as const,
            current: curVendOut,
            prior: priVendOut,
            percentOfRevenue: null,
            variance: calcVar(curVendOut, priVendOut),
          },
          {
            key: 'supplierAdvances',
            label: 'Supplier Advances / Open Credits',
            section: '5. VENDOR PAYMENTS & BALANCES (INFORMATIONAL — EXCLUDED FROM P&L)',
            type: 'INFORMATIONAL' as const,
            current: curSuppAdv,
            prior: priSuppAdv,
            percentOfRevenue: null,
            variance: calcVar(curSuppAdv, priSuppAdv),
          },
        ],
      },
    ];
  }, [curB, priB, curV, priV, currentData, priorData]);

  // Flattened Statement Rows for Export
  const flatStatementRows = useMemo(() => {
    const list: StatementRow[] = [];
    statementSections.forEach((sec) => {
      sec.rows.forEach((r) => list.push(r));
    });
    return list;
  }, [statementSections]);

  // Detailed Ledger Items (Combined Invoices + Operating Expenses)
  const ledgerItems = useMemo(() => {
    const items: any[] = [];
    (currentData?.invoices || []).forEach((inv: any) => {
      const net = Number(inv.netBilling || inv.grossSales || 0);
      const cogs = Number(inv.recognizedCogs || 0);
      const gp = net - cogs;
      items.push({
        id: `inv-${inv.invoiceNumber}`,
        date: inv.createdAt,
        reference: inv.invoiceNumber,
        category: inv.channel === 'HMS' ? 'HMS Dispense' : 'Retail POS',
        type: 'INVOICE',
        description: inv.customerName || (inv.channel === 'HMS' ? 'Inpatient Prescription' : 'Walk-In Customer'),
        revenue: net,
        cogs,
        grossProfit: gp,
        collections: Number(inv.collections || 0),
        outstanding: Number(inv.outstanding || 0),
        expenseAmount: 0,
        actor: inv.collectedBy || inv.soldBy || 'Staff',
        status: inv.status || 'POSTED',
        raw: inv,
      });
    });

    (currentData?.expenses || []).forEach((exp: any) => {
      items.push({
        id: `exp-${exp.id || exp.expenseNumber}`,
        date: exp.date || exp.createdAt,
        reference: exp.expenseNumber || 'EXP-GEN',
        category: 'Operating Expense',
        type: 'EXPENSE',
        description: `${exp.category || 'Expense'}${exp.description ? ` · ${exp.description}` : ''}${exp.payeeOrVendor ? ` (${exp.payeeOrVendor})` : ''}`,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        collections: 0,
        outstanding: 0,
        expenseAmount: Number(exp.amount || 0),
        actor: exp.enteredBy || exp.approvedBy || 'Staff',
        status: exp.approvedBy ? 'APPROVED' : 'PENDING',
        raw: exp,
      });
    });

    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [currentData]);

  // Filter Detailed Ledger Items
  const filteredLedger = useMemo(() => {
    return ledgerItems.filter((item) => {
      if (ledgerCategory !== 'ALL' && item.category !== ledgerCategory) return false;
      if (ledgerSearch.trim()) {
        const q = ledgerSearch.toLowerCase();
        const mRef = item.reference.toLowerCase().includes(q);
        const mDesc = item.description.toLowerCase().includes(q);
        const mAct = item.actor.toLowerCase().includes(q);
        if (!mRef && !mDesc && !mAct) return false;
      }
      return true;
    });
  }, [ledgerItems, ledgerCategory, ledgerSearch]);

  const totalLedgerRecords = filteredLedger.length;
  const totalLedgerPages = Math.ceil(totalLedgerRecords / limit) || 1;
  const paginatedLedger = useMemo(() => {
    const start = (page - 1) * limit;
    return filteredLedger.slice(start, start + limit);
  }, [filteredLedger, page, limit]);

  // Totals for detailed ledger footer
  const ledgerTotals = useMemo(() => {
    let rev = 0;
    let cogs = 0;
    let gp = 0;
    let exp = 0;
    let col = 0;
    filteredLedger.forEach((it) => {
      rev += it.revenue;
      cogs += it.cogs;
      gp += it.grossProfit;
      exp += it.expenseAmount;
      col += it.collections;
    });
    return { rev, cogs, gp, exp, col };
  }, [filteredLedger]);

  // Export Handler
  const handleExport = (format: 'excel' | 'csv' | 'print') => {
    const periodLabel = `${appliedFilters.fromDate} to ${appliedFilters.toDate}`;

    if (activeView === 'statement') {
      const columns = [
        { header: 'Financial Line Item', key: 'label' },
        { header: 'Section / Type', key: 'type' },
        {
          header: 'Current Period (PKR)',
          format: (r: StatementRow) => (r.current !== 0 ? formatPKR(r.current) : '0'),
          numeric: true,
        },
        {
          header: '% of Revenue',
          format: (r: StatementRow) => (r.percentOfRevenue != null ? `${r.percentOfRevenue.toFixed(1)}%` : '—'),
        },
        {
          header: `Prior Period (${priorRange?.label || 'Prior'})`,
          format: (r: StatementRow) => (r.prior != null ? (r.prior !== 0 ? formatPKR(r.prior) : '0') : 'N/A'),
          numeric: true,
        },
        {
          header: 'Variance / Growth',
          format: (r: StatementRow) => (r.variance != null ? `${r.variance >= 0 ? '+' : ''}${r.variance.toFixed(2)}%` : '—'),
        },
      ];

      const opts = {
        title: 'Pharmacy Operating Profit (P&L) Statement',
        subtitle: 'Accrual-based financial statement measuring medicine sales, recognized COGS, and operating overheads',
        periodLabel,
        userName: currentUser?.fullName || currentUser?.username,
        filename: 'Pharmacy_Operating_Profit_Statement',
        columns,
        data: flatStatementRows,
      };

      if (format === 'excel') exportToExcel(opts);
      else if (format === 'csv') exportToCSV(opts);
      else if (format === 'print') printFinancialReport(opts);
    } else {
      // Detailed Ledger Export
      const columns = [
        { header: 'Date & Time', format: (r: any) => formatDateTime(r.date) },
        { header: 'Reference ID', key: 'reference' },
        { header: 'Category', key: 'category' },
        { header: 'Description / Payee', key: 'description' },
        { header: 'Recognized Revenue (PKR)', format: (r: any) => (r.revenue > 0 ? formatPKR(r.revenue) : '—'), numeric: true },
        { header: 'Recognized COGS (PKR)', format: (r: any) => (r.cogs > 0 ? formatPKR(r.cogs) : '—'), numeric: true },
        { header: 'Gross Profit (PKR)', format: (r: any) => (r.revenue > 0 ? formatPKR(r.grossProfit) : '—'), numeric: true },
        { header: 'Operating Expense (PKR)', format: (r: any) => (r.expenseAmount > 0 ? formatPKR(r.expenseAmount) : '—'), numeric: true },
        { header: 'Actual Collections (PKR)', format: (r: any) => (r.collections > 0 ? formatPKR(r.collections) : '—'), numeric: true },
        { header: 'Outstanding (PKR)', format: (r: any) => (r.outstanding > 0 ? formatPKR(r.outstanding) : '—'), numeric: true },
        { header: 'Staff / Collector', key: 'actor' },
        { header: 'Status', key: 'status' },
      ];

      const opts = {
        title: 'Pharmacy Operating Profit — Detailed Transaction Ledger',
        subtitle: 'Itemized sales transactions and operating expenses contributing to P&L',
        periodLabel,
        userName: currentUser?.fullName || currentUser?.username,
        filename: 'Pharmacy_P&L_Detailed_Ledger',
        columns,
        data: filteredLedger,
      };

      if (format === 'excel') exportToExcel(opts);
      else if (format === 'csv') exportToCSV(opts);
      else if (format === 'print') printFinancialReport(opts);
    }
  };

  return (
    <div className="min-w-0 max-w-full space-y-4 p-4 sm:p-6 lg:p-8 max-w-[1700px] mx-auto">
      {/* ── Top Report Switcher Tabs ─────────────────────────────────── */}
      {onNavigate && !isSales && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-200 -mt-1">
          {ALL_REPORTS_LIST.map((tab) => {
            const isActive = tab.page === 'reports-operating-profit';
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
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Operating Profit (P&L)</h1>
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
              (Accrual Statement)
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Consolidated pharmacy earned revenue, matched batch COGS, recognized operating expenses and net margin.
          </p>
        </div>
      </div>

      {/* ── Advanced Filter Panel (Compact Bordered Card) ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-2.5">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700 pb-1.5 border-b border-slate-100">
          <Filter className="h-3.5 w-3.5 text-[#0c6b50]" />
          <span>Statement Filters</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {/* 1. Period Preset */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Period</label>
            <select
              value={preset}
              onChange={(e) => handlePresetChange(e.target.value as PeriodPreset)}
              className="w-full h-8.5 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0c6b50]"
            >
              {PERIOD_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
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

          {/* 4. Prior Period Comparison */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Prior Period Comparison</label>
            <select
              value={comparison}
              onChange={(e) => setComparison(e.target.value as 'previous' | 'none')}
              className="w-full h-8.5 px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0c6b50]"
            >
              <option value="previous">Previous Equivalent Period</option>
              <option value="none">None (Current Period Only)</option>
            </select>
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={handleReset}
            title="Reset filters"
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
            <span>Generate Statement</span>
          </button>
        </div>
      </div>

      {/* ── Statement Toolbar & View Toggle (Exact HMS M04 Layout) ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left side: Statement title and View Toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">Accounting P&L Statement (Accrual)</h2>
            <div className="text-[11px] text-slate-500 font-normal">
              Period: {appliedFilters.fromDate} to {appliedFilters.toDate}
              {priorRange ? ` · Prior: ${priorRange.label}` : ''}
            </div>
          </div>

          {/* Toggle Buttons matching HMS structural reference */}
          <div className="inline-flex rounded-lg border border-slate-300 p-0.5 bg-slate-100">
            <button
              type="button"
              onClick={() => setActiveView('statement')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                activeView === 'statement'
                  ? 'bg-[#0c6b50] text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Statement View
            </button>
            <button
              type="button"
              onClick={() => setActiveView('ledger')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                activeView === 'ledger'
                  ? 'bg-[#0c6b50] text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Detailed Ledger ({ledgerItems.length})
            </button>
          </div>
        </div>

        {/* Right side: Export buttons on same statement toolbar */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleExport('excel')}
            className="h-8 px-2.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="h-8 px-2.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-blue-600" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={() => handleExport('print')}
            className="h-8 px-2.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Printer className="h-3.5 w-3.5 text-slate-600" />
            <span>Print / PDF</span>
          </button>
        </div>
      </div>

      {/* ── Content View ── */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-xs">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-3 border-solid border-[#0c6b50] border-r-transparent" />
          <div className="text-xs font-medium text-slate-500 mt-2">Computing Financial P&amp;L Statement...</div>
        </div>
      ) : error ? (
        <div className="bg-white border border-rose-200 rounded-xl p-8 text-center text-rose-600 text-xs shadow-xs">
          {error}
        </div>
      ) : activeView === 'statement' ? (
        /* ══════════════════════════════════════════════════════════════════
           STATEMENT VIEW — 6 Columns Matching HMS Super Admin Reference
           ══════════════════════════════════════════════════════════════════ */
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-300 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-2.5 px-3 text-left border-r border-slate-200 min-w-[280px]">
                    Financial Line Item
                  </th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 w-[120px]">
                    Section / Type
                  </th>
                  <th className="py-2.5 px-3 text-right border-r border-slate-200 w-[160px]">
                    Current Period (PKR)
                  </th>
                  <th className="py-2.5 px-3 text-right border-r border-slate-200 w-[110px]">
                    % of Revenue
                  </th>
                  <th className="py-2.5 px-3 text-right border-r border-slate-200 w-[160px]">
                    Prior Period (PKR)
                  </th>
                  <th className="py-2.5 px-3 text-right w-[140px]">
                    Variance / Growth
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {statementSections.map((sec) => (
                  <React.Fragment key={sec.sectionName}>
                    {/* Section Banner Header Row */}
                    <tr className="bg-slate-100 border-t-2 border-b border-slate-300">
                      <td colSpan={6} className="py-2 px-3 text-[11px] font-bold text-slate-900 uppercase tracking-wider">
                        {sec.sectionName}
                      </td>
                    </tr>

                    {/* Section Rows */}
                    {sec.rows.map((row) => {
                      const isSubtotal = row.type === 'SUBTOTAL';
                      const isNetResult = row.type === 'NET RESULT';
                      const isInformational = row.type === 'INFORMATIONAL';

                      let rowClass = 'hover:bg-slate-50/60 transition';
                      let textClass = 'text-slate-800';

                      if (isNetResult) {
                        rowClass = 'bg-emerald-50/70 border-t-2 border-b-2 border-emerald-300 font-bold';
                        textClass = 'text-[#0c6b50] font-bold text-[13px]';
                      } else if (isSubtotal) {
                        rowClass = 'bg-slate-50/90 border-t border-b border-slate-300 font-bold';
                        textClass = 'text-slate-900 font-bold';
                      } else if (isInformational) {
                        rowClass = 'hover:bg-slate-50/70 transition bg-slate-50/40 text-slate-700';
                      }

                      return (
                        <tr key={row.key} className={rowClass}>
                          {/* Financial Line Item */}
                          <td className={`py-2 px-3 border-r border-slate-200 ${textClass}`}>
                            <div className="flex items-center gap-1.5">
                              {!isSubtotal && !isNetResult && (
                                <span className="text-slate-400 font-normal select-none">•</span>
                              )}
                              <span>{row.label}</span>
                            </div>
                          </td>

                          {/* Section / Type */}
                          <td className="py-2 px-3 text-center border-r border-slate-200 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                            {isInformational ? (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-bold border border-slate-200">
                                INFORMATIONAL
                              </span>
                            ) : (
                              row.type
                            )}
                          </td>

                          {/* Current Period (PKR) */}
                          <td className={`py-2 px-3 text-right border-r border-slate-200 font-mono ${textClass}`}>
                            {row.current !== 0 ? formatPKR(row.current) : '0.00'}
                          </td>

                          {/* % of Revenue */}
                          <td className="py-2 px-3 text-right border-r border-slate-200 font-mono font-medium text-slate-700">
                            {isInformational ? (
                              '—'
                            ) : row.percentOfRevenue != null ? (
                              `${row.percentOfRevenue.toFixed(1)}%`
                            ) : (
                              '—'
                            )}
                          </td>

                          {/* Prior Period (PKR) */}
                          <td className="py-2 px-3 text-right border-r border-slate-200 font-mono text-slate-600">
                            {row.prior != null ? (row.prior !== 0 ? formatPKR(row.prior) : '0.00') : 'N/A'}
                          </td>

                          {/* Variance / Growth */}
                          <td className="py-2 px-3 text-right font-mono">
                            {row.variance != null ? (
                              <span
                                className={`inline-flex items-center gap-0.5 font-bold ${
                                  row.variance > 0
                                    ? row.key.toLowerCase().includes('expense') || row.key.toLowerCase().includes('cogs') || row.key.toLowerCase().includes('loss')
                                      ? 'text-rose-600'
                                      : 'text-emerald-700'
                                    : row.variance < 0
                                    ? row.key.toLowerCase().includes('expense') || row.key.toLowerCase().includes('cogs') || row.key.toLowerCase().includes('loss')
                                      ? 'text-emerald-700'
                                      : 'text-rose-600'
                                    : 'text-slate-500'
                                }`}
                              >
                                {row.variance > 0 ? '+' : ''}
                                {row.variance.toFixed(2)}%
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ══════════════════════════════════════════════════════════════════
           DETAILED LEDGER VIEW — Itemized Invoices & Expenses
           ══════════════════════════════════════════════════════════════════ */
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={ledgerSearch}
                onChange={(e) => {
                  setLedgerSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search invoice #, customer, payee..."
                className="w-full text-xs pl-8 pr-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#0c6b50]"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold text-slate-600">Category:</label>
              <select
                value={ledgerCategory}
                onChange={(e) => {
                  setLedgerCategory(e.target.value);
                  setPage(1);
                }}
                className="text-xs border border-slate-300 rounded-lg p-1.5 bg-white text-slate-800"
              >
                <option value="ALL">All Categories</option>
                <option value="Retail POS">Retail Walk-In POS</option>
                <option value="HMS Dispense">HMS Inpatient Dispense</option>
                <option value="Operating Expense">Operating Expenses</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-300 shadow-xs overflow-hidden">
            {paginatedLedger.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs">
                No matching transactions found in detailed ledger.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#f1f5f9] border-b border-slate-300 text-slate-800 text-[11px] font-bold uppercase tracking-wider sticky top-0 z-10 whitespace-nowrap">
                      <th className="w-12 py-2.5 px-3 text-center border-r border-slate-300 font-bold text-slate-700">#</th>
                      <th className="py-2.5 px-3 text-left border-r border-slate-300 whitespace-nowrap">Date &amp; Time</th>
                      <th className="py-2.5 px-3 text-left border-r border-slate-300 whitespace-nowrap">Reference ID</th>
                      <th className="py-2.5 px-3 text-center border-r border-slate-300 whitespace-nowrap">Category</th>
                      <th className="py-2.5 px-3 text-left border-r border-slate-300 min-w-[200px]">Description / Payee</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-300 whitespace-nowrap">Net Revenue</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-300 whitespace-nowrap">Matched COGS</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-300 whitespace-nowrap">Gross Profit</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-300 whitespace-nowrap">Operating Expense</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-300 whitespace-nowrap">Collections</th>
                      <th className="py-2.5 px-3 text-left border-r border-slate-300 whitespace-nowrap">Staff</th>
                      <th className="py-2.5 px-3 text-center w-12">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 text-slate-800">
                    {paginatedLedger.map((row, idx) => (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/70 transition cursor-pointer"
                        onClick={() => setDetailEntry(row)}
                      >
                        <td className="py-2 px-3 text-center border-r border-slate-200 text-slate-500 font-mono text-[11px] bg-slate-50/60 whitespace-nowrap">
                          {(page - 1) * limit + idx + 1}
                        </td>
                        <td className="py-2 px-3 text-slate-600 border-r border-slate-200 whitespace-nowrap font-mono">
                          {formatDateTime(row.date)}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 font-mono font-medium text-[#0c6b50] whitespace-nowrap">
                          {row.reference}
                        </td>
                        <td className="py-2 px-3 text-center border-r border-slate-200 whitespace-nowrap">
                          <span className="font-semibold text-slate-700">{row.category}</span>
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 text-slate-800 max-w-[240px] truncate" title={row.description}>
                          {row.description}
                        </td>
                        <td className="py-2 px-3 text-right border-r border-slate-200 font-mono whitespace-nowrap">
                          {row.revenue > 0 ? formatPKR(row.revenue) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right border-r border-slate-200 font-mono whitespace-nowrap text-slate-600">
                          {row.cogs > 0 ? formatPKR(row.cogs) : '—'}
                        </td>
                        <td className={`py-2 px-3 text-right border-r border-slate-200 font-mono font-bold whitespace-nowrap ${
                          row.grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}>
                          {row.revenue > 0 ? formatPKR(row.grossProfit) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right border-r border-slate-200 font-mono font-bold text-rose-700 whitespace-nowrap">
                          {row.expenseAmount > 0 ? formatPKR(row.expenseAmount) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right border-r border-slate-200 font-mono text-emerald-700 whitespace-nowrap">
                          {row.collections > 0 ? formatPKR(row.collections) : '—'}
                        </td>
                        <td className="py-2 px-3 text-left border-r border-slate-200 text-slate-600 whitespace-nowrap">
                          {row.actor}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailEntry(row);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-[#0c6b50] hover:bg-emerald-50 cursor-pointer transition"
                            title="View Transaction Details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  {/* ── Table Totals Row ── */}
                  <tfoot>
                    <tr className="bg-[#f1f5f9] font-bold text-slate-900 border-t-2 border-slate-300 text-xs whitespace-nowrap">
                      <td colSpan={5} className="py-2.5 px-3 text-right uppercase tracking-wider text-slate-700 text-[10.5px] font-bold border-r border-slate-300">
                        Matching Report Rows:
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono border-r border-slate-300 text-slate-900">
                        {formatPKR(ledgerTotals.rev)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono border-r border-slate-300 text-slate-700">
                        {formatPKR(ledgerTotals.cogs)}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-mono border-r border-slate-300 ${
                        ledgerTotals.gp >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}>
                        {formatPKR(ledgerTotals.gp)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono border-r border-slate-300 text-rose-700">
                        {formatPKR(ledgerTotals.exp)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono border-r border-slate-300 text-emerald-700">
                        {formatPKR(ledgerTotals.col)}
                      </td>
                      <td colSpan={2} className="py-2.5 px-3 text-center text-slate-400 font-normal">
                        —
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalLedgerRecords > 0 && (
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
                  <span>entries · Page {page} of {totalLedgerPages} ({totalLedgerRecords} records)</span>
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
                    disabled={page >= totalLedgerPages}
                    onClick={() => setPage((p) => Math.min(totalLedgerPages, p + 1))}
                    className="px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-700 font-semibold disabled:opacity-40 hover:bg-slate-100 flex items-center gap-1 cursor-pointer transition"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Detailed Entry Modal ── */}
      {detailEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-[#0c6b50]" />
                <h3 className="font-bold text-sm text-slate-900">Ledger Entry Details</h3>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-800">
                  {detailEntry.reference}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDetailEntry(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 pb-3 border-b border-slate-150">
                <div>
                  <span className="text-slate-500 block text-[11px]">Date &amp; Time</span>
                  <span className="font-medium text-slate-900">{formatDateTime(detailEntry.date)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Category</span>
                  <span className="font-semibold text-slate-900">{detailEntry.category}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Description</span>
                  <span className="font-medium text-slate-900">{detailEntry.description}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Staff / Actor</span>
                  <span className="font-medium text-slate-900">{detailEntry.actor}</span>
                </div>
              </div>

              {detailEntry.type === 'INVOICE' ? (
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Net Recognized Revenue:</span>
                    <span className="font-mono font-medium">{formatPKR(detailEntry.revenue)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Recognized Batch COGS:</span>
                    <span className="font-mono">−{formatPKR(detailEntry.cogs)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-emerald-700">
                    <span>Gross Profit / Margin:</span>
                    <span className="font-mono">{formatPKR(detailEntry.grossProfit)}</span>
                  </div>
                  <div className="flex justify-between text-slate-700 border-t border-slate-200 pt-1.5">
                    <span>Actual Collections:</span>
                    <span className="font-mono">{formatPKR(detailEntry.collections)}</span>
                  </div>
                  {detailEntry.outstanding > 0 && (
                    <div className="flex justify-between text-amber-700 font-semibold">
                      <span>Uncollected Outstanding:</span>
                      <span className="font-mono">{formatPKR(detailEntry.outstanding)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Expense Category:</span>
                    <span className="font-semibold text-slate-900">{detailEntry.raw?.category || 'Operating Expense'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Payee / Vendor:</span>
                    <span className="font-medium">{detailEntry.raw?.payeeOrVendor || '—'}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-rose-700">
                    <span>Approved Operating Expense:</span>
                    <span className="font-mono">{formatPKR(detailEntry.expenseAmount)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 text-right">
              <button
                type="button"
                onClick={() => setDetailEntry(null)}
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
