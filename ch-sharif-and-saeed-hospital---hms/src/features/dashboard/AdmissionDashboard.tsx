import React, { useEffect, useMemo, useState } from 'react';
import {
  Bed,
  Users,
  Activity,
  CheckCircle2,
  Clock,
  ArrowLeftRight,
  Loader2,
  AlertCircle,
  Building2,
  DoorOpen,
  LogIn,
  Eye,
  Calendar,
  UserCheck,
  RotateCw,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { PanelBadge } from '../../components/common/PanelBadge';
import { useRouter } from '../../context/RouterContext';
import { fetchAdmissions, AdmissionRecord } from '../../services/admissionService';
import { WardsRoomsBedsService, fetchWardHierarchy } from '../../services/wardsRoomsBedsService';
import { Ward, Room, Bed as WardBed } from '../../types/wardsRoomsBeds';
import { CheckInAdmissionModal } from '../admission/CheckInAdmissionModal';
import { AdmissionDetailModal } from '../admission/AdmissionDetailModal';
import { formatDateTimeDDMMYYYY } from '../../utils/formatters';
import { HospitalKpiHeader, KpiItem } from '../../components/common/HospitalKpiHeader';

function formatDisplayDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return formatDateTimeDDMMYYYY(iso) || '—';
}

/**
 * Admission Dashboard — canonical design.md implementation for Inpatient Operations.
 * Adheres strictly to design system typography, HospitalKpiHeader (§4.2),
 * dark emerald headers (§4.5), and intuitive ward occupancy cards.
 */
export const AdmissionDashboard: React.FC = () => {
  const { navigate } = useRouter();

  const [admissions, setAdmissions] = useState<AdmissionRecord[]>([]);
  const [hierarchy, setHierarchy] = useState<{ wards: Ward[]; rooms: Room[]; beds: WardBed[] }>({
    wards: WardsRoomsBedsService.getWards(),
    rooms: WardsRoomsBedsService.getRooms(),
    beds: WardsRoomsBedsService.getBeds(),
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modals
  const [checkInTarget, setCheckInTarget] = useState<AdmissionRecord | null>(null);
  const [detailAdmissionId, setDetailAdmissionId] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [admissionsRes, hierarchyRes] = await Promise.all([
        fetchAdmissions(),
        fetchWardHierarchy().catch(() => ({
          wards: WardsRoomsBedsService.getWards(),
          rooms: WardsRoomsBedsService.getRooms(),
          beds: WardsRoomsBedsService.getBeds(),
        })),
      ]);
      setAdmissions(admissionsRes);
      setHierarchy(hierarchyRes);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load admission dashboard data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const { wards, rooms, beds } = hierarchy;

  // Admission subsets
  const plannedAdmissions = useMemo(
    () => admissions.filter((a) => a.status === 'PLANNED' || a.status === 'CONFIRMED'),
    [admissions]
  );
  const activeAdmissions = useMemo(
    () => admissions.filter((a) => a.status === 'ACTIVE' || a.status === 'DISCHARGE_PENDING'),
    [admissions]
  );

  // Global KPIs
  const occupiedBedsCount = beds.filter((b) => b.occupancyStatus === 'Occupied').length;
  const availableBedsCount = beds.filter((b) => b.occupancyStatus === 'Available').length;
  const overallOccupancyRate = beds.length > 0 ? Math.round((occupiedBedsCount / beds.length) * 100) : 0;

  // Canonical KPI Telemetry adhering to design.md §4.2
  const kpiItems: KpiItem[] = useMemo(() => {
    return [
      {
        category: 'TOTAL BED CAPACITY',
        title: 'Hospital Beds',
        value: beds.length,
        icon: Bed,
        subtitle: `Across ${wards.length} active wards`,
        tone: 'default',
      },
      {
        category: 'AVAILABLE FOR INTAKE',
        title: 'Vacant Beds',
        value: availableBedsCount,
        icon: CheckCircle2,
        subtitle: 'Immediate intake ready',
        tone: 'success',
      },
      {
        category: 'INCOMING ARRIVALS',
        title: 'Planned Arrivals',
        value: plannedAdmissions.length,
        icon: Clock,
        subtitle: 'Awaiting bed check-in',
        tone: 'info',
      },
      {
        category: 'CURRENT CENSUS',
        title: 'Active Inpatients',
        value: activeAdmissions.length,
        icon: Users,
        subtitle: `${overallOccupancyRate}% bed occupancy`,
        tone: overallOccupancyRate >= 80 ? 'warning' : 'default',
      },
    ];
  }, [beds.length, wards.length, availableBedsCount, plannedAdmissions.length, activeAdmissions.length, overallOccupancyRate]);

  // Computed per-ward statistics
  const wardCardsData = useMemo(() => {
    const list = wards.map((ward) => {
      const wardRooms = rooms.filter((r) => r.wardId === ward.id);
      const wardBeds = beds.filter((b) => b.wardId === ward.id);

      const totalRooms = wardRooms.length;
      const occupiedRooms = wardRooms.filter((r) =>
        wardBeds.some((b) => b.roomId === r.id && b.occupancyStatus === 'Occupied')
      ).length;

      const totalBeds = wardBeds.length;
      const occupiedBeds = wardBeds.filter((b) => b.occupancyStatus === 'Occupied').length;
      const availableBeds = wardBeds.filter((b) => b.occupancyStatus === 'Available').length;
      const maintenanceBeds = wardBeds.filter(
        (b) => b.occupancyStatus === 'Maintenance' || b.occupancyStatus === 'Reserved'
      ).length;

      const occupancyPercent = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

      return {
        ward,
        totalRooms,
        occupiedRooms,
        totalBeds,
        occupiedBeds,
        availableBeds,
        maintenanceBeds,
        occupancyPercent,
      };
    });

    // Standalone rooms (rooms without parent ward)
    const standaloneRooms = rooms.filter((r) => !r.wardId);
    if (standaloneRooms.length > 0) {
      const standaloneBeds = beds.filter((b) => !b.wardId);
      const totalRooms = standaloneRooms.length;
      const occupiedRooms = standaloneRooms.filter((r) =>
        standaloneBeds.some((b) => b.roomId === r.id && b.occupancyStatus === 'Occupied')
      ).length;
      const totalBeds = standaloneBeds.length;
      const occupiedBeds = standaloneBeds.filter((b) => b.occupancyStatus === 'Occupied').length;
      const availableBeds = standaloneBeds.filter((b) => b.occupancyStatus === 'Available').length;
      const maintenanceBeds = standaloneBeds.filter(
        (b) => b.occupancyStatus === 'Maintenance' || b.occupancyStatus === 'Reserved'
      ).length;
      const occupancyPercent = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

      list.push({
        ward: {
          id: 'standalone',
          code: 'STANDALONE',
          name: 'Private & Standalone Rooms',
          departmentId: '',
          departmentName: 'General',
          wardType: 'Private',
          floor: 'Various',
          genderPolicy: undefined,
          status: 'Active',
          roomCount: totalRooms,
          bedCount: totalBeds,
          availableBeds: availableBeds,
          historicalAdmissionCount: 0,
          createdBy: 'System',
          createdAt: '',
          updatedBy: 'System',
          updatedAt: '',
        },
        totalRooms,
        occupiedRooms,
        totalBeds,
        occupiedBeds,
        availableBeds,
        maintenanceBeds,
        occupancyPercent,
      });
    }

    return list;
  }, [wards, rooms, beds]);

  return (
    <div className="space-y-4 pb-8 text-slate-800">
      {/* =========================================================================
          1. CARD PAGE HEADER BLOCK (design.md §4.1)
      ========================================================================= */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-4 sm:p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center shadow-2xs shrink-0">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#111827]">Admission &amp; Inpatient Dashboard</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db] inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#129b70] animate-pulse" />
                Live Census Active
              </span>
            </div>
            <p className="text-xs text-[#52665e] mt-0.5">
              Real-time inpatient census, ward &amp; room bed occupancy, incoming arrivals, and active stay management.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={load}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh live admission data"
          >
            <RotateCw className={`h-3.5 w-3.5 text-[#08775A] ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Syncing...' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admission/new_admission')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#08775A] hover:bg-[#065f46] text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>New Admission</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admission/admission_check_in')}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#effaf5] hover:bg-[#dff5ea] text-[#08775A] border border-[#c2e7db] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>Check-In Queue ({plannedAdmissions.length})</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/admission/bed_board_transfers')}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-slate-700 hover:text-slate-900 border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-[#08775A]" />
            <span>Bed Board</span>
          </button>
        </div>
      </div>

      {loadError && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between gap-2.5 text-xs text-rose-700 font-medium">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={load}
            className="px-2.5 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded font-semibold transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* =========================================================================
          2. CANONICAL KPI HEADER (design.md §4.2)
      ========================================================================= */}
      <div>
        <div className="flex items-center justify-between mb-2 px-0.5">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Inpatient Census &amp; Capacity Telemetry
          </h2>
          <span className="text-[11px] font-semibold text-[#52665e]">
            Live Bed Database Synced
          </span>
        </div>
        <HospitalKpiHeader items={kpiItems} columns="grid-cols-2 lg:grid-cols-4" />
      </div>

      {/* =========================================================================
          3. WARDS OVERVIEW & BED OCCUPANCY CARDS
      ========================================================================= */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-0.5">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#08775A]" />
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Wards Overview &amp; Bed Occupancy
            </h2>
          </div>
          <span className="text-[11px] font-semibold text-[#52665e] bg-white px-2.5 py-1 rounded-md border border-[#e2eae5]">
            {wardCardsData.length} Ward{wardCardsData.length === 1 ? '' : 's'} Configured
          </span>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-xl border border-[#e2eae5] p-8 flex items-center justify-center gap-2 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin text-[#08775A]" />
            <span className="text-xs font-medium">Loading ward census cards…</span>
          </div>
        ) : wardCardsData.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e2eae5] p-8 text-center text-xs text-slate-500">
            No wards configured yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {wardCardsData.map((item) => {
              const {
                ward,
                totalRooms,
                occupiedRooms,
                totalBeds,
                occupiedBeds,
                availableBeds,
                maintenanceBeds,
                occupancyPercent,
              } = item;

              // Occupancy color bar
              const barColor =
                occupancyPercent >= 90
                  ? 'bg-rose-500'
                  : occupancyPercent >= 70
                  ? 'bg-amber-500'
                  : 'bg-[#08775A]';

              return (
                <div
                  key={ward.id}
                  className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md transition-all p-4.5 flex flex-col justify-between"
                >
                  {/* Card Header: Ward Name & Badges */}
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-bold text-slate-900">{ward.name}</h3>
                          {ward.code && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-mono font-semibold">
                              {ward.code}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#52665e] mt-0.5">
                          {ward.departmentName || 'General Ward'} {ward.floor ? `• ${ward.floor}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        {ward.wardType && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                            {ward.wardType}
                          </span>
                        )}
                        {ward.genderPolicy && ward.genderPolicy !== 'Not Applicable' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                            {ward.genderPolicy}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Room & Bed Ratio Blocks — "room 6/10 is trh" */}
                    <div className="grid grid-cols-2 gap-2 mt-3.5 pt-3 border-t border-slate-100">
                      {/* Room Block */}
                      <div className="bg-[#f8faf9] rounded-xl p-2.5 border border-[#e2eae5] flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center shrink-0">
                          <DoorOpen className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Rooms</p>
                          <p className="text-sm font-bold text-slate-900 leading-tight font-mono tabular-nums">
                            {occupiedRooms} / {totalRooms}
                          </p>
                          <p className="text-[9px] text-slate-400">In use / Total</p>
                        </div>
                      </div>

                      {/* Bed Block */}
                      <div className="bg-[#f8faf9] rounded-xl p-2.5 border border-[#e2eae5] flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center shrink-0">
                          <Bed className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Beds</p>
                          <p className="text-sm font-bold text-slate-900 leading-tight font-mono tabular-nums">
                            {occupiedBeds} / {totalBeds}
                          </p>
                          <p className="text-[9px] text-slate-400">Occupied / Total</p>
                        </div>
                      </div>
                    </div>

                    {/* Occupancy Progress Bar */}
                    <div className="mt-3.5 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#52665e] font-medium">Occupancy</span>
                        <span className="font-bold text-slate-900 font-mono tabular-nums">{occupancyPercent}%</span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${barColor} rounded-full transition-all duration-300`}
                          style={{ width: `${Math.min(100, occupancyPercent)}%` }}
                        />
                      </div>
                    </div>

                    {/* Bed Status Breakdown Pills */}
                    <div className="flex items-center gap-1.5 flex-wrap mt-3 pt-2 text-[10px]">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 font-semibold border border-rose-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                        {occupiedBeds} Occupied
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#effaf5] text-[#08775A] font-semibold border border-[#c2e7db]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#129b70]" />
                        {availableBeds} Free
                      </span>
                      {maintenanceBeds > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 font-semibold border border-amber-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          {maintenanceBeds} Maint
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Footer Action */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px]">
                      {availableBeds > 0 ? (
                        <span className="text-[#08775A] font-semibold">{availableBeds} beds available</span>
                      ) : (
                        <span className="text-rose-600 font-semibold">Ward Full</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate('/admission/bed_board_transfers')}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#08775A] hover:text-[#065f46] hover:underline cursor-pointer"
                    >
                      <ArrowLeftRight className="h-3 w-3" />
                      <span>Bed Board</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* =========================================================================
          4. TWO-COLUMN QUEUES: PLANNED ARRIVALS & ACTIVE INPATIENTS (design.md §4.5)
      ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Planned / Incoming Admissions Section */}
        <div className="bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col">
          {/* Dark Emerald Header Strip */}
          <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-300" />
              <span className="font-semibold text-xs sm:text-sm tracking-wide">
                Planned Arrivals · Incoming Queue
              </span>
              <span className="bg-emerald-700/60 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-500/30 text-[10px] font-semibold">
                {plannedAdmissions.length} Incoming
              </span>
            </div>

            <button
              type="button"
              onClick={() => navigate('/admission/planned_admissions')}
              className="text-xs text-emerald-200 hover:text-white font-semibold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span>View All</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="p-3 divide-y divide-[#e2eae5] flex-1 overflow-y-auto max-h-[460px]">
            {isLoading ? (
              <div className="p-8 flex items-center justify-center gap-2 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-[#08775A]" />
                <span className="text-xs">Loading planned admissions…</span>
              </div>
            ) : plannedAdmissions.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#52665e]">
                No incoming planned admissions right now.
              </div>
            ) : (
              plannedAdmissions.slice(0, 6).map((a) => (
                <div
                  key={a.id}
                  className="py-3 first:pt-1 last:pb-1 flex items-start justify-between gap-3 hover:bg-[#effaf5]/50 p-2.5 rounded-xl transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[#123e2b]">{a.patientName}</span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                        {a.patientMrNumber || a.admissionNumber}
                      </span>
                      {a.payerType === 'Corporate / Panel' && <PanelBadge />}
                    </div>

                    <div className="text-[11px] text-[#52665e] mt-1 flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800">{a.departmentName}</span>
                      <span>•</span>
                      <span>Dr. {a.doctorName || 'Unassigned'}</span>
                    </div>

                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
                      <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
                        <Calendar className="h-3 w-3" />
                        Expected: {formatDisplayDateTime(a.expectedAt || a.createdAtIso)}
                      </span>
                      {a.bedLabel ? (
                        <span className="font-semibold text-[#08775A]">Bed: {a.bedLabel}</span>
                      ) : (
                        <span className="text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                          Bed Unassigned
                        </span>
                      )}
                    </div>

                    {a.diagnosis && (
                      <p className="text-[10px] text-slate-500 mt-1 line-clamp-1 italic">
                        Dx: {a.diagnosis}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setCheckInTarget(a)}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-[11px] font-bold shadow-xs transition-colors cursor-pointer"
                    >
                      <LogIn className="h-3 w-3" /> Check-In
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailAdmissionId(a.id)}
                      className="text-[10px] font-semibold text-[#52665e] hover:text-[#08775A] flex items-center gap-0.5 cursor-pointer"
                    >
                      <Eye className="h-3 w-3" /> Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Active Inpatients Section */}
        <div className="bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col">
          {/* Dark Emerald Header Strip */}
          <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-300" />
              <span className="font-semibold text-xs sm:text-sm tracking-wide">
                Active Inpatients · Live Census
              </span>
              <span className="bg-emerald-700/60 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-500/30 text-[10px] font-semibold">
                {activeAdmissions.length} Admitted
              </span>
            </div>

            <button
              type="button"
              onClick={() => navigate('/admission/active_admissions')}
              className="text-xs text-emerald-200 hover:text-white font-semibold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span>View All</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="p-3 divide-y divide-[#e2eae5] flex-1 overflow-y-auto max-h-[460px]">
            {isLoading ? (
              <div className="p-8 flex items-center justify-center gap-2 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-[#08775A]" />
                <span className="text-xs">Loading active inpatients…</span>
              </div>
            ) : activeAdmissions.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#52665e]">
                No active inpatients right now.
              </div>
            ) : (
              activeAdmissions.slice(0, 6).map((a) => (
                <div
                  key={a.id}
                  className="py-3 first:pt-1 last:pb-1 flex items-start justify-between gap-3 hover:bg-[#effaf5]/50 p-2.5 rounded-xl transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[#123e2b]">{a.patientName}</span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                        {a.admissionNumber}
                      </span>
                      {a.payerType === 'Corporate / Panel' && <PanelBadge />}
                    </div>

                    <div className="text-[11px] text-[#52665e] mt-1 flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[#08775A] bg-[#effaf5] px-1.5 py-0.5 rounded border border-[#c2e7db]">
                        {a.bedLabel || 'Bed Assigned'}
                      </span>
                      <span>•</span>
                      <span className="font-medium text-slate-700">{a.departmentName}</span>
                      <span>•</span>
                      <span>Dr. {a.doctorName || 'Assigned'}</span>
                    </div>

                    <div className="flex items-center gap-2.5 mt-1.5 text-[10px] text-slate-500 flex-wrap">
                      <span>Admitted: {formatDisplayDateTime(a.admittedAt || a.createdAtIso)}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          a.medicationMode === 'HOSPITAL_MANAGED'
                            ? 'bg-blue-100 text-blue-700 border border-blue-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {a.medicationMode === 'HOSPITAL_MANAGED' ? 'Hospital Managed' : 'Self Med'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setDetailAdmissionId(a.id)}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-white hover:bg-[#f6faf8] text-[#123e2b] border border-[#e2eae5] rounded-lg text-[11px] font-bold shadow-2xs transition-colors cursor-pointer"
                    >
                      <Eye className="h-3 w-3 text-[#08775A]" /> Manage Stay
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/admission/bed_board_transfers')}
                      className="text-[10px] font-medium text-[#52665e] hover:text-[#08775A] flex items-center gap-0.5 cursor-pointer"
                    >
                      <ArrowLeftRight className="h-3 w-3" /> Bed Board
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Interactive Modals */}
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

      {detailAdmissionId && (
        <AdmissionDetailModal
          admissionId={detailAdmissionId}
          onClose={() => setDetailAdmissionId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
};
