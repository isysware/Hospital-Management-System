import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  RotateCcw,
  Eye,
  Filter,
  X,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';
import { formatPKR, formatDateTimeDDMMYYYY } from '../../../utils/formatters';
import { formatDateISO, getHospitalCurrentDate } from '../../../utils/dateConstants';
import { useAuth } from '../../../context/AuthContext';
import {
  fetchOperatingProfitStatement,
  fetchManagementFilterOptions,
  EMPTY_MANAGEMENT_OPTIONS,
  OperatingProfitStatementResponse,
  OperatingProfitStatementRow,
  StatementLedgerEntry,
} from '../../../services/managementReportsService';
import { useFilterOptions } from '../../../components/reports/reportFilters';
import { Select, TextInput } from '../../../components/forms/FormControls';
import { ExportButtonGroup } from '../financeControl/ExportButtonGroup';
import {
  downloadTablePDF,
  downloadTableExcel,
  downloadTableCSV,
  printTable,
  ExportColumn,
  ExportRequest,
} from '../../../services/tableExportService';

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

export const OperatingProfitStatementView: React.FC = () => {
  const { currentUser } = useAuth();
  const options = useFilterOptions(fetchManagementFilterOptions, EMPTY_MANAGEMENT_OPTIONS);

  // Filters State
  const todayISO = formatDateISO(getHospitalCurrentDate());
  const [preset, setPreset] = useState<PeriodPreset>('today');
  const [fromDate, setFromDate] = useState<string>(todayISO);
  const [toDate, setToDate] = useState<string>(todayISO);
  const [departmentId, setDepartmentId] = useState<string>('');
  const [comparison, setComparison] = useState<'previous' | 'none'>('previous');

  // Applied Filters State (used for backend queries)
  const [appliedFilters, setAppliedFilters] = useState({
    preset: 'today' as PeriodPreset,
    fromDate: todayISO,
    toDate: todayISO,
    departmentId: '',
    comparison: 'previous' as 'previous' | 'none',
  });

  // View state
  const [activeView, setActiveView] = useState<'statement' | 'ledger'>('statement');
  const [ledgerCategory, setLedgerCategory] = useState<string>('');
  const [ledgerSearch, setLedgerSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(25);

  // Data state
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OperatingProfitStatementResponse | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<StatementLedgerEntry | null>(null);

  // Sync date inputs when preset changes
  const handlePresetChange = (newPreset: PeriodPreset) => {
    setPreset(newPreset);
    const today = getHospitalCurrentDate();
    const todayStr = formatDateISO(today);

    if (newPreset === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (newPreset === 'yesterday') {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      const yStr = formatDateISO(y);
      setFromDate(yStr);
      setToDate(yStr);
    } else if (newPreset === 'this_week') {
      const d = new Date(today);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      setFromDate(formatDateISO(d));
      setToDate(todayStr);
    } else if (newPreset === 'this_month') {
      const startOfMonth = `${todayStr.slice(0, 7)}-01`;
      setFromDate(startOfMonth);
      setToDate(todayStr);
    } else if (newPreset === 'last_month') {
      const parts = todayStr.split('-').map(Number);
      const curY = parts[0] || 2026;
      const curM = parts[1] || 11;
      const lastY = curM === 1 ? curY - 1 : curY;
      const lastM = curM === 1 ? 12 : curM - 1;
      const mStr = String(lastM).padStart(2, '0');
      const start = `${lastY}-${mStr}-01`;
      const lastDay = new Date(lastY, lastM, 0).getDate();
      const end = `${lastY}-${mStr}-${String(lastDay).padStart(2, '0')}`;
      setFromDate(start);
      setToDate(end);
    } else if (newPreset === 'all_time') {
      setFromDate('2020-01-01');
      setToDate(todayStr);
    }
  };

  // Load Report Data
  const loadReport = useCallback(
    async (overridePage?: number, overrideLimit?: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchOperatingProfitStatement({
          preset: appliedFilters.preset,
          fromDate: appliedFilters.preset === 'custom' ? appliedFilters.fromDate : undefined,
          toDate: appliedFilters.preset === 'custom' ? appliedFilters.toDate : undefined,
          departmentId: appliedFilters.departmentId || undefined,
          comparison: appliedFilters.comparison,
          view: activeView,
          category: ledgerCategory || undefined,
          page: overridePage ?? page,
          limit: overrideLimit ?? limit,
        });
        setData(res);
      } catch (err: any) {
        setError(err?.message || 'Failed to generate Operating Profit (P&L) Statement.');
      } finally {
        setLoading(false);
      }
    },
    [appliedFilters, activeView, ledgerCategory, page, limit]
  );

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleApply = () => {
    setPage(1);
    setAppliedFilters({
      preset,
      fromDate,
      toDate,
      departmentId,
      comparison,
    });
  };

  const handleReset = () => {
    const todayStr = formatDateISO(getHospitalCurrentDate());
    setPreset('today');
    setFromDate(todayStr);
    setToDate(todayStr);
    setDepartmentId('');
    setComparison('previous');
    setLedgerCategory('');
    setLedgerSearch('');
    setPage(1);
    setAppliedFilters({
      preset: 'today',
      fromDate: todayStr,
      toDate: todayStr,
      departmentId: '',
      comparison: 'previous',
    });
  };

  // Group statement rows by section
  const sectionedRows = useMemo(() => {
    if (!data?.rows) return [];
    const sections: { sectionName: string; rows: OperatingProfitStatementRow[] }[] = [];
    let currentSection = '';
    let currentRows: OperatingProfitStatementRow[] = [];

    data.rows.forEach((r) => {
      if (r.section !== currentSection) {
        if (currentRows.length > 0) {
          sections.push({ sectionName: currentSection, rows: currentRows });
        }
        currentSection = r.section;
        currentRows = [r];
      } else {
        currentRows.push(r);
      }
    });
    if (currentRows.length > 0) {
      sections.push({ sectionName: currentSection, rows: currentRows });
    }
    return sections;
  }, [data?.rows]);

  // Client-side search filter for Detailed Ledger items
  const filteredLedgerItems = useMemo(() => {
    if (!data?.ledger?.items) return [];
    if (!ledgerSearch.trim()) return data.ledger.items;
    const term = ledgerSearch.toLowerCase().trim();
    return data.ledger.items.filter(
      (it) =>
        it.reference.toLowerCase().includes(term) ||
        it.description.toLowerCase().includes(term) ||
        it.actor.toLowerCase().includes(term) ||
        it.department.toLowerCase().includes(term) ||
        it.category.toLowerCase().includes(term)
    );
  }, [data?.ledger?.items, ledgerSearch]);

  // Format helper for numbers
  const formatAmount = (val: number | null | undefined, unit: 'percent' | 'currency' = 'currency', key?: string) => {
    if (val === null || val === undefined) {
      if (key === 'pharmacyBilling') return 'N/A';
      return '—';
    }
    if (unit === 'percent') return `${val >= 0 ? '' : ''}${val.toFixed(1)}%`;
    return Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Variance badge/text styling
  const renderVariance = (val: number | null | undefined) => {
    if (val === null || val === undefined) return <span className="text-slate-400 font-normal">—</span>;
    if (val > 0) {
      return <span className="text-emerald-700 font-semibold">+{val.toFixed(2)}%</span>;
    }
    if (val < 0) {
      return <span className="text-rose-700 font-semibold">{val.toFixed(2)}%</span>;
    }
    return <span className="text-slate-600 font-medium">0.00%</span>;
  };

  // Export handlers using TableExportService
  const handleExport = async (format: 'pdf' | 'excel' | 'csv' | 'print') => {
    const filenamePrefix = `Operating_Profit_PL_${preset}_${fromDate}_${toDate}`;
    const documentTitle = 'Operating Profit & P&L Statement (Accrual)';
    const documentSubtitle = `Period: ${data?.period?.label || 'Today'} | Comparison: ${
      comparison === 'previous' ? 'Previous Equivalent Period' : 'None'
    }`;

    if (activeView === 'statement') {
      const columns: ExportColumn<OperatingProfitStatementRow>[] = [
        {
          header: 'Financial Line Item',
          cell: (r) => (r.type === 'SECTION' ? r.section.toUpperCase() : r.label),
        },
        {
          header: 'Section / Type',
          cell: (r) => (r.type === 'SECTION' ? '' : r.type),
        },
        {
          header: 'Current Period (PKR)',
          align: 'right',
          cell: (r) => {
            if (r.key === 'pharmacyBilling' && (r.current === null || r.current === undefined)) return 'N/A';
            return r.current !== null && r.current !== undefined
              ? r.unit === 'percent'
                ? `${r.current.toFixed(1)}%`
                : formatPKR(r.current)
              : '—';
          },
          excelValue: (r) => {
            if (r.key === 'pharmacyBilling' && (r.current === null || r.current === undefined)) return 'N/A';
            return r.current !== null && r.current !== undefined ? Number(r.current) : '';
          },
        },
        {
          header: '% of Revenue',
          align: 'right',
          cell: (r) => (r.type === 'INFORMATIONAL' || r.percentOfRevenue === null || r.percentOfRevenue === undefined ? '—' : `${r.percentOfRevenue.toFixed(1)}%`),
          excelValue: (r) => (r.type === 'INFORMATIONAL' || r.percentOfRevenue === null || r.percentOfRevenue === undefined ? '' : Number(r.percentOfRevenue)),
        },
        {
          header: 'Prior Period (PKR)',
          align: 'right',
          cell: (r) => {
            if (r.key === 'pharmacyBilling' && (r.prior === null || r.prior === undefined)) return 'N/A';
            return r.prior !== null && r.prior !== undefined
              ? r.unit === 'percent'
                ? `${r.prior.toFixed(1)}%`
                : formatPKR(r.prior)
              : '—';
          },
          excelValue: (r) => {
            if (r.key === 'pharmacyBilling' && (r.prior === null || r.prior === undefined)) return 'N/A';
            return r.prior !== null && r.prior !== undefined ? Number(r.prior) : '';
          },
        },
        {
          header: 'Variance / Growth',
          align: 'right',
          cell: (r) => (r.variance !== null && r.variance !== undefined ? `${r.variance.toFixed(2)}%` : '—'),
          excelValue: (r) => (r.variance !== null && r.variance !== undefined ? Number(r.variance) : ''),
        },
      ];

      const flatRows: OperatingProfitStatementRow[] = [];
      sectionedRows.forEach((sec) => {
        flatRows.push({
          key: `sec-${sec.sectionName}`,
          section: sec.sectionName,
          label: sec.sectionName,
          type: 'SECTION',
          unit: 'currency',
          current: null,
          prior: null,
          percentOfRevenue: null,
          variance: null,
          sourceCount: 0,
        });
        sec.rows.forEach((r) => flatRows.push(r));
      });

      // Include dynamically generated separate financial streams in exports
      if (data?.outsourcedStreams && data.outsourcedStreams.length > 0) {
        flatRows.push({
          key: 'sec-outsourced-streams',
          section: 'SEPARATE FINANCIAL STREAMS — EXCLUDED FROM HOSPITAL P&L',
          label: 'OUTSOURCED DEPARTMENTS & SEPARATE FINANCIAL STREAMS',
          type: 'SECTION',
          unit: 'currency',
          current: null,
          prior: null,
          percentOfRevenue: null,
          variance: null,
          sourceCount: 0,
        });

        data.outsourcedStreams.forEach((stream) => {
          flatRows.push({
            key: `outsourced-billing-${stream.departmentId}`,
            section: 'SEPARATE FINANCIAL STREAMS — EXCLUDED FROM HOSPITAL P&L',
            label: `${stream.departmentName} — Period Billing${stream.providerName ? ` (${stream.providerName})` : ''}`,
            type: 'INFORMATIONAL',
            unit: 'currency',
            current: stream.currentBilling,
            prior: stream.priorBilling,
            percentOfRevenue: null,
            variance: stream.billingVariance ?? null,
            sourceCount: 0,
          });
          flatRows.push({
            key: `outsourced-payable-${stream.departmentId}`,
            section: 'SEPARATE FINANCIAL STREAMS — EXCLUDED FROM HOSPITAL P&L',
            label: `${stream.departmentName} — Provider Payable${stream.providerName ? ` (${stream.providerName})` : ''}`,
            type: 'INFORMATIONAL',
            unit: 'currency',
            current: stream.currentPayable,
            prior: stream.priorPayable,
            percentOfRevenue: null,
            variance: stream.payableVariance ?? null,
            sourceCount: 0,
          });
        });

        // Pharmacy row
        flatRows.push({
          key: 'pharmacyBilling',
          section: 'SEPARATE FINANCIAL STREAMS — EXCLUDED FROM HOSPITAL P&L',
          label: 'Pharmacy Standalone Billing (External Stream)',
          type: 'INFORMATIONAL',
          unit: 'currency',
          current: data?.pharmacyStream?.currentBilling ?? null,
          prior: data?.pharmacyStream?.priorBilling ?? null,
          percentOfRevenue: null,
          variance: null,
          sourceCount: 0,
        });
      }

      const req: ExportRequest<OperatingProfitStatementRow> = {
        documentTitle,
        documentSubtitle,
        filenamePrefix,
        columns,
        rows: flatRows,
        currentUser,
        periodLabel: data?.period?.label,
      };

      if (format === 'csv') downloadTableCSV(req);
      else if (format === 'excel') downloadTableExcel(req);
      else if (format === 'pdf') downloadTablePDF(req);
      else if (format === 'print') printTable(req);
    } else {
      // Detailed Ledger Export
      const columns: ExportColumn<StatementLedgerEntry>[] = [
        { header: 'Date & Time', cell: (r) => formatDateTimeDDMMYYYY(r.date) },
        { header: 'Reference ID', cell: (r) => r.reference },
        { header: 'Category', cell: (r) => r.category },
        { header: 'Department', cell: (r) => r.department },
        { header: 'Description / Payee', cell: (r) => r.description },
        { header: 'Actor / Staff', cell: (r) => r.actor },
        {
          header: 'Recognized Revenue (PKR)',
          align: 'right',
          cell: (r) => (r.revenue > 0 ? formatPKR(r.revenue) : '—'),
          excelValue: (r) => Number(r.revenue),
        },
        {
          header: 'Recognized Cost (PKR)',
          align: 'right',
          cell: (r) => (r.cost > 0 ? formatPKR(r.cost) : '—'),
          excelValue: (r) => Number(r.cost),
        },
        { header: 'Status', cell: (r) => r.status },
      ];

      const req: ExportRequest<StatementLedgerEntry> = {
        documentTitle: `${documentTitle} — Detailed Ledger`,
        documentSubtitle,
        filenamePrefix: `${filenamePrefix}_Ledger`,
        columns,
        rows: filteredLedgerItems,
        currentUser,
        periodLabel: data?.period?.label,
      };

      if (format === 'csv') downloadTableCSV(req);
      else if (format === 'excel') downloadTableExcel(req);
      else if (format === 'pdf') downloadTablePDF(req);
      else if (format === 'print') printTable(req);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Page Header ────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[#08775A]" />
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">Operating Profit (P&L)</h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Consolidated hospital earned revenue, direct clinical service costs, recognized payroll & commissions,
              and operating overheads.
            </p>
          </div>
        </div>
      </div>

      {/* ── Advanced Filter Bar (Identical to GenericReportView & HMS Software) ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-end gap-3 flex-wrap">
        {/* 1. Period */}
        <div className="w-44">
          <Select
            label="Period"
            options={PERIOD_OPTIONS}
            value={preset}
            onChange={(e) => handlePresetChange(e.target.value as PeriodPreset)}
          />
        </div>

        {/* 2. From & To Date (when Custom) */}
        {preset === 'custom' && (
          <>
            <div className="w-36">
              <TextInput
                label="From"
                type="date"
                lang="en-GB"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="w-36">
              <TextInput
                label="To"
                type="date"
                lang="en-GB"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </>
        )}

        {/* 3. Department */}
        <div className="w-52">
          <Select
            label="Department"
            placeholder="All Departments"
            options={options.departments || []}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          />
        </div>

        {/* 4. Comparison */}
        <div className="w-56">
          <Select
            label="Comparison"
            options={[
              { value: 'previous', label: 'Previous Period' },
              { value: 'none', label: 'None' },
            ]}
            value={comparison}
            onChange={(e) => setComparison(e.target.value as 'previous' | 'none')}
          />
        </div>

        {/* 5. Action Buttons */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={handleApply}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-60 cursor-pointer"
          >
            <Filter className="h-3.5 w-3.5" />
            <span>Filter</span>
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-medium transition-colors disabled:opacity-60 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Warnings & Notices */}
      {data?.warnings && data.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 space-y-1">
          {data.warnings.map((w, idx) => (
            <div key={idx} className="flex items-start gap-1.5 font-medium">
              <span className="text-amber-600 font-bold">•</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Statement Toolbar & View Toggle ────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left side: Statement title and View Toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <h2 className="text-sm font-bold text-slate-800 tracking-tight">Accounting P&L Statement (Accrual)</h2>
            <div className="text-[11px] text-slate-500 font-normal">
              Period: {data?.period?.label || 'Today'}
              {data?.priorPeriod ? ` · Prior: ${data.priorPeriod.label}` : ''}
            </div>
          </div>

          {/* Toggle Buttons matching Salon structural reference */}
          <div className="inline-flex rounded border border-slate-300 p-0.5 bg-slate-100">
            <button
              type="button"
              onClick={() => setActiveView('statement')}
              className={`px-3 py-1 text-xs font-semibold rounded transition ${
                activeView === 'statement'
                  ? 'bg-[#08775A] text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Statement View
            </button>
            <button
              type="button"
              onClick={() => setActiveView('ledger')}
              className={`px-3 py-1 text-xs font-semibold rounded transition ${
                activeView === 'ledger'
                  ? 'bg-[#08775A] text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Detailed Ledger {data?.ledger?.totalRecords !== undefined ? `(${data.ledger.totalRecords})` : ''}
            </button>
          </div>
        </div>

        {/* Right side: Export buttons */}
        <div className="flex items-center gap-1.5">
          <ExportButtonGroup
            onExcel={() => handleExport('excel')}
            onCsv={() => handleExport('csv')}
            onPdf={() => handleExport('pdf')}
            onPrint={() => handleExport('print')}
          />
        </div>
      </div>

      {/* ── Content View: Loading / Error / Data ─────────────────────── */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center shadow-xs">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-3 border-solid border-[#08775A] border-r-transparent" />
          <div className="text-xs font-medium text-slate-600 mt-2">Computing Financial P&L Statement...</div>
        </div>
      ) : error ? (
        <div className="bg-white border border-rose-200 rounded-lg p-8 text-center text-rose-600 text-xs shadow-xs">
          {error}
        </div>
      ) : activeView === 'statement' ? (
        /* ══════════════════════════════════════════════════════════════════
           STATEMENT VIEW — 6 Columns Matching Salon Reference
           ══════════════════════════════════════════════════════════════════ */
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
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
                {sectionedRows.map((sec) => (
                  <React.Fragment key={sec.sectionName}>
                    {/* Section Banner Header Row */}
                    <tr className="bg-slate-100 border-t-2 border-b border-slate-300">
                      <td
                        colSpan={6}
                        className="py-2 px-3 text-[11px] font-bold text-slate-900 uppercase tracking-wider"
                      >
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
                        textClass = 'text-[#08775A] font-bold text-[13px]';
                      } else if (isSubtotal) {
                        rowClass = 'bg-slate-50/90 border-t border-b border-slate-300 font-bold';
                        textClass = 'text-slate-900 font-bold';
                      } else if (isInformational) {
                        rowClass = 'hover:bg-slate-50/70 transition bg-slate-50/40 font-medium';
                        textClass = 'text-slate-800 font-medium';
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
                            {row.key === 'pharmacyBilling' && (row.current === null || row.current === undefined) ? (
                              <span className="text-slate-400 font-medium">N/A</span>
                            ) : (
                              formatAmount(row.current, row.unit, row.key)
                            )}
                          </td>

                          {/* % of Revenue */}
                          <td className="py-2 px-3 text-right border-r border-slate-200 font-mono font-medium text-slate-700">
                            {isInformational ? (
                              '—'
                            ) : row.percentOfRevenue !== null && row.percentOfRevenue !== undefined ? (
                              `${row.percentOfRevenue.toFixed(1)}%`
                            ) : isNetResult && row.current && data?.rows?.find((r) => r.key === 'netRevenue')?.current ? (
                              `${(
                                (row.current / (data.rows.find((r) => r.key === 'netRevenue')?.current || 1)) *
                                100
                              ).toFixed(1)}%`
                            ) : (
                              '—'
                            )}
                          </td>

                          {/* Prior Period (PKR) */}
                          <td className="py-2 px-3 text-right border-r border-slate-200 font-mono text-slate-600">
                            {row.key === 'pharmacyBilling' && (row.prior === null || row.prior === undefined) ? (
                              <span className="text-slate-400 font-medium">N/A</span>
                            ) : (
                              formatAmount(row.prior, row.unit, row.key)
                            )}
                          </td>

                          {/* Variance / Growth */}
                          <td className="py-2 px-3 text-right font-mono">
                            {row.key === 'pharmacyBilling' && (row.current === null || row.current === undefined)
                              ? '—'
                              : renderVariance(row.variance)}
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

        {/* ── Separate Financial Streams Table (Outsourced Departments & Pharmacy) ── */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden mt-4">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Outsourced Departments &amp; Separate Financial Streams
              </h3>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                Excluded from Hospital P&amp;L
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              Informational only · Independent provider settlements · Not recognized in Hospital Operating Revenue / Profit
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-300 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-2.5 px-3 text-left border-r border-slate-200 min-w-[220px]">
                    Department
                  </th>
                  <th className="py-2.5 px-3 text-left border-r border-slate-200 min-w-[200px]">
                    Provider
                  </th>
                  <th className="py-2.5 px-3 text-right border-r border-slate-200 w-[180px]">
                    Period Billing (PKR)
                  </th>
                  <th className="py-2.5 px-3 text-right w-[180px]">
                    Provider Payable (PKR)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {/* Dynamic Outsourced Departments Rows */}
                {data?.outsourcedStreams && data.outsourcedStreams.length > 0 ? (
                  data.outsourcedStreams.map((stream) => (
                    <tr key={stream.departmentId} className="hover:bg-slate-50/70 transition">
                      <td className="py-2 px-3 border-r border-slate-200 font-medium text-slate-800">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400 select-none">•</span>
                          <span>{stream.departmentName}</span>
                          {stream.departmentCode && (
                            <span className="text-[10px] text-slate-400 font-mono">({stream.departmentCode})</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-slate-600">
                        {stream.providerName ? (
                          <span>{stream.providerName}</span>
                        ) : (
                          <span className="text-slate-400 italic">No linked provider</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right border-r border-slate-200 font-mono text-slate-800">
                        <div>{formatPKR(stream.currentBilling)}</div>
                        {appliedFilters.comparison === 'previous' && stream.priorBilling !== null && (
                          <div className="text-[10px] text-slate-500">
                            Prior: {formatPKR(stream.priorBilling)}
                            {stream.billingVariance !== null && (
                              <span className="ml-1">{renderVariance(stream.billingVariance)}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-800">
                        <div>{formatPKR(stream.currentPayable)}</div>
                        {appliedFilters.comparison === 'previous' && stream.priorPayable !== null && (
                          <div className="text-[10px] text-slate-500">
                            Prior: {formatPKR(stream.priorPayable)}
                            {stream.payableVariance !== null && (
                              <span className="ml-1">{renderVariance(stream.payableVariance)}</span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-3 px-3 text-center text-slate-400 italic">
                      No outsourced departments configured or active for this period.
                    </td>
                  </tr>
                )}

                {/* Standalone Pharmacy Informational Row */}
                <tr className="bg-slate-50/40 hover:bg-slate-50/70 transition border-t border-slate-200">
                  <td className="py-2 px-3 border-r border-slate-200 font-medium text-slate-800">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 select-none">•</span>
                      <span>Pharmacy</span>
                      <span className="text-[10px] text-slate-500 font-normal">(Standalone ERP)</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 border-r border-slate-200 text-slate-600">
                    <span className="text-slate-500 italic">Pharmacy Independent Stream</span>
                  </td>
                  <td className="py-2 px-3 text-right border-r border-slate-200 font-mono text-slate-800">
                    {data?.pharmacyStream?.available && data.pharmacyStream.currentBilling !== null ? (
                      <div>
                        <div>{formatPKR(data.pharmacyStream.currentBilling)}</div>
                        {appliedFilters.comparison === 'previous' && data.pharmacyStream.priorBilling !== null && (
                          <div className="text-[10px] text-slate-500">
                            Prior: {formatPKR(data.pharmacyStream.priorBilling)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400 font-medium">N/A</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-400">
                    <span className="text-slate-400 font-medium">N/A</span>
                  </td>
                </tr>
              </tbody>
              {/* Footer Summary Row */}
              {data?.outsourcedStreams && data.outsourcedStreams.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100/80 border-t-2 border-slate-300 font-bold text-slate-900">
                    <td colSpan={2} className="py-2 px-3 border-r border-slate-200 text-right uppercase tracking-wider text-[11px]">
                      Total Outsourced Streams:
                    </td>
                    <td className="py-2 px-3 text-right border-r border-slate-200 font-mono text-[#08775A]">
                      {formatPKR(data.summary?.totalOutsourcedBilling || 0)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-800">
                      {formatPKR(data.summary?.totalOutsourcedPayable || 0)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          </div>
        </div>
      ) : (
        /* ══════════════════════════════════════════════════════════════════
           DETAILED LEDGER VIEW — Itemized Source Transactions Behind P&L
           ══════════════════════════════════════════════════════════════════ */
        <div className="space-y-3">
          {/* Ledger Search & Filter Sub-bar */}
          <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="w-full sm:w-72">
              <TextInput
                placeholder="Search reference, description, actor..."
                icon={<Search className="h-4 w-4 text-slate-400" />}
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">Category:</span>
              <div className="w-56">
                <Select
                  placeholder="All P&L Categories"
                  options={[
                    { value: 'opd', label: 'OPD Services' },
                    { value: 'emergency', label: 'Emergency Services' },
                    { value: 'observation', label: 'Observation Services' },
                    { value: 'admission', label: 'Admission Services' },
                    { value: 'discounts', label: 'Discounts' },
                    { value: 'consumables', label: 'Clinical Consumables' },
                    { value: 'payroll', label: 'Staff Payroll' },
                    { value: 'commission', label: 'Doctor Commission' },
                    { value: 'hospitalOpex', label: 'Hospital Operating Expenses' },
                    { value: 'inventoryOpex', label: 'Inventory Operating Expenses' },
                    { value: 'outsourced', label: 'Outsourced Services' },
                  ]}
                  value={ledgerCategory}
                  onChange={(e) => {
                    setLedgerCategory(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Ledger Grid Table */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-300 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-2.5 px-3 text-center border-r border-slate-200 w-12">#</th>
                    <th className="py-2.5 px-3 text-left border-r border-slate-200 min-w-[130px]">Date & Time</th>
                    <th className="py-2.5 px-3 text-left border-r border-slate-200 min-w-[120px]">Reference ID</th>
                    <th className="py-2.5 px-3 text-left border-r border-slate-200 min-w-[140px]">Category</th>
                    <th className="py-2.5 px-3 text-left border-r border-slate-200 min-w-[130px]">Department</th>
                    <th className="py-2.5 px-3 text-left border-r border-slate-200 min-w-[200px]">
                      Description / Payee
                    </th>
                    <th className="py-2.5 px-3 text-left border-r border-slate-200 min-w-[130px]">Actor / Staff</th>
                    <th className="py-2.5 px-3 text-right border-r border-slate-200 w-[130px]">
                      Recognized Revenue
                    </th>
                    <th className="py-2.5 px-3 text-right border-r border-slate-200 w-[130px]">
                      Recognized Cost
                    </th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-200 w-[90px]">Status</th>
                    <th className="py-2.5 px-3 text-center w-[70px]">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredLedgerItems.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-slate-500 font-medium">
                        No financial transactions found for the selected period and criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredLedgerItems.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-2 px-3 text-center border-r border-slate-200 text-slate-500 font-mono">
                          {(page - 1) * limit + idx + 1}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 text-slate-700 whitespace-nowrap">
                          {formatDateTimeDDMMYYYY(item.date)}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 font-mono font-medium text-slate-900 whitespace-nowrap">
                          {item.reference}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 text-slate-700 capitalize">
                          {item.category}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 text-slate-700">
                          {item.department}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 text-slate-800 max-w-[240px] truncate block overflow-hidden">
                          {item.description}
                        </td>
                        <td className="py-2 px-3 border-r border-slate-200 text-slate-700">
                          {item.actor}
                        </td>
                        <td className="py-2 px-3 text-right border-r border-slate-200 font-mono font-semibold text-slate-800">
                          {item.revenue > 0 ? `+PKR ${formatAmount(item.revenue)}` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right border-r border-slate-200 font-mono font-semibold text-rose-700">
                          {item.cost > 0 ? `-PKR ${formatAmount(item.cost)}` : '—'}
                        </td>
                        <td className="py-2 px-3 text-center border-r border-slate-200 font-semibold text-[11px] text-slate-700">
                          {item.status}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => setSelectedEntry(item)}
                            className="p-1 text-slate-500 hover:text-[#08775A] hover:bg-slate-100 rounded transition"
                            title="View Details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {/* Ledger Summary Footer */}
                {filteredLedgerItems.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900 text-xs">
                      <td colSpan={7} className="py-2.5 px-3 text-right uppercase tracking-wider border-r border-slate-200">
                        Matching Records Subtotal:
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-800 border-r border-slate-200">
                        +PKR {formatAmount(filteredLedgerItems.reduce((s, it) => s + it.revenue, 0))}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-rose-800 border-r border-slate-200">
                        -PKR {formatAmount(filteredLedgerItems.reduce((s, it) => s + it.cost, 0))}
                      </td>
                      <td colSpan={2} className="py-2.5 px-3 text-center text-slate-600 font-normal text-[11px]">
                        {filteredLedgerItems.length} transactions
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Pagination Controls */}
            {data?.ledger && (
              <div className="bg-white border-t border-slate-200 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-500">Show</span>
                  <div className="w-20">
                    <Select
                      options={[
                        { value: '10', label: '10' },
                        { value: '25', label: '25' },
                        { value: '50', label: '50' },
                        { value: '100', label: '100' },
                      ]}
                      value={String(limit)}
                      onChange={(e) => {
                        const newLimit = Number(e.target.value);
                        setLimit(newLimit);
                        setPage(1);
                        loadReport(1, newLimit);
                      }}
                    />
                  </div>
                  <span className="font-medium text-slate-500">records per page</span>
                  <span className="text-slate-400 font-normal">
                    (Page {data.ledger.page} of {data.ledger.totalPages}, {data.ledger.totalRecords} total items)
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={data.ledger.page <= 1}
                    onClick={() => {
                      const p = data.ledger.page - 1;
                      setPage(p);
                      loadReport(p);
                    }}
                    className="p-1.5 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none transition"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-2 font-medium">
                    {data.ledger.page} / {data.ledger.totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={data.ledger.page >= data.ledger.totalPages}
                    onClick={() => {
                      const p = data.ledger.page + 1;
                      setPage(p);
                      loadReport(p);
                    }}
                    className="p-1.5 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none transition"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── View Details Modal ─────────────────────────────────────── */}
      {selectedEntry && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl max-w-lg w-full overflow-hidden text-xs">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-[#08775A]" />
                Transaction Detail — {selectedEntry.reference}
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntry(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-slate-700">
                <div>
                  <span className="font-semibold text-slate-500 block text-[10px] uppercase">Date & Time</span>
                  <span>{formatDateTimeDDMMYYYY(selectedEntry.date)}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block text-[10px] uppercase">Category</span>
                  <span className="capitalize">{selectedEntry.category}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block text-[10px] uppercase">Department</span>
                  <span>{selectedEntry.department}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block text-[10px] uppercase">Status</span>
                  <span>{selectedEntry.status}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block text-[10px] uppercase">Actor / Staff</span>
                  <span>{selectedEntry.actor}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 block text-[10px] uppercase">Financial Type</span>
                  <span>{selectedEntry.revenue > 0 ? 'Recognized Revenue' : 'Recognized Cost'}</span>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-2">
                <span className="font-semibold text-slate-500 block text-[10px] uppercase">Description / Patient</span>
                <span className="text-slate-800">{selectedEntry.description}</span>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded p-2.5 flex items-center justify-between font-mono">
                <span className="font-semibold text-slate-700">Recognized Amount:</span>
                <span
                  className={`font-bold text-sm ${
                    selectedEntry.revenue > 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {selectedEntry.revenue > 0
                    ? `+PKR ${formatAmount(selectedEntry.revenue)}`
                    : `-PKR ${formatAmount(selectedEntry.cost)}`}
                </span>
              </div>

              {selectedEntry.details && Object.keys(selectedEntry.details).length > 0 && (
                <div className="border-t border-slate-100 pt-2">
                  <span className="font-semibold text-slate-500 block text-[10px] uppercase mb-1">
                    Source Audit Metadata
                  </span>
                  <pre className="p-2 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono text-slate-700 max-h-36 overflow-y-auto">
                    {JSON.stringify(selectedEntry.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            <div className="bg-slate-50 px-4 py-2.5 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedEntry(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition"
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
