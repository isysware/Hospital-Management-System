import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutGrid,
  Bed as BedIcon,
  Search,
  RotateCcw,
  RefreshCw,
  DoorOpen,
  Building2,
  CheckCircle2,
  Clock,
  Layers,
  Activity,
  AlertTriangle,
  User,
} from 'lucide-react';
import { PanelBadge } from '../../components/common/PanelBadge';
import { Modal } from '../../components/common/Modal';
import { useRouter } from '../../context/RouterContext';
import { fetchAdmissions, AdmissionRecord } from '../../services/admissionService';
import { WardsRoomsBedsService, fetchWardHierarchy } from '../../services/wardsRoomsBedsService';
import type { Ward, Room, Bed } from '../../types/wardsRoomsBeds';
import { AdmissionDetailModal } from './AdmissionDetailModal';
import { CheckInAdmissionModal } from './CheckInAdmissionModal';
import { HospitalKpiHeader, KpiItem } from '../../components/common/HospitalKpiHeader';

export const BedBoardView: React.FC = () => {
  const { navigate } = useRouter();

  const [wards, setWards] = useState<Ward[]>(() => WardsRoomsBedsService.getWards());
  const [rooms, setRooms] = useState<Room[]>(() => WardsRoomsBedsService.getRooms());
  const [beds, setBeds] = useState<Bed[]>(() => WardsRoomsBedsService.getBeds());
  const [admissions, setAdmissions] = useState<AdmissionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWardFilter, setSelectedWardFilter] = useState('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'ALL' | 'Available' | 'Occupied' | 'Maintenance'>('ALL');

  // Modals
  const [detailAdmissionId, setDetailAdmissionId] = useState<string | null>(null);
  const [assignTargetBed, setAssignTargetBed] = useState<Bed | null>(null);
  const [checkInTargetAdmission, setCheckInTargetAdmission] = useState<AdmissionRecord | null>(null);

  const loadData = async (isManualRefresh = false) => {
    if (isManualRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const [hierarchyRes, admissionsRes] = await Promise.all([
        fetchWardHierarchy(),
        fetchAdmissions(),
      ]);
      setWards(hierarchyRes.wards);
      setRooms(hierarchyRes.rooms);
      setBeds(hierarchyRes.beds);
      setAdmissions(admissionsRes);
    } catch (err) {
      console.error('Failed to refresh bed board data:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Map admissions by bedId for quick lookup
  const admissionByBedId = useMemo(() => {
    const map = new Map<string, AdmissionRecord>();
    for (const a of admissions) {
      if (a.bedId && (a.status === 'ACTIVE' || a.status === 'DISCHARGE_PENDING' || a.status === 'CONFIRMED' || a.status === 'PLANNED')) {
        map.set(a.bedId, a);
      }
    }
    return map;
  }, [admissions]);

  // Planned admissions awaiting bed check-in
  const plannedAdmissions = useMemo(
    () => admissions.filter((a) => a.status === 'PLANNED' || a.status === 'CONFIRMED'),
    [admissions]
  );

  // Stats
  const totalBeds = beds.length;
  const occupiedBeds = beds.filter((b) => b.occupancyStatus === 'Occupied').length;
  const availableBeds = beds.filter((b) => b.occupancyStatus === 'Available').length;
  const maintenanceBeds = beds.filter(
    (b) => b.occupancyStatus === 'Maintenance' || b.operationalStatus === 'Cleaning' || b.operationalStatus === 'Maintenance'
  ).length;

  const kpiItems: KpiItem[] = [
    {
      title: 'Total Inpatient Beds',
      value: totalBeds,
      icon: BedIcon,
      subtitle: `${wards.length} Active Wards Configured`,
      accentColor: '#08775A',
    },
    {
      title: 'Available Beds',
      value: availableBeds,
      icon: CheckCircle2,
      subtitle: 'Ready for Immediate Intake',
      accentColor: '#16a34a',
    },
    {
      title: 'Occupied Beds',
      value: occupiedBeds,
      icon: Activity,
      subtitle: totalBeds > 0 ? `${Math.round((occupiedBeds / totalBeds) * 100)}% Census Rate` : '0% Census Rate',
      accentColor: '#dc2626',
    },
    {
      title: 'Maintenance / Out of Service',
      value: maintenanceBeds,
      icon: Clock,
      subtitle: 'Sanitizing / Servicing',
      accentColor: '#f59e0b',
    },
  ];

  // Filtered beds
  const filteredBeds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return beds.filter((b) => {
      // Ward filter
      if (selectedWardFilter !== 'ALL' && b.wardId !== selectedWardFilter) {
        return false;
      }
      // Status filter
      if (selectedStatusFilter !== 'ALL') {
        if (selectedStatusFilter === 'Maintenance') {
          if (b.occupancyStatus !== 'Maintenance' && b.operationalStatus !== 'Cleaning' && b.operationalStatus !== 'Maintenance') {
            return false;
          }
        } else if (b.occupancyStatus !== selectedStatusFilter) {
          return false;
        }
      }
      // Text search
      if (q) {
        const matchesBed = b.bedNumber.toLowerCase().includes(q) || b.code.toLowerCase().includes(q);
        const matchesRoom = (b.roomName || '').toLowerCase().includes(q) || (b.roomNumber || '').toLowerCase().includes(q);
        const matchesWard = (b.wardName || '').toLowerCase().includes(q);
        const matchesPatient = (b.currentPatientName || '').toLowerCase().includes(q);
        const adm = admissionByBedId.get(b.id);
        const matchesAdm = adm
          ? adm.patientName.toLowerCase().includes(q) ||
            adm.admissionNumber.toLowerCase().includes(q) ||
            adm.patientMrNumber.toLowerCase().includes(q)
          : false;

        if (!matchesBed && !matchesRoom && !matchesWard && !matchesPatient && !matchesAdm) {
          return false;
        }
      }
      return true;
    });
  }, [beds, searchQuery, selectedWardFilter, selectedStatusFilter, admissionByBedId]);

  // Group filtered beds by Ward and Room
  const groupedStructure = useMemo(() => {
    const wardMap = new Map<
      string,
      {
        ward: Ward | null;
        rooms: Map<string, { room: Room | null; beds: Bed[] }>;
        directBeds: Bed[];
      }
    >();

    // Prepare entries for all wards
    wards.forEach((w) => {
      if (selectedWardFilter === 'ALL' || selectedWardFilter === w.id) {
        wardMap.set(w.id, {
          ward: w,
          rooms: new Map(),
          directBeds: [],
        });
      }
    });

    // Standalone rooms
    const standaloneKey = '__STANDALONE__';
    if (selectedWardFilter === 'ALL' || selectedWardFilter === standaloneKey) {
      wardMap.set(standaloneKey, {
        ward: null,
        rooms: new Map(),
        directBeds: [],
      });
    }

    // Distribute filtered beds
    filteredBeds.forEach((b) => {
      const wardKey = b.wardId && wardMap.has(b.wardId) ? b.wardId : standaloneKey;
      const wardGroup = wardMap.get(wardKey);
      if (!wardGroup) return;

      if (b.roomId) {
        if (!wardGroup.rooms.has(b.roomId)) {
          const roomObj = rooms.find((r) => r.id === b.roomId) || null;
          wardGroup.rooms.set(b.roomId, { room: roomObj, beds: [] });
        }
        wardGroup.rooms.get(b.roomId)!.beds.push(b);
      } else {
        wardGroup.directBeds.push(b);
      }
    });

    return Array.from(wardMap.entries()).filter(([_, group]) => {
      let bedCount = group.directBeds.length;
      group.rooms.forEach((r) => {
        bedCount += r.beds.length;
      });
      return bedCount > 0;
    });
  }, [wards, rooms, filteredBeds, selectedWardFilter]);

  const hasActiveFilters = searchQuery.trim() !== '' || selectedWardFilter !== 'ALL' || selectedStatusFilter !== 'ALL';

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedWardFilter('ALL');
    setSelectedStatusFilter('ALL');
  };

  // Render a high-fidelity bed card per design.md
  const renderBedCard = (bed: Bed) => {
    const isOccupied = bed.occupancyStatus === 'Occupied';
    const isAvailable = bed.occupancyStatus === 'Available';
    const isReserved = bed.occupancyStatus === 'Reserved';

    const adm = bed.id ? admissionByBedId.get(bed.id) : null;
    const patientName = bed.currentPatientName || adm?.patientName;
    const admissionIdToUse = bed.admissionId || adm?.id;

    let cardClasses = 'border-slate-200 bg-white hover:border-slate-300 shadow-xs';
    let statusPill = 'bg-slate-100 text-slate-700 border-slate-200';
    let statusText: string = bed.operationalStatus || 'Maintenance';

    if (isOccupied) {
      cardClasses = 'border-rose-200/90 bg-rose-50/40 hover:border-rose-300 hover:bg-rose-50/70 shadow-xs';
      statusPill = 'bg-rose-100 text-rose-800 border-rose-200';
      statusText = 'Occupied';
    } else if (isAvailable) {
      cardClasses = 'border-emerald-200/90 bg-[#effaf5]/50 hover:border-[#08775A]/40 hover:bg-[#effaf5] shadow-xs';
      statusPill = 'bg-emerald-100 text-emerald-800 border-emerald-200';
      statusText = 'Available';
    } else if (isReserved) {
      cardClasses = 'border-amber-200/90 bg-amber-50/40 hover:border-amber-300 hover:bg-amber-50/70 shadow-xs';
      statusPill = 'bg-amber-100 text-amber-800 border-amber-200';
      statusText = 'Reserved';
    }

    const handleClick = () => {
      if (isOccupied && admissionIdToUse) {
        setDetailAdmissionId(admissionIdToUse);
      } else if (isAvailable) {
        setAssignTargetBed(bed);
      }
    };

    return (
      <div
        key={bed.id}
        onClick={handleClick}
        className={`group rounded-xl border p-3 flex flex-col justify-between transition-all duration-150 cursor-pointer min-h-[96px] ${cardClasses}`}
        title={
          isOccupied
            ? `Bed ${bed.bedNumber}: Click to manage stay / transfer`
            : isAvailable
            ? `Bed ${bed.bedNumber}: Click to assign planned patient`
            : `Bed ${bed.bedNumber} (${bed.operationalStatus})`
        }
      >
        {/* Top: Bed number + status badge */}
        <div className="flex items-center justify-between gap-1 leading-none">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-bold text-slate-900 group-hover:text-[#08775A] transition-colors truncate">
              {bed.bedNumber}
            </span>
            {bed.bedType && bed.bedType !== 'Standard' && (
              <span className="text-[9px] text-slate-400 font-medium">({bed.bedType})</span>
            )}
          </div>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${statusPill}`}>
            {statusText}
          </span>
        </div>

        {/* Content Details */}
        <div className="mt-2">
          {isOccupied ? (
            <div className="space-y-0.5">
              <p className="text-[11px] font-bold text-slate-900 truncate leading-tight flex items-center gap-1">
                <User className="h-2.5 w-2.5 text-rose-600 shrink-0" />
                <span className="truncate">{patientName || 'Admitted Patient'}</span>
              </p>
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-mono text-slate-600 truncate">
                  {adm?.patientMrNumber || adm?.admissionNumber || 'Inpatient'}
                </span>
                {adm?.payerType === 'Corporate / Panel' && <PanelBadge className="scale-75 origin-left" />}
              </div>
            </div>
          ) : isAvailable ? (
            <div>
              <p className="text-[11px] font-semibold text-emerald-800 leading-tight">Ready for Intake</p>
              <span className="inline-flex items-center text-[10px] font-bold text-[#08775A] group-hover:underline mt-0.5">
                + Assign Patient
              </span>
            </div>
          ) : isReserved ? (
            <div>
              <p className="text-[11px] font-semibold text-amber-800 leading-tight">Patient Reserved</p>
              <p className="text-[10px] text-amber-700/80 mt-0.5">Hold Active</p>
            </div>
          ) : (
            <div>
              <p className="text-[11px] font-semibold text-slate-700 leading-tight">
                {bed.operationalStatus || 'Maintenance'}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">Unavailable</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      {/* Page Header Block (§4.1) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-[#effaf5] border border-[#c2e7db] text-[#08775A] flex items-center justify-center font-bold shadow-2xs">
            <LayoutGrid className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Bed Board &amp; Transfers</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#08775A] animate-pulse" />
                Live Census
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time occupancy telemetry, bed allocation, and inter-ward transfers. Click Available to assign, or Occupied to transfer.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl border border-slate-200 text-xs font-semibold shadow-2xs transition-colors"
            title="Refresh Bed Status"
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
          {/* Search Input */}
          <div className="relative w-56 sm:w-64">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search bed, patient, MRN, room…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#08775A] bg-slate-50/50"
            />
          </div>

          {/* Ward Dropdown */}
          <select
            value={selectedWardFilter}
            onChange={(e) => setSelectedWardFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#08775A] bg-white text-slate-700 font-semibold"
          >
            <option value="ALL">All Wards</option>
            {wards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
            <option value="__STANDALONE__">Standalone Rooms</option>
          </select>

          {/* Segmented Status Tabs */}
          <div className="inline-flex items-center p-1 bg-slate-100/80 rounded-xl gap-1">
            <button
              type="button"
              onClick={() => setSelectedStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                selectedStatusFilter === 'ALL'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Beds
            </button>
            <button
              type="button"
              onClick={() => setSelectedStatusFilter('Available')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                selectedStatusFilter === 'Available'
                  ? 'bg-[#08775A] text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${selectedStatusFilter === 'Available' ? 'bg-white' : 'bg-emerald-500'}`} />
              Available ({availableBeds})
            </button>
            <button
              type="button"
              onClick={() => setSelectedStatusFilter('Occupied')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                selectedStatusFilter === 'Occupied'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${selectedStatusFilter === 'Occupied' ? 'bg-white' : 'bg-rose-500'}`} />
              Occupied ({occupiedBeds})
            </button>
            <button
              type="button"
              onClick={() => setSelectedStatusFilter('Maintenance')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                selectedStatusFilter === 'Maintenance'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${selectedStatusFilter === 'Maintenance' ? 'bg-white' : 'bg-amber-500'}`} />
              Maint ({maintenanceBeds})
            </button>
          </div>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50/60 rounded-lg hover:bg-rose-50 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset Filters
          </button>
        )}
      </div>

      {/* Main Bed Grid */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 flex flex-col items-center justify-center gap-2.5 text-slate-400">
          <RefreshCw className="h-6 w-6 animate-spin text-[#08775A]" />
          <span className="text-xs font-semibold">Loading real-time bed board…</span>
        </div>
      ) : groupedStructure.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center text-xs text-slate-500 font-medium">
          No inpatient beds found matching the filter criteria.
        </div>
      ) : (
        <div className="space-y-5">
          {groupedStructure.map(([wardId, wardData]) => {
            const ward = wardData.ward;
            const wardTitle = ward ? ward.name : 'Standalone / Private Rooms';

            // Counts for this ward
            let wardTotalBeds = wardData.directBeds.length;
            let wardOccupiedBeds = wardData.directBeds.filter((b) => b.occupancyStatus === 'Occupied').length;
            wardData.rooms.forEach((r) => {
              wardTotalBeds += r.beds.length;
              wardOccupiedBeds += r.beds.filter((b) => b.occupancyStatus === 'Occupied').length;
            });

            const wardOccupancyPct = wardTotalBeds > 0 ? Math.round((wardOccupiedBeds / wardTotalBeds) * 100) : 0;

            return (
              <div key={wardId} className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden">
                {/* Dark Emerald Header Strip (§4.1 / §4.5) */}
                <div className="bg-[#0e5944] px-4 py-3 flex items-center justify-between flex-wrap gap-2 text-white">
                  <div className="flex items-center gap-2.5">
                    <Building2 className="h-4 w-4 text-emerald-300" />
                    <h2 className="text-sm font-bold text-white tracking-wide">{wardTitle}</h2>
                    {ward?.genderPolicy && ward.genderPolicy !== 'Not Applicable' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-200 border border-emerald-700/50 font-semibold">
                        {ward.genderPolicy}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-20 bg-emerald-950/60 rounded-full h-2 overflow-hidden border border-emerald-700/40">
                        <div
                          className="bg-emerald-400 h-full rounded-full transition-all duration-300"
                          style={{ width: `${wardOccupancyPct}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-emerald-200 font-bold">{wardOccupancyPct}%</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/70 text-emerald-100 border border-emerald-700/50 font-mono text-[11px]">
                      <b>{wardOccupiedBeds}</b> / {wardTotalBeds} Occupied
                    </span>
                  </div>
                </div>

                {/* Rooms and Beds */}
                <div className="p-4 space-y-4">
                  {Array.from(wardData.rooms.entries()).map(([roomId, roomData]) => {
                    const room = roomData.room;
                    const roomName = room ? room.name : `Room ${roomId}`;

                    return (
                      <div key={roomId} className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-slate-600 font-bold">
                          <DoorOpen className="h-3.5 w-3.5 text-[#08775A]" />
                          <span>{roomName}</span>
                          <span className="text-[11px] text-slate-400 font-normal font-mono">
                            ({roomData.beds.length} bed{roomData.beds.length === 1 ? '' : 's'})
                          </span>
                        </div>

                        {/* Beds Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2.5">
                          {roomData.beds.map((bed) => renderBedCard(bed))}
                        </div>
                      </div>
                    );
                  })}

                  {wardData.directBeds.length > 0 && (
                    <div className="space-y-2 pt-1 border-t border-slate-100">
                      <div className="flex items-center gap-2 text-xs text-slate-600 font-bold">
                        <Layers className="h-3.5 w-3.5 text-[#08775A]" />
                        <span>Direct Beds</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2.5">
                        {wardData.directBeds.map((bed) => renderBedCard(bed))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bed Assignment Modal */}
      {assignTargetBed && (
        <Modal
          isOpen
          onClose={() => setAssignTargetBed(null)}
          title={`Assign Bed ${assignTargetBed.bedNumber} (${assignTargetBed.wardName || 'Ward'})`}
          maxWidth="md"
        >
          <div className="space-y-3.5 text-xs">
            <p className="text-slate-600 font-medium">Select a planned patient awaiting admission to check them in:</p>

            {plannedAdmissions.length === 0 ? (
              <div className="p-5 bg-slate-50 rounded-xl text-center text-slate-500 font-medium border border-slate-200">
                No planned admissions waiting for check-in.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                {plannedAdmissions.map((p) => (
                  <div key={p.id} className="p-3 hover:bg-slate-50 flex items-center justify-between gap-2.5 transition-colors">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900">{p.patientName}</span>
                        <span className="font-mono text-[11px] text-slate-500">({p.patientMrNumber})</span>
                        {p.payerType === 'Corporate / Panel' && <PanelBadge />}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{p.departmentName} • Dr. {p.doctorName || 'Assigned'}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const target = { ...p, bedId: assignTargetBed.id };
                        setAssignTargetBed(null);
                        setCheckInTargetAdmission(target);
                      }}
                      className="px-3 py-1.5 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-2xs shrink-0 transition-colors"
                    >
                      Check-In
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setAssignTargetBed(null)}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Check-In Modal */}
      {checkInTargetAdmission && (
        <CheckInAdmissionModal
          admission={checkInTargetAdmission}
          onClose={() => setCheckInTargetAdmission(null)}
          onCheckedIn={() => {
            setCheckInTargetAdmission(null);
            loadData();
          }}
        />
      )}

      {/* Stay / Transfer Modal */}
      {detailAdmissionId && (
        <AdmissionDetailModal
          admissionId={detailAdmissionId}
          initialTab="bed"
          onClose={() => setDetailAdmissionId(null)}
          onChanged={() => loadData()}
        />
      )}
    </div>
  );
};
