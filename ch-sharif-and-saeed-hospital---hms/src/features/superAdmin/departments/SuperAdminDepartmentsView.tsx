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
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';
import { StatusBadge } from '../../../components/common/StatusBadge';
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

  const deptKpiItems: KpiItem[] = useMemo(
    () => [
      {
        category: 'TOTAL DEPARTMENTS',
        title: 'Total Units',
        value: kpiTotal,
        icon: Layers,
        subtitle: 'Registered departments',
        tone: 'default',
      },
      {
        category: 'ACTIVE OPERATING',
        title: 'Active Departments',
        value: kpiActive,
        icon: CheckCircle2,
        subtitle: `of ${kpiTotal} operating`,
        tone: 'success',
      },
      {
        category: 'CLINICAL CARE',
        title: 'Clinical Departments',
        value: kpiClinical,
        icon: Stethoscope,
        subtitle: 'Patient care & OPD',
        tone: 'info',
      },
      {
        category: 'DIAGNOSTIC & SUPPORT',
        title: 'Diagnostic / Support',
        value: kpiDiagSupport,
        icon: FlaskConical,
        subtitle: 'Labs, imaging & support',
        tone: 'default',
      },
    ],
    [kpiTotal, kpiActive, kpiClinical, kpiDiagSupport],
  );

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
      toast.error(`Default Pharmacy department "${selectedDeptForDelete.name}" (${selectedDeptForDelete.code}) is protected and cannot be deleted.`);
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
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* 1. Page Header Block (design.md §4.1) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-[#111827]">Hospital Departments</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db] inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#129b70]" />
              Clinical &amp; Administrative Units
            </span>
          </div>
          <p className="text-xs text-[#52665e] max-w-2xl leading-relaxed">
            Manage hospital departments, clinical care units, department heads, operational capabilities, and tariff linkages.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap self-start md:self-auto">
          {/* Export Dropdown Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
              disabled={isExportingPdf || isExportingExcel}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer disabled:opacity-60"
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
                  : 'Export Dossier'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>

            {isExportDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-20 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in duration-100">
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

                <button
                  type="button"
                  onClick={handlePrint}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-[#effaf5] hover:text-[#08775A] transition-colors cursor-pointer"
                >
                  <Printer className="h-4 w-4 text-slate-600" />
                  <div className="flex-1">
                    <span className="font-semibold block text-slate-800">Print Catalog</span>
                    <span className="text-[10px] text-slate-400">Browser print preview</span>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Import Excel */}
          <button
            type="button"
            onClick={() => setIsImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>Import Excel</span>
          </button>

          {/* Add Department Button */}
          <button
            type="button"
            onClick={() => {
              setSelectedDeptForEdit(null);
              setIsAddEditOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#129b70] hover:bg-[#0e7d5a] text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Add Department</span>
          </button>
        </div>
      </div>

      {/* 2. KPI Summary Cards (design.md §4.2) */}
      <HospitalKpiHeader items={deptKpiItems} columns="grid-cols-2 lg:grid-cols-4" />

      {/* 3. Search and Filters Control Bar (design.md §4.4) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Search Input */}
          <div className="relative md:col-span-4">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#8b9e95]" />
            <input
              type="text"
              value={filters.searchTerm}
              onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
              placeholder="Search by code, name, or in-charge..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-[#c2e7db] bg-white placeholder:text-[#8b9e95] focus:border-[#08775A] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 transition-colors"
            />
          </div>

          {/* Department Type Filter */}
          <div className="md:col-span-3">
            <select
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              className="w-full py-2 px-3 text-xs rounded-lg border border-[#c2e7db] bg-white text-[#111827] font-medium focus:border-[#08775A] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 cursor-pointer"
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
              className="w-full py-2 px-3 text-xs rounded-lg border border-[#c2e7db] bg-white text-[#111827] font-medium focus:border-[#08775A] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 cursor-pointer"
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
              className="w-full py-2 px-3 text-xs rounded-lg border border-[#c2e7db] bg-white text-[#111827] font-medium focus:border-[#08775A] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 cursor-pointer"
            >
              <option value="All">All Capabilities</option>
              <option value="OPD">OPD Enabled</option>
              <option value="Observation">Observation</option>
              <option value="Emergency">Emergency</option>
              <option value="Admission">Admission</option>
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
              className="inline-flex items-center justify-center p-2 rounded-lg border border-[#e2eae5] text-rose-600 hover:text-rose-800 hover:bg-rose-50 transition-colors shadow-2xs w-full cursor-pointer"
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
              <span className="text-[#08775A] ml-1 font-semibold">(Filtered)</span>
            ) : null}
          </div>

          {/* Columns Visibility Selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsColumnDropdownOpen(!isColumnDropdownOpen)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
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

      {/* 4. Master Departments Table (design.md §4.5) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] overflow-hidden shadow-2xs flex flex-col">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[13px] font-bold text-white tracking-wide">Department Directory</h2>
            <span className="bg-[#08775A] text-white px-2 py-0.5 rounded-full text-[11px] font-semibold border border-white/10 font-mono">
              {filteredDepartments.length} {filteredDepartments.length === 1 ? 'Record' : 'Records'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadExcel}
              disabled={isExportingExcel}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#16a34a] hover:bg-[#15803d] text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              title="Export as Excel"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPDF}
              disabled={isExportingPdf}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              title="Export as PDF"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>PDF</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer"
              title="Print Dossier"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print</span>
            </button>
          </div>
        </div>

        {/* Sub-header row */}
        <div className="bg-[#f6faf8] border-b border-[#e2eae5] px-4 py-2 flex items-center justify-between text-xs text-[#52665e]">
          <div>
            Showing <span className="font-semibold text-[#111827]">{(currentPage - 1) * pageSize + 1}</span>–
            <span className="font-semibold text-[#111827]">{Math.min(currentPage * pageSize, filteredDepartments.length)}</span> of{' '}
            <span className="font-semibold text-[#111827]">{filteredDepartments.length}</span> departments
            {filteredDepartments.length !== departments.length && (
              <span className="text-[#08775A] font-semibold ml-1.5">(Filtered from {departments.length} total)</span>
            )}
          </div>
          <div className="text-[11px] text-[#52665e]">
            Page <span className="font-bold text-[#111827]">{currentPage}</span> of{' '}
            <span className="font-bold text-[#111827]">{totalPages}</span>
          </div>
        </div>

        {/* Table Element */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#effaf5] border-b border-[#c2e7db] text-[#08775A] font-bold text-[11px] uppercase tracking-wider select-none sticky top-0 z-10 whitespace-nowrap">
              <tr className="whitespace-nowrap">
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 w-12 whitespace-nowrap">#</th>
                {visibleColumns.code && <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Code</th>}
                {visibleColumns.name && <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Department Name</th>}
                {visibleColumns.type && <th className="py-2.5 px-3 border-r border-[#c2e7db]/70 whitespace-nowrap">Type</th>}
                {visibleColumns.floor && <th className="py-2.5 px-3 border-r border-[#c2e7db]/70 whitespace-nowrap">Location / Floor</th>}
                {visibleColumns.fixedPrice && <th className="py-2.5 px-3 border-r border-[#c2e7db]/70 whitespace-nowrap">Fixed Price (PKR)</th>}
                {visibleColumns.head && <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Head / In-charge</th>}
                {visibleColumns.access && <th className="py-2.5 px-3 border-r border-[#c2e7db]/70 whitespace-nowrap">Operational Access</th>}
                {visibleColumns.doctors && <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 whitespace-nowrap">Doctors</th>}
                {visibleColumns.staff && <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 whitespace-nowrap">Staff</th>}
                {visibleColumns.status && <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 whitespace-nowrap">Status</th>}
                {visibleColumns.updatedBy && <th className="py-2.5 px-3 border-r border-[#c2e7db]/70 whitespace-nowrap">Updated By</th>}
                {visibleColumns.updatedDate && <th className="py-2.5 px-3 border-r border-[#c2e7db]/70 whitespace-nowrap">Updated Date</th>}
                {visibleColumns.actions && <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-xs">
              {paginatedDepartments.map((dept, idx) => (
                <tr
                  key={dept.id}
                  className={`${
                    idx % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfc]'
                  } hover:bg-[#f0f8f4] transition-colors border-b border-[#e2eae5]`}
                >
                  {/* Sequence # */}
                  <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] whitespace-nowrap">
                    {(currentPage - 1) * pageSize + idx + 1}
                  </td>

                  {/* Code */}
                  {visibleColumns.code && (
                    <td className="py-2.5 px-3.5 font-mono font-bold text-[#08775A] border-r border-[#e2eae5] whitespace-nowrap">
                      {dept.code}
                    </td>
                  )}

                  {/* Name */}
                  {visibleColumns.name && (
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap">
                      <span className="font-semibold text-[#111827]">{dept.name}</span>
                    </td>
                  )}

                  {/* Type badge */}
                  {visibleColumns.type && (
                    <td className="py-2.5 px-3 border-r border-[#e2eae5] whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                        {dept.type}
                      </span>
                    </td>
                  )}

                  {/* Floor / Location */}
                  {visibleColumns.floor && (
                    <td className="py-2.5 px-3 text-[#52665e] border-r border-[#e2eae5] whitespace-nowrap">
                      {dept.floor || dept.location ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#f6faf8] text-[#111827] border border-[#e2eae5]">
                          {dept.floor ? `${dept.floor}${dept.location ? ` - ${dept.location}` : ''}` : dept.location}
                        </span>
                      ) : (
                        <span className="text-[#8b9e95] text-[10px] italic">Not Set</span>
                      )}
                    </td>
                  )}

                  {/* Fixed Price (PKR) */}
                  {visibleColumns.fixedPrice && (
                    <td className="py-2.5 px-3 font-semibold text-[#111827] border-r border-[#e2eae5] whitespace-nowrap">
                      {dept.fixedPrice !== undefined && dept.fixedPrice !== null ? (
                        <span className="text-[#08775A] font-mono font-bold">
                          PKR {Number(dept.fixedPrice).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[#8b9e95] font-normal text-[10px] italic">
                          Optional / Free
                        </span>
                      )}
                    </td>
                  )}

                  {/* Head / In-charge */}
                  {visibleColumns.head && (
                    <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap">
                      {dept.headName === 'Not Assigned' ? (
                        <span className="text-[#8b9e95] italic">Not Assigned</span>
                      ) : (
                        <span className="font-medium text-[#111827]">{dept.headName}</span>
                      )}
                    </td>
                  )}

                  {/* Operational Access compact tags */}
                  {visibleColumns.access && (
                    <td className="py-2.5 px-3 border-r border-[#e2eae5] whitespace-nowrap">
                      <div className="flex items-center gap-1 flex-nowrap">
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
                            <span className="text-[#8b9e95] text-xs">—</span>
                          )}
                      </div>
                    </td>
                  )}

                  {/* Doctors */}
                  {visibleColumns.doctors && (
                    <td className="py-2.5 px-3 text-center font-bold text-[#111827] border-r border-[#e2eae5] whitespace-nowrap">
                      <span className="font-mono">{dept.doctorCount}</span> <span className="font-normal text-[#8b9e95] text-[10px]">Doctors</span>
                    </td>
                  )}

                  {/* Staff */}
                  {visibleColumns.staff && (
                    <td className="py-2.5 px-3 text-center font-bold text-[#111827] border-r border-[#e2eae5] whitespace-nowrap">
                      <span className="font-mono">{dept.staffCount}</span> <span className="font-normal text-[#8b9e95] text-[10px]">Staff</span>
                    </td>
                  )}

                  {/* Status */}
                  {visibleColumns.status && (
                    <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] whitespace-nowrap">
                      <StatusBadge status={dept.status} size="sm" />
                    </td>
                  )}

                  {/* Updated By */}
                  {visibleColumns.updatedBy && (
                    <td className="py-2.5 px-3 text-[#52665e] font-medium whitespace-nowrap border-r border-[#e2eae5]" title={dept.updatedBy}>
                      {dept.updatedBy}
                    </td>
                  )}

                  {/* Updated Date */}
                  {visibleColumns.updatedDate && (
                    <td className="py-2.5 px-3 text-[#52665e] font-mono text-[11px] whitespace-nowrap border-r border-[#e2eae5]">
                      {dept.updatedAt.split(',')[0]}
                    </td>
                  )}

                  {/* Actions */}
                  {visibleColumns.actions && (
                    <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {/* View Button */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDeptForView(dept);
                            setIsViewDrawerOpen(true);
                          }}
                          title="View Department Details"
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
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
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>

                        {/* Activate / Deactivate Toggle */}
                        <button
                          disabled={dept.isDefaultPharmacy}
                          type="button"
                          onClick={() => {
                            setSelectedDeptForDeactivate(dept);
                            setIsDeactivateOpen(true);
                          }}
                          title={dept.status === 'Active' ? 'Deactivate Department' : 'Activate Department'}
                          className={`h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                            dept.status === 'Active'
                              ? 'text-[#52665e] hover:bg-amber-50 hover:text-amber-700'
                              : 'text-[#08775A] hover:bg-[#effaf5]'
                          }`}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>

                        {/* Delete Button (Protected for OPD, ER, OBS; Guarded by Linked Records for others) */}
                        {isProtectedCoreDepartment(dept) ? (
                          <span
                            title="Default Pharmacy department cannot be deleted"
                            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-slate-300 cursor-not-allowed opacity-60"
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
                            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
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
                  <td colSpan={14} className="py-12 text-center text-[#52665e]">
                    <Building2 className="h-8 w-8 text-[#8b9e95] mx-auto mb-2 opacity-50" />
                    <span className="font-semibold text-xs text-[#111827] block">
                      No departments match your current search and filter criteria.
                    </span>
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="mt-2 text-xs font-semibold text-[#08775A] hover:underline cursor-pointer"
                    >
                      Reset All Filters
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Pagination (design.md §4.5) */}
        <div className="bg-[#f6faf8] border-t border-[#e2eae5] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[#52665e]">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded-lg border border-[#c2e7db] bg-white px-2.5 py-1 text-xs text-[#111827] font-medium focus:border-[#08775A] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span className="ml-2">
              Showing <span className="font-semibold text-[#111827]">{(currentPage - 1) * pageSize + 1}</span>–
              <span className="font-semibold text-[#111827]">{Math.min(currentPage * pageSize, filteredDepartments.length)}</span> of{' '}
              <span className="font-semibold text-[#111827]">{filteredDepartments.length}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-[#e2eae5] bg-white text-[#52665e] hover:bg-[#effaf5] hover:text-[#08775A] disabled:opacity-40 transition-colors cursor-pointer text-xs font-semibold"
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              <span>Previous</span>
            </button>
            <span className="px-2 font-mono text-[11px] font-semibold text-[#111827]">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-[#e2eae5] bg-white text-[#52665e] hover:bg-[#effaf5] hover:text-[#08775A] disabled:opacity-40 transition-colors cursor-pointer text-xs font-semibold"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
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
