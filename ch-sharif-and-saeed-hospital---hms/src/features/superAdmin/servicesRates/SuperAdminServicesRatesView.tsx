import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  Download,
  Upload,
  FileCheck,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  HospitalService,
  ServiceFilterState,
  ServiceFormValues,
} from '../../../types/serviceRates';
import { ServiceRatesService, fetchServices } from '../../../services/serviceRatesService';
import { Department } from '../../../types/department';
import { DepartmentService, fetchDepartments } from '../../../services/departmentService';
import { ServicesKPIBar } from './ServicesKPIBar';
import { ServicesFilterBar } from './ServicesFilterBar';
import { ServicesTable } from './ServicesTable';
import { ServiceModal } from './ServiceModal';
import { ServiceDetailModal } from './ServiceDetailModal';
import { ServiceExportModal } from './ServiceExportModal';
import { ServiceImportModal } from './ServiceImportModal';
import { downloadServicesPDF } from '../../../services/serviceRatesExportService';
import { useToast } from '../../../context/ToastContext';

export const SuperAdminServicesRatesView: React.FC = () => {
  const { currentUser } = useAuth();
  const { success: toastSuccess, error: toastError, warning: toastWarning } = useToast();
  const showToast = (type: 'success' | 'error' | 'warning', message: string) => {
    if (type === 'success') toastSuccess(message);
    else if (type === 'error') toastError(message);
    else toastWarning(message);
  };

  // Master State
  const [services, setServices] = useState<HospitalService[]>([]);
  const [departments, setDepartments] = useState<Department[]>(() => DepartmentService.getDepartments());
  const [filters, setFilters] = useState<ServiceFilterState>({
    searchTerm: '',
    departmentId: 'All',
    category: 'All',
    panelEligible: 'All',
    status: 'All',
  });

  // Modal States
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<HospitalService | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<HospitalService | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);


  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [list, depts] = await Promise.all([
        fetchServices(),
        fetchDepartments(),
      ]);
      setServices(list);
      setDepartments(depts);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load services from the server.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredServices = useMemo(() => {
    return ServiceRatesService.filterServices(services, filters);
  }, [services, filters]);

  const handleFilterChange = (newFilters: Partial<ServiceFilterState>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const handleResetFilters = () => {
    setFilters({
      searchTerm: '',
      departmentId: 'All',
      category: 'All',
      panelEligible: 'All',
      status: 'All',
    });
  };

  // CRUD Handlers
  const handleOpenAdd = () => {
    setSelectedService(null);
    setIsAddEditModalOpen(true);
  };

  const handleOpenEdit = (service: HospitalService) => {
    setSelectedService(service);
    setIsAddEditModalOpen(true);
  };

  const handleOpenView = (service: HospitalService) => {
    setSelectedService(service);
    setIsDetailModalOpen(true);
  };

  const handleSaveService = async (values: ServiceFormValues) => {
    try {
      if (selectedService) {
        await ServiceRatesService.updateService(selectedService.id, values, currentUser);
        showToast('success', `Service "${values.name}" updated successfully.`);
      } else {
        await ServiceRatesService.createService(values, currentUser);
        showToast('success', `Service "${values.name}" created successfully.`);
      }
      setIsAddEditModalOpen(false);
      setSelectedService(null);
      await loadData();
    } catch (err: any) {
      showToast('error', err.message || 'Failed to save service.');
    }
  };

  const handleToggleStatus = async (service: HospitalService) => {
    try {
      const nextStatus = service.status === 'Active' ? 'Inactive' : 'Active';
      await ServiceRatesService.changeServiceStatus(service.id, nextStatus, currentUser);
      showToast(
        'success',
        `Service "${service.name}" is now marked as ${nextStatus}.`
      );
      await loadData();
    } catch (err: any) {
      showToast('error', err.message || 'Failed to update status.');
    }
  };

  const handleDeletePrompt = (service: HospitalService) => {
    const isCoreEncounter = Boolean(
      service.isDefaultEncounterService &&
      service.encounterType &&
      ['OPD', 'OBSERVATION', 'EMERGENCY'].includes(service.encounterType.toUpperCase())
    );

    if (isCoreEncounter) {
      showToast(
        'warning',
        `Cannot delete "${service.name}": Core encounter services (${service.encounterType}) cannot be deleted from the hospital master catalog. You can deactivate it instead.`
      );
      return;
    }

    setServiceToDelete(service);
  };

  const handleConfirmDelete = async () => {
    if (!serviceToDelete) return;
    const res = await ServiceRatesService.deleteService(serviceToDelete.id);
    if (res.success) {
      showToast('success', `Service "${serviceToDelete.name}" deleted from master catalog.`);
      await loadData();
    } else {
      showToast('error', res.message || 'Failed to delete service.');
    }
    setServiceToDelete(null);
  };

  const handleDirectDownloadPDF = async () => {
    try {
      await downloadServicesPDF(filteredServices, filters, currentUser);
      showToast('success', 'PDF directory downloaded successfully.');
    } catch (err) {
      showToast('error', 'Failed to generate PDF.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading services & rates…</span>
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
    <div id="super-admin-services-rates-view" className="p-6 max-w-7xl mx-auto">

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Services & Rates Master Catalog
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
              Charge Master
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Centralized tariff registry, billing units, clinical categorization, and panel insurance eligibility
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Quick PDF Download */}
          <button
            id="services-quick-pdf-btn"
            onClick={handleDirectDownloadPDF}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-xs"
            title="Direct Download PDF with active filters"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Download PDF
          </button>

          {/* Export Options Modal */}
          <button
            id="services-export-menu-btn"
            onClick={() => setIsExportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Export Options...
          </button>

          {/* Import Excel */}
          <button
            id="services-import-excel-btn"
            onClick={() => setIsImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-xs"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            Import Excel
          </button>

          {/* Add Service (Primary) */}
          <button
            id="services-add-btn"
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            Add Billable Service
          </button>
        </div>
      </div>

      {/* KPI Bar */}
      <ServicesKPIBar services={services} />

      {/* Filter Bar */}
      <ServicesFilterBar
        filters={filters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
        departments={departments}
        totalResults={filteredServices.length}
      />

      {/* Master Table */}
      <ServicesTable
        services={filteredServices}
        onView={handleOpenView}
        onEdit={handleOpenEdit}
        onToggleStatus={handleToggleStatus}
        onDelete={handleDeletePrompt}
        onResetFilters={handleResetFilters}
      />

      {/* Add / Edit Modal */}
      <ServiceModal
        isOpen={isAddEditModalOpen}
        onClose={() => {
          setIsAddEditModalOpen(false);
          setSelectedService(null);
        }}
        onSave={handleSaveService}
        service={selectedService}
        departments={departments}
      />

      {/* Detail Modal */}
      <ServiceDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedService(null);
        }}
        service={selectedService}
        onEdit={handleOpenEdit}
        onToggleStatus={handleToggleStatus}
      />

      {/* Export Modal */}
      <ServiceExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        services={filteredServices}
        filters={filters}
        currentUser={currentUser}
      />

      {/* Import Modal */}
      <ServiceImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={(count) => {
          setIsImportModalOpen(false);
          showToast('success', `Successfully imported ${count} service record(s) to master catalog.`);
          loadData();
        }}
        existingServices={services}
        currentUser={currentUser}
      />

      {/* Delete Confirmation Modal */}
      {serviceToDelete && (
        <div
          id="services-delete-confirm-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4"
        >
          <div className="bg-white max-w-md w-full rounded-2xl p-6 border border-slate-200 shadow-xl space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="text-center">
              <h3 className="text-base font-bold text-slate-800">
                Confirm Service Deletion
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Are you sure you want to permanently remove{' '}
                <strong className="text-slate-700">
                  {serviceToDelete.code} — {serviceToDelete.name}
                </strong>{' '}
                from the master catalog?
              </p>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              This action will delete the service from the active master catalog. Core encounter services (OPD, Observation, Emergency) are protected and cannot be deleted.
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setServiceToDelete(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                id="services-confirm-delete-btn"
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs"
              >
                Delete Service
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
