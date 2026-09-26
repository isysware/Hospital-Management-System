import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Filter as FilterIcon, RotateCcw, Search, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Select, TextInput } from '../forms/FormControls';
import { useAuth } from '../../context/AuthContext';
import { formatPKR } from '../../utils/formatters';
import { formatDateISO, getHospitalCurrentDate } from '../../utils/dateConstants';
import { downloadTablePDF, downloadTableExcel, downloadTableCSV, printTable, ExportColumn } from '../../services/tableExportService';
import { ExportButtonGroup } from '../../features/superAdmin/financeControl/ExportButtonGroup';

/** `all` is only offered by reports that opt in via `allTimeOption` (their backend must accept it). */
export type ReportDatePreset = 'all' | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';

const PRESET_OPTIONS: { label: string; value: ReportDatePreset }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This Week', value: 'this_week' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Custom Range', value: 'custom' },
];

export interface ReportKpi {
  label: string;
  value: string;
  accent?: 'default' | 'positive' | 'negative' | 'warning';
}

export interface ReportResult<T> {
  periodLabel?: string;
  kpis?: ReportKpi[];
  rows: T[];
}

export interface GenericReportViewProps<T> {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  filenamePrefix: string;
  columns: ExportColumn<T>[];
  fetchReport: (range: { preset: ReportDatePreset; fromDate?: string; toDate?: string }) => Promise<ReportResult<T>>;
  rowKey: (row: T, index: number) => string;
  /** Renders a table cell for on-screen display; defaults to the export column's `cell`. Lets a report add badges/links the plain export text can't carry. */
  renderCell?: (col: ExportColumn<T>, row: T) => React.ReactNode;
  emptyMessage?: string;
  /** Point-in-time reports (census, bed occupancy) have no date range to filter. */
  noDateFilter?: boolean;
  extraFilters?: React.ReactNode;
  /** Only the portal's own Summary report should show a KPI strip (reporting.md §1) — every other report stays a plain filtered table. */
  showKpis?: boolean;
  /** Called when the Reset button is pressed, so a report with its own extra filter state (department, doctor, status…) can clear it too. */
  onResetExtraFilters?: () => void;
  /** Right-aligned numeric columns that must NOT be summed in the totals row (headers). */
  noTotalColumns?: string[];
  /** Adds an "All Time" period (and makes it the default) — for history lists like settlements. */
  allTimeOption?: boolean;
}

/** Totals for these columns are counts, not money. */
const COUNT_HEADER = /qty|count|invoices|receipts|admissions|discharges|patients|pending/i;

const PAGE_SIZE = 50;

const DMY = /^(\d{2})[-/](\d{2})[-/](\d{4})(.*)$/;

function sortKey<T>(col: ExportColumn<T>, row: T): string | number {
  const raw = col.excelValue ? col.excelValue(row) : col.cell(row);
  if (typeof raw === 'number') return raw;
  const m = DMY.exec(raw);
  return m ? `${m[3]}${m[2]}${m[1]}${m[4]}` : raw;
}

function compareCells(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

const accentClass: Record<NonNullable<ReportKpi['accent']>, string> = {
  default: 'text-slate-900',
  positive: 'text-emerald-700',
  negative: 'text-rose-700',
  warning: 'text-amber-700',
};

/**
 * Reusable reporting view matching hospital ERP theme & reference reporting UI:
 * - Clean title & filter bar
 * - Dark hospital theme banner with icon and period label
 * - Colorful Export Toolbar (Excel, CSV, PDF, Print)
 * - Complete bordered table grid with # row numbering & subtle dividers
 */
export function GenericReportView<T>({
  title,
  subtitle,
  icon: Icon,
  filenamePrefix,
  columns,
  fetchReport,
  rowKey,
  renderCell,
  emptyMessage = 'No records match these filters.',
  noDateFilter,
  extraFilters,
  showKpis = false,
  onResetExtraFilters,
  noTotalColumns,
  allTimeOption,
}: GenericReportViewProps<T>) {
  const { currentUser } = useAuth();
  const todayISO = formatDateISO(getHospitalCurrentDate());
  const defaultPreset: ReportDatePreset = allTimeOption ? 'all' : 'today';
  const [preset, setPreset] = useState<ReportDatePreset>(defaultPreset);
  const [fromDate, setFromDate] = useState(todayISO);
  const [toDate, setToDate] = useState(todayISO);
  const [result, setResult] = useState<ReportResult<T> | null>(null);
  // Every report auto-loads its default view on open (see effect below), so
  // start in the loading state to avoid a one-frame "no results yet" flash.
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Always closes over the CURRENT fetchReport/extraFilters state at click
  // time — no stale-closure risk from a narrowly-scoped useCallback dep array.
  const applyFilter = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setResult(await fetchReport({ preset, fromDate: preset === 'custom' ? fromDate : undefined, toDate: preset === 'custom' ? toDate : undefined }));
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load report.');
    } finally {
      setIsLoading(false);
    }
  };

  // Bumped by Reset so the effect below re-fetches with the just-cleared
  // filters — it fires after React commits the reset, so `fetchReport`'s
  // closure (owned by the parent) already reflects the cleared extra filters.
  const [reloadTick, setReloadTick] = useState(0);

  const handleReset = () => {
    setPreset(defaultPreset);
    setFromDate(todayISO);
    setToDate(todayISO);
    onResetExtraFilters?.();
    setSearch('');
    setLoadError(null);
    setReloadTick((n) => n + 1);
  };

  // Every report loads its default view (Today, or the point-in-time snapshot)
  // as soon as it opens — no click required. Filter/Reset are for changing
  // the criteria afterward, not for the first load.
  useEffect(() => {
    applyFilter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  // Quick in-table search over the loaded rows (the filter row re-queries
  // the backend; this only narrows what's already on screen). Exports follow
  // what's visible.
  const [search, setSearch] = useState('');
  const allRows = result?.rows ?? [];
  const needle = search.trim().toLowerCase();
  const searchedRows = needle ? allRows.filter((r) => columns.some((c) => c.cell(r).toLowerCase().includes(needle))) : allRows;

  // Click a column header to sort (asc → desc → off). Numeric columns sort by
  // their raw Excel value; text sorts naturally, with DD/MM/YYYY dates
  // re-ordered to YYYYMMDD so they sort chronologically.
  const [sort, setSort] = useState<{ header: string; dir: 'asc' | 'desc' } | null>(null);
  const toggleSort = (header: string) =>
    setSort((s) => (s?.header !== header ? { header, dir: 'asc' } : s.dir === 'asc' ? { header, dir: 'desc' } : null));
  const sortCol = sort ? columns.find((c) => c.header === sort.header) : undefined;
  const rows = sortCol
    ? [...searchedRows].sort((a, b) => {
        const cmp = compareCells(sortKey(sortCol, a), sortKey(sortCol, b));
        return sort!.dir === 'asc' ? cmp : -cmp;
      })
    : searchedRows;

  // Pagination — totals and exports still cover every filtered row, not just the visible page.
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  useEffect(() => {
    setPage(0);
  }, [result, needle, sort]);

  // Totals row: sums every right-aligned column whose Excel value is numeric,
  // except ones the report marks as not additive (e.g. a per-request amount
  // repeated on each receipt row).
  const totals = columns.map((c) => {
    if (c.align !== 'right' || !c.excelValue || rows.length === 0 || noTotalColumns?.includes(c.header)) return null;
    let sum = 0;
    for (const r of rows) {
      const v = c.excelValue(r);
      if (typeof v !== 'number') return null;
      sum += v;
    }
    return sum;
  });
  const hasTotals = totals.some((t) => t !== null);

  const exportContext = { documentTitle: title, documentSubtitle: subtitle, filenamePrefix, columns, rows, currentUser, periodLabel: result?.periodLabel };

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Top Header & Subtitle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
      </div>

      {/* Filter Bar — change filters, then press Filter to re-query. Point-in-time
          reports (noDateFilter) still get the bar when they have their own filters. */}
      {(!noDateFilter || extraFilters) && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex items-end gap-3 flex-wrap">
          {!noDateFilter && (
            <div className="w-44">
              <Select label="Period" options={allTimeOption ? [{ label: 'All Time', value: 'all' }, ...PRESET_OPTIONS] : PRESET_OPTIONS} value={preset} onChange={(e) => setPreset(e.target.value as ReportDatePreset)} />
            </div>
          )}
          {!noDateFilter && preset === 'custom' && (
            <>
              <TextInput label="From" lang="en-GB" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              <TextInput label="To" lang="en-GB" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </>
          )}
          {extraFilters}
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={applyFilter}
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
      )}

      {loadError ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 flex flex-col items-center gap-2 text-center shadow-xs">
          <AlertCircle className="h-6 w-6 text-rose-500" />
          <p className="text-xs text-rose-700 font-medium">{loadError}</p>
          <button type="button" onClick={applyFilter} className="mt-1 text-xs font-semibold text-[#08775A] hover:underline">
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 flex items-center justify-center gap-2 text-slate-400 shadow-xs">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Loading report…</span>
        </div>
      ) : (
        <>
          {showKpis && result?.kpis && result.kpis.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {result.kpis.map((k) => (
                <div key={k.label} className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs">
                  <span className="text-[10.5px] text-slate-500 font-medium block">{k.label}</span>
                  <span className={`text-base font-bold font-mono block mt-1 ${accentClass[k.accent || 'default']}`}>{k.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Distinctive Dark Theme Banner (matching reference UI) */}
          <div className="bg-gradient-to-r from-[#0a4636] to-[#08775A] text-white px-4 py-2.5 rounded-lg flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2.5 font-bold text-sm tracking-wide text-white">
              <div className="h-6 w-6 rounded bg-white/15 text-white flex items-center justify-center">
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span>{title}</span>
            </div>
            {result?.periodLabel && (
              <span className="text-xs text-emerald-100 font-medium bg-white/10 px-2.5 py-0.5 rounded-md">
                {result.periodLabel}
              </span>
            )}
          </div>

          {/* Export Toolbar (Excel, CSV, PDF, Print) right above table */}
          <div className="flex items-center justify-between gap-3 flex-wrap -mt-1">
            <div className="relative w-full sm:w-64">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search in results…"
                className="w-full h-8 pl-8 pr-2.5 rounded-lg border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-[#08775A]"
              />
            </div>
            <ExportButtonGroup
              disabled={rows.length === 0}
              onExcel={() => downloadTableExcel(exportContext)}
              onCsv={() => downloadTableCSV(exportContext)}
              onPdf={() => downloadTablePDF(exportContext)}
              onPrint={() => printTable(exportContext)}
            />
          </div>

          {/* Table with proper bordered grid lines */}
          <div className="bg-white rounded-lg border border-slate-300 shadow-xs overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)]">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#f1f5f9] border-b border-slate-300 sticky top-0 z-10 text-slate-800 text-[11.5px] font-bold uppercase tracking-wider">
                    <th className="w-12 py-3 px-3 text-center border-r border-slate-300 font-bold text-slate-700">#</th>
                    {columns.map((c) => {
                      const sortable = !/^actions?$/i.test(c.header);
                      const active = sort?.header === c.header;
                      return (
                        <th
                          key={c.header}
                          onClick={sortable ? () => toggleSort(c.header) : undefined}
                          aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                          className={`py-3 px-3.5 border-r border-slate-300 last:border-r-0 whitespace-nowrap ${sortable ? 'cursor-pointer select-none hover:bg-slate-200/70' : ''} ${
                            c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                          }`}
                          title={sortable ? 'Click to sort' : undefined}
                        >
                          <span className="inline-flex items-center gap-1">
                            {c.header}
                            {sortable &&
                              (active ? (
                                sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3 text-[#08775A]" /> : <ArrowDown className="h-3 w-3 text-[#08775A]" />
                              ) : (
                                <ArrowUpDown className="h-3 w-3 text-slate-400" />
                              ))}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="py-12 text-center text-slate-400 border-b border-slate-200">
                        {emptyMessage}
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row, i) => {
                      const idx = safePage * PAGE_SIZE + i;
                      return (
                      <tr key={rowKey(row, idx)} className="hover:bg-slate-50/90 transition-colors border-b border-slate-200 last:border-b-0">
                        <td className="py-2.5 px-3 text-center border-r border-slate-200 text-slate-500 font-mono text-[11px] bg-slate-50/60 whitespace-nowrap">
                          {idx + 1}
                        </td>
                        {columns.map((c) => {
                          const isCodeOrId = c.header.toLowerCase().includes('#') || c.header.toLowerCase().includes('code') || c.header.toLowerCase().includes('id');
                          return (
                            <td
                              key={c.header}
                              className={`py-2.5 px-3.5 border-r border-slate-200 last:border-r-0 whitespace-nowrap ${
                                c.align === 'right'
                                  ? 'text-right font-mono'
                                  : c.align === 'center'
                                  ? 'text-center'
                                  : isCodeOrId
                                  ? 'font-semibold text-[#08775A]'
                                  : ''
                              }`}
                            >
                              {renderCell ? renderCell(c, row) : c.cell(row)}
                            </td>
                          );
                        })}
                      </tr>
                      );
                    })
                  )}
                </tbody>
                {hasTotals && rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-[#f1f5f9] border-t-2 border-slate-300 font-bold text-slate-900 sticky bottom-0">
                      <td className="py-2.5 px-3 text-center border-r border-slate-300 text-[10.5px] uppercase tracking-wider text-slate-600">Total</td>
                      {columns.map((c, i) => (
                        <td key={c.header} className="py-2.5 px-3.5 border-r border-slate-300 last:border-r-0 whitespace-nowrap text-right font-mono">
                          {totals[i] === null ? '' : COUNT_HEADER.test(c.header) ? String(totals[i]) : formatPKR(totals[i] as number)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {rows.length > 0 && (
              <div className="flex items-center justify-between gap-3 px-3.5 py-2 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-600">
                <span>
                  Showing {safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + pageRows.length} of {rows.length}
                  {rows.length !== allRows.length ? ` (filtered from ${allRows.length})` : ''}
                </span>
                {pageCount > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPage(safePage - 1)}
                      disabled={safePage === 0}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Prev
                    </button>
                    <span className="px-1.5 font-medium">
                      Page {safePage + 1} of {pageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage(safePage + 1)}
                      disabled={safePage >= pageCount - 1}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
