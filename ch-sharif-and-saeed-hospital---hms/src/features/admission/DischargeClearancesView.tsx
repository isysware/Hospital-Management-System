import { AdmissionLedgerButton } from './AdmissionLedgerButton';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Search,
  RotateCcw,
  Eye,
  RefreshCw,
  CheckCircle2,
  Clock,
  Building2,
  Users,
  AlertCircle,
  Stethoscope,
  Receipt,
  Pill,
} from 'lucide-react';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/StateViews';
import { PanelBadge } from '../../components/common/PanelBadge';
import { fetchAdmissions, AdmissionRecord, ClearanceType } from '../../services/admissionService';
import { AdmissionDetailModal } from './AdmissionDetailModal';
import { HospitalKpiHeader, KpiItem } from '../../components/common/HospitalKpiHeader';

const GATES: { type: ClearanceType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: 'CLINICAL', label: 'Clinical', icon: Stethoscope },
  { type: 'HOSPITAL_BILLING', label: 'Hospital Billing', icon: Receipt },
  { type: 'PHARMACY', label: 'Pharmacy', icon: Pill },
];

const STATUS_STYLE: Record<string, { badge: string; dot: string; label: string }> = {
  CLEARED: {
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-500',
    label: 'Cleared',
  },
  NOT_APPLICABLE: {
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
    label: 'N/A',
  },
  PENDING: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
    label: 'Pending',
  },
};

function gateStatus(admission: AdmissionRecord, type: ClearanceType): string {
  return admission.clearances?.find((c) => c.clearanceType === type)?.status || 'PENDING';
}

function isAdmissionFullyCleared(admission: AdmissionRecord): boolean {
  return GATES.every((g) => ['CLEARED', 'NOT_APPLICABLE'].includes(gateStatus(admission, g.type)));
}

/**
 * Discharge Clearances — 3-gate status board (Clinical, Hospital Billing, Pharmacy)
 * formatted to Hospital Design System (design.md) standards.
 */
export const DischargeClearancesView: React.FC = () => {
  const [admissions, setAdmissions] = useState<AdmissionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [gateFilter, setGateFilter] = useState<'ALL' | 'READY' | 'PENDING'>('ALL');
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetchAdmissions({ status: 'ACTIVE' });
      setAdmissions(data);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load active admissions for clearance tracking.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const readyCount = useMemo(
    () => admissions.filter(isAdmissionFullyCleared).length,
    [admissions]
  );
  const pendingCount = admissions.length - readyCount;

  const departmentCount = useMemo(() => {
    const set = new Set(admissions.map((a) => a.departmentName).filter(Boolean));
    return set.size;
  }, [admissions]);

  const kpiItems: KpiItem[] = [
    {
      title: 'Active Inpatients',
      value: admissions.length,
      icon: Users,
      subtitle: 'Currently Under Inpatient Care',
      accentColor: '#08775A',
    },
    {
      title: 'All Gates Cleared',
      value: readyCount,
      icon: CheckCircle2,
      subtitle: 'Ready for Final Gate Pass',
      accentColor: '#16a34a',
    },
    {
      title: 'Pending Clearances',
      value: pendingCount,
      icon: Clock,
      subtitle: 'Awaiting Clinical / Billing / Rx',
      accentColor: '#f59e0b',
    },
    {
      title: 'Inpatient Departments',
      value: departmentCount,
      icon: Building2,
      subtitle: 'Active Clinical Units',
      accentColor: '#0284c7',
    },
  ];

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return admissions.filter((a) => {
      if (gateFilter === 'READY' && !isAdmissionFullyCleared(a)) return false;
      if (gateFilter === 'PENDING' && isAdmissionFullyCleared(a)) return false;

      if (!q) return true;
      return (
        a.patientName.toLowerCase().includes(q) ||
        a.admissionNumber.toLowerCase().includes(q) ||
        a.patientMrNumber.toLowerCase().includes(q) ||
        a.departmentName.toLowerCase().includes(q) ||
        (a.bedLabel || '').toLowerCase().includes(q)
      );
    });
  }, [admissions, searchTerm, gateFilter]);

  const hasActiveFilters = searchTerm.trim() !== '' || gateFilter !== 'ALL';

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Page Header Block (§4.1) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-[#effaf5] border border-[#c2e7db] text-[#08775A] flex items-center justify-center font-bold shadow-2xs">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Discharge Clearances</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#08775A] animate-pulse" />
                3-Gate Matrix
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Live Clinical, Hospital Billing, and Pharmacy clearance gates required prior to final patient discharge.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl border border-slate-200 text-xs font-semibold shadow-2xs transition-colors"
            title="Refresh Clearances"
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
        <div className="flex items-center gap-2.5 flex-wrap flex-1 min-w-0">
          <div className="relative w-64 sm:w-80">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search patient, MRN, admission #, department…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#08775A] bg-slate-50/50"
            />
          </div>

          <div className="inline-flex items-center p-1 bg-slate-100/80 rounded-xl gap-1">
            <button
              type="button"
              onClick={() => setGateFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                gateFilter === 'ALL' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Inpatients ({admissions.length})
            </button>
            <button
              type="button"
              onClick={() => setGateFilter('READY')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                gateFilter === 'READY' ? 'bg-[#08775A] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${gateFilter === 'READY' ? 'bg-white' : 'bg-emerald-500'}`} />
              Ready ({readyCount})
            </button>
            <button
              type="button"
              onClick={() => setGateFilter('PENDING')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                gateFilter === 'PENDING' ? 'bg-amber-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${gateFilter === 'PENDING' ? 'bg-white' : 'bg-amber-500'}`} />
              Pending Gates ({pendingCount})
            </button>
          </div>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setGateFilter('ALL');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50/60 rounded-lg hover:bg-rose-50 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset Filters
          </button>
        )}
      </div>

      {/* Clearance Data Table Container (§4.5) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] px-5 py-3.5 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            <h2 className="text-sm font-bold text-white tracking-wide">3-Gate Discharge Clearance Matrix</h2>
            <span className="px-2 py-0.5 rounded-full bg-emerald-950/70 text-emerald-200 border border-emerald-700/50 text-xs font-mono font-bold">
              {filtered.length} Inpatient{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
          <span className="text-[11px] text-emerald-200/80 font-medium hidden sm:inline">
            Clinical Doctor Auth • Front Desk Billing Audit • Inpatient Pharmacy Hold
          </span>
        </div>

        {isLoading ? (
          <div className="p-12">
            <LoadingState message="Loading discharge clearance records…" />
          </div>
        ) : loadError ? (
          <div className="p-8">
            <ErrorState message={loadError} onRetry={load} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10">
            <EmptyState
              title="No active admissions found"
              description="Discharge gate status will appear here once patients are checked into an active inpatient bed."
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
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Bed</th>
                  {GATES.map((g) => {
                    const GateIcon = g.icon;
                    return (
                      <th key={g.type} className="text-center px-3 py-3 font-bold text-[#08775A] whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <GateIcon className="h-3.5 w-3.5 text-[#08775A]/80" />
                          <span>{g.label} Gate</span>
                        </div>
                      </th>
                    );
                  })}
                  <th className="text-center px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Status</th>
                  <th className="text-right px-4 py-3 font-bold text-[#08775A] whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((a, idx) => {
                  const fullyCleared = isAdmissionFullyCleared(a);

                  return (
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
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[10px] text-slate-500">{a.patientMrNumber}</span>
                          {a.payerType === 'Corporate / Panel' ? (
                            <PanelBadge className="scale-75 origin-left" />
                          ) : (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 text-slate-600">
                              Self-Pay
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap font-medium text-slate-700">{a.departmentName}</td>
                      <td className="px-3.5 py-3 whitespace-nowrap font-medium text-slate-700">
                        {a.bedLabel ? (
                          <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 font-medium">
                            {a.bedLabel}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      {GATES.map((g) => {
                        const status = gateStatus(a, g.type);
                        const conf = STATUS_STYLE[status] || STATUS_STYLE.PENDING;

                        return (
                          <td key={g.type} className="px-3 py-3 whitespace-nowrap text-center">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${conf.badge}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${conf.dot}`} />
                              {conf.label}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-3.5 py-3 whitespace-nowrap text-center">
                        {fullyCleared ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" /> All Cleared
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            <Clock className="h-3 w-3 text-amber-600" /> Pending Gate(s)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            title="Open Clearance Modal & Grant Gates"
                            onClick={() => setDetailId(a.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
                          >
                            <Eye className="h-3 w-3" /> Gate Detail
                          </button>
                          <AdmissionLedgerButton admissionId={a.id} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
