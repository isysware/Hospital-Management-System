import React, { useEffect, useMemo, useState } from 'react';
import {
  UserCheck,
  CheckCircle2,
  RefreshCw,
  Search,
  RotateCcw,
  Calendar,
  Building2,
  FileText,
  Printer,
  Eye,
  Clock,
  Users,
  ShieldCheck,
  ArrowRight,
  Filter,
  Check,
  X,
  FileSpreadsheet,
  Download,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { PanelBadge } from '../../components/common/PanelBadge';
import { Modal } from '../../components/common/Modal';
import { useRouter } from '../../context/RouterContext';
import { AdmissionRecord, fetchAdmissions } from '../../services/admissionService';
import { DepartmentService, fetchDepartments } from '../../services/departmentService';
import { Department } from '../../types/department';
import { AdmissionDetailModal } from '../admission/AdmissionDetailModal';
import { AdmissionLedgerModal } from '../frontDesk/admissionRecords/AdmissionLedgerModal';
import { HospitalKpiHeader } from '../../components/common/HospitalKpiHeader';
import { formatPKR, formatDateTimeDDMMYYYY } from '../../utils/formatters';

function formatDisplayDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return formatDateTimeDDMMYYYY(iso) || '—';
}

function computeStayDuration(admittedAt?: string | null, dischargedAt?: string | null): string {
  if (!admittedAt || !dischargedAt) return '—';
  const start = new Date(admittedAt).getTime();
  const end = new Date(dischargedAt).getTime();
  if (isNaN(start) || isNaN(end) || end < start) return '—';
  const diffHours = Math.round((end - start) / (1000 * 60 * 60));
  if (diffHours < 24) {
    return `${Math.max(1, diffHours)} hr${diffHours === 1 ? '' : 's'}`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
}

export const DischargedPatientsView: React.FC = () => {
  const { navigate, currentPortal } = useRouter();

  const [patients, setPatients] = useState<AdmissionRecord[]>([]);
  const [departments, setDepartments] = useState<Department[]>(() => DepartmentService.getDepartments());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [payerFilter, setPayerFilter] = useState<'ALL' | 'Corporate / Panel' | 'Self Pay'>('ALL');
  const [timeFilter, setTimeFilter] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL');

  // Modals
  const [detailAdmissionId, setDetailAdmissionId] = useState<string | null>(null);
  const [ledgerAdmissionId, setLedgerAdmissionId] = useState<string | null>(null);
  const [printSlipPatient, setPrintSlipPatient] = useState<AdmissionRecord | null>(null);

  const load = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);

    try {
      const [admissionsRes, deptRes] = await Promise.all([
        fetchAdmissions({ status: 'DISCHARGED' }),
        fetchDepartments().catch(() => DepartmentService.getDepartments()),
      ]);
      setPatients(admissionsRes);
      setDepartments(deptRes.filter((d) => d.status === 'Active'));
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load discharged patients.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Compute Summary Statistics
  const totalDischarged = patients.length;
  const todayStr = new Date().toDateString();

  const dischargedToday = useMemo(() => {
    return patients.filter((p) => {
      if (!p.dischargedAt) return false;
      const d = new Date(p.dischargedAt);
      return !isNaN(d.getTime()) && d.toDateString() === todayStr;
    }).length;
  }, [patients, todayStr]);

  const panelDischarged = useMemo(() => {
    return patients.filter((p) => p.payerType === 'Corporate / Panel').length;
  }, [patients]);

  const selfPayDischarged = totalDischarged - panelDischarged;

  // Average stay calculation in days
  const avgStayDays = useMemo(() => {
    const valid = patients.filter((p) => p.admittedAt && p.dischargedAt);
    if (valid.length === 0) return 0;
    const totalHours = valid.reduce((sum, p) => {
      const start = new Date(p.admittedAt).getTime();
      const end = new Date(p.dischargedAt).getTime();
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        return sum + (end - start) / (1000 * 60 * 60);
      }
      return sum;
    }, 0);
    return Math.round((totalHours / valid.length / 24) * 10) / 10;
  }, [patients]);

  // Filter Logic
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = startOfToday - 30 * 24 * 60 * 60 * 1000;

    return patients.filter((p) => {
      // Department filter
      if (departmentFilter !== 'ALL' && p.departmentId !== departmentFilter) {
        return false;
      }

      // Payer filter
      if (payerFilter !== 'ALL' && p.payerType !== payerFilter) {
        return false;
      }

      // Time filter
      if (timeFilter !== 'ALL' && p.dischargedAt) {
        const dischargeTime = new Date(p.dischargedAt).getTime();
        if (timeFilter === 'TODAY' && dischargeTime < startOfToday) return false;
        if (timeFilter === 'WEEK' && dischargeTime < sevenDaysAgo) return false;
        if (timeFilter === 'MONTH' && dischargeTime < thirtyDaysAgo) return false;
      }

      // Search term
      if (term) {
        const matchesName = p.patientName.toLowerCase().includes(term);
        const matchesMr = p.patientMrNumber.toLowerCase().includes(term);
        const matchesAdm = p.admissionNumber.toLowerCase().includes(term);
        const matchesDept = p.departmentName.toLowerCase().includes(term);
        const matchesDoc = (p.doctorName || '').toLowerCase().includes(term);
        const matchesBed = (p.bedLabel || '').toLowerCase().includes(term);
        const matchesDx = (p.diagnosis || '').toLowerCase().includes(term);

        if (!matchesName && !matchesMr && !matchesAdm && !matchesDept && !matchesDoc && !matchesBed && !matchesDx) {
          return false;
        }
      }

      return true;
    });
  }, [patients, search, departmentFilter, payerFilter, timeFilter]);

  const hasActiveFilters =
    search.trim() !== '' ||
    departmentFilter !== 'ALL' ||
    payerFilter !== 'ALL' ||
    timeFilter !== 'ALL';

  const resetFilters = () => {
    setSearch('');
    setDepartmentFilter('ALL');
    setPayerFilter('ALL');
    setTimeFilter('ALL');
  };

  // Pharmacy pagination states & export
  const [pageSize, setPageSize] = useState(15);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, departmentFilter, payerFilter, timeFilter]);

  const paginatedPatients = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;

  const handleExportCsv = () => {
    if (filtered.length === 0) return;
    const headers = ['#', 'Admission No', 'MR #', 'Patient Name', 'Payer', 'Department', 'Doctor', 'Discharged Bed', 'Admitted At', 'Discharged At', 'Stay Duration', 'Medication Mode'];
    const rows = filtered.map((p, idx) => [
      idx + 1,
      `"${p.admissionNumber}"`,
      `"${p.patientMrNumber}"`,
      `"${p.patientName}"`,
      `"${p.payerType}"`,
      `"${p.departmentName}"`,
      `"${p.doctorName || ''}"`,
      `"${p.bedLabel || 'Bed Released'}"`,
      `"${p.admittedAt ? formatDisplayDateTime(p.admittedAt) : ''}"`,
      `"${p.dischargedAt ? formatDisplayDateTime(p.dischargedAt) : ''}"`,
      `"${computeStayDuration(p.admittedAt || p.createdAtIso, p.dischargedAt)}"`,
      `"${p.medicationMode === 'HOSPITAL_MANAGED' ? 'Hospital' : 'Self'}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `discharged_patients_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const handleExportExcel = () => {
    if (filtered.length === 0) return;
    const headers = ['#', 'Admission No', 'MR #', 'Patient Name', 'Payer', 'Department', 'Doctor', 'Discharged Bed', 'Admitted At', 'Discharged At', 'Stay Duration', 'Medication Mode'];
    const rowsHtml = filtered
      .map(
        (p, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${p.admissionNumber}</td>
        <td>${p.patientMrNumber}</td>
        <td>${p.patientName}</td>
        <td>${p.payerType}</td>
        <td>${p.departmentName}</td>
        <td>${p.doctorName || ''}</td>
        <td>${p.bedLabel || 'Bed Released'}</td>
        <td>${p.admittedAt ? formatDisplayDateTime(p.admittedAt) : ''}</td>
        <td>${p.dischargedAt ? formatDisplayDateTime(p.dischargedAt) : ''}</td>
        <td>${computeStayDuration(p.admittedAt || p.createdAtIso, p.dischargedAt)}</td>
        <td>${p.medicationMode === 'HOSPITAL_MANAGED' ? 'Hospital' : 'Self'}</td>
      </tr>
    `,
      )
      .join('');

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"/></head>
      <body>
        <h2>Discharged Patients Archive</h2>
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
    link.download = `discharged_patients_${new Date().toISOString().slice(0, 10)}.xls`;
    link.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150 font-sans">
      {/* Top Header Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#effaf5] text-[#08775A] flex items-center justify-center font-bold">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Discharged Patients</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Historical record of completed admissions, length of stay, and patient billing ledgers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold shadow-2xs transition-colors disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-[#08775A]' : ''}`} />
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>

          {currentPortal === 'admission' ? (
            <button
              type="button"
              onClick={() => navigate('/admission/final_discharge')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Final Discharge Queue
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/front-desk/admissions')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Users className="h-3.5 w-3.5" /> Admission Records
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700 font-medium">
          {loadError}
        </div>
      )}

      {/* Pharmacy Style Summary KPI Strip */}
      <HospitalKpiHeader
        cards={[
          {
            title: 'Total Discharges',
            value: totalDischarged,
            subtitle: 'All-time completed stays',
            icon: UserCheck,
            accentColor: '#08775A',
            category: 'ARCHIVED',
          },
          {
            title: 'Discharged Today',
            value: dischargedToday,
            subtitle: 'Patients released today',
            icon: Calendar,
            accentColor: '#0284c7',
            category: 'TODAY EXIT',
          },
          {
            title: 'Avg Length of Stay',
            value: `${avgStayDays} ${avgStayDays === 1 ? 'Day' : 'Days'}`,
            subtitle: 'From check-in to discharge',
            icon: Clock,
            accentColor: '#8b5cf6',
            category: 'HOSPITAL ALOS',
          },
          {
            title: 'Panel vs Self-Pay',
            value: `${panelDischarged} / ${selfPayDischarged}`,
            subtitle: `${panelDischarged} Corporate, ${selfPayDischarged} Cash`,
            icon: ShieldCheck,
            accentColor: '#f59e0b',
            category: 'COVERAGE RATIO',
          },
        ]}
      />

      {/* Filter and Search Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3.5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Search Input */}
          <div className="md:col-span-6 relative">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by Patient Name, MR #, Admission #, Doctor, Diagnosis…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08775A] focus:border-[#08775A] bg-slate-50/50"
            />
          </div>

          {/* Department Filter */}
          <div className="md:col-span-3">
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08775A] bg-white text-slate-700"
            >
              <option value="ALL">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          {/* Payer Filter */}
          <div className="md:col-span-3">
            <select
              value={payerFilter}
              onChange={(e) => setPayerFilter(e.target.value as any)}
              className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#08775A] bg-white text-slate-700"
            >
              <option value="ALL">All Payer Types</option>
              <option value="Corporate / Panel">Corporate / Panel Only</option>
              <option value="Self Pay">Self Pay Only</option>
            </select>
          </div>
        </div>

        {/* Time Chips & Summary Line */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-slate-500 mr-1">Discharge Time:</span>

            <button
              type="button"
              onClick={() => setTimeFilter('ALL')}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                timeFilter === 'ALL'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Time
            </button>

            <button
              type="button"
              onClick={() => setTimeFilter('TODAY')}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                timeFilter === 'TODAY'
                  ? 'bg-[#08775A] text-white shadow-2xs'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              Today ({dischargedToday})
            </button>

            <button
              type="button"
              onClick={() => setTimeFilter('WEEK')}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                timeFilter === 'WEEK'
                  ? 'bg-[#08775A] text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Last 7 Days
            </button>

            <button
              type="button"
              onClick={() => setTimeFilter('MONTH')}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                timeFilter === 'MONTH'
                  ? 'bg-[#08775A] text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              This Month
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-500">
              Showing <span className="font-bold text-slate-800">{filtered.length}</span> of {totalDischarged} records
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" /> Reset Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Discharged Patients Table in Pharmacy Design */}
      <div className="bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-300" />
            <span className="font-bold text-sm tracking-wide">Discharged Patients Archive</span>
            <span className="text-[11px] font-semibold text-emerald-200/90 bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-500/30">
              {filtered.length} record{filtered.length === 1 ? '' : 's'}
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

        {/* Search in results toolbar */}
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

          <div className="text-slate-500 font-medium">
            Showing {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
            {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} entries
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 flex flex-col items-center justify-center gap-2 text-slate-400">
            <RefreshCw className="h-6 w-6 animate-spin text-[#08775A]" />
            <span className="text-xs font-medium">Loading discharged patients…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <UserCheck className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-800">No discharged patient records found</p>
            <p className="text-xs text-slate-500 mt-1">
              {hasActiveFilters
                ? 'Try adjusting your search query or filters.'
                : 'Completed discharges will automatically be archived here.'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" /> Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] min-h-[300px]">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-[#f8fafc] text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200 uppercase tracking-wider select-none">
                <tr>
                  <th className="py-3 px-3.5 text-center border-r border-slate-200 w-12 whitespace-nowrap">#</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Admission #</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">MR #</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Patient Name</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Department &amp; Doctor</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Discharged Bed</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap">Admission Timeline</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap text-center">Stay Length</th>
                  <th className="py-3 px-4 border-r border-slate-200 whitespace-nowrap text-center">Medication</th>
                  <th className="py-3 px-4 text-center whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {paginatedPatients.map((patient, idx) => {
                  const duration = computeStayDuration(patient.admittedAt || patient.createdAtIso, patient.dischargedAt);
                  const rowNumber = (currentPage - 1) * pageSize + idx + 1;

                  return (
                    <tr key={patient.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="py-3.5 px-3.5 text-center border-r border-slate-100 text-slate-500 font-semibold text-xs whitespace-nowrap font-mono">
                        {rowNumber}
                      </td>

                      {/* Admission Number */}
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap font-mono font-bold text-slate-900">
                        {patient.admissionNumber}
                      </td>

                      {/* MR # */}
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap font-mono text-xs font-semibold text-[#08775A]">
                        {patient.patientMrNumber || '—'}
                      </td>

                      {/* Patient Name */}
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-slate-900">{patient.patientName}</span>
                          {patient.payerType === 'Corporate / Panel' && <PanelBadge />}
                        </div>
                        {patient.diagnosis && (
                          <div className="text-[10px] text-slate-500 italic mt-0.5 line-clamp-1 max-w-[180px]">
                            {patient.diagnosis}
                          </div>
                        )}
                      </td>

                      {/* Department & Doctor */}
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                        <div className="font-medium text-slate-800">{patient.departmentName}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Dr. {patient.doctorName || 'Assigned'}</div>
                      </td>

                      {/* Bed Label */}
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                        <span className="font-medium text-slate-700">{patient.bedLabel || 'Bed Released'}</span>
                      </td>

                      {/* Timeline */}
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap">
                        <div className="text-[11px] text-slate-700">
                          <span className="text-slate-400">Adm: </span>
                          {formatDisplayDateTime(patient.admittedAt || patient.createdAtIso)}
                        </div>
                        <div className="text-[11px] text-emerald-700 font-medium mt-0.5">
                          <span className="text-slate-400">Dis: </span>
                          {formatDisplayDateTime(patient.dischargedAt)}
                        </div>
                      </td>

                      {/* Stay Length */}
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {duration}
                        </span>
                      </td>

                      {/* Medication Mode */}
                      <td className="py-3.5 px-4 border-r border-slate-100 whitespace-nowrap text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            patient.medicationMode === 'HOSPITAL_MANAGED'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {patient.medicationMode === 'HOSPITAL_MANAGED' ? 'Hospital' : 'Self'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-center">
                        <div className="inline-flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailAdmissionId(patient.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg shadow-2xs transition-colors cursor-pointer"
                            title="View Stay Details"
                          >
                            <Eye className="h-3 w-3 text-[#08775A]" /> View Details
                          </button>

                          <button
                            type="button"
                            onClick={() => setLedgerAdmissionId(patient.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#08775A] bg-[#effaf5] hover:bg-[#d8f3e5] border border-[#08775A]/20 rounded-lg transition-colors cursor-pointer"
                            title="View Billing Ledger"
                          >
                            <FileText className="h-3 w-3" /> Ledger
                          </button>

                          <button
                            type="button"
                            onClick={() => setPrintSlipPatient(patient)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="Print Discharge Summary Slip"
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pharmacy Pagination Footer */}
        {filtered.length > 0 && (
          <div className="px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-slate-500">
              Showing {(currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} entries
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
                disabled={currentPage === totalPages || filtered.length === 0}
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

      {/* Modals */}
      {detailAdmissionId && (
        <AdmissionDetailModal
          admissionId={detailAdmissionId}
          initialTab="overview"
          onClose={() => setDetailAdmissionId(null)}
          onChanged={() => load()}
        />
      )}

      {ledgerAdmissionId && (
        <AdmissionLedgerModal
          admissionId={ledgerAdmissionId}
          readOnly
          onClose={() => setLedgerAdmissionId(null)}
        />
      )}

      {/* Printable Discharge Summary Slip Modal */}
      {printSlipPatient && (
        <Modal
          isOpen
          onClose={() => setPrintSlipPatient(null)}
          title={`Discharge Summary Slip — ${printSlipPatient.admissionNumber}`}
          maxWidth="md"
        >
          <div className="space-y-4">
            {/* Slip Paper Preview */}
            <div
              id="discharge-slip-content"
              className="p-5 bg-white border border-slate-300 rounded-xl space-y-4 text-xs font-sans shadow-xs"
            >
              {/* Slip Header */}
              <div className="text-center pb-3 border-b border-slate-200">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                  CH Sharif &amp; Saeed Hospital
                </h3>
                <p className="text-[10px] text-slate-500">Inpatient Discharge Summary Slip</p>
                <div className="mt-1 font-mono text-[10px] font-bold text-slate-700">
                  Admission #{printSlipPatient.admissionNumber}
                </div>
              </div>

              {/* Patient Block */}
              <div className="grid grid-cols-2 gap-2 text-[11px] pb-3 border-b border-slate-100">
                <div>
                  <span className="text-slate-400 block text-[10px]">PATIENT NAME</span>
                  <span className="font-bold text-slate-900">{printSlipPatient.patientName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">MR NUMBER</span>
                  <span className="font-mono font-bold text-slate-900">{printSlipPatient.patientMrNumber}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">DEPARTMENT</span>
                  <span className="text-slate-800">{printSlipPatient.departmentName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">ATTENDING DOCTOR</span>
                  <span className="text-slate-800">Dr. {printSlipPatient.doctorName || 'Assigned'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">PAYER TYPE</span>
                  <span className="font-semibold text-slate-800">{printSlipPatient.payerType}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">LAST BED / WARD</span>
                  <span className="text-slate-800">{printSlipPatient.bedLabel || 'Bed Released'}</span>
                </div>
              </div>

              {/* Admission & Discharge Timestamps */}
              <div className="grid grid-cols-2 gap-2 text-[11px] pb-3 border-b border-slate-100">
                <div>
                  <span className="text-slate-400 block text-[10px]">ADMITTED AT</span>
                  <span className="font-medium text-slate-800">
                    {formatDisplayDateTime(printSlipPatient.admittedAt || printSlipPatient.createdAtIso)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">DISCHARGED AT</span>
                  <span className="font-medium text-emerald-800">
                    {formatDisplayDateTime(printSlipPatient.dischargedAt)}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block text-[10px]">TOTAL STAY DURATION</span>
                  <span className="font-bold text-slate-900">
                    {computeStayDuration(printSlipPatient.admittedAt || printSlipPatient.createdAtIso, printSlipPatient.dischargedAt)}
                  </span>
                </div>
              </div>

              {printSlipPatient.diagnosis && (
                <div className="pb-3 border-b border-slate-100">
                  <span className="text-slate-400 block text-[10px]">DIAGNOSIS</span>
                  <p className="text-slate-800 italic mt-0.5">{printSlipPatient.diagnosis}</p>
                </div>
              )}

              {/* Clearance Status */}
              <div>
                <span className="text-slate-400 block text-[10px] mb-1">MANDATORY DISCHARGE CLEARANCES</span>
                <div className="grid grid-cols-3 gap-1.5 text-[10px] text-center font-bold">
                  <div className="p-1.5 bg-emerald-50 text-emerald-800 rounded border border-emerald-200">
                    Clinical: CLEARED
                  </div>
                  <div className="p-1.5 bg-emerald-50 text-emerald-800 rounded border border-emerald-200">
                    Billing: CLEARED
                  </div>
                  <div className="p-1.5 bg-emerald-50 text-emerald-800 rounded border border-emerald-200">
                    Pharmacy: CLEARED
                  </div>
                </div>
              </div>

              {/* Slip Sign-off */}
              <div className="pt-4 flex items-center justify-between text-[10px] text-slate-400">
                <span>Discharge Authorized</span>
                <span>Hospital Officer Signature</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPrintSlipPatient(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                <Printer className="h-3.5 w-3.5" /> Print Slip
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
