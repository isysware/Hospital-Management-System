import { AdmissionLedgerButton } from './AdmissionLedgerButton';
import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Search, RotateCcw, LogIn, Eye, RefreshCw, Calendar, CheckCircle2 } from 'lucide-react';
import { Select, TextInput } from '../../components/forms/FormControls';
import { PanelBadge } from '../../components/common/PanelBadge';
import { DepartmentService, fetchDepartments } from '../../services/departmentService';
import { Department } from '../../types/department';
import { fetchAdmissions, AdmissionRecord } from '../../services/admissionService';
import { CheckInAdmissionModal } from './CheckInAdmissionModal';
import { AdmissionDetailModal } from './AdmissionDetailModal';

interface PlannedAdmissionsViewProps {
  title: string;
  subtitle: string;
  /** Check-In page shows the Check-In action; Planned Admissions page is read/handoff-review only. */
  showCheckIn?: boolean;
}

/**
 * Planned/Confirmed admissions handed off from Front Desk (§2.9) —
 * strictly adheres to canonical design.md specs (dark emerald table header,
 * clean filter toolbar, and standard page header block).
 */
export const PlannedAdmissionsView: React.FC<PlannedAdmissionsViewProps> = ({
  title,
  subtitle,
  showCheckIn = false,
}) => {
  const [allDepartments, setAllDepartments] = useState<Department[]>(() => DepartmentService.getDepartments());
  useEffect(() => {
    fetchDepartments().then(setAllDepartments).catch(() => {});
  }, []);
  const departments = useMemo(() => allDepartments.filter((d) => d.status === 'Active'), [allDepartments]);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [admissions, setAdmissions] = useState<AdmissionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkInTarget, setCheckInTarget] = useState<AdmissionRecord | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [planned, confirmed] = await Promise.all([
        fetchAdmissions({ status: 'PLANNED' }),
        fetchAdmissions({ status: 'CONFIRMED' }),
      ]);
      setAdmissions([...planned, ...confirmed]);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load planned admissions.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return admissions.filter((a) => {
      if (departmentFilter && a.departmentId !== departmentFilter) return false;
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
  }, [admissions, departmentFilter, searchTerm]);

  return (
    <div className="space-y-4 pb-8 text-slate-800">
      {/* =========================================================================
          1. CARD PAGE HEADER BLOCK (design.md §4.1)
      ========================================================================= */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-4 sm:p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center shadow-2xs shrink-0">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#111827]">{title}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db] inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#129b70] animate-pulse" />
                {showCheckIn ? 'Check-In Desk' : 'Arrival Queue'}
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
            title="Refresh arrival list"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[#08775A] ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Syncing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          2. FILTER TOOLBAR (design.md §4.4)
      ========================================================================= */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#8b9e95]" />
            <input
              type="text"
              placeholder="Search by patient name, MR #, admission #…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-xs pl-9 pr-3 py-2 border border-[#c2e7db] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775A] bg-white placeholder:text-[#8b9e95]"
            />
          </div>

          {/* Department Select Dropdown */}
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

          {/* Reset Filters */}
          {(searchTerm || departmentFilter) && (
            <button
              type="button"
              onClick={() => {
                setDepartmentFilter('');
                setSearchTerm('');
              }}
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
            <Clock className="h-4 w-4 text-emerald-300" />
            <span className="font-semibold text-xs sm:text-sm tracking-wide">
              {showCheckIn ? 'Admission Check-In Queue' : 'Planned Inpatient Register'}
            </span>
            <span className="bg-emerald-700/60 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-500/30 text-[10px] font-semibold">
              {filtered.length} {filtered.length === 1 ? 'Record' : 'Records'}
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
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Patient Details</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Department</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Attending Doctor</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Expected Date</th>
                <th className="py-2.5 px-4 border-r border-[#c2e7db]/60 text-center">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#52665e]">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-[#08775A]" />
                      <span>Loading planned admissions…</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#52665e]">
                    <Clock className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    <span className="font-semibold text-xs text-slate-700 block">
                      No planned admissions found.
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Admissions scheduled from Front Desk will appear here in real time.
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
                      <td className="py-2.5 px-4 border-r border-[#e2eae5] whitespace-nowrap">
                        <div className="font-bold text-[#123e2b]">{a.patientName}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {a.patientMrNumber && (
                            <span className="font-mono text-[10px] text-slate-500 font-semibold">
                              MR: {a.patientMrNumber}
                            </span>
                          )}
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
                      <td className="py-2.5 px-4 border-r border-[#e2eae5] whitespace-nowrap text-slate-600 font-mono text-[11px]">
                        {a.expectedAt || '—'}
                      </td>
                      <td className="py-2.5 px-4 border-r border-[#e2eae5] whitespace-nowrap text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                          {a.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {showCheckIn && (
                            <button
                              type="button"
                              onClick={() => setCheckInTarget(a)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#08775A] hover:bg-[#065f46] text-white rounded text-[11px] font-bold shadow-xs transition-colors cursor-pointer"
                              title="Assign bed and check in"
                            >
                              <LogIn className="h-3 w-3" />
                              <span>Check In</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDetailId(a.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-[#e2eae5] rounded text-[11px] font-semibold transition-colors cursor-pointer"
                            title="View details"
                          >
                            <Eye className="h-3 w-3 text-[#08775A]" />
                            <span>Details</span>
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

      {checkInTarget && (
        <CheckInAdmissionModal
          admission={checkInTarget}
          onClose={() => setCheckInTarget(null)}
          onCheckedIn={() => {
            setCheckInTarget(null);
            load();
          }}
        />
      )}
      {detailId && (
        <AdmissionDetailModal admissionId={detailId} onClose={() => setDetailId(null)} onChanged={load} />
      )}
    </div>
  );
};
