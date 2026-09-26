import React, { useState, useEffect, useMemo } from 'react';
import {
  Building2,
  Plus,
  FileSpreadsheet,
  Download,
  Search,
  Filter,
  RefreshCw,
  Eye,
  Edit2,
  Power,
  Trash2,
  CheckCircle2,
  Activity,
  Stethoscope,
  FlaskConical,
  Layers,
  ChevronDown,
  Printer,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  FileDown,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import {
  Department,
  DepartmentFilterState,
  DepartmentFormValues,
  DepartmentHeadOption,
  DepartmentType,
  HospitalFloor,
} from '../../../types/department';
import {
  DepartmentService,
  VALID_DEPARTMENT_TYPES,
  fetchDepartments,
  isProtectedCoreDepartment,
} from '../../../services/departmentService';
import { FloorService } from '../../../services/floorService';
import { fetchStaffUsers } from '../../../services/staffUserService';
import { StaffUser } from '../../../types/staffUser';
import {
  downloadDepartmentPDF,
  downloadDepartmentExcel,
} from '../../../services/departmentExportService';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { toErrorMessage } from '../../../utils/apiErrors';
import { AddEditDepartmentModal } from './AddEditDepartmentModal';
import { ViewDepartmentDrawer } from './ViewDepartmentDrawer';
import { DeactivateConfirmModal } from './DeactivateConfirmModal';
import { DeleteSafeguardModal } from './DeleteSafeguardModal';
import { ImportDepartmentsModal } from './ImportDepartmentsModal';
import { ExportDepartmentDossierModal } from './ExportDepartmentDossierModal';

export const SuperAdminDepartmentsView: React.FC = () => {
  const { currentUser } = useAuth();
  const toast = useToast();

  // State: Departments master list — loaded from the real backend
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [floors, setFloors] = useState<HospitalFloor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDepartments = React.useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [deptData, staffData, floorsData] = await Promise.all([
        fetchDepartments(),
        fetchStaffUsers().catch(() => []),
        FloorService.fetchFloors().catch(() => []),
      ]);
      setDepartments(deptData);
      setStaffUsers(staffData);
      setFloors(floorsData);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load departments from the server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  // Real database staff options for Head / In-charge assignment (no mock data)
  const headOptions = useMemo<DepartmentHeadOption[]>(() => {
    return staffUsers
      .filter((s) => s.status === 'ACTIVE')
      .map((s) => ({
        userId: s.id, // Real Staff UUID from Postgres DB
        name: s.fullName,
        designation: s.designation || (s.staffCategory === 'Doctor' ? 'Consultant' : s.staffCategory),
        department: s.departmentName || 'General',
        role: s.staffCategory === 'Doctor' ? 'Doctor' : s.staffCategory === 'Other Staff' ? 'Admin' : 'Staff',
      }));
  }, [staffUsers]);

  // State: Filters
  const [filters, setFilters] = useState<DepartmentFilterState>({
    searchTerm: '',
    type: 'All',
    status: 'All',
    capability: 'All',
  });

  // State: Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // State: Modals
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [selectedDeptForEdit, setSelectedDeptForEdit] = useState<Department | null>(null);

  const [isViewDrawerOpen, setIsViewDrawerOpen] = useState(false);
  const [selectedDeptForView, setSelectedDeptForView] = useState<Department | null>(null);

  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [selectedDeptForDeactivate, setSelectedDeptForDeactivate] = useState<Department | null>(null);

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedDeptForDelete, setSelectedDeptForDelete] = useState<Department | null>(null);
  const [isDeletingDept, setIsDeletingDept] = useState(false);

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isExportDossierOpen, setIsExportDossierOpen] = useState(false);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  const [isColumnDropdownOpen, setIsColumnDropdownOpen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  // Column Visibility Controls
  const [visibleColumns, setVisibleColumns] = useState({
    code: true,
    name: true,
    type: true,
    floor: true,
    fixedPrice: true,
    head: true,
    access: true,
    doctors: true,
    staff: true,
    status: true,
    updatedBy: true,
    updatedDate: true,
    actions: true,
  });

  // KPI Calculations derived dynamically from the SAME department dataset
  const kpiTotal = departments.length;
  const kpiActive = departments.filter((d) => d.status === 'Active').length;
  const kpiClinical = departments.filter((d) => d.type === 'Clinical').length;
  const kpiDiagSupport = departments.filter(
    (d) => d.type === 'Diagnostic' || d.type === 'Support Service'
  ).length;

  // Filtered dataset
  const filteredDepartments = useMemo(() => {
    return departments.filter((dept) => {
      // Search
      if (filters.searchTerm.trim()) {
        const q = filters.searchTerm.toLowerCase().trim();
        const mCode = dept.code.toLowerCase().includes(q);
        const mName = dept.name.toLowerCase().includes(q);
        const mHead = dept.headName.toLowerCase().includes(q);
        if (!mCode && !mName && !mHead) return false;
      }

      // Type
      if (filters.type !== 'All' && dept.type !== filters.type) {
        return false;
      }

      // Status
      if (filters.status !== 'All' && dept.status !== filters.status) {
        return false;
      }

      // Operational Capability
      if (filters.capability !== 'All') {
        switch (filters.capability) {
          case 'OPD':
            if (!dept.opdEnabled) return false;
            break;
          case 'Observation':
            if (!dept.observationEnabled) return false;
            break;
          case 'Emergency':
            if (!dept.emergencyEnabled) return false;
            break;
          case 'Admission':
            if (!dept.admissionEnabled) return false;
            break;
          case 'Pharmacy Related':
            if (!dept.pharmacyRelated) return false;
            break;
          case 'None':
            if (
              dept.opdEnabled ||
              dept.observationEnabled ||
              dept.emergencyEnabled ||
              dept.admissionEnabled ||
              dept.pharmacyRelated
            ) {
              return false;
            }
            break;
        }
      }

      return true;
    });
  }, [departments, filters]);

  // Reset pagination if filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  // Paginated records
  const totalPages = Math.ceil(filteredDepartments.length / pageSize) || 1;
  const paginatedDepartments = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredDepartments.slice(startIndex, startIndex + pageSize);
  }, [filteredDepartments, currentPage, pageSize]);

  // Handlers
  const handleResetFilters = () => {
    setFilters({
      searchTerm: '',
      type: 'All',
      status: 'All',
      capability: 'All',
    });
    toast.info('Department filters reset to default view.', 'Filters Reset');
  };

  const handleSaveDepartment = async (values: DepartmentFormValues) => {
    try {
      if (selectedDeptForEdit) {
        // Edit Department
        const updated = await DepartmentService.updateDepartment(
          selectedDeptForEdit.id,
          values,
          currentUser,
          departments
        );
        setDepartments((prev) =>
          prev.map((d) => (d.id === selectedDeptForEdit.id ? updated : d))
        );
        toast.success(
          `Department "${updated.name}" (${updated.code}) updated successfully.`,
          'Department Updated'
        );
      } else {
        // Add Department
        const created = await DepartmentService.createDepartment(
          values,
          currentUser,
          departments
        );
        setDepartments((prev) => [created, ...prev]);
        toast.success(
          `Department "${created.name}" (${created.code}) created successfully.`,
          'Department Added'
        );
      }
      setIsAddEditOpen(false);
      setSelectedDeptForEdit(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save department.');
    }
  };

  const handleToggleStatus = async () => {
    if (!selectedDeptForDeactivate) return;
    try {
      const nextStatus =
        selectedDeptForDeactivate.status === 'Active' ? 'Inactive' : 'Active';
      const updated = await DepartmentService.updateDepartmentStatus(
        selectedDeptForDeactivate.id,
        nextStatus,
        currentUser,
        departments
      );
      setDepartments((prev) =>
        prev.map((d) => (d.id === selectedDeptForDeactivate.id ? updated : d))
      );
      toast.success(
        `Department "${updated.name}" is now ${nextStatus}.`,
        'Status Changed'
      );
      setIsDeactivateOpen(false);
      setSelectedDeptForDeactivate(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update department status.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedDeptForDelete) return;
    if (isProtectedCoreDepartment(selectedDeptForDelete)) {
      toast.error(`Core hospital care department "${selectedDeptForDelete.name}" (${selectedDeptForDelete.code}) is protected and cannot be deleted.`);
      setIsDeleteOpen(false);
      setSelectedDeptForDelete(null);
      return;
    }
    try {
      setIsDeletingDept(true);
      await DepartmentService.deleteDepartment(selectedDeptForDelete.id, departments);
      setDepartments((prev) =>
        prev.filter((d) => d.id !== selectedDeptForDelete.id)
      );
      toast.success(
        `Department "${selectedDeptForDelete.name}" permanently deleted.`,
        'Department Deleted'
      );
      setIsDeleteOpen(false);
      setSelectedDeptForDelete(null);
    } catch (err: any) {
      toast.error(toErrorMessage(err));
    } finally {
      setIsDeletingDept(false);
    }
  };

  const handleImportBatch = (importedDepts: Department[]) => {
    setDepartments((prev) => [...importedDepts, ...prev]);
    toast.success(
      `Successfully imported ${importedDepts.length} department(s) into the directory.`,
      'Import Complete'
    );
  };

  const handleDownloadPDF = async () => {
    try {
      setIsExportingPdf(true);
      await downloadDepartmentPDF(filteredDepartments, filters, currentUser);
      toast.success('Department PDF downloaded successfully.', 'Export Complete');
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      toast.error('Unable to generate export. Please try again.', 'Export Failed');
    } finally {
      setIsExportingPdf(false);
      setIsExportDropdownOpen(false);
    }
  };

  const handleDownloadExcel = async () => {
    try {
      setIsExportingExcel(true);
      await downloadDepartmentExcel(filteredDepartments, filters, currentUser);
      toast.success('Department Excel file downloaded successfully.', 'Export Complete');
    } catch (err) {
      console.error('Failed to generate Excel:', err);
      toast.error('Unable to generate export. Please try again.', 'Export Failed');
    } finally {
      setIsExportingExcel(false);
      setIsExportDropdownOpen(false);
    }
  };

  const handlePrint = () => {
    setIsExportDropdownOpen(false);
    setIsExportDossierOpen(true);
    setTimeout(() => {
      window.print();
    }, 150);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading departments…</span>
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
          onClick={loadDepartments}
          className="px-4 py-2 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-semibold rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#08775A]">
            <Building2 className="h-4 w-4" />
            <span>Master Registry</span>
          </div>
          <h2 className="text-xl font-black tracking-tight text-slate-900 mt-1">
            Hospital Departments
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Manage hospital departments, department heads, operational capabilities, staffing links and status.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Export Dropdown Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
              disabled={isExportingPdf || isExportingExcel}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-60"
            >
              {isExportingPdf || isExportingExcel ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#08775A]" />
              ) : (
                <Download className="h-3.5 w-3.5 text-slate-500" />
              )}
              <span>
                {isExportingPdf
                  ? 'Downloading PDF...'
                  : isExportingExcel
                  ? 'Downloading Excel...'
                  : 'Export'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>

            {isExportDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-20 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in duration-100">
                {/* 1. Download PDF */}
                <button
                  type="button"
                  onClick={handleDownloadPDF}
                  disabled={isExportingPdf}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-[#effaf5] hover:text-[#08775A] transition-colors cursor-pointer"
                >
                  <FileDown className="h-4 w-4 text-[#08775A]" />
                  <div className="flex-1">
                    <span className="font-semibold block text-slate-800">Download PDF</span>
                    <span className="text-[10px] text-slate-400">Direct .pdf document</span>
                  </div>
                </button>

                {/* 2. Download Excel */}
                <button
                  type="button"
                  onClick={handleDownloadExcel}
                  disabled={isExportingExcel}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-[#effaf5] hover:text-[#08775A] transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  <div className="flex-1">
                    <span className="font-semibold block text-slate-800">Download Excel</span>
                    <span className="text-[10px] text-slate-400">Direct .xlsx workbook</span>
                  </div>
                </button>

                <div className="my-1 border-t border-slate-100" />

                {/* 3. Print */}
                <button
                  type="button"
                  onClick={handlePrint}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-[#effaf5] hover:text-[#08775A] transition-colors cursor-pointer"
                >
                  <Printer className="h-4 w-4 text-slate-600" />
                  <div className="flex-1">
                    <span className="font-semibold block text-slate-800">Print</span>
                    <span className="text-[10px] text-slate-400">Browser print dialog</span>
                  </div>
                </button>

                {/* Optional Preview Dossier */}
                <button
                  type="button"
                  onClick={() => {
                    setIsExportDropdownOpen(false);
                    setIsExportDossierOpen(true);
                  }}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  <Eye className="h-4 w-4 text-slate-400" />
                  <div className="flex-1">
                    <span className="block">Preview Dossier</span>
                    <span className="text-[10px] text-slate-400">Visual report preview</span>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Import Excel */}
          <button
            type="button"
            onClick={() => setIsImportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-slate-500" />
            <span>Import Excel</span>
          </button>

          {/* Add Department Button */}
          <button
            type="button"
            onClick={() => {
              setSelectedDeptForEdit(null);
              setIsAddEditOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#08775A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0e7d5a] transition-colors shadow-xs"
          >
            <Plus className="h-4 w-4" />
            <span>Add Department</span>
          </button>
        </div>
      </div>

      {/* 2. KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Departments */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Total Departments
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{kpiTotal}</span>
            <span className="text-[11px] text-slate-500 font-medium">Registered units</span>
          </div>
        </div>

        {/* Active Departments */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#08775A]">
              Active Departments
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#effaf5] text-[#08775A]">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[#08775A]">{kpiActive}</span>
            <span className="text-[11px] text-slate-500 font-medium">
              of {kpiTotal} operating
            </span>
          </div>
        </div>

        {/* Clinical Departments */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Clinical Departments
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <Stethoscope className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{kpiClinical}</span>
            <span className="text-[11px] text-slate-500 font-medium">Patient care &amp; OPD</span>
          </div>
        </div>

        {/* Diagnostic / Support Departments */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Diagnostic / Support
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-[#08775A]">
              <FlaskConical className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{kpiDiagSupport}</span>
            <span className="text-[11px] text-slate-500 font-medium">Labs, Imaging, Support</span>
          </div>
        </div>
      </div>

      {/* 3. Search and Filters Control Bar (Strictly No From/To Date filter for Master Registry!) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Search Input */}
          <div className="relative md:col-span-4">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={filters.searchTerm}
              onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
              placeholder="Search departments..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 bg-white placeholder:text-slate-400 focus:border-[#08775A] focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20 transition-colors"
            />
          </div>

          {/* Department Type Filter */}
          <div className="md:col-span-3">
            <select
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              className="w-full py-2 px-3 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:border-[#08775A] focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20"
            >
              <option value="All">All Department Types</option>
              {VALID_DEPARTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="md:col-span-2">
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="w-full py-2 px-3 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:border-[#08775A] focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20"
            >
              <option value="All">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          {/* Operational Capability Filter */}
          <div className="md:col-span-2">
            <select
              value={filters.capability}
              onChange={(e) => setFilters({ ...filters, capability: e.target.value })}
              className="w-full py-2 px-3 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:border-[#08775A] focus:outline-hidden focus:ring-2 focus:ring-[#08775A]/20"
            >
              <option value="All">All Capabilities</option>
              <option value="OPD">OPD Enabled</option>
              <option value="Observation">Observation</option>
              <option value="Emergency">Emergency Enabled</option>
              <option value="Admission">Admission Enabled</option>
              <option value="Pharmacy Related">Pharmacy Related</option>
              <option value="None">Administrative / Support Only</option>
            </select>
          </div>

          {/* Reset Filters */}
          <div className="md:col-span-1 flex items-center justify-end">
            <button
              type="button"
              onClick={handleResetFilters}
              title="Reset all filters"
              className="inline-flex items-center justify-center p-2 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 transition-colors shadow-2xs w-full"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Table View Toolbar */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
          <div>
            Showing <span className="font-bold text-slate-800">{filteredDepartments.length}</span> departments
            {filters.searchTerm || filters.type !== 'All' || filters.status !== 'All' || filters.capability !== 'All' ? (
              <span className="text-[#08775A] ml-1 font-medium">(Filtered)</span>
            ) : null}
          </div>

          {/* Columns Visibility Selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsColumnDropdownOpen(!isColumnDropdownOpen)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Customize Columns</span>
            </button>

            {isColumnDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-20 w-52 rounded-xl border border-slate-200 bg-white p-3 shadow-xl space-y-1.5 text-xs">
                <span className="font-bold text-slate-800 text-[11px] block mb-1">
                  Visible Table Columns
                </span>
                {Object.entries(visibleColumns).map(([colKey, isVisible]) => (
                  <label
                    key={colKey}
                    className="flex items-center gap-2 cursor-pointer text-slate-700 hover:text-[#08775A] select-none"
                  >
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={(e) =>
                        setVisibleColumns({
                          ...visibleColumns,
                          [colKey]: e.target.checked,
                        })
                      }
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[#08775A] focus:ring-[#08775A]"
                    />
                    <span className="capitalize">{colKey.replace(/([A-Z])/g, ' $1')}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. Master Departments Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#effaf5] text-[11px] font-bold text-[#08775A] border-b border-[#c2e7db]">
              <tr>
                {visibleColumns.code && <th className="py-3 px-4">Code</th>}
                {visibleColumns.name && <th className="py-3 px-4">Department Name</th>}
                {visibleColumns.type && <th className="py-3 px-3">Type</th>}
                {visibleColumns.floor && <th className="py-3 px-3">Location / Floor</th>}
                {visibleColumns.fixedPrice && <th className="py-3 px-3">Fixed Price (PKR)</th>}
                {visibleColumns.head && <th className="py-3 px-4">Head / In-charge</th>}
                {visibleColumns.access && <th className="py-3 px-3">Operational Access</th>}
                {visibleColumns.doctors && <th className="py-3 px-3 text-center">Doctors</th>}
                {visibleColumns.staff && <th className="py-3 px-3 text-center">Staff</th>}
                {visibleColumns.status && <th className="py-3 px-3 text-center">Status</th>}
                {visibleColumns.updatedBy && <th className="py-3 px-3">Updated By</th>}
                {visibleColumns.updatedDate && <th className="py-3 px-3">Updated Date</th>}
                {visibleColumns.actions && <th className="py-3 px-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px]">
              {paginatedDepartments.map((dept) => (
                <tr
                  key={dept.id}
                  className="hover:bg-slate-50/70 transition-colors group"
                >
                  {/* Code */}
                  {visibleColumns.code && (
                    <td className="py-3 px-4 font-mono font-bold text-[#08775A]">
                      {dept.code}
                    </td>
                  )}

                  {/* Name */}
                  {visibleColumns.name && (
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{dept.name}</div>
                      <div className="text-[10px] text-slate-500 line-clamp-1 max-w-xs">
                        {dept.location}
                      </div>
                    </td>
                  )}

                  {/* Type badge (Mint/Neutral badge - strictly NO rainbow styling) */}
                  {visibleColumns.type && (
                    <td className="py-3 px-3">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                        {dept.type}
                      </span>
                    </td>
                  )}

                  {/* Floor / Location */}
                  {visibleColumns.floor && (
                    <td className="py-3 px-3 text-slate-700">
                      {dept.floor ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          {dept.floor}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px] italic">Not Set</span>
                      )}
                    </td>
                  )}

                  {/* Fixed Price (PKR) */}
                  {visibleColumns.fixedPrice && (
                    <td className="py-3 px-3 font-semibold text-slate-800">
                      {dept.fixedPrice !== undefined && dept.fixedPrice !== null ? (
                        <span className="text-emerald-700 font-mono font-bold">
                          PKR {Number(dept.fixedPrice).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-normal text-[10px] italic">
                          Optional / Free
                        </span>
                      )}
                    </td>
                  )}

                  {/* Head / In-charge */}
                  {visibleColumns.head && (
                    <td className="py-3 px-4">
                      {dept.headName === 'Not Assigned' ? (
                        <span className="text-slate-400 italic">Not Assigned</span>
                      ) : (
                        <span className="font-medium text-slate-800">{dept.headName}</span>
                      )}
                    </td>
                  )}

                  {/* Operational Access compact tags */}
                  {visibleColumns.access && (
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1 flex-wrap max-w-xs">
                        {dept.opdEnabled && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                            OPD
                          </span>
                        )}
                        {dept.observationEnabled && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                            OBS
                          </span>
                        )}
                        {dept.emergencyEnabled && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            ER
                          </span>
                        )}
                        {dept.admissionEnabled && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                            Admission
                          </span>
                        )}
                        {dept.pharmacyRelated && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                            Pharmacy
                          </span>
                        )}
                        {!dept.opdEnabled &&
                          !dept.observationEnabled &&
                          !dept.emergencyEnabled &&
                          !dept.admissionEnabled &&
                          !dept.pharmacyRelated && (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                      </div>
                    </td>
                  )}

                  {/* Doctors */}
                  {visibleColumns.doctors && (
                    <td className="py-3 px-3 text-center font-bold text-slate-800">
                      {dept.doctorCount} <span className="font-normal text-slate-400 text-[10px]">Doctors</span>
                    </td>
                  )}

                  {/* Staff */}
                  {visibleColumns.staff && (
                    <td className="py-3 px-3 text-center font-bold text-slate-800">
                      {dept.staffCount} <span className="font-normal text-slate-400 text-[10px]">Staff</span>
                    </td>
                  )}

                  {/* Status */}
                  {visibleColumns.status && (
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          dept.status === 'Active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {dept.status}
                      </span>
                    </td>
                  )}

                  {/* Updated By (Actual logged-in user name/role) */}
                  {visibleColumns.updatedBy && (
                    <td className="py-3 px-3 text-slate-700 font-medium max-w-[150px] truncate" title={dept.updatedBy}>
                      {dept.updatedBy}
                    </td>
                  )}

                  {/* Updated Date */}
                  {visibleColumns.updatedDate && (
                    <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                      {dept.updatedAt.split(',')[0]}
                    </td>
                  )}

                  {/* Actions */}
                  {visibleColumns.actions && (
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {/* View Button */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDeptForView(dept);
                            setIsViewDrawerOpen(true);
                          }}
                          title="View Department Details"
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>

                        {/* Edit Button */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDeptForEdit(dept);
                            setIsAddEditOpen(true);
                          }}
                          title="Edit Department"
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-[#effaf5] hover:text-[#08775A] transition-colors"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>

                        {/* Activate / Deactivate Toggle */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDeptForDeactivate(dept);
                            setIsDeactivateOpen(true);
                          }}
                          title={dept.status === 'Active' ? 'Deactivate Department' : 'Activate Department'}
                          className={`rounded-lg p-1.5 transition-colors ${
                            dept.status === 'Active'
                              ? 'text-slate-400 hover:bg-amber-50 hover:text-amber-700'
                              : 'text-[#08775A] hover:bg-emerald-50'
                          }`}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>

                        {/* Delete Button (Protected for OPD, ER, OBS; Guarded by Linked Records for others) */}
                        {isProtectedCoreDepartment(dept) ? (
                          <span
                            title="Protected Core Care Department (OPD, Emergency, Observation cannot be deleted)"
                            className="rounded-lg p-1.5 text-slate-300 cursor-not-allowed inline-flex items-center justify-center opacity-60"
                          >
                            <ShieldAlert className="h-3.5 w-3.5 text-slate-400" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDeptForDelete(dept);
                              setIsDeleteOpen(true);
                            }}
                            title="Delete Department (Checked for linked records)"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}

              {paginatedDepartments.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-500">
                    <Building2 className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    <span className="font-semibold text-xs text-slate-700 block">
                      No departments match your current search and filter criteria.
                    </span>
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="mt-2 text-xs font-semibold text-[#08775A] hover:underline"
                    >
                      Reset All Filters
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Pagination */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span className="ml-2">
              Showing {(currentPage - 1) * pageSize + 1}–
              {Math.min(currentPage * pageSize, filteredDepartments.length)} of {filteredDepartments.length}
            </span>
          </div>

          <div className="flex items-center gap-1 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 font-medium">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 5. Modals & Drawers */}
      {/* Add / Edit Modal */}
      <AddEditDepartmentModal
        isOpen={isAddEditOpen}
        onClose={() => {
          setIsAddEditOpen(false);
          setSelectedDeptForEdit(null);
        }}
        onSave={handleSaveDepartment}
        departmentToEdit={selectedDeptForEdit}
        existingDepartments={departments}
        headOptions={headOptions}
        floors={floors}
      />

      {/* View Detail Drawer */}
      <ViewDepartmentDrawer
        isOpen={isViewDrawerOpen}
        onClose={() => {
          setIsViewDrawerOpen(false);
          setSelectedDeptForView(null);
        }}
        department={selectedDeptForView}
        onEdit={(dept) => {
          setSelectedDeptForEdit(dept);
          setIsAddEditOpen(true);
        }}
      />

      {/* Deactivate / Activate Confirmation Modal */}
      <DeactivateConfirmModal
        isOpen={isDeactivateOpen}
        onClose={() => {
          setIsDeactivateOpen(false);
          setSelectedDeptForDeactivate(null);
        }}
        onConfirm={handleToggleStatus}
        department={selectedDeptForDeactivate}
      />

      {/* Delete Confirmation Modal */}
      <DeleteSafeguardModal
        isOpen={isDeleteOpen}
        isDeleting={isDeletingDept}
        onClose={() => {
          if (!isDeletingDept) {
            setIsDeleteOpen(false);
            setSelectedDeptForDelete(null);
          }
        }}
        onConfirmDelete={handleConfirmDelete}
        onDeactivateInstead={() => {
          if (selectedDeptForDelete) {
            setSelectedDeptForDeactivate(selectedDeptForDelete);
            setIsDeleteOpen(false);
            setIsDeactivateOpen(true);
          }
        }}
        department={selectedDeptForDelete}
      />

      {/* Import Excel Modal */}
      <ImportDepartmentsModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportSuccess={handleImportBatch}
        existingDepartments={departments}
        headOptions={headOptions}
      />

      {/* Export Dossier / Print Preview Modal */}
      <ExportDepartmentDossierModal
        isOpen={isExportDossierOpen}
        onClose={() => setIsExportDossierOpen(false)}
        departments={filteredDepartments}
        filters={filters}
        currentUser={currentUser}
      />
    </div>
  );
};
