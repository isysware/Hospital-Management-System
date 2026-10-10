import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus,
  Download,
  Printer,
  FileSpreadsheet,
  FileText,
  Clock,
  ChevronDown,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { Shift, ShiftFilterState, ShiftFormData } from '../../../types/shift';
import { Department } from '../../../types/department';
import { DepartmentService } from '../../../services/departmentService';
import { ShiftService, fetchShifts } from '../../../services/shiftService';
import {
  downloadShiftsPDF,
  downloadShiftsExcel,
  printShifts,
} from '../../../services/shiftExportService';
import { ShiftKPIBar } from './ShiftKPIBar';
import { ShiftFilterBar } from './ShiftFilterBar';
import { ShiftTable } from './ShiftTable';
import { ShiftModal } from './ShiftModal';
import { ShiftDetailModal } from './ShiftDetailModal';
import { ShiftStatusModal } from './ShiftStatusModal';

export const ShiftManagementView: React.FC = () => {
  const { currentUser } = useAuth();
  const toast = useToast();

  // Dataset State
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);

  // Filters State
  const initialFilters: ShiftFilterState = {
    searchTerm: '',
    departmentId: 'ALL',
    shiftType: 'ALL',
    schedule: 'ALL',
    status: 'ALL',
  };
  const [filters, setFilters] = useState<ShiftFilterState>(initialFilters);

  // Modal States
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [formModalShift, setFormModalShift] = useState<Shift | null>(null);
  const [isDuplicateMode, setIsDuplicateMode] = useState(false);

  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedShiftForDetail, setSelectedShiftForDetail] = useState<Shift | null>(null);

  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [shiftForStatusChange, setShiftForStatusChange] = useState<Shift | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load initial dataset & departments
  const refreshShifts = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const loaded = await fetchShifts();
      setShifts(loaded);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load shifts from the server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshShifts();
    const depts = DepartmentService.getDepartments();
    setDepartments(depts);
  }, [refreshShifts]);

  // KPIs across entire shift dataset
  const kpis = useMemo(() => {
    return ShiftService.getKPIs(shifts);
  }, [shifts]);

  // Filtered shifts
  const filteredShifts = useMemo(() => {
    return ShiftService.getShifts(filters);
  }, [shifts, filters]);

  // Open Add Modal
  const handleOpenAdd = () => {
    setFormModalShift(null);
    setIsDuplicateMode(false);
    setIsFormModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (shift: Shift) => {
    setFormModalShift(shift);
    setIsDuplicateMode(false);
    setIsFormModalOpen(true);
  };

  // Open Duplicate Modal
  const handleOpenDuplicate = (shift: Shift) => {
    setFormModalShift(shift);
    setIsDuplicateMode(true);
    setIsFormModalOpen(true);
  };

  // Open Detail View Modal
  const handleOpenView = (shift: Shift) => {
    setSelectedShiftForDetail(shift);
    setIsDetailModalOpen(true);
  };

  // Open Status Confirmation Modal
  const handleOpenStatusToggle = (shift: Shift) => {
    setShiftForStatusChange(shift);
    setIsStatusModalOpen(true);
  };

  // Save Shift (Create or Update or Duplicate)
  const handleSaveShift = async (formData: ShiftFormData) => {
    try {
      if (isDuplicateMode || !formModalShift) {
        // Create new shift record
        const created = await ShiftService.createShift(formData, currentUser);
        toast.success(
          `Shift "${created.name}" (${created.code}) created successfully.`,
          'Shift Created'
        );
      } else {
        // Update existing shift record
        const updated = await ShiftService.updateShift(
          formModalShift.id,
          formData,
          currentUser
        );
        toast.success(
          `Shift "${updated.name}" (${updated.code}) updated successfully.`,
          'Shift Updated'
        );
      }
      setIsFormModalOpen(false);
      await refreshShifts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save shift';
      toast.error(message, 'Validation Error');
    }
  };

  // Confirm Status Toggle
  const handleConfirmStatusToggle = async () => {
    if (!shiftForStatusChange) return;

    try {
      const updated = await ShiftService.toggleShiftStatus(
        shiftForStatusChange.id,
        currentUser
      );
      toast.success(
        `Shift "${updated.name}" is now ${updated.status === 'ACTIVE' ? 'Active' : 'Inactive'}.`,
        updated.status === 'ACTIVE' ? 'Shift Activated' : 'Shift Deactivated'
      );
      setIsStatusModalOpen(false);
      setShiftForStatusChange(null);
      refreshShifts();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to modify shift status';
      toast.error(message, 'Status Update Failed');
    }
  };

  // Exports
  const handleExportPDF = async () => {
    setExportDropdownOpen(false);
    try {
      await downloadShiftsPDF(filteredShifts, filters, currentUser);
      toast.success('Shift Master PDF document generated successfully.', 'Export Complete');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'PDF export failed';
      toast.error(message, 'Export Error');
    }
  };

  const handleExportExcel = () => {
    setExportDropdownOpen(false);
    try {
      downloadShiftsExcel(filteredShifts, filters, currentUser);
      toast.success('Shift Master Excel workbook downloaded successfully.', 'Export Complete');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Excel export failed';
      toast.error(message, 'Export Error');
    }
  };

  const handlePrint = () => {
    try {
      printShifts(filteredShifts, filters, currentUser);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Print preview failed';
      toast.error(message, 'Print Error');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading shifts…</span>
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
          onClick={refreshShifts}
          className="px-4 py-2 bg-[#149E75] hover:bg-[#08775A] text-white text-xs font-semibold rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 1. Section 4.1 Card Page Header Block */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center shadow-2xs">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#123e2b] tracking-tight">
                  Shift Management
                </h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#08775A] animate-pulse" />
                  24/7 Operations
                </span>
              </div>
              <p className="text-xs text-[#52665e] mt-0.5">
                Configure department-wise reusable duty shifts, arrival grace periods, and weekly rotas
              </p>
            </div>
          </div>

          {/* Action Header Buttons */}
          <div className="flex items-center flex-wrap gap-2">
            {/* Export Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#52665e] hover:text-[#111827] bg-white border border-[#e2eae5] hover:bg-[#f6f8f7] rounded-lg transition-colors cursor-pointer shadow-2xs"
              >
                <Download className="h-3.5 w-3.5 text-[#08775A]" />
                <span>Export</span>
                <ChevronDown className="h-3 w-3 text-[#52665e]" />
              </button>

              {exportDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setExportDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-1.5 w-48 bg-white border border-[#e2eae5] rounded-xl shadow-lg z-30 py-1 text-xs">
                    <button
                      type="button"
                      onClick={handleExportPDF}
                      className="w-full text-left px-3 py-2 hover:bg-[#effaf5] flex items-center gap-2 text-slate-700 font-medium cursor-pointer"
                    >
                      <FileText className="h-4 w-4 text-rose-600" />
                      <span>Download PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportExcel}
                      className="w-full text-left px-3 py-2 hover:bg-[#effaf5] flex items-center gap-2 text-slate-700 font-medium cursor-pointer"
                    >
                      <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                      <span>Download Excel</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Print Button */}
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#52665e] hover:text-[#111827] bg-white border border-[#e2eae5] hover:bg-[#f6f8f7] rounded-lg transition-colors cursor-pointer shadow-2xs"
              title="Print Shift Directory"
            >
              <Printer className="h-3.5 w-3.5 text-[#08775A]" />
              <span className="hidden sm:inline">Print</span>
            </button>

            {/* Add Shift Button */}
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg transition-colors cursor-pointer shadow-2xs"
            >
              <Plus className="h-4 w-4" />
              <span>Add Shift</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. KPI Bar */}
      <ShiftKPIBar kpis={kpis} />

      {/* 3. Filter Bar */}
      <ShiftFilterBar
        filters={filters}
        onFilterChange={setFilters}
        onReset={() => setFilters(initialFilters)}
        departments={departments}
        totalCount={shifts.length}
        filteredCount={filteredShifts.length}
      />

      {/* 4. Shift Master Table */}
      <ShiftTable
        shifts={filteredShifts}
        totalCount={shifts.length}
        onView={handleOpenView}
        onEdit={handleOpenEdit}
        onDuplicate={handleOpenDuplicate}
        onToggleStatus={handleOpenStatusToggle}
        onAddNew={handleOpenAdd}
        onClearFilters={() => setFilters(initialFilters)}
        onExportExcel={handleExportExcel}
        onExportPDF={handleExportPDF}
        onPrint={handlePrint}
      />

      {/* 5. Add / Edit / Duplicate Modal */}
      <ShiftModal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        onSave={handleSaveShift}
        initialShift={formModalShift}
        isDuplicate={isDuplicateMode}
        departments={departments}
        shifts={shifts}
      />

      {/* 6. Read-Only Shift Detail Modal */}
      <ShiftDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        shift={selectedShiftForDetail}
      />

      {/* 7. Status Deactivate / Reactivate Modal */}
      <ShiftStatusModal
        isOpen={isStatusModalOpen}
        onClose={() => {
          setIsStatusModalOpen(false);
          setShiftForStatusChange(null);
        }}
        onConfirm={handleConfirmStatusToggle}
        shift={shiftForStatusChange}
      />
    </div>
  );
};
