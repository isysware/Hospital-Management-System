import { AdmissionLedgerButton } from './AdmissionLedgerButton';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Pill,
  Eye,
  Search,
  RotateCcw,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Users,
  Clock,
  Layers,
} from 'lucide-react';
import { formatDateTimeDDMMYYYY } from '../../utils/formatters';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/StateViews';
import { pharmacyApiService } from '../../services/pharmacyApiService';
import { AdmissionDetailModal } from './AdmissionDetailModal';
import { HospitalKpiHeader, KpiItem } from '../../components/common/HospitalKpiHeader';

const STATUS_BADGE: Record<string, { badge: string; dot: string; label: string }> = {
  REQUESTED: {
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    dot: 'bg-blue-500',
    label: 'Requested',
  },
  AUTHORIZATION_REQUIRED: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
    label: 'Auth Required',
  },
  ACCEPTED: {
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    dot: 'bg-indigo-500',
    label: 'Accepted',
  },
  PARTIALLY_FULFILLED: {
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    dot: 'bg-sky-500',
    label: 'Partially Fulfilled',
  },
  FULFILLED: {
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-500',
    label: 'Fulfilled',
  },
  REJECTED: {
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    dot: 'bg-rose-500',
    label: 'Rejected',
  },
  INTEGRATION_ERROR: {
    badge: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-500',
    label: 'Integration Error',
  },
};

interface PharmacyRequestRow {
  id: string;
  medicineRequestNumber: string;
  admissionId: string;
  admissionNumber: string;
  patientName: string;
  bedLabel: string;
  medicines: string;
  status: string;
  requestedByLabel: string;
  requestedAt: string;
}

function toRow(raw: any): PharmacyRequestRow {
  const admission = raw.admissionRecord || {};
  const bed = admission.bed;
  return {
    id: raw.id,
    medicineRequestNumber: raw.medicineRequestNumber,
    admissionId: admission.id,
    admissionNumber: admission.admissionNumber || '—',
    patientName: admission.panelPatient?.fullName || admission.selfPayEncounter?.fullName || 'Unknown',
    bedLabel: bed ? `${bed.room?.name || ''} / ${bed.bedNumber}`.replace(/^\s*\/\s*/, '') : '—',
    medicines: (raw.lines || []).map((l: any) => `${l.medicine?.name || 'Medicine'} × ${Number(l.requestedQuantity)}`).join(', '),
    status: raw.status,
    requestedByLabel: raw.requestedBy?.username || '—',
    requestedAt: raw.requestedAt ? formatDateTimeDDMMYYYY(raw.requestedAt) : '—',
  };
}

const STATUS_OPTIONS = [
  { label: 'All Statuses', value: '' },
  { label: 'Requested', value: 'REQUESTED' },
  { label: 'Authorization Required', value: 'AUTHORIZATION_REQUIRED' },
  { label: 'Accepted', value: 'ACCEPTED' },
  { label: 'Partially Fulfilled', value: 'PARTIALLY_FULFILLED' },
  { label: 'Fulfilled', value: 'FULFILLED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Integration Error', value: 'INTEGRATION_ERROR' },
];

/**
 * Hospital-Managed medicine requests raised from active admissions — live
 * feed backed by `/pharmacy-bridge/requests` database endpoint.
 */
export const PharmacyRequestsView: React.FC = () => {
  const [rows, setRows] = useState<PharmacyRequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);
    try {
      const raw = await pharmacyApiService.getInpatientRequests(statusFilter || undefined);
      setRows(raw.map(toRow));
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load pharmacy requests.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.patientName.toLowerCase().includes(q) ||
        r.admissionNumber.toLowerCase().includes(q) ||
        r.medicineRequestNumber.toLowerCase().includes(q) ||
        r.medicines.toLowerCase().includes(q)
    );
  }, [rows, searchTerm]);

  const pendingAuthCount = useMemo(() => rows.filter((r) => r.status === 'AUTHORIZATION_REQUIRED').length, [rows]);
  const fulfilledCount = useMemo(() => rows.filter((r) => r.status === 'FULFILLED').length, [rows]);
  const activeAdmissionsCount = useMemo(() => {
    const set = new Set(rows.map((r) => r.admissionId).filter(Boolean));
    return set.size;
  }, [rows]);

  const kpiItems: KpiItem[] = [
    {
      title: 'Total Pharmacy Requests',
      value: rows.length,
      icon: Pill,
      subtitle: `${activeAdmissionsCount} Inpatients Requesting`,
      accentColor: '#08775A',
    },
    {
      title: 'Authorization Required',
      value: pendingAuthCount,
      icon: AlertTriangle,
      subtitle: 'High-Cost Medicine Gate',
      accentColor: '#f59e0b',
    },
    {
      title: 'Fulfilled Dispenses',
      value: fulfilledCount,
      icon: CheckCircle2,
      subtitle: 'Dispensed to Inpatient Care',
      accentColor: '#16a34a',
    },
    {
      title: 'Active Inpatient Cases',
      value: activeAdmissionsCount,
      icon: Users,
      subtitle: 'With Hospital Dispensing',
      accentColor: '#0284c7',
    },
  ];

  const hasActiveFilters = searchTerm.trim() !== '' || statusFilter !== '';

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Page Header Block (§4.1) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-[#effaf5] border border-[#c2e7db] text-[#08775A] flex items-center justify-center font-bold shadow-2xs">
            <Pill className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Pharmacy Requests</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#08775A] animate-pulse" />
                Live Inpatient Feed
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Live hospital-managed medicine request queue from inpatient admissions to central pharmacy.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl border border-slate-200 text-xs font-semibold shadow-2xs transition-colors"
            title="Refresh Requests"
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
              placeholder="Search patient, admission #, request #, medicine…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#08775A] bg-slate-50/50"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#08775A] bg-white text-slate-700 font-semibold"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setStatusFilter('');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50/60 rounded-lg hover:bg-rose-50 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset Filters
          </button>
        )}
      </div>

      {/* Data Table Container (§4.5) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] px-5 py-3.5 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <Pill className="h-4 w-4 text-emerald-300" />
            <h2 className="text-sm font-bold text-white tracking-wide">Inpatient Pharmacy Request Queue</h2>
            <span className="px-2 py-0.5 rounded-full bg-emerald-950/70 text-emerald-200 border border-emerald-700/50 text-xs font-mono font-bold">
              {filtered.length} Request{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
          <span className="text-[11px] text-emerald-200/80 font-medium hidden sm:inline">
            Directly synced with central Inpatient Pharmacy Dispensary
          </span>
        </div>

        {isLoading ? (
          <div className="p-12">
            <LoadingState message="Loading inpatient pharmacy requests…" />
          </div>
        ) : loadError ? (
          <div className="p-8">
            <ErrorState message={loadError} onRetry={() => load()} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10">
            <EmptyState
              title="No pharmacy requests found"
              description="Requests raised from Hospital-Managed admissions will appear in this queue."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#effaf5] border-b border-[#c2e7db] sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Request #</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Admission #</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Patient</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Bed</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A]">Medicines</th>
                  <th className="text-center px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Status</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Requested By</th>
                  <th className="text-left px-3.5 py-3 font-bold text-[#08775A] whitespace-nowrap">Requested At</th>
                  <th className="text-right px-4 py-3 font-bold text-[#08775A] whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r, idx) => {
                  const conf = STATUS_BADGE[r.status] || {
                    badge: 'bg-slate-100 text-slate-700 border-slate-200',
                    dot: 'bg-slate-400',
                    label: r.status.replace(/_/g, ' '),
                  };

                  return (
                    <tr
                      key={r.id}
                      className={`transition-colors hover:bg-[#e7f6f1]/40 ${
                        idx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'
                      }`}
                    >
                      <td className="px-3.5 py-3 whitespace-nowrap font-mono font-bold text-slate-900">
                        {r.medicineRequestNumber.replace(/^REQ-\d{2}-/, 'REQ-')}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap font-mono text-slate-600 font-semibold">
                        {r.admissionNumber}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap font-bold text-slate-900">{r.patientName}</td>
                      <td className="px-3.5 py-3 whitespace-nowrap font-medium text-slate-700">{r.bedLabel}</td>
                      <td className="px-3.5 py-3 text-slate-700 max-w-xs truncate" title={r.medicines}>
                        {r.medicines}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap text-center">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${conf.badge}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${conf.dot}`} />
                          {conf.label}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap text-slate-600 font-medium">{r.requestedByLabel}</td>
                      <td className="px-3.5 py-3 whitespace-nowrap font-mono text-slate-400 text-[11px]">
                        {r.requestedAt}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            title="Open Admission Detail"
                            onClick={() => setDetailId(r.admissionId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
                          >
                            <Eye className="h-3 w-3" /> View
                          </button>
                          <AdmissionLedgerButton admissionId={r.admissionId} />
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
          initialTab="pharmacy"
          onClose={() => setDetailId(null)}
          onChanged={() => load()}
        />
      )}
    </div>
  );
};
