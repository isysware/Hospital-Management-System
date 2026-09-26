import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutGrid,
  Building,
  Bed as BedIcon,
  Plus,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import {
  Ward,
  Room,
  Bed,
  WardFormValues,
  RoomFormValues,
  BedFormValues,
} from '../../../types/wardsRoomsBeds';
import {
  WardsRoomsBedsService,
  fetchWardHierarchy,
  getNextBedNumbers,
} from '../../../services/wardsRoomsBedsService';
import { DepartmentService } from '../../../services/departmentService';
import { WardsRoomsBedsTopSummary } from './WardsRoomsBedsTopSummary';
import { WardTab } from './WardTab';
import { RoomTab } from './RoomTab';
import { BedTab } from './BedTab';
import { WardModal } from './WardModal';
import { RoomModal } from './RoomModal';
import { BedModal } from './BedModal';
import { WardDetailModal } from './WardDetailModal';
import { RoomDetailModal } from './RoomDetailModal';
import { BedDetailModal } from './BedDetailModal';
import { WardsRoomsBedsExportModal } from './WardsRoomsBedsExportModal';
import { WardsRoomsBedsImportModal } from './WardsRoomsBedsImportModal';
import {
  downloadWardsPDF,
  downloadRoomsPDF,
  downloadBedsPDF,
} from '../../../services/wardsRoomsBedsExportService';
import { StaffUser } from '../../../types/staffUser';
import { fetchStaffUsers } from '../../../services/staffUserService';
import { HospitalFloor } from '../../../types/department';
import { FloorService } from '../../../services/floorService';

interface SuperAdminWardsRoomsBedsViewProps {
  initialTab?: 'wards' | 'rooms' | 'beds';
}

export const SuperAdminWardsRoomsBedsView: React.FC<
  SuperAdminWardsRoomsBedsViewProps
> = ({ initialTab = 'wards' }) => {
  const { currentUser } = useAuth();

  // Active Tab
  const [activeTab, setActiveTab] = useState<'wards' | 'rooms' | 'beds'>(initialTab);

  // Entities
  const [wards, setWards] = useState<Ward[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [floors, setFloors] = useState<HospitalFloor[]>([]);

  // Modals
  const [isWardModalOpen, setIsWardModalOpen] = useState(false);
  const [selectedWard, setSelectedWard] = useState<Ward | null>(null);

  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);

  const [isBedModalOpen, setIsBedModalOpen] = useState(false);
  const [selectedBed, setSelectedBed] = useState<Bed | null>(null);

  // Detail Modals
  const [isWardDetailOpen, setIsWardDetailOpen] = useState(false);
  const [isRoomDetailOpen, setIsRoomDetailOpen] = useState(false);
  const [isBedDetailOpen, setIsBedDetailOpen] = useState(false);

  // Export / Import Modals
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Delete Prompt
  const [itemToDelete, setItemToDelete] = useState<{
    type: 'ward' | 'room' | 'bed';
    item: any;
  } | null>(null);

  const toastService = useToast();

  const showToast = (type: 'success' | 'warning' | 'error', message: string) => {
    if (type === 'success') toastService.success(message);
    else if (type === 'warning') toastService.warning(message);
    else toastService.error(message);
  };

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [{ wards: w, rooms: r, beds: b }, staffList, floorList] = await Promise.all([
        fetchWardHierarchy(),
        fetchStaffUsers().catch(() => []),
        FloorService.fetchFloors().catch(() => []),
      ]);
      setWards(w);
      setRooms(r);
      setBeds(b);
      setStaffUsers(staffList);
      setFloors(floorList);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load wards / rooms / beds from the server.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const departments = useMemo(() => {
    return DepartmentService.getDepartments();
  }, []);

  const summary = useMemo(() => {
    return WardsRoomsBedsService.getTopSummary();
  }, [wards, rooms, beds]);

  // Direct PDF Download handler
  const handleDirectDownloadPDF = async () => {
    try {
      if (activeTab === 'wards') {
        await downloadWardsPDF(wards, currentUser);
        showToast('success', 'Wards Directory PDF downloaded.');
      } else if (activeTab === 'rooms') {
        await downloadRoomsPDF(rooms, currentUser);
        showToast('success', 'Rooms Directory PDF downloaded.');
      } else {
        await downloadBedsPDF(beds, currentUser);
        showToast('success', 'Beds Directory PDF downloaded.');
      }
    } catch (err) {
      showToast('error', 'Failed to generate PDF.');
    }
  };

  // Ward CRUD
  const handleSaveWard = async (values: WardFormValues) => {
    try {
      if (selectedWard) {
        await WardsRoomsBedsService.updateWard(selectedWard.id, values, currentUser);
        showToast('success', `Ward "${values.name}" updated successfully.`);
      } else {
        await WardsRoomsBedsService.createWard(values, currentUser);
        showToast('success', `Ward "${values.name}" created successfully.`);
      }
      setIsWardModalOpen(false);
      setSelectedWard(null);
      await loadData();
    } catch (err: any) {
      showToast('error', err.message || 'Failed to save ward.');
    }
  };

  const handleToggleWardStatus = async (w: Ward) => {
    try {
      const nextStatus = w.status === 'Active' ? 'Inactive' : 'Active';
      await WardsRoomsBedsService.changeWardStatus(w.id, nextStatus, currentUser);
      showToast('success', `Ward "${w.name}" marked as ${nextStatus}.`);
      await loadData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleDeleteWardPrompt = (w: Ward) => {
    const hasHistory = (w.historicalAdmissionCount ?? 0) > 0;

    if (hasHistory) {
      showToast(
        'warning',
        `Cannot delete Ward "${w.name}": Contains historical admissions. Deactivate it instead.`
      );
      return;
    }
    setItemToDelete({ type: 'ward', item: w });
  };

  // Room CRUD
  const handleSaveRoom = async (values: RoomFormValues) => {
    try {
      if (selectedRoom) {
        await WardsRoomsBedsService.updateRoom(selectedRoom.id, values, currentUser);

        // If autoGenerateBeds was selected and capacity was increased:
        const existingRoomBeds = beds.filter((b) => b.roomId === selectedRoom.id);
        const missingCount = values.capacity - existingRoomBeds.length;
        if (values.autoGenerateBeds && missingCount > 0) {
          const newBedNames = getNextBedNumbers(existingRoomBeds, missingCount, 'Bed ');
          const bedsToCreate: BedFormValues[] = newBedNames.map((bName) => ({
            code: '',
            bedNumber: bName,
            roomId: selectedRoom.id,
            wardId: '',
            bedType: 'Standard',
            occupancyStatus: 'Available',
            operationalStatus: 'Active',
          }));
          await WardsRoomsBedsService.createBedsBatch(bedsToCreate, currentUser);
          showToast('success', `Room "${values.name}" updated and ${missingCount} bed(s) auto-generated.`);
        } else {
          showToast('success', `Room "${values.name}" updated successfully.`);
        }
      } else {
        const createdRoom = await WardsRoomsBedsService.createRoom(values, currentUser);

        // If autoGenerateBeds was selected on new room:
        if (values.autoGenerateBeds && values.capacity > 0) {
          const newBedNames = getNextBedNumbers([], values.capacity, 'Bed ');
          const bedsToCreate: BedFormValues[] = newBedNames.map((bName) => ({
            code: '',
            bedNumber: bName,
            roomId: createdRoom.id,
            wardId: '',
            bedType: 'Standard',
            occupancyStatus: 'Available',
            operationalStatus: 'Active',
          }));
          await WardsRoomsBedsService.createBedsBatch(bedsToCreate, currentUser);
          showToast('success', `Room "${values.name}" created with ${values.capacity} beds configured.`);
        } else {
          showToast('success', `Room "${values.name}" created successfully.`);
        }
      }
      setIsRoomModalOpen(false);
      setSelectedRoom(null);
      await loadData();
    } catch (err: any) {
      showToast('error', err.message || 'Failed to save room.');
    }
  };

  const handleToggleRoomStatus = async (r: Room) => {
    try {
      const nextStatus = r.status === 'Active' ? 'Inactive' : 'Active';
      await WardsRoomsBedsService.changeRoomStatus(r.id, nextStatus, currentUser);
      showToast('success', `Room "${r.name}" marked as ${nextStatus}.`);
      await loadData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleDeleteRoomPrompt = (r: Room) => {
    const hasHistory = (r.admissionLinkageCount ?? 0) > 0;

    if (hasHistory) {
      showToast(
        'warning',
        `Cannot delete Room "${r.name}": Contains historical admissions. Deactivate it instead.`
      );
      return;
    }
    setItemToDelete({ type: 'room', item: r });
  };

  // Bed CRUD
  const handleSaveBed = async (values: BedFormValues) => {
    try {
      // A Room is optional (Direct Ward Bed). When absent, the "scope" for
      // capacity/numbering purposes is the ward's own direct beds instead.
      const targetRoom = values.roomId ? rooms.find((r) => r.id === values.roomId) : undefined;
      const existingScopedBeds = values.roomId
        ? beds.filter((b) => b.roomId === values.roomId)
        : beds.filter((b) => b.wardId === values.wardId && !b.roomId);
      const scopeLabel = targetRoom ? `room "${targetRoom.name}"` : 'the ward';

      // Room has a fixed bed-capacity ceiling that auto-expands; a Ward has
      // no such ceiling, so this is a no-op when there's no target room.
      const maybeExpandRoomCapacity = async (newTotal: number) => {
        if (targetRoom && newTotal > targetRoom.capacity) {
          await WardsRoomsBedsService.updateRoom(targetRoom.id, { ...targetRoom, capacity: newTotal }, currentUser);
        }
      };

      if (selectedBed) {
        // 1. Update the existing bed
        await WardsRoomsBedsService.updateBed(selectedBed.id, values, currentUser);

        // 2. Check if user wanted to expand quantity with additional beds
        const addCount = values.additionalBeds || 0;
        if (addCount > 0) {
          const newBedNames = getNextBedNumbers(existingScopedBeds, addCount, 'Bed ');
          const bedsToCreate: BedFormValues[] = newBedNames.map((bName) => ({
            code: '',
            bedNumber: bName,
            roomId: values.roomId,
            wardId: values.wardId,
            bedType: values.bedType || 'Standard',
            occupancyStatus: 'Available',
            operationalStatus: 'Active',
          }));
          await WardsRoomsBedsService.createBedsBatch(bedsToCreate, currentUser);
          await maybeExpandRoomCapacity(existingScopedBeds.length + addCount);

          showToast(
            'success',
            `Bed "${values.bedNumber}" updated and ${addCount} additional bed(s) created successfully.`
          );
        } else {
          showToast('success', `Bed "${values.bedNumber}" updated successfully.`);
        }
      } else {
        // Adding new bed(s)
        const qty = values.quantity && values.quantity > 1 ? values.quantity : 1;

        if (qty === 1) {
          await WardsRoomsBedsService.createBed(values, currentUser);
          await maybeExpandRoomCapacity(existingScopedBeds.length + 1);
          showToast('success', `Bed "${values.bedNumber}" created successfully.`);
        } else {
          // Batch creation
          const prefix = values.numberingPrefix || 'Bed ';
          const newBedNames = getNextBedNumbers(existingScopedBeds, qty, prefix);
          const bedsToCreate: BedFormValues[] = newBedNames.map((bName) => ({
            code: '',
            bedNumber: bName,
            roomId: values.roomId,
            wardId: values.wardId,
            bedType: values.bedType || 'Standard',
            occupancyStatus: 'Available',
            operationalStatus: 'Active',
          }));

          await WardsRoomsBedsService.createBedsBatch(bedsToCreate, currentUser);
          await maybeExpandRoomCapacity(existingScopedBeds.length + qty);

          showToast('success', `${qty} beds created successfully for ${scopeLabel}.`);
        }
      }
      setIsBedModalOpen(false);
      setSelectedBed(null);
      await loadData();
    } catch (err: any) {
      showToast('error', err.message || 'Failed to save bed.');
    }
  };

  const handleToggleBedOperational = async (b: Bed) => {
    try {
      if (b.occupancyStatus === 'Occupied') {
        showToast('warning', 'Cannot change operational status: Bed is currently occupied.');
        return;
      }
      const nextStatus = b.operationalStatus === 'Active' ? 'Out of Service' : 'Active';
      await WardsRoomsBedsService.changeBedOperationalStatus(b.id, nextStatus, currentUser);
      showToast('success', `Bed "${b.bedNumber}" is now ${nextStatus}.`);
      await loadData();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleDeleteBedPrompt = (b: Bed) => {
    if (b.occupancyStatus === 'Occupied') {
      showToast('warning', `Cannot delete Bed "${b.bedNumber}": Currently occupied.`);
      return;
    }
    if ((b.historicalAdmissionCount ?? 0) > 0) {
      showToast(
        'warning',
        `Cannot delete Bed "${b.bedNumber}": Has historical patient admissions. Decommission instead.`
      );
      return;
    }
    setItemToDelete({ type: 'bed', item: b });
  };

  // Confirm delete
  const handleConfirmDelete = async () => {
    if (!itemToDelete) return;
    const { type, item } = itemToDelete;

    if (type === 'ward') {
      const res = await WardsRoomsBedsService.deleteWard(item.id);
      if (res.success) {
        showToast('success', `Ward "${item.name}" deleted.`);
      } else {
        showToast('error', res.message || 'Failed to delete ward.');
      }
    } else if (type === 'room') {
      const res = await WardsRoomsBedsService.deleteRoom(item.id);
      if (res.success) {
        showToast('success', `Room "${item.name}" deleted.`);
      } else {
        showToast('error', res.message || 'Failed to delete room.');
      }
    } else if (type === 'bed') {
      const res = await WardsRoomsBedsService.deleteBed(item.id);
      if (res.success) {
        showToast('success', `Bed "${item.bedNumber}" deleted.`);
      } else {
        showToast('error', res.message || 'Failed to delete bed.');
      }
    }

    setItemToDelete(null);
    await loadData();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading wards, rooms & beds…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-rose-500" />
        <p className="text-sm text-rose-700 font-medium">{loadError}</p>
        <button
          type="button"
          onClick={loadData}
          className="px-4 py-2 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-semibold rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div id="super-admin-wards-rooms-beds-view" className="p-6 max-w-7xl mx-auto">
      {/* Toast */}
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Inpatient Facility: Wards, Rooms & Beds
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              Capacity Master
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Hierarchical inpatient management, synchronized bed census, daily tariffs, and operational governance
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Quick PDF Download */}
          <button
            id="wrb-quick-pdf-btn"
            onClick={handleDirectDownloadPDF}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Download PDF
          </button>

          {/* Export Options */}
          <button
            id="wrb-export-menu-btn"
            onClick={() => setIsExportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Export Options...
          </button>

          {/* Import Excel */}
          <button
            id="wrb-import-excel-btn"
            onClick={() => setIsImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-xs transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            Import Excel
          </button>

          {/* Add item for current tab */}
          <button
            id="wrb-add-primary-btn"
            onClick={() => {
              if (activeTab === 'wards') {
                setSelectedWard(null);
                setIsWardModalOpen(true);
              } else if (activeTab === 'rooms') {
                setSelectedRoom(null);
                setIsRoomModalOpen(true);
              } else {
                setSelectedBed(null);
                setIsBedModalOpen(true);
              }
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            {activeTab === 'wards'
              ? 'Add Ward'
              : activeTab === 'rooms'
              ? 'Add Room'
              : 'Add Bed'}
          </button>
        </div>
      </div>

      {/* Top Reconciled Summary */}
      <WardsRoomsBedsTopSummary summary={summary} />

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-5">
        <button
          id="wrb-tab-wards"
          onClick={() => setActiveTab('wards')}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-colors ${
            activeTab === 'wards'
              ? 'border-[#08775A] text-[#08775A] bg-[#effaf5]/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          <span>Wards</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] ${
              activeTab === 'wards'
                ? 'bg-[#08775A] text-white'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {wards.length}
          </span>
        </button>

        <button
          id="wrb-tab-rooms"
          onClick={() => setActiveTab('rooms')}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-colors ${
            activeTab === 'rooms'
              ? 'border-[#08775A] text-[#08775A] bg-[#effaf5]/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Building className="w-4 h-4" />
          <span>Rooms</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] ${
              activeTab === 'rooms'
                ? 'bg-[#08775A] text-white'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {rooms.length}
          </span>
        </button>

        <button
          id="wrb-tab-beds"
          onClick={() => setActiveTab('beds')}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-colors ${
            activeTab === 'beds'
              ? 'border-[#08775A] text-[#08775A] bg-[#effaf5]/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BedIcon className="w-4 h-4" />
          <span>Beds</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] ${
              activeTab === 'beds'
                ? 'bg-[#08775A] text-white'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {beds.length}
          </span>
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'wards' && (
        <WardTab
          wards={wards}
          departments={departments}
          onAdd={() => {
            setSelectedWard(null);
            setIsWardModalOpen(true);
          }}
          onView={(w) => {
            setSelectedWard(w);
            setIsWardDetailOpen(true);
          }}
          onEdit={(w) => {
            setSelectedWard(w);
            setIsWardModalOpen(true);
          }}
          onToggleStatus={handleToggleWardStatus}
          onDelete={handleDeleteWardPrompt}
        />
      )}

      {activeTab === 'rooms' && (
        <RoomTab
          rooms={rooms}
          wards={wards}
          onAdd={() => {
            setSelectedRoom(null);
            setIsRoomModalOpen(true);
          }}
          onView={(r) => {
            setSelectedRoom(r);
            setIsRoomDetailOpen(true);
          }}
          onEdit={(r) => {
            setSelectedRoom(r);
            setIsRoomModalOpen(true);
          }}
          onToggleStatus={handleToggleRoomStatus}
          onDelete={handleDeleteRoomPrompt}
        />
      )}

      {activeTab === 'beds' && (
        <BedTab
          beds={beds}
          wards={wards}
          rooms={rooms}
          onAdd={() => {
            setSelectedBed(null);
            setIsBedModalOpen(true);
          }}
          onView={(b) => {
            setSelectedBed(b);
            setIsBedDetailOpen(true);
          }}
          onEdit={(b) => {
            setSelectedBed(b);
            setIsBedModalOpen(true);
          }}
          onToggleOperational={handleToggleBedOperational}
          onDelete={handleDeleteBedPrompt}
        />
      )}

      {/* Modals */}
      <WardModal
        isOpen={isWardModalOpen}
        onClose={() => {
          setIsWardModalOpen(false);
          setSelectedWard(null);
        }}
        onSave={handleSaveWard}
        ward={selectedWard}
        departments={departments}
        staffUsers={staffUsers}
        floors={floors}
      />

      <RoomModal
        isOpen={isRoomModalOpen}
        onClose={() => {
          setIsRoomModalOpen(false);
          setSelectedRoom(null);
        }}
        onSave={handleSaveRoom}
        room={selectedRoom}
        wards={wards}
        beds={beds}
      />

      <BedModal
        isOpen={isBedModalOpen}
        onClose={() => {
          setIsBedModalOpen(false);
          setSelectedBed(null);
        }}
        onSave={handleSaveBed}
        bed={selectedBed}
        wards={wards}
        rooms={rooms}
        beds={beds}
      />

      <WardDetailModal
        isOpen={isWardDetailOpen}
        onClose={() => {
          setIsWardDetailOpen(false);
          setSelectedWard(null);
        }}
        ward={selectedWard}
        rooms={rooms}
        onEdit={(w) => {
          setSelectedWard(w);
          setIsWardModalOpen(true);
        }}
        onToggleStatus={handleToggleWardStatus}
      />

      <RoomDetailModal
        isOpen={isRoomDetailOpen}
        onClose={() => {
          setIsRoomDetailOpen(false);
          setSelectedRoom(null);
        }}
        room={selectedRoom}
        beds={beds}
        onEdit={(r) => {
          setSelectedRoom(r);
          setIsRoomModalOpen(true);
        }}
        onToggleStatus={handleToggleRoomStatus}
      />

      <BedDetailModal
        isOpen={isBedDetailOpen}
        onClose={() => {
          setIsBedDetailOpen(false);
          setSelectedBed(null);
        }}
        bed={selectedBed}
        rooms={rooms}
        onEdit={(b) => {
          setSelectedBed(b);
          setIsBedModalOpen(true);
        }}
        onToggleOperational={handleToggleBedOperational}
      />

      <WardsRoomsBedsExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        activeTab={activeTab}
        wards={wards}
        rooms={rooms}
        beds={beds}
        currentUser={currentUser}
      />

      <WardsRoomsBedsImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        activeTab={activeTab}
        wards={wards}
        rooms={rooms}
        beds={beds}
        currentUser={currentUser}
        onImportComplete={(entity, count) => {
          setIsImportModalOpen(false);
          showToast('success', `Imported ${count} ${entity} records successfully.`);
          loadData();
        }}
      />

      {/* Delete Confirmation Modal */}
      {itemToDelete && (
        <div
          id="wrb-delete-confirm-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4"
        >
          <div className="bg-white max-w-md w-full rounded-2xl p-6 border border-slate-200 shadow-xl space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="text-center">
              <h3 className="text-base font-bold text-slate-800">
                Confirm {itemToDelete.type.toUpperCase()} Deletion
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Are you sure you want to permanently delete{' '}
                <strong className="text-slate-700">
                  {itemToDelete.item.code || itemToDelete.item.bedNumber} —{' '}
                  {itemToDelete.item.name || itemToDelete.item.bedNumber}
                </strong>
                ?
              </p>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              This action cannot be undone. Records with active or historical patient admissions cannot be deleted. Deleting a ward or room will also remove its unassigned child beds.
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setItemToDelete(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                id="wrb-confirm-delete-btn"
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs"
              >
                Delete Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
