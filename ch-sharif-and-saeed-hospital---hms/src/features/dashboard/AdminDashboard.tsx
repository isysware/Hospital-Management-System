import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Users,
  UserCheck,
  Bed,
  CreditCard,
  AlertCircle,
  Clock,
  TrendingUp,
  Stethoscope,
  ShieldCheck,
  FileSpreadsheet,
  RefreshCw,
  CheckCircle2,
  ChevronRight,
  Activity,
} from 'lucide-react';
import { useRouter } from '../../context/RouterContext';
import { dashboardService, ResolvedDashboardState } from '../../services/dashboardService';
import { formatPKR } from '../../utils/formatters';
import { HospitalKpiHeader, KpiItem } from '../../components/common/HospitalKpiHeader';

type DateFilterPreset = 'today' | 'yesterday' | 'this_week' | 'this_month';

/**
 * Admin Dashboard — mirrors SuperAdmin's executive aesthetics and command center layout
 * per canonical design.md specifications (emerald palette, Inter typography, HospitalKpiHeader,
 * dark emerald table header strip, and clean filter bar).
 */
export const AdminDashboard: React.FC = () => {
  const { navigate } = useRouter();

  const [selectedPreset, setSelectedPreset] = useState<DateFilterPreset>('today');
  const [data, setData] = useState<ResolvedDashboardState | null>(() => dashboardService.getCachedDashboard());
  const [isLoading, setIsLoading] = useState<boolean>(!dashboardService.getCachedDashboard());
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (preset: DateFilterPreset = 'today') => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await dashboardService.fetchSuperAdminDashboard(preset);
      setData(result);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load live dashboard data from server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard(selectedPreset);
  }, [loadDashboard, selectedPreset]);

  const infrastructure = data?.infrastructure;
  const bedMetrics = data?.bedMetrics;
  const billingSummary = data?.billingSummary;
  const inventorySummary = data?.inventorySummary;
  const patientFlow = data?.patientFlow || [];
  const doctorsOnDuty = data?.doctorsOnDuty || [];
  const flaggedStockItems = data?.flaggedStockItems || [];

  const opdTotal = patientFlow.find((f) => f.category === 'OPD')?.total ?? 0;
  const admissionTotal = patientFlow.find((f) => f.category === 'Admission')?.total ?? 0;
  const emergencyTotal = patientFlow.find((f) => f.category === 'Emergency')?.total ?? 0;
  const totalPatients = patientFlow.reduce((sum, f) => sum + (f.total || 0), 0);
  const collectionsPercent =
    billingSummary && billingSummary.netBilling > 0
      ? Math.round((billingSummary.paidAmount / billingSummary.netBilling) * 100)
      : 0;
  const doctorsOnDutyCount = doctorsOnDuty.filter((d) => d.status === 'On Duty').length;

  const displayPeriodLabel = useMemo(() => {
    if (selectedPreset === 'today') return 'Today (Current Day)';
    if (selectedPreset === 'yesterday') return 'Yesterday';
    if (selectedPreset === 'this_week') return 'This Week (Last 7 Days)';
    if (selectedPreset === 'this_month') return 'This Month (MTD)';
    return data?.periodLabel || 'Today';
  }, [selectedPreset, data?.periodLabel]);

  // Executive KPI telemetry adhering to design.md §4.2 HospitalKpiHeader
  const kpiItems: KpiItem[] = useMemo(() => {
    const totalAlerts =
      (inventorySummary?.lowStockItemsCount ?? 0) +
      (inventorySummary?.outOfStockItemsCount ?? 0) +
      (inventorySummary?.nearExpiryItemsCount ?? 0) +
      (inventorySummary?.expiredItemsCount ?? 0);

    return [
      {
        category: 'DOCTORS ON DUTY',
        title: 'Active Clinicians',
        value: `${infrastructure?.doctorsCount ?? 0}`,
        icon: UserCheck,
        subtitle: `${doctorsOnDutyCount} on duty today`,
        tone: 'default',
      },
      {
        category: 'HOSPITAL PATIENTS',
        title: 'Census Volume',
        value: totalPatients,
        icon: Users,
        subtitle: `${opdTotal} OPD • ${admissionTotal} IPD • ${emergencyTotal} ER`,
        tone: 'info',
      },
      {
        category: 'BED OCCUPANCY',
        title: 'Inpatient Beds',
        value: `${bedMetrics?.occupancyPercent ?? 0}%`,
        icon: Bed,
        subtitle: `${bedMetrics?.occupiedBeds ?? 0} / ${bedMetrics?.totalBeds ?? 0} occupied`,
        tone: (bedMetrics?.occupancyPercent ?? 0) >= 80 ? 'warning' : 'success',
      },
      {
        category: 'REALIZED REVENUE',
        title: 'Collections',
        value: formatPKR(billingSummary?.paidAmount ?? 0),
        icon: CreditCard,
        subtitle: `Realization rate: ${collectionsPercent}%`,
        tone: 'default',
      },
      {
        category: 'ACTIVE WORKFORCE',
        title: 'Staff Members',
        value: `${infrastructure?.totalStaffCount ?? 0}`,
        icon: Clock,
        subtitle: `${infrastructure?.activeDepartmentsCount ?? 0} clinical depts`,
        tone: 'indigo',
      },
      {
        category: 'SUPPLY ALERTS',
        title: 'Inventory Watch',
        value: totalAlerts,
        icon: AlertCircle,
        subtitle: `${inventorySummary?.lowStockItemsCount ?? 0} low • ${inventorySummary?.outOfStockItemsCount ?? 0} out`,
        tone: totalAlerts > 0 ? 'danger' : 'default',
      },
    ];
  }, [
    infrastructure,
    doctorsOnDutyCount,
    totalPatients,
    opdTotal,
    admissionTotal,
    emergencyTotal,
    bedMetrics,
    billingSummary,
    collectionsPercent,
    inventorySummary,
  ]);

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
              <h1 className="text-xl font-bold text-[#111827]">Hospital Administration Command Center</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db] inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#129b70] animate-pulse" />
                Admin Operations
              </span>
            </div>
            <p className="text-xs text-[#52665e] mt-0.5">
              Real-time operational monitoring, clinical duty rosters, bed occupancy and supply alerts.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => loadDashboard(selectedPreset)}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh operational metrics"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[#08775A] ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Syncing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          2. FILTER & DATE RANGE TOOLBAR (design.md §4.4)
      ========================================================================= */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Segmented Tab Presets */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {(
              [
                { key: 'today', label: 'Today' },
                { key: 'yesterday', label: 'Yesterday' },
                { key: 'this_week', label: 'This Week' },
                { key: 'this_month', label: 'This Month' },
              ] as const
            ).map((preset) => {
              const isActive = selectedPreset === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => {
                    setSelectedPreset(preset.key);
                    loadDashboard(preset.key);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-[#08775A] text-white shadow-xs'
                      : 'bg-[#f8faf9] text-[#52665e] hover:bg-[#eff5f2] hover:text-[#111827] border border-[#e2eae5]'
                  }`}
                >
                  <span>{preset.label}</span>
                </button>
              );
            })}
          </div>

          <div className="hidden sm:flex items-center gap-1.5 text-xs text-[#52665e]">
            <span>Active Window:</span>
            <span className="font-semibold text-slate-800 bg-[#f8faf9] px-2.5 py-1 rounded-md border border-[#e2eae5]">
              {displayPeriodLabel}
            </span>
          </div>
        </div>

        {loadError && (
          <div className="mt-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{loadError}</span>
            </div>
            <button
              type="button"
              onClick={() => loadDashboard(selectedPreset)}
              className="px-2.5 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded font-semibold transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* =========================================================================
          3. EXECUTIVE KPI INDICATORS (design.md §4.2)
      ========================================================================= */}
      <div>
        <div className="flex items-center justify-between mb-2 px-0.5">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Operational &amp; Financial Telemetry
          </h2>
          <span className="text-[11px] font-semibold text-[#52665e]">
            Live Database Synced
          </span>
        </div>
        <HospitalKpiHeader items={kpiItems} columns="grid-cols-2 md:grid-cols-3 lg:grid-cols-6" />
      </div>

      {/* =========================================================================
          4. MAIN OPERATIONAL CONTENT LAYOUT
      ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left 2 Cols: Doctors on Duty Table & Quick Actions */}
        <div className="lg:col-span-2 space-y-4">
          {/* Active Doctors on Duty Table (design.md §4.5) */}
          <div className="bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col">
            {/* Dark Emerald Header Strip */}
            <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-emerald-300" />
                <span className="font-semibold text-xs sm:text-sm tracking-wide">
                  Active Doctors &amp; Duty Rosters Today
                </span>
                <span className="bg-emerald-700/60 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-500/30 text-[10px] font-semibold">
                  {doctorsOnDuty.length} Active
                </span>
              </div>
              <button
                type="button"
                onClick={() => navigate('/admin/staff_users')}
                className="text-xs text-emerald-200 hover:text-white font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>View Full Roster</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[11px] font-bold text-[#08775A] select-none sticky top-0 z-10">
                    <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Doctor Name</th>
                    <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Specialty / Department</th>
                    <th className="py-2.5 px-4 border-r border-[#c2e7db]/60">Shift Timings</th>
                    <th className="py-2.5 px-4 border-r border-[#c2e7db]/60 text-center">Patients Booked</th>
                    <th className="py-2.5 px-4 text-center">Duty Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e2eae5] text-slate-700">
                  {doctorsOnDuty.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-400">
                        {isLoading ? (
                          <div className="flex items-center justify-center gap-2">
                            <RefreshCw className="h-4 w-4 animate-spin text-[#08775A]" />
                            <span>Loading live roster…</span>
                          </div>
                        ) : (
                          'No active doctor records found for today.'
                        )}
                      </td>
                    </tr>
                  ) : (
                    doctorsOnDuty.map((doc, idx) => {
                      const isEven = idx % 2 === 0;
                      return (
                        <tr
                          key={doc.id}
                          className={`transition-colors border-b border-[#e2eae5] ${
                            isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                          } hover:bg-[#e7f6f1]/40`}
                        >
                          <td className="py-3 px-4 font-bold text-[#123e2b] border-r border-[#e2eae5]">{doc.name}</td>
                          <td className="py-3 px-4 text-slate-600 border-r border-[#e2eae5]">{doc.department}</td>
                          <td className="py-3 px-4 text-slate-500 font-mono text-[11px] border-r border-[#e2eae5]">{doc.shiftLabel}</td>
                          <td className="py-3 px-4 text-center font-bold text-slate-800 font-mono border-r border-[#e2eae5]">
                            {doc.patientsBooked}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                doc.status === 'On Duty'
                                  ? 'bg-[#effaf5] text-[#08775A] border border-[#c2e7db]'
                                  : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full mr-1.5 ${
                                  doc.status === 'On Duty' ? 'bg-[#129b70] animate-pulse' : 'bg-slate-400'
                                }`}
                              />
                              {doc.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick Setup & Management Actions */}
          <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Administrative Quick Actions
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <button
                type="button"
                onClick={() => navigate('/admin/staff_users')}
                className="p-3.5 rounded-xl border border-[#e2eae5] hover:border-[#129b70] hover:bg-[#effaf5]/50 text-left transition-all group cursor-pointer"
              >
                <Stethoscope className="h-5 w-5 text-[#129b70] mb-2 group-hover:scale-110 transition-transform" />
                <div className="text-xs font-bold text-slate-900">Manage Doctors</div>
                <div className="text-[11px] text-[#52665e] mt-0.5">Rosters &amp; duty profiles</div>
              </button>

              <button
                type="button"
                onClick={() => navigate('/admin/services_rates')}
                className="p-3.5 rounded-xl border border-[#e2eae5] hover:border-[#08775A] hover:bg-[#effaf5]/50 text-left transition-all group cursor-pointer"
              >
                <FileSpreadsheet className="h-5 w-5 text-[#08775A] mb-2 group-hover:scale-110 transition-transform" />
                <div className="text-xs font-bold text-slate-900">Services &amp; Rates</div>
                <div className="text-[11px] text-[#52665e] mt-0.5">Tariffs &amp; charges</div>
              </button>

              <button
                type="button"
                onClick={() => navigate('/admin/wards_rooms_beds')}
                className="p-3.5 rounded-xl border border-[#e2eae5] hover:border-[#08775A] hover:bg-[#effaf5]/50 text-left transition-all group cursor-pointer"
              >
                <Bed className="h-5 w-5 text-[#08775A] mb-2 group-hover:scale-110 transition-transform" />
                <div className="text-xs font-bold text-slate-900">Wards &amp; Beds</div>
                <div className="text-[11px] text-[#52665e] mt-0.5">Rooms &amp; bed capacity</div>
              </button>

              <button
                type="button"
                onClick={() => navigate('/admin/billing_reports')}
                className="p-3.5 rounded-xl border border-[#e2eae5] hover:border-[#129b70] hover:bg-[#effaf5]/50 text-left transition-all group cursor-pointer"
              >
                <TrendingUp className="h-5 w-5 text-[#129b70] mb-2 group-hover:scale-110 transition-transform" />
                <div className="text-xs font-bold text-slate-900">Revenue Audits</div>
                <div className="text-[11px] text-[#52665e] mt-0.5">Department billing</div>
              </button>
            </div>
          </div>
        </div>

        {/* Right 1 Col: Ward Occupancy & Operational Alerts */}
        <div className="space-y-4">
          {/* Inpatient Ward Bed Capacity */}
          <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-3.5">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Ward Bed Capacity
              </h2>
              <span className="text-[11px] font-bold text-[#08775A] bg-[#effaf5] px-2 py-0.5 rounded-full border border-[#c2e7db]">
                {bedMetrics?.occupancyPercent ?? 0}% Occupied
              </span>
            </div>

            <div className="space-y-3.5">
              {(bedMetrics?.wards || []).length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  {isLoading ? 'Loading live ward data…' : 'No wards configured yet.'}
                </p>
              ) : (
                (bedMetrics?.wards || []).map((w) => (
                  <div key={w.wardName} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-medium text-slate-700">
                      <span className="font-semibold text-slate-800">{w.wardName}</span>
                      <span className="font-mono text-slate-600">
                        {w.occupiedBeds}/{w.totalBeds} ({w.occupancyPercent}%)
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          w.occupancyPercent >= 85
                            ? 'bg-rose-500'
                            : w.occupancyPercent >= 70
                            ? 'bg-[#129b70]'
                            : 'bg-[#08775A]'
                        }`}
                        style={{ width: `${w.occupancyPercent}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 pt-3.5 border-t border-[#e2eae5] flex items-center justify-between text-xs">
              <span className="text-[#52665e]">Available Vacant Beds:</span>
              <span className="font-bold text-[#08775A] bg-[#effaf5] px-2 py-0.5 rounded border border-[#c2e7db]">
                {bedMetrics?.availableBeds ?? 0} Free
              </span>
            </div>
          </div>

          {/* Stock & Pharmacy Alerts */}
          <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span>Stock &amp; Pharmacy Alerts</span>
            </h2>
            <div className="space-y-2.5 text-xs">
              {flaggedStockItems.length === 0 ? (
                <div className="py-6 text-center text-slate-400">
                  <CheckCircle2 className="h-6 w-6 text-[#129b70]/50 mx-auto mb-1.5" />
                  <p className="text-xs font-semibold text-slate-700">All items in stock</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">All central store medicines are above reorder threshold</p>
                </div>
              ) : (
                flaggedStockItems.map((item) => (
                  <div
                    key={item.id}
                    className={`p-3 rounded-lg border leading-snug ${
                      item.status === 'OUT_OF_STOCK'
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                  >
                    <div className="font-bold text-xs">{item.name}</div>
                    <div className={`text-[11px] mt-0.5 ${item.status === 'OUT_OF_STOCK' ? 'text-rose-700' : 'text-amber-700'}`}>
                      {item.status === 'OUT_OF_STOCK'
                        ? 'Out of Stock in Central Store'
                        : `Low Stock (${item.currentStock} ${item.unit} remaining) • Reorder level: ${item.reorderLevel}`}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          5. ROLE & GOVERNANCE POLICY FOOTER
      ========================================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-[#effaf5] rounded-xl border border-[#c2e7db] text-xs text-[#08775A] shadow-2xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#129b70] shrink-0" />
          <span>
            <strong className="text-[#123e2b]">Hospital Administration Workstation:</strong> Operating under role-based hospital access controls. Root governance and audit policies are active.
          </span>
        </div>
        <span className="text-[10px] font-mono bg-white text-[#08775A] px-2 py-0.5 rounded border border-[#c2e7db]">
          Admin Operations Secured
        </span>
      </div>
    </div>
  );
};
