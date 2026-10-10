import { AdmissionLedgerButton } from './AdmissionLedgerButton';
import React, { useEffect, useMemo, useState } from 'react';
import { Users, Search, RotateCcw, Eye, RefreshCw, Activity } from 'lucide-react';
import { PanelBadge } from '../../components/common/PanelBadge';
import { DepartmentService, fetchDepartments } from '../../services/departmentService';
import { StaffUserService, fetchStaffUsers } from '../../services/staffUserService';
import { Department } from '../../types/department';
import { StaffUser } from '../../types/staffUser';
import { fetchAdmissions, AdmissionRecord, AdmissionStatus } from '../../services/admissionService';
import { formatPKR } from '../../utils/formatters';
import { AdmissionDetailModal } from './AdmissionDetailModal';

interface ActiveAdmissionsViewProps {
  title: string;
  subtitle: string;
  initialTab?: 'overview' | 'services' | 'medication' | 'pharmacy' | 'bed' | 'clearances';
  /** Pass 'ALL' for every admission status (Super Admin/Admin oversight); defaults to 'ACTIVE' for the Admission Portal's own inpatient-stay screens. */
  statusFilter?: AdmissionStatus | 'ALL';
  /** Shows an Estimated Amount column — on for Super Admin/Admin oversight pages where the billed amount is the point. */
  showAmountColumn?: boolean;
  /** Optional content rendered between the page header and the filter bar */
  children?: React.ReactNode;
}

/**
 * Shared "every admission" list, reused for `active_admissions`,
 * `hospital_services_procedures`, and Super Admin/Admin's `admission_overview`.
 * Conforms 100% to design.md standards with real DB data, dark emerald strip,
 * and clean telemetry.
 */
export const ActiveAdmissionsView: React.FC<ActiveAdmissionsViewProps> = ({
  title,
  subtitle,
  initialTab = 'overview',
  statusFilter = 'ACTIVE',
  showAmountColumn = false,
  children,
}) => {
  const [allDepartments, setAllDepartments] = useState<Department[]>(() => DepartmentService.getDepartments());
  const [allStaff, setAllStaff] = useState<StaffUser[]>(() => StaffUserService.getStaffUsers());
  useEffect(() => {
    fetchDepartments().then(setAllDepartments).catch(() => {});
    fetchStaffUsers().then(setAllStaff).catch(() => {});
  }, []);
  const departments = useMemo(() => allDepartments.filter((d) => d.status === 'Active'), [allDepartments]);
  const doctors = useMemo(() => allStaff.filter((s) => s.staffCategory === 'Doctor' && s.status === 'ACTIVE'), [allStaff]);

  const [departmentFilter, setDepartmentFilter] = useState('');
  const [doctorFilter, setDoctorFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [admissions, setAdmissions] = useState<AdmissionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = statusFilter !== 'ALL' ? { status: statusFilter as AdmissionStatus } : undefined;
      setAdmissions(await fetchAdmissions(params));
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load admissions.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return admissions.filter((a) => {
      if (departmentFilter && a.departmentId !== departmentFilter) return false;
      if (doctorFilter && a.doctorId !== doctorFilter) return false;
      if (
        q &&
        !(
          a.patientName.toLowerCase().includes(q) ||
          a.admissionNumber.toLowerCase().includes(q) ||
          (a.patientMrNumber && a.patientMrNumber.toLowerCase().includes(q))
        )
      ) {
        return false;
      }
      return true;
    });
  }, [admissions, departmentFilter, doctorFilter, searchTerm]);

  const resetFilters = () => {
    setDepartmentFilter('');
    setDoctorFilter('');
    setSearchTerm('');
  };

  const totalEstimatedAmount = useMemo(
    () => filtered.reduce((sum, a) => sum + (a.estimatedAmount || 0), 0),
    [filtered],
  );

  return (
    <div className="space-y-4 pb-8 text-slate-800">
      {/* =========================================================================
          1. CARD PAGE HEADER BLOCK (design.md §4.1)
      ========================================================================= */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-4 sm:p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center shadow-2xs shrink-0">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#111827]">{title}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db] inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#129b70] animate-pulse" />
                Live Inpatient Registry
              </span>
            </div>
            <p className="text-xs text-[#52665e] mt-0.5">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={load}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh inpatient list"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[#08775A] ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Syncing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {children}

      {/* Optional Telemetry strip for Estimated amounts */}
      {showAmountColumn && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 border-t-[3.5px] border-t-[#08775A] shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Inpatients in View
            </span>
            <div className="text-xl font-extrabold text-slate-900 mt-1 font-mono tabular-nums">
              {filtered.length}
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">Matching current criteria</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 border-t-[3.5px] border-t-emerald-600 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Estimated Billing
            </span>
            <div className="text-xl font-extrabold text-[#08775A] mt-1 font-mono tabular-nums">
              {formatPKR(totalEstimatedAmount)}
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">Estimated admission total</span>
          </div>
        </div>
      )}

      {/* =========================================================================
          2. FILTER TOOLBAR (design.md §4.4)
      ========================================================================= */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#8b9e95]" />
            <input
              type="text"
              placeholder="Search by patient name, MR #, admission #…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-xs pl-9 pr-3 py-2 border border-[#c2e7db] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775A] bg-white placeholder:text-[#8b9e95]"
            />
          </div>

          {/* Department Dropdown */}
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="text-xs px-3 py-2 border border-[#c2e7db] rounded-lg bg-white focus:outline-hidden focus:ring-1 focus:ring-[#08775A] text-[#111827] font-medium cursor-pointer"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          {/* Doctor Dropdown */}
          <select
            value={doctorFilter}
            onChange={(e) => setDoctorFilter(e.target.value)}
            className="text-xs px-3 py-2 border border-[#c2e7db] rounded-lg bg-white focus:outline-hidden focus:ring-1 focus:ring-[#08775A] text-[#111827] font-medium cursor-pointer"
          >
            <option value="">All Doctors</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </select>

          {/* Reset Filters */}
          {(searchTerm || departmentFilter || doctorFilter) && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* =========================================================================
          3. DATA TABLE (design.md §4.5)
      ========================================================================= */}
      <div className="bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-300" />
            <span className="font-semibold text-xs sm:text-sm tracking-wide">
              Admitted Inpatients Registry
            </span>
            <span className="bg-emerald-700/60 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-500/30 text-[10px] font-semibold">
              {filtered.length} {filtered.length === 1 ? 'Patient' : 'Patients'}
            </span>
          </div>
        </div>

        {loadError && (
          <div className="p-3 bg-rose-50 border-b border-rose-200 text-xs text-rose-700 flex items-center justify-between">
            <span>{loadError}</span>
            <button type="button" onClick={load} className="underline font-bold cursor-pointer">
              Retry
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[11px] font-bold text-[#08775A] select-none sticky top-0 z-10 whitespace-nowrap">
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/60 w-12">#</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Admission #</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">MR #</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Patient Name</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Department</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Attending Doctor</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Bed Assigned</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Medication Mode</th>
                {showAmountColumn && (
                  <>
                    <th className="py-2.5 px-4 border-r border-[#c2e7db]/60 text-center">Status</th>
                    <th className="py-2.5 px-4 border-r border-[#c2e7db]/60 text-right">Estimated Amount</th>
                  </>
                )}
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={showAmountColumn ? 11 : 9} className="py-12 text-center text-[#52665e]">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-[#08775A]" />
                      <span>Loading inpatients…</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={showAmountColumn ? 11 : 9} className="py-12 text-center text-[#52665e]">
                    <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    <span className="font-semibold text-xs text-slate-700 block">
                      No matching inpatients found.
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Try resetting your filter parameters.
                    </span>
                  </td>
                </tr>
              ) : (
                filtered.map((a, idx) => {
                  const isEven = idx % 2 === 0;
                  return (
                    <tr
                      key={a.id}
                      className={`transition-colors border-b border-[#e2eae5] ${
                        isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                      } hover:bg-[#e7f6f1]/40`}
                    >
                      <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] bg-[#effaf5]/20">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5] font-mono font-bold text-slate-800 whitespace-nowrap">
                        {a.admissionNumber}
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5] font-mono text-xs font-semibold text-[#08775A] whitespace-nowrap">
                        {a.patientMrNumber || '—'}
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5] whitespace-nowrap">
                        <div className="font-bold text-[#123e2b]">{a.patientName}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {a.payerType === 'Corporate / Panel' ? (
                            <PanelBadge />
                          ) : (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 text-slate-600">
                              Self-Pay
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5] whitespace-nowrap text-slate-700 font-medium">
                        {a.departmentName}
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5] whitespace-nowrap text-slate-700">
                        {a.doctorName || <span className="text-slate-400 italic">Unassigned</span>}
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5] whitespace-nowrap">
                        {a.bedLabel ? (
                          <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                            {a.bedLabel}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5] whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            a.medicationMode === 'HOSPITAL_MANAGED'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {a.medicationMode === 'HOSPITAL_MANAGED' ? 'Hospital Managed' : 'Self Med'}
                        </span>
                      </td>
                      {showAmountColumn && (
                        <>
                          <td className="py-2.5 px-4 border-r border-[#e2eae5] whitespace-nowrap text-center">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                              {a.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 border-r border-[#e2eae5] whitespace-nowrap text-right font-mono font-bold text-[#08775A]">
                            {a.estimatedAmount ? formatPKR(a.estimatedAmount) : '—'}
                          </td>
                        </>
                      )}
                      <td className="py-2.5 px-4 whitespace-nowrap text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailId(a.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-[#f6faf8] text-[#123e2b] border border-[#e2eae5] rounded text-[11px] font-bold shadow-2xs transition-colors cursor-pointer"
                            title="Manage Inpatient Stay"
                          >
                            <Eye className="h-3 w-3 text-[#08775A]" />
                            <span>Manage Stay</span>
                          </button>
                          <AdmissionLedgerButton admissionId={a.id} />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailId && (
        <AdmissionDetailModal
          admissionId={detailId}
          initialTab={initialTab}
          onClose={() => setDetailId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
};
