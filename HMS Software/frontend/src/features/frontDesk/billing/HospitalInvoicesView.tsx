import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Receipt,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Search,
  RefreshCw,
  X,
  Calendar,
  Plus,
  RotateCcw,
  Eye,
  CreditCard,
  FileSpreadsheet,
  Download,
  FileText,
  Printer,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Banknote,
} from 'lucide-react';
import { formatPKR } from '../../../utils/formatters';
import {
  fetchInvoices,
  InvoiceSummary,
  InvoiceStatus,
  EncounterType,
} from '../../../services/invoiceService';
import { InvoiceDetailModal, InvoiceModalAction } from './InvoiceDetailModal';
import { HospitalKpiHeader } from '../../../components/common/HospitalKpiHeader';
import {
  formatDateISO,
  getHospitalCurrentDate,
} from '../../../utils/dateConstants';
import { useToast } from '../../../context/ToastContext';

export type CareQueueFilter = 'ALL' | 'OPD' | 'ER' | 'OBS' | 'ADM' | 'CUSTOM';
export type PayerFilter = 'ALL' | 'SELF_PAY' | 'PANEL';

/** Record-type filter for the Discounts / Refunds / Payments-Receipts nav items — server-side (see `fetchInvoices`), so it holds across the whole table, not just what's currently loaded. */
export type InvoiceRecordFilter = 'DISCOUNTED' | 'REFUNDED' | 'PAID';

interface HospitalInvoicesViewProps {
  /** When true, only invoices with an outstanding balance are shown by default. */
  outstandingOnly?: boolean;
  /** Legacy prop for backward compatibility */
  encounterTypeFilter?: EncounterType;
  initialQueueFilter?: CareQueueFilter;
  /** Restricts the ledger to only invoices with a discount / a refund / at least one payment — used by the Discounts, Refunds, and Payments-Receipts pages so they show only what actually happened, not every invoice. */
  recordFilter?: InvoiceRecordFilter;
  title?: string;
  subtitle?: string;
}

/**
 * Resolves the operational care/queue category for an invoice:
 * - ADM: Admission / Inpatient stay
 * - ER: Emergency encounter
 * - OBS: Observation bed encounter
 * - CUSTOM: Ad-hoc / Custom Billing encounter (e.g. lab-test-only walk-in)
 * - OPD: Outpatient consultation / walk-in encounter
 */
export function getInvoiceCareQueue(inv: InvoiceSummary): 'OPD' | 'ER' | 'OBS' | 'ADM' | 'CUSTOM' {
  if (inv.sourceType === 'ADMISSION') return 'ADM';
  if (inv.encounterType === 'EMERGENCY') return 'ER';
  if (inv.encounterType === 'OBSERVATION') return 'OBS';
  if (inv.encounterType === 'CUSTOM') return 'CUSTOM';
  return 'OPD';
}

const QUEUE_TABS: { key: CareQueueFilter; label: string }[] = [
  { key: 'ALL', label: 'All Invoices' },
  { key: 'OPD', label: 'OPD (Outpatient)' },
  { key: 'ER', label: 'Emergency (ER)' },
  { key: 'OBS', label: 'Observation (OBS)' },
  { key: 'ADM', label: 'Inpatient (ADM)' },
  { key: 'CUSTOM', label: 'Custom Billing' },
];

export const HospitalInvoicesView: React.FC<HospitalInvoicesViewProps> = ({
  outstandingOnly = false,
  encounterTypeFilter,
  initialQueueFilter,
  recordFilter,
  title = 'Hospital Invoices & Patient Queues',
  subtitle = 'Unified billing ledger across OPD, Emergency (ER), Observation (OBS), Inpatient Admissions (ADM), and Custom Billing.',
}) => {
  // Determine initial queue
  const resolvedInitialQueue: CareQueueFilter = useMemo(() => {
    if (initialQueueFilter) return initialQueueFilter;
    if (encounterTypeFilter === 'OPD') return 'OPD';
    if (encounterTypeFilter === 'EMERGENCY') return 'ER';
    if (encounterTypeFilter === 'OBSERVATION') return 'OBS';
    if (encounterTypeFilter === 'CUSTOM') return 'CUSTOM';
    return 'ALL';
  }, [initialQueueFilter, encounterTypeFilter]);

  const toast = useToast();
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter States
  const [activeQueue, setActiveQueue] = useState<CareQueueFilter>(resolvedInitialQueue);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | InvoiceStatus>('ALL');
  const [payerFilter, setPayerFilter] = useState<PayerFilter>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isOutstandingOnly, setIsOutstandingOnly] = useState(outstandingOnly);

  // Active modal — `openInvoiceAction` pre-selects which form the modal opens
  // into (Add Service / Refund) when triggered from a row's quick-action
  // button, instead of always landing on the plain view.
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [openInvoiceAction, setOpenInvoiceAction] = useState<InvoiceModalAction | undefined>(undefined);

  const openInvoice = (id: string, action?: InvoiceModalAction) => {
    setOpenInvoiceId(id);
    setOpenInvoiceAction(action);
  };

  const closeInvoiceModal = () => {
    setOpenInvoiceId(null);
    setOpenInvoiceAction(undefined);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('invoiceId')) {
        url.searchParams.delete('invoiceId');
        window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
      }
    } catch {
      // ignore
    }
  };

  // Auto-detect and handle deep-linking query parameters (?search=, ?admissionNumber=, ?invoiceId=, ?invoiceNumber=, ?queue=)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlSearch = params.get('search') || params.get('admissionNumber') || params.get('mrNumber') || params.get('invoiceNumber');
      const urlInvoiceId = params.get('invoiceId');
      const urlQueue = params.get('queue') as CareQueueFilter | null;

      if (urlSearch) {
        setSearchTerm(urlSearch);
      }
      if (urlQueue && ['ALL', 'OPD', 'ER', 'OBS', 'ADM', 'CUSTOM'].includes(urlQueue)) {
        setActiveQueue(urlQueue);
      } else if (params.get('admissionNumber')) {
        setActiveQueue('ADM');
      }
      if (urlInvoiceId) {
        setOpenInvoiceId(urlInvoiceId);
      }
    } catch {
      // Ignore URL parsing errors
    }
  }, []);

  const load = useCallback(async (mode: boolean | 'background' = false) => {
    if (mode === true) {
      setIsRefreshing(true);
    } else if (mode === 'background') {
      // Silent background fetch: keep current rows visible with zero flicker
    } else {
      setIsLoading(true);
    }
    setLoadError(null);

    try {
      const data = await fetchInvoices({
        transactions: true,
        hasDiscount: recordFilter === 'DISCOUNTED' ? true : undefined,
        hasRefund: recordFilter === 'REFUNDED' ? true : undefined,
        hasPayment: recordFilter === 'PAID' ? true : undefined,
        hasOutstandingBalance: outstandingOnly ? true : undefined,
      });
      setInvoices(data);
    } catch (err: any) {
      if (mode !== 'background') {
        setLoadError(
          err?.response?.data?.error?.message || err?.message || 'Failed to load invoices from server.'
        );
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [recordFilter, outstandingOnly]);

  // 1. Initial load
  useEffect(() => {
    load();
  }, [load]);

  // 2. Auto-sync on window focus (e.g. when returning to Front Desk from Admission/Pharmacy)
  useEffect(() => {
    const handleFocus = () => {
      load('background');
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [load]);

  // 3. Auto-sync on application events (invoice updated, admission updated, pharmacy synced)
  useEffect(() => {
    const handleAppEvent = () => {
      load('background');
    };
    window.addEventListener('hms-invoice-updated', handleAppEvent);
    window.addEventListener('hms-admission-updated', handleAppEvent);
    window.addEventListener('hms-pharmacy-synced', handleAppEvent);
    return () => {
      window.removeEventListener('hms-invoice-updated', handleAppEvent);
      window.removeEventListener('hms-admission-updated', handleAppEvent);
      window.removeEventListener('hms-pharmacy-synced', handleAppEvent);
    };
  }, [load]);

  // 4. Background auto-polling every 6 seconds when document is visible
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && !openInvoiceId) {
        load('background');
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [load, openInvoiceId]);

  // This component is reused for every Hospital Invoices / Payments /
  // Discounts / Refunds / Outstanding Balances nav item from the SAME
  // switch statement (FrontDeskModuleView.tsx) — React keeps the same
  // instance across those nav clicks (same component type, same tree slot),
  // it only re-renders with new props. Without this, `isOutstandingOnly`'s
  // `useState(outstandingOnly)` initializer never re-runs, so navigating
  // from any other invoices page onto Outstanding Balances silently kept
  // whatever toggle state was already there instead of the page's own
  // intended default — this is what made it show every invoice.
  useEffect(() => {
    setIsOutstandingOnly(outstandingOnly);
  }, [outstandingOnly]);

  // Sync initial prop changes
  useEffect(() => {
    if (resolvedInitialQueue) {
      setActiveQueue(resolvedInitialQueue);
    }
  }, [resolvedInitialQueue]);

  // Live count by queue tab
  const queueCounts = useMemo(() => {
    const counts: Record<CareQueueFilter, number> = { ALL: invoices.length, OPD: 0, ER: 0, OBS: 0, ADM: 0, CUSTOM: 0 };
    invoices.forEach((inv) => {
      const q = getInvoiceCareQueue(inv);
      counts[q] = (counts[q] || 0) + 1;
    });
    return counts;
  }, [invoices]);

  // Helper to get local date string YYYY-MM-DD
  const getLocalDateString = (isoString?: string): string => {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Filtered dataset
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // 1. Queue / Care type filter
      if (activeQueue !== 'ALL') {
        const queue = getInvoiceCareQueue(inv);
        if (queue !== activeQueue) return false;
      }

      // 2. Outstanding only filter
      if (isOutstandingOnly && inv.balanceDue <= 0) return false;

      // 3. Status filter
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;

      // 4. Payer filter
      if (payerFilter === 'SELF_PAY' && inv.payerType !== 'Self Pay') return false;
      if (payerFilter === 'PANEL' && inv.payerType !== 'Corporate / Panel') return false;

      // 5. Custom Date Range filter
      const invDateStr = getLocalDateString(inv.transactionAtIso || inv.createdAtIso);
      if (startDate && invDateStr && invDateStr < startDate) return false;
      if (endDate && invDateStr && invDateStr > endDate) return false;

      // 6. Search query (Patient Name, MR#, Phone, CNIC, Invoice #, Token)
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const qDigits = q.replace(/\D/g, '');
        const numMatch = inv.invoiceNumber.toLowerCase().includes(q);
        const tokenMatch = (inv.queueNumber || '').toLowerCase().includes(q);
        const nameMatch = inv.patientName.toLowerCase().includes(q);
        const mrMatch = (inv.patientMr || '').toLowerCase().includes(q);
        const phoneMatch = !!(
          inv.patientPhone &&
          (inv.patientPhone.toLowerCase().includes(q) ||
            (qDigits.length >= 4 && inv.patientPhone.replace(/\D/g, '').includes(qDigits)))
        );
        const cnicMatch = !!(
          inv.patientCnic &&
          (inv.patientCnic.toLowerCase().includes(q) ||
            (qDigits.length >= 4 && inv.patientCnic.replace(/\D/g, '').includes(qDigits)))
        );
        const receiptMatch = [inv.receiptNumber, inv.receiptMethod, inv.receiptAccount, inv.receiptCollector, inv.transactionType].some(value => value?.toLowerCase().includes(q));
        if (!receiptMatch && !numMatch && !tokenMatch && !nameMatch && !mrMatch && !phoneMatch && !cnicMatch) return false;
      }

      return true;
    }).sort((a, b) => {
      const diff = new Date(a.transactionAtIso || a.createdAtIso).getTime() - new Date(b.transactionAtIso || b.createdAtIso).getTime();
      return (sortDirection === 'asc' ? 1 : -1) * (diff || (a.transactionId || a.id).localeCompare(b.transactionId || b.id));
    });
  }, [invoices, activeQueue, isOutstandingOnly, statusFilter, payerFilter, startDate, endDate, searchTerm, sortDirection]);

  // Summary Metrics of filtered data
  const metrics = useMemo(() => {
    const seen = new Set<string>();
    return filteredInvoices.reduce(
      (acc, i) => {
        acc.totalInvoices += i.transactionType === 'Original Invoice' ? 1 : 0;
        acc.totalGross += i.grossAmount ?? i.subtotal;
        acc.totalDiscount += i.discountAmount ?? i.discountTotal;
        acc.totalBilled += i.billingAmount ?? i.total;
        acc.totalPaid += i.collectedAmount ?? i.paidTotal;
        if (!seen.has(i.id)) acc.totalDue += i.balanceDue;
        seen.add(i.id);
        return acc;
      },
      { totalInvoices: 0, totalGross: 0, totalDiscount: 0, totalBilled: 0, totalPaid: 0, totalDue: 0 }
    );
  }, [filteredInvoices]);

  const hasActiveFilters =
    activeQueue !== 'ALL' ||
    searchTerm.trim() !== '' ||
    statusFilter !== 'ALL' ||
    payerFilter !== 'ALL' ||
    startDate !== '' ||
    endDate !== '' ||
    isOutstandingOnly !== outstandingOnly;

  const resetAllFilters = () => {
    setActiveQueue('ALL');
    setSearchTerm('');
    setStatusFilter('ALL');
    setPayerFilter('ALL');
    setStartDate('');
    setEndDate('');
    setIsOutstandingOnly(outstandingOnly);
  };

  const handleSetToday = () => {
    const todayStr = formatDateISO(getHospitalCurrentDate());
    setStartDate(todayStr);
    setEndDate(todayStr);
  };

  // Pharmacy-style pagination & export states
  const [pageSize, setPageSize] = useState(15);
  const [currentPage, setCurrentPage] = useState(1);

  const paginatedInvoices = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredInvoices.slice(start, start + pageSize);
  }, [filteredInvoices, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(page => Math.min(page, Math.max(1, Math.ceil(filteredInvoices.length / pageSize))));
  }, [filteredInvoices.length, pageSize]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeQueue, statusFilter, payerFilter, startDate, endDate, searchTerm, sortDirection, pageSize, isOutstandingOnly]);

  const handleExportCsv = () => {
    if (filteredInvoices.length === 0) {
      toast.warning('No invoices match the selected filters to export.', 'Export');
      return;
    }
    const headers = ['#', 'Invoice Number', 'Service ID', 'MR #', 'Patient Name', 'Care Type', 'Payer', 'Gross', 'Discount', 'Billing', 'Collected', 'Current Outstanding', 'Status', 'Transaction Date', 'Type', 'Receipt', 'Method', 'Account', 'Collected By'];
    const rows = filteredInvoices.map((inv, idx) => [
      idx + 1,
      `"${inv.invoiceNumber}"`,
      `"${inv.encounterType !== 'CUSTOM' ? (inv.queueNumber || '—') : '—'}"`,
      `"${inv.patientMr || ''}"`,
      `"${inv.patientName}"`,
      `"${getInvoiceCareQueue(inv)}"`,
      `"${inv.payerType}"`,
      inv.grossAmount ?? inv.subtotal,
      inv.discountAmount ?? inv.discountTotal,
      inv.billingAmount ?? inv.total,
      inv.collectedAmount ?? inv.paidTotal,
      inv.balanceDue,
      `"${inv.status}"`,
      `"${inv.transactionAt || inv.createdAt}"`,
      ...[inv.transactionType, inv.receiptNumber, inv.receiptMethod, inv.receiptAccount, inv.receiptCollector].map(v => `"${String(v || '').replaceAll('"', '""')}"`)
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = `hospital_invoices_${new Date().toISOString().slice(0, 10)}.csv`;
    link.download = filename;
    link.click();
    toast.success(`Exported ${filteredInvoices.length} invoices to ${filename}.`, 'CSV Export Ready');
  };

  const handleExportExcel = () => {
    if (filteredInvoices.length === 0) {
      toast.warning('No invoices match the selected filters to export.', 'Export');
      return;
    }
    const headers = ['#', 'Invoice Number', 'Service ID', 'MR #', 'Patient Name', 'Care Type', 'Payer', 'Gross', 'Discount', 'Billing', 'Collected', 'Current Outstanding', 'Status', 'Transaction Date', 'Type', 'Receipt', 'Method', 'Account', 'Collected By'];
    const rowsHtml = filteredInvoices.map((inv, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${inv.invoiceNumber}</td>
        <td>${inv.encounterType !== 'CUSTOM' ? (inv.queueNumber || '—') : '—'}</td>
        <td>${inv.patientMr || ''}</td>
        <td>${inv.patientName}</td>
        <td>${getInvoiceCareQueue(inv)}</td>
        <td>${inv.payerType}</td>
        <td>${inv.grossAmount ?? inv.subtotal}</td>
        <td>${inv.discountAmount ?? inv.discountTotal}</td>
        <td>${inv.billingAmount ?? inv.total}</td>
        <td>${inv.collectedAmount ?? inv.paidTotal}</td>
        <td>${inv.balanceDue}</td>
        <td>${inv.status}</td>
        <td>${inv.transactionAt || inv.createdAt}</td>
        ${[inv.transactionType, inv.receiptNumber, inv.receiptMethod, inv.receiptAccount, inv.receiptCollector].map(v => `<td>${String(v || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</td>`).join('')}
      </tr>
    `).join('');

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"/></head>
      <body>
        <h2>Hospital Invoices Ledger Registry</h2>
        <table border="1">
          <tr style="background:#0e5944;color:#ffffff;font-weight:bold;">
            ${headers.map(h => `<th>${h}</th>`).join('')}
          </tr>
          ${rowsHtml}
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = `hospital_invoices_${new Date().toISOString().slice(0, 10)}.xls`;
    link.download = filename;
    link.click();
    toast.success(`Exported ${filteredInvoices.length} invoices to ${filename}.`, 'Excel Export Ready');
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-slate-500 gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-[#08775A]" />
        <span className="text-sm font-semibold text-slate-600">Loading hospital invoices…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center bg-white rounded-2xl border border-rose-200 p-8 shadow-xs">
        <AlertTriangle className="h-9 w-9 text-rose-500" />
        <h3 className="text-sm font-bold text-rose-950">Failed to Load Invoices</h3>
        <p className="text-xs text-rose-700 max-w-md">{loadError}</p>
        <button
          type="button"
          onClick={() => load()}
          className="mt-2 px-5 py-2.5 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Page Header */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-[#111827]">{title}</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              Live Front Desk Ledger
            </span>
          </div>
          <p className="text-xs text-[#52665e] max-w-2xl leading-relaxed">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={() => load(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
            title="Refresh Invoices"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[#08775A] ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Segmented Queue Selector (Hospital Theme) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-2 shadow-2xs">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {QUEUE_TABS.map((tab) => {
            const isActive = activeQueue === tab.key;
            const count = queueCounts[tab.key] || 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveQueue(tab.key)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-[#08775A] text-white shadow-xs'
                    : 'bg-[#f8faf9] text-[#52665e] hover:bg-[#eff5f2] hover:text-[#111827] border border-[#e2eae5]'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-white text-[#08775A] border border-[#c2e7db]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Financial Summary Cards (Pharmacy KPI Card Design) */}
      <HospitalKpiHeader
        items={[
          {
            label: 'Invoices in View',
            value: metrics.totalInvoices,
            icon: Receipt,
            tone: 'info',
            subtitle: 'Matching current criteria',
          },
          {
            label: 'Net Billed (PKR)',
            value: formatPKR(metrics.totalBilled),
            icon: TrendingUp,
            tone: 'default',
            subtitle: 'Total invoice amount',
          },
          {
            label: 'Total Collected (PKR)',
            value: formatPKR(metrics.totalPaid),
            icon: Banknote,
            tone: 'success',
            subtitle: 'Realized payments',
          },
          {
            label: 'Total Balance Due (PKR)',
            value: formatPKR(metrics.totalDue),
            icon: AlertCircle,
            tone: metrics.totalDue > 0 ? 'danger' : 'success',
            subtitle: 'Pending settlement',
          },
        ]}
      />

      {/* Filter Toolbar: Direct Custom Date, Search, Status & Payer */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#8b9e95]" />
            <input
              type="text"
              placeholder="Search by Patient Name, MR#, Phone, CNIC, or Invoice #…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-xs pl-9 pr-7 py-2 border border-[#c2e7db] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#08775A] focus:border-[#08775A] bg-white placeholder:text-[#8b9e95]"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Custom Date Range Picker (Direct, No Presets Dropdown) */}
          <div className="flex items-center gap-1.5 bg-[#f8faf9] px-2.5 py-1.5 rounded-lg border border-[#c2e7db] shrink-0">
            <Calendar className="h-3.5 w-3.5 text-[#08775A] shrink-0" />
            <span className="text-[11px] font-semibold text-[#52665e]">From:</span>
            <input
              lang="en-GB" type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-xs px-1.5 py-1 bg-white border border-[#c2e7db] rounded-md text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#08775A]"
            />
            <span className="text-[11px] font-semibold text-[#52665e]">To:</span>
            <input
              lang="en-GB" type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-xs px-1.5 py-1 bg-white border border-[#c2e7db] rounded-md text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#08775A]"
            />
            <button
              type="button"
              onClick={handleSetToday}
              className="text-[10px] px-2 py-1 rounded font-semibold border border-[#c2e7db] text-[#08775A] bg-white hover:bg-[#effaf5] transition-colors cursor-pointer"
              title="Set to Today"
            >
              Today
            </button>
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                }}
                className="text-slate-400 hover:text-slate-700 p-0.5 rounded cursor-pointer"
                title="Clear Dates"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Status Dropdown */}
          <div className="shrink-0 flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-[#52665e] hidden sm:inline">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="text-xs px-2.5 py-2 border border-[#c2e7db] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#08775A] text-[#111827] font-medium cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIALLY_PAID">Partially Paid</option>
              <option value="PAID">Paid</option>
              <option value="VOID">Void</option>
            </select>
          </div>

          {/* Payer Dropdown */}
          <div className="shrink-0 flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-[#52665e] hidden sm:inline">Payer:</span>
            <select
              value={payerFilter}
              onChange={(e) => setPayerFilter(e.target.value as any)}
              className="text-xs px-2.5 py-2 border border-[#c2e7db] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#08775A] text-[#111827] font-medium cursor-pointer"
            >
              <option value="ALL">All Payers</option>
              <option value="SELF_PAY">Self Pay</option>
              <option value="PANEL">Corporate / Panel</option>
            </select>
          </div>

          {/* Outstanding Due Filter */}
          <button
            type="button"
            onClick={() => setIsOutstandingOnly(!isOutstandingOnly)}
            className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer border ${
              isOutstandingOnly
                ? 'bg-rose-50 border-rose-300 text-rose-700'
                : 'bg-white border-[#c2e7db] text-[#52665e] hover:bg-[#f8faf9]'
            }`}
          >
            <span>Due &gt; 0</span>
          </button>

          {/* Quick Refresh Button in Filter Bar */}
          <button
            type="button"
            onClick={() => load(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#08775A] bg-[#effaf5] hover:bg-[#d6f2e8] border border-[#c2e7db] rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-60"
            title="Refresh Invoices Now"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Reset all filters"
            >
              <X className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Pharmacy Table Container ── */}
      <div className="bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-emerald-300" />
            <span className="font-bold text-xs sm:text-sm tracking-tight text-white whitespace-nowrap">
              Hospital Invoices & Ledger Registry
            </span>
            <span className="text-[10px] font-semibold bg-emerald-700/60 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-500/30 whitespace-nowrap">
              {filteredInvoices.length} Active Records
            </span>
          </div>

          {/* Action & Export Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => load(true)}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer whitespace-nowrap border border-emerald-500/40 disabled:opacity-60"
              title="Refresh invoice table rows"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
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

        {/* Search in Results Bar */}
        <div className="px-3.5 py-2 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="text-slate-600 font-medium">
            Showing <strong className="text-slate-800">{paginatedInvoices.length}</strong> of{' '}
            <strong className="text-slate-800">{filteredInvoices.length}</strong> matching records
          </div>

          <div className="flex items-center gap-1.5 whitespace-nowrap text-slate-500 font-medium">
            <span>Per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-white border border-slate-200 rounded-md px-2 py-0.5 text-xs text-slate-700 focus:outline-none"
            >
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {/* Main Table Scroll Container matching Image 1 (Invoice Register) */}
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] min-h-[320px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#f1f5f9] border-b border-slate-300 text-slate-800 font-bold uppercase text-[11.5px] tracking-wider sticky top-0 z-10 select-none">
              <tr>
                <th className="w-12 py-3 px-3 text-center border-r border-slate-300 font-bold text-slate-700">#</th>
                <th className="py-3 px-3.5 border-r border-slate-300 whitespace-nowrap">Invoice # / Type</th>
                <th className="py-3 px-3.5 border-r border-slate-300 whitespace-nowrap">Service ID</th>
                <th className="py-3 px-3.5 border-r border-slate-300 whitespace-nowrap"><button type="button" onClick={() => setSortDirection(d => d === 'asc' ? 'desc' : 'asc')} title="Sort by transaction date">Transaction Date {sortDirection === 'asc' ? '(oldest first)' : '(newest first)'}</button></th>
                <th className="py-3 px-3.5 border-r border-slate-300 whitespace-nowrap">Patient</th>
                <th className="py-3 px-3.5 border-r border-slate-300 whitespace-nowrap">Source</th>
                <th className="py-3 px-3.5 border-r border-slate-300 whitespace-nowrap">Department</th>
                <th className="py-3 px-3.5 border-r border-slate-300 text-right whitespace-nowrap">Gross</th>
                <th className="py-3 px-3.5 border-r border-slate-300 text-right whitespace-nowrap">Discount</th>
                <th className="py-3 px-3.5 border-r border-slate-300 text-right whitespace-nowrap">Billing</th>
                <th className="py-3 px-3.5 border-r border-slate-300 text-right whitespace-nowrap">Collected</th>
                <th className="py-3 px-3.5 border-r border-slate-300 text-right whitespace-nowrap">Current Outstanding</th>
                <th className="py-3 px-3.5 border-r border-slate-300 text-center whitespace-nowrap">Status</th>
                <th className="py-3 px-3.5 text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {paginatedInvoices.map((inv, idx) => {
                const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                const careQueue = getInvoiceCareQueue(inv);
                const isPaid = inv.status === 'PAID';
                const isPartiallyPaid = inv.status === 'PARTIALLY_PAID';
                const isVoid = inv.status === 'VOID';

                return (
                  <tr
                    key={inv.transactionId || inv.id}
                    className="hover:bg-slate-50/90 transition-colors border-b border-slate-200 last:border-b-0 cursor-pointer"
                    onClick={() => openInvoice(inv.id)}
                  >
                    {/* Index */}
                    <td className="py-2.5 px-3 text-center border-r border-slate-200 text-slate-500 font-mono text-[11px] bg-slate-50/60 whitespace-nowrap">
                      {globalIdx}
                    </td>

                    {/* Invoice # */}
                    <td className="py-2.5 px-3.5 border-r border-slate-200 font-mono font-semibold text-[#08775A] whitespace-nowrap">
                      <span>{inv.invoiceNumber}</span>
                      <span className="block text-xs font-sans text-slate-700">{inv.transactionType}</span>
                      {inv.receiptNumber && <details onClick={e => e.stopPropagation()} className="text-xs font-sans font-normal text-slate-600">
                        <summary className="cursor-pointer">{inv.receiptNumber}</summary>
                        <div>{inv.receiptMethod} {inv.receiptAccount || ''}</div>
                        <div>Collected by: {inv.receiptCollector || 'Unknown'}</div>
                        <div>Original invoice: {inv.createdAt}</div>
                      </details>}
                    </td>

                    {/* Service ID (Token / Encounter Queue Number) */}
                    <td className="py-2.5 px-3.5 border-r border-slate-200 whitespace-nowrap">
                      {inv.queueNumber && inv.encounterType !== 'CUSTOM' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {inv.queueNumber}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono text-xs">—</span>
                      )}
                    </td>

                    {/* Date */}
                    <td className="py-2.5 px-3.5 border-r border-slate-200 text-slate-700 whitespace-nowrap text-xs">
                      {inv.transactionAt || inv.createdAt}
                    </td>

                    {/* Patient */}
                    <td className="py-2.5 px-3.5 border-r border-slate-200 whitespace-nowrap">
                      <span className="font-semibold text-slate-900 block">{inv.patientName}</span>
                      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-slate-500 font-mono">
                        {inv.patientMr && <span>MR: {inv.patientMr}</span>}
                        {inv.patientPhone && <span className="text-slate-600">• {inv.patientPhone}</span>}
                        {inv.patientCnic && <span className="text-slate-600">• CNIC: {inv.patientCnic}</span>}
                      </div>
                    </td>

                    {/* Source */}
                    <td className="py-2.5 px-3.5 border-r border-slate-200 whitespace-nowrap text-xs text-slate-700 font-medium">
                      {careQueue === 'OBS' ? 'Observation' : careQueue === 'ER' ? 'Emergency' : careQueue === 'OPD' ? 'OPD' : careQueue === 'ADM' ? 'Admission' : inv.sourceType || 'WALK_IN'}
                    </td>

                    {/* Department */}
                    <td className="py-2.5 px-3.5 border-r border-slate-200 whitespace-nowrap text-xs text-slate-700">
                      {inv.departmentName || 'PICU'}
                    </td>

                    {/* Gross */}
                    <td className="py-2.5 px-3.5 border-r border-slate-200 text-right font-mono text-slate-700 whitespace-nowrap">
                      {formatPKR(inv.grossAmount ?? inv.subtotal)}
                    </td>

                    {/* Discount */}
                    <td className="py-2.5 px-3.5 border-r border-slate-200 text-right font-mono text-slate-700 whitespace-nowrap">
                      {formatPKR(inv.discountAmount ?? inv.discountTotal)}
                    </td>

                    {/* Net */}
                    <td className="py-2.5 px-3.5 border-r border-slate-200 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                      {formatPKR(inv.billingAmount ?? inv.total)}
                    </td>

                    {/* Paid */}
                    <td className="py-2.5 px-3.5 border-r border-slate-200 text-right font-mono text-slate-800 whitespace-nowrap">
                      {formatPKR(inv.collectedAmount ?? inv.paidTotal)}
                    </td>

                    {/* Balance */}
                    <td className={`py-2.5 px-3.5 border-r border-slate-200 text-right font-mono font-bold whitespace-nowrap ${inv.balanceDue > 0 ? 'text-slate-900' : 'text-slate-600'}`}>
                      {formatPKR(inv.balanceDue)}
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-3.5 border-r border-slate-200 text-center whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${
                          isPaid
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : isPartiallyPaid
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : isVoid
                            ? 'bg-slate-100 text-slate-600 border border-slate-200'
                            : 'bg-rose-50 text-rose-800 border border-rose-200'
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openInvoice(inv.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#08775A] hover:bg-[#065f46] text-white rounded text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                          title="View invoice details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>View</span>
                        </button>
                        {!isVoid && (inv.balanceDue > 0) && (
                          <button
                            type="button"
                            onClick={() => openInvoice(inv.id, 'payment')}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-white hover:bg-slate-100 text-[#08775A] border border-[#c2e7db] rounded text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                            title="Collect Remaining Payment"
                          >
                            <CreditCard className="h-3 w-3" />
                            <span>Collect Remaining Payment</span>
                          </button>
                        )}
                        {!isVoid && inv.paidTotal > 0 && (
                          <button
                            type="button"
                            onClick={() => openInvoice(inv.id, 'refund')}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-white hover:bg-rose-50 text-rose-700 hover:text-rose-800 border border-rose-200 hover:border-rose-300 rounded text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                            title="Process refund for this invoice"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Refund</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={14} className="py-16 text-center text-slate-500">
                    <Receipt className="h-9 w-9 text-slate-300 mx-auto mb-2" />
                    <h4 className="text-sm font-semibold text-slate-800">No Invoices Found</h4>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                      {hasActiveFilters
                        ? 'No invoices match your currently selected criteria.'
                        : 'No invoices have been recorded yet in this queue.'}
                    </p>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={resetAllFilters}
                        className="mt-3 px-3.5 py-1.5 bg-[#f8faf9] hover:bg-[#eff5f2] text-[#08775A] text-xs font-semibold rounded-lg border border-[#c2e7db] transition-colors cursor-pointer"
                      >
                        Reset All Filters
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            {filteredInvoices.length > 0 && (
              <tfoot>
                <tr className="bg-[#f1f5f9] border-t-2 border-slate-300 font-bold text-slate-900 sticky bottom-0">
                  <td className="py-2.5 px-3 text-center border-r border-slate-300 text-[10.5px] uppercase tracking-wider text-slate-600 font-bold">Total</td>
                  <td colSpan={6} className="py-2.5 px-3.5 border-r border-slate-300 text-slate-600 text-xs font-semibold">
                    Total for {filteredInvoices.length} {filteredInvoices.length === 1 ? 'record' : 'records'}
                  </td>
                  <td className="py-2.5 px-3.5 border-r border-slate-300 whitespace-nowrap text-right font-mono">{formatPKR(metrics.totalGross)}</td>
                  <td className="py-2.5 px-3.5 border-r border-slate-300 whitespace-nowrap text-right font-mono">{formatPKR(metrics.totalDiscount)}</td>
                  <td className="py-2.5 px-3.5 border-r border-slate-300 whitespace-nowrap text-right font-mono">{formatPKR(metrics.totalBilled)}</td>
                  <td className="py-2.5 px-3.5 border-r border-slate-300 whitespace-nowrap text-right font-mono">{formatPKR(metrics.totalPaid)}</td>
                  <td className="py-2.5 px-3.5 border-r border-slate-300 whitespace-nowrap text-right font-mono">{formatPKR(metrics.totalDue)}</td>
                  <td colSpan={2} className="py-2.5 px-3.5"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* ── Table Pagination Bar (Matching Pharmacy) ── */}
        <div className="px-4 py-3 bg-slate-50/80 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div>
            Page <strong className="text-slate-800">{currentPage}</strong> of{' '}
            <strong className="text-slate-800">{Math.max(1, Math.ceil(filteredInvoices.length / pageSize))}</strong>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </button>
            <button
              type="button"
              disabled={currentPage >= Math.ceil(filteredInvoices.length / pageSize)}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Invoice Detail / Payment Modal */}
      {openInvoiceId && (
        <InvoiceDetailModal
          invoiceId={openInvoiceId}
          initialAction={openInvoiceAction}
          onClose={closeInvoiceModal}
          onChanged={() => load(true)}
        />
      )}
    </div>
  );
};
