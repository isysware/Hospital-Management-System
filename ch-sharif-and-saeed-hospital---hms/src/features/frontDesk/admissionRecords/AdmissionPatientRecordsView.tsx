import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Loader2,
  Search,
  RefreshCw,
  Eye,
  FileSpreadsheet,
  Download,
  Printer,
  ChevronLeft,
  ChevronRight,
  BedDouble,
  Receipt,
  Wallet,
  AlertCircle,
} from 'lucide-react';
import { formatPKR } from '../../../utils/formatters';
import { formatDisplayDate } from '../../../utils/dateConstants';
import { LoadingState, ErrorState } from '../../../components/common/StateViews';
import { PanelBadge } from '../../../components/common/PanelBadge';
import { HospitalKpiHeader } from '../../../components/common/HospitalKpiHeader';
import {
  fetchAdmissionRecords,
  AdmissionPatientRecordRow,
  AdmissionBillingStatus,
} from '../../../services/admissionBillingService';
import { getAllPatients, primePatientRegistryCache } from '../../../services/patientRegistryService';
import { AdmissionLedgerModal } from './AdmissionLedgerModal';

function formatTimestamp(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDisplayDate(d)}, ${d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`;
}

const BILLING_STATUS_BADGE: Record<AdmissionBillingStatus, string> = {
  NO_CHARGES: 'bg-slate-100 text-slate-600',
  UNPAID: 'bg-rose-50 text-rose-800 border border-rose-200',
  PARTIALLY_PAID: 'bg-amber-50 text-amber-800 border border-amber-200',
  PAID: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
};

const CLINICAL_STATUS_BADGE: Record<string, string> = {
  PLANNED: 'bg-blue-50 text-blue-700 border border-blue-200',
  CONFIRMED: 'bg-blue-50 text-blue-700 border border-blue-200',
  ACTIVE: 'bg-[#effaf5] text-[#08775A] border border-[#c2e7db]',
  DISCHARGE_PENDING: 'bg-amber-50 text-amber-800 border border-amber-200',
  DISCHARGED: 'bg-slate-100 text-slate-600 border border-slate-200',
};

/**
 * Front Desk / Billing — "Admission Patient Records" (source-of-truth: the
 * user's admission ledger spec §2). One row per registered admission (never
 * per department invoice, unlike `HospitalInvoicesView`'s ADM queue) — the
 * single entry point into an admission's Running Ledger (`AdmissionLedgerModal`).
 */
export const AdmissionPatientRecordsView: React.FC = () => {
  const [rows, setRows] = useState<AdmissionPatientRecordRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [openAdmissionId, setOpenAdmissionId] = useState<string | null>(null);

  // Pharmacy pagination states
  const [pageSize, setPageSize] = useState(15);
  const [currentPage, setCurrentPage] = useState(1);

  const load = async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);
    try {
      if (!getAllPatients().length) {
        await primePatientRegistryCache();
      }
      setRows(await fetchAdmissionRecords());
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load admission patient records.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return rows;
    const q = searchTerm.toLowerCase().trim();
    return rows.filter(
      (r) =>
        r.admissionNumber.toLowerCase().includes(q) ||
        r.patientName.toLowerCase().includes(q) ||
        (r.patientMrNumber || '').toLowerCase().includes(q),
    );
  }, [rows, searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;

  const metrics = useMemo(
    () =>
      filteredRows.reduce(
        (acc, r) => ({
          count: acc.count + 1,
          totalCharges: acc.totalCharges + r.currentCharges,
          totalPaid: acc.totalPaid + r.totalPaid,
          totalOutstanding: acc.totalOutstanding + r.outstanding,
        }),
        { count: 0, totalCharges: 0, totalPaid: 0, totalOutstanding: 0 },
      ),
    [filteredRows],
  );

  const handleExportCsv = () => {
    if (filteredRows.length === 0) return;
    const headers = ['#', 'Admission No', 'MR #', 'Patient Name', 'Payer', 'Admission Date', 'Location', 'Charges', 'Paid', 'Outstanding', 'Clinical Status', 'Billing Status'];
    const csvRows = filteredRows.map((r, idx) => [
      idx + 1,
      `"${r.admissionNumber}"`,
      `"${r.patientMrNumber || ''}"`,
      `"${r.patientName}"`,
      `"${r.payerType === 'PANEL' ? 'Panel' : 'Self-Pay'}"`,
      `"${r.admittedAt ? formatTimestamp(r.admittedAt) : 'Pending'}"`,
      `"${[r.ward, r.room, r.bed].filter(Boolean).join(' / ') || '—'}"`,
      r.currentCharges,
      r.totalPaid,
      r.outstanding,
      `"${r.clinicalStatus}"`,
      `"${r.billingStatus}"`,
    ]);
    const csv = [headers.join(','), ...csvRows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `admission_records_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const handleExportExcel = () => {
    if (filteredRows.length === 0) return;
    const headers = ['#', 'Admission No', 'MR #', 'Patient Name', 'Payer', 'Admission Date', 'Location', 'Charges', 'Paid', 'Outstanding', 'Clinical Status', 'Billing Status'];
    const rowsHtml = filteredRows
      .map(
        (r, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${r.admissionNumber}</td>
        <td>${r.patientMrNumber || ''}</td>
        <td>${r.patientName}</td>
        <td>${r.payerType === 'PANEL' ? 'Panel' : 'Self-Pay'}</td>
        <td>${r.admittedAt ? formatTimestamp(r.admittedAt) : 'Pending'}</td>
        <td>${[r.ward, r.room, r.bed].filter(Boolean).join(' / ') || '—'}</td>
        <td>${r.currentCharges}</td>
        <td>${r.totalPaid}</td>
        <td>${r.outstanding}</td>
        <td>${r.clinicalStatus}</td>
        <td>${r.billingStatus}</td>
      </tr>
    `,
      )
      .join('');

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"/></head>
      <body>
        <h2>Admission Patient Registry & Financial Records</h2>
        <table border="1">
          <tr style="background:#0e5944;color:#ffffff;font-weight:bold;">
            ${headers.map((h) => `<th>${h}</th>`).join('')}
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
    link.download = `admission_records_${new Date().toISOString().slice(0, 10)}.xls`;
    link.click();
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-150 font-sans">
      {/* Top Banner Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-[#effaf5] text-[#08775A] flex items-center justify-center shrink-0">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Admission Patient Records</h1>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl leading-relaxed">
              One running financial record per admission — ward, bed, lab, consultant, and OT charges accumulate here in real-time.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold rounded-lg shadow-xs transition-colors disabled:opacity-50 self-start md:self-auto cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-[#08775A] ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Pharmacy Style KPI Header Cards */}
      {!isLoading && !loadError && (
        <HospitalKpiHeader
          cards={[
            {
              title: 'Active Admissions',
              value: metrics.count,
              subtitle: 'Registered in system',
              icon: BedDouble,
              accentColor: '#08775A',
              category: 'INPATIENTS',
            },
            {
              title: 'Current Charges',
              value: formatPKR(metrics.totalCharges),
              subtitle: 'Accumulated services',
              icon: Receipt,
              accentColor: '#0284c7',
              category: 'GROSS ACCUMULATED',
            },
            {
              title: 'Total Paid / Advance',
              value: formatPKR(metrics.totalPaid),
              subtitle: 'Collected payments',
              icon: Wallet,
              accentColor: '#16a34a',
              category: 'REALIZED REVENUE',
            },
            {
              title: 'Outstanding Dues',
              value: formatPKR(metrics.totalOutstanding),
              subtitle: 'Net pending balance',
              icon: AlertCircle,
              accentColor: '#dc2626',
              category: 'RECEIVABLE',
            },
          ]}
        />
      )}

      {/* Pharmacy Table Container */}
      <div className="bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-emerald-300" />
            <span className="font-bold text-sm tracking-wide">Admission Patient Records</span>
            <span className="text-[11px] font-semibold text-emerald-200/90 bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-500/30">
              {filteredRows.length} record{filteredRows.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={handleExportExcel}
              className="bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-semibold px-2.5 py-1 rounded-lg shadow-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Export to Excel"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-semibold px-2.5 py-1 rounded-lg shadow-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Export to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-2.5 py-1 rounded-lg shadow-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Print Table"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
          </div>
        </div>

        {/* Search & Records per page Toolbar */}
        <div className="px-3.5 py-2 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium">Show</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-white border border-slate-300 rounded px-2 py-0.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#08775A]"
            >
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span className="text-slate-600 font-medium">records per page</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search admission, patient, MRN…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-56 text-xs pl-8 pr-3 py-1 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08775A] bg-white placeholder:text-slate-400"
              />
            </div>
            <div className="text-slate-500 font-medium whitespace-nowrap">
              Showing {filteredRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length} entries
            </div>
          </div>
        </div>

        {isLoading ? (
          <LoadingState message="Loading admission patient records…" />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={() => load()} />
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] min-h-[300px]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#f8fafc] text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200 uppercase tracking-wider select-none">
                <tr>
                  <th className="py-3 px-3.5 text-center border-r border-slate-200 w-12 whitespace-nowrap">#</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Admission No.</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">MR #</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Patient Name</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Payer</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Admission Date</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Ward / Bed</th>
                  <th className="py-3 px-4 border-r border-slate-200 text-right whitespace-nowrap">Current Charges</th>
                  <th className="py-3 px-4 border-r border-slate-200 text-right whitespace-nowrap">Total Paid</th>
                  <th className="py-3 px-4 border-r border-slate-200 text-right whitespace-nowrap">Outstanding</th>
                  <th className="py-3 px-4 border-r border-slate-200 text-center whitespace-nowrap">Clinical Status</th>
                  <th className="py-3 px-4 border-r border-slate-200 text-center whitespace-nowrap">Billing Status</th>
                  <th className="py-3 px-4 text-center whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {paginatedRows.map((r, idx) => {
                  const rowNumber = (currentPage - 1) * pageSize + idx + 1;
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                      onClick={() => setOpenAdmissionId(r.id)}
                    >
                      <td className="py-3.5 px-3.5 text-center border-r border-slate-100 text-slate-500 font-semibold text-xs whitespace-nowrap font-mono">
                        {rowNumber}
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {r.admissionNumber}
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap font-mono text-xs font-semibold text-[#08775A]">
                        {r.patientMrNumber || '—'}
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                        <span className="font-semibold text-slate-900 block whitespace-nowrap">{r.patientName}</span>
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                        {r.payerType === 'PANEL' ? (
                          <PanelBadge />
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600 whitespace-nowrap">
                            Self-Pay
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap text-slate-600">
                        {r.admittedAt ? formatTimestamp(r.admittedAt) : 'Pending check-in'}
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap text-slate-600 font-medium">
                        {[r.ward, r.room, r.bed].filter(Boolean).join(' / ') || '—'}
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 text-right font-mono font-bold text-slate-900 whitespace-nowrap tabular-nums">
                        {formatPKR(r.currentCharges)}
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 text-right font-mono font-bold text-emerald-700 whitespace-nowrap tabular-nums">
                        {formatPKR(r.totalPaid)}
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 text-right font-mono font-bold whitespace-nowrap tabular-nums">
                        {r.outstanding > 0 ? (
                          <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200 whitespace-nowrap font-bold">
                            {formatPKR(r.outstanding)}
                          </span>
                        ) : r.availableCredit > 0 ? (
                          <span
                            className="text-[#08775A] bg-[#effaf5] px-2 py-0.5 rounded-full border border-[#c2e7db] whitespace-nowrap font-bold"
                            title="Available advance / credit"
                          >
                            Credit {formatPKR(r.availableCredit)}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-normal whitespace-nowrap">Settled</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
                            CLINICAL_STATUS_BADGE[r.clinicalStatus] || 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {['PLANNED', 'CONFIRMED'].includes(r.clinicalStatus)
                            ? 'PENDING CHECK-IN'
                            : r.clinicalStatus.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 border-r border-slate-100 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${BILLING_STATUS_BADGE[r.billingStatus]}`}
                        >
                          {r.billingStatus.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setOpenAdmissionId(r.id)}
                          title="View Admission Record"
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-[#08775A] text-[#08775A] hover:text-white border border-[#c2e7db] hover:border-[#08775A] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
                        >
                          <Eye className="h-3 w-3" />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="py-16 text-center text-slate-500">
                      <ClipboardList className="h-9 w-9 text-slate-300 mx-auto mb-2" />
                      <h4 className="text-sm font-semibold text-slate-800">No Admission Records Found</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        {searchTerm ? 'No admission matches your search.' : 'No admission patient records yet.'}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {isRefreshing && (
          <div className="px-4 py-2 border-t border-slate-200 flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#08775A]" /> Refreshing…
          </div>
        )}

        {/* Pharmacy Pagination Footer */}
        {filteredRows.length > 0 && (
          <div className="px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-slate-500">
              Showing {(currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length} entries
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                  .map((p, idx, arr) => (
                    <React.Fragment key={p}>
                      {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-slate-400">…</span>}
                      <button
                        type="button"
                        onClick={() => setCurrentPage(p)}
                        className={`w-7 h-7 rounded text-xs font-semibold cursor-pointer ${
                          currentPage === p
                            ? 'bg-[#08775A] text-white shadow-xs'
                            : 'text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                      >
                        {p}
                      </button>
                    </React.Fragment>
                  ))}
              </div>
              <button
                type="button"
                disabled={currentPage === totalPages || filteredRows.length === 0}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {openAdmissionId && (
        <AdmissionLedgerModal
          admissionId={openAdmissionId}
          onClose={() => setOpenAdmissionId(null)}
          onChanged={() => load(true)}
        />
      )}
    </div>
  );
};
