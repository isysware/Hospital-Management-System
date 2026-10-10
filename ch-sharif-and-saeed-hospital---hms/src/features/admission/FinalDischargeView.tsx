import { AdmissionLedgerButton } from './AdmissionLedgerButton';
import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  RotateCcw,
  Bed,
  Clock,
  LogOut,
  Eye,
  ShieldCheck,
  Building2,
} from 'lucide-react';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/StateViews';
import { useToast } from '../../context/ToastContext';
import { fetchAdmissions, dischargeAdmission, AdmissionRecord } from '../../services/admissionService';
import { AdmissionDetailModal } from './AdmissionDetailModal';
import { HospitalKpiHeader, KpiItem } from '../../components/common/HospitalKpiHeader';

function isDischargeReady(a: AdmissionRecord): boolean {
  const gates = a.clearances || [];
  if (gates.length === 0) return false;
  return gates.every((g) => g.status === 'CLEARED' || g.status === 'NOT_APPLICABLE');
}

/**
 * Final Discharge — admissions where all 3 clearance gates are cleared.
 * Concludes inpatient stay and frees bed in real-time.
 */
export const FinalDischargeView: React.FC = () => {
  const toast = useToast();
  const [admissions, setAdmissions] = useState<AdmissionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dischargingId, setDischargingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const load = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);
    try {
      const [activeRows, pendingRows] = await Promise.all([
        fetchAdmissions({ status: 'ACTIVE' }),
        fetchAdmissions({ status: 'DISCHARGE_PENDING' }),
      ]);
      setAdmissions([...activeRows, ...pendingRows]);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load admissions.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const ready = useMemo(() => admissions.filter(isDischargeReady), [admissions]);
  const pendingCount = admissions.length - ready.length;

  const kpiItems: KpiItem[] = [
    {
      title: 'Ready for Final Discharge',
      value: ready.length,
      icon: CheckCircle2,
      subtitle: 'All 3 Clearance Gates Cleared',
      accentColor: '#16a34a',
    },
    {
      title: 'Clearances Incomplete',
      value: pendingCount,
      icon: Clock,
      subtitle: 'Awaiting Gate Clearance',
      accentColor: '#f59e0b',
    },
    {
      title: 'Total Active / Pending Admissions',
      value: admissions.length,
      icon: Bed,
      subtitle: 'Tracked Inpatients',
      accentColor: '#08775A',
    },
    {
      title: 'Discharge Readiness Rate',
      value: admissions.length > 0 ? `${Math.round((ready.length / admissions.length) * 100)}%` : '0%',
      icon: ShieldCheck,
      subtitle: 'Census Turnover Index',
      accentColor: '#0284c7',
    },
  ];

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return ready;
    return ready.filter(
      (a) =>
        a.patientName.toLowerCase().includes(q) ||
        a.admissionNumber.toLowerCase().includes(q) ||
        a.patientMrNumber.toLowerCase().includes(q) ||
        a.departmentName.toLowerCase().includes(q) ||
        a.doctorName.toLowerCase().includes(q) ||
        (a.bedLabel || '').toLowerCase().includes(q)
    );
  }, [ready, searchTerm]);

  const handleDischarge = async (a: AdmissionRecord) => {
    setDischargingId(a.id);
    try {
      await dischargeAdmission(a.id);
      toast.success(`${a.patientName} discharged successfully. Bed freed.`);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to discharge patient.');
    } finally {
      setDischargingId(null);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Page Header Block (§4.1) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-[#effaf5] border border-[#c2e7db] text-[#08775A] flex items-center justify-center font-bold shadow-2xs">
            <LogOut className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Final Discharge</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#08775A] animate-pulse" />
                Gate Cleared
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Patients with all 3 clearance gates (Clinical, Hospital Billing, Pharmacy) approved — ready for checkout and bed release.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl border border-slate-200 text-xs font-semibold shadow-2xs transition-colors"
            title="Refresh Ready Admissions"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-[#08775A]' : 'text-slate-500'}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Hospital KPI Telemetry (§4.2) */}
      <HospitalKpiHeader items={kpiItems} />

      {/* Filter Toolbar (§4.4) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex items-center justify-between flex-wrap gap-3">
        <div className="relative w-64 sm:w-80">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search patient, MRN, admission #, doctor…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#08775A] bg-slate-50/50"
          />
        </div>

        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50/60 rounded-lg hover:bg-rose-50 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Clear Search
          </button>
        )}
      </div>

      {/* Data Table Container (§4.5) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] px-5 py-3.5 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
            <h2 className="text-sm font-bold text-white tracking-wide">Discharge-Ready Inpatients Queue</h2>
            <span className="px-2 py-0.5 rounded-full bg-emerald-950/70 text-emerald-200 border border-emerald-700/50 text-xs font-mono font-bold">
              {filtered.length} Inpatient{filtered.length === 1 ? '' : 's'} Ready
            </span>
          </div>
          <span className="text-[11px] text-emerald-200/80 font-medium hidden sm:inline">
            Actioning discharge concludes stay and immediately marks bed as Available / Cleaning
          </span>
        </div>

        {isLoading ? (
          <div className="p-12">
            <LoadingState message="Loading discharge-ready inpatients…" />
          </div>
        ) : loadError ? (
          <div className="p-8">
            <ErrorState message={loadError} onRetry={() => load()} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10">
            <EmptyState
              title="No admissions ready for final discharge"
              description="Patients will appear here once all 3 gates (Clinical, Hospital Billing, Pharmacy) are granted in Discharge Clearances."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#effaf5] border-b border-[#c2e7db] sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Admission #</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Patient</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Department</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Attending Doctor</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Bed</th>
                  <th className="text-center px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Gate Status</th>
                  <th className="text-right px-4 py-3 font-bold text-[#08775A] whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((a, idx) => (
                  <tr
                    key={a.id}
                    className={`transition-colors hover:bg-[#e7f6f1]/40 ${
                      idx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'
                    }`}
                  >
                    <td className="px-3.5 py-3 whitespace-nowrap font-mono font-bold text-slate-800">
                      {a.admissionNumber}
                    </td>
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <div className="font-bold text-slate-900">{a.patientName}</div>
                      <div className="font-mono text-[10px] text-slate-500 mt-0.5">{a.patientMrNumber}</div>
                    </td>
                    <td className="px-3.5 py-3 whitespace-nowrap font-medium text-slate-700">{a.departmentName}</td>
                    <td className="px-3.5 py-3 whitespace-nowrap font-medium text-slate-700">
                      {a.doctorName || 'Not Assigned'}
                    </td>
                    <td className="px-3.5 py-3 whitespace-nowrap font-medium text-slate-700">
                      {a.bedLabel ? (
                        <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 font-medium">
                          {a.bedLabel}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3.5 py-3 whitespace-nowrap text-center">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        3 of 3 Cleared
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDetailId(a.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold shadow-2xs transition-colors"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                        <AdmissionLedgerButton admissionId={a.id} />
                        <button
                          type="button"
                          disabled={dischargingId === a.id}
                          onClick={() => handleDischarge(a)}
                          className="px-3.5 py-1 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-60 inline-flex items-center gap-1.5 transition-colors"
                        >
                          {dischargingId === a.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <LogOut className="h-3.5 w-3.5" />
                          )}
                          Discharge Patient
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailId && (
        <AdmissionDetailModal
          admissionId={detailId}
          initialTab="clearances"
          onClose={() => setDetailId(null)}
          onChanged={() => load()}
        />
      )}
    </div>
  );
};
