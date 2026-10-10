import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  UserCheck,
  Building,
  CreditCard,
  CalendarPlus,
  Upload,
  Download,
  Plus,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Loader2,
  Clock,
} from 'lucide-react';
import {
  formatDateISO,
  getHospitalCurrentDate,
} from '../../../utils/dateConstants';
import {
  Patient,
  PatientFormData,
  PatientFilterState,
  PatientStatus,
  ImportSummary,
} from '../../../types/patient';
import { User } from '../../../types';
import {
  fetchPatients,
  getAllPatients,
  filterPatients,
  getPatientRegistryKpis,
  createPatient,
  updatePatient,
  updatePatientStatus,
} from '../../../services/patientRegistryService';
import { PatientFilterBar } from './PatientFilterBar';
import { PatientTable } from './PatientTable';
import { PatientModal } from './PatientModal';
import { PatientDetailDrawer } from './PatientDetailDrawer';
import { PatientStatusModal } from './PatientStatusModal';
import { PatientImportModal } from './PatientImportModal';
import { PatientExportModal } from './PatientExportModal';
import { PatientDossierModal } from './PatientDossierModal';
import { useToast } from '../../../context/ToastContext';
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';

interface PatientRegistryViewProps {
  currentUser: User | null;
  initialDateFilter?: 'ALL' | 'TODAY';
}

const DEFAULT_FILTERS: PatientFilterState = {
  searchTerm: '',
  gender: 'ALL',
  payerType: 'ALL',
  panelId: 'ALL',
  status: 'ALL',
};

export const PatientRegistryView: React.FC<PatientRegistryViewProps> = ({
  currentUser,
  initialDateFilter = 'ALL',
}) => {
  const toast = useToast();
  // Master patient records
  const [patients, setPatients] = useState<Patient[]>([]);

  // Time Filter State
  const [timeFilter, setTimeFilter] = useState<'ALL' | 'TODAY'>(initialDateFilter);

  useEffect(() => {
    if (initialDateFilter) {
      setTimeFilter(initialDateFilter);
    }
  }, [initialDateFilter]);

  const todayISO = useMemo(() => formatDateISO(getHospitalCurrentDate()), []);

  const todayCount = useMemo(() => {
    return patients.filter((p) => {
      const reg = p.registrationDate || '';
      const created = p.createdAt ? p.createdAt.slice(0, 10) : '';
      return reg === todayISO || created === todayISO;
    }).length;
  }, [patients, todayISO]);

  // Filter State
  const [filters, setFilters] = useState<PatientFilterState>(DEFAULT_FILTERS);

  // Modals & Drawers State
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [patientToEdit, setPatientToEdit] = useState<Patient | null>(null);

  const [detailDrawerPatient, setDetailDrawerPatient] = useState<Patient | null>(null);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);

  const [statusModalPatient, setStatusModalPatient] = useState<Patient | null>(null);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const [dossierPatient, setDossierPatient] = useState<Patient | null>(null);
  const [isDossierModalOpen, setIsDossierModalOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPatients = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const list = await fetchPatients();
      setPatients(list);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load patients from the server.');
    } finally {
      setIsLoading(false);
    }
  };

  // Load patient records on mount
  useEffect(() => {
    loadPatients();
  }, []);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    if (type === 'error') {
      toast.error(text, 'Validation / Registry Error');
    } else if (type === 'info') {
      toast.info(text, 'Patient Registry');
    } else {
      toast.success(text, 'Patient Registry');
    }
  };

  // Filtered dataset
  const filteredPatients = useMemo(() => {
    let list = filterPatients(patients, filters);
    if (timeFilter === 'TODAY') {
      list = list.filter((p) => {
        const reg = p.registrationDate || '';
        const created = p.createdAt ? p.createdAt.slice(0, 10) : '';
        return reg === todayISO || created === todayISO;
      });
    }
    return list;
  }, [patients, filters, timeFilter, todayISO]);

  // Overall KPIs
  const kpis = useMemo(() => {
    return getPatientRegistryKpis(patients);
  }, [patients]);

  // Handlers for Filters
  const handleFilterChange = <K extends keyof PatientFilterState>(
    key: K,
    value: PatientFilterState[K]
  ) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  // Register or Update Patient Save
  const handleSavePatient = async (formData: PatientFormData) => {
    if (patientToEdit) {
      // Update
      const res = await updatePatient(patientToEdit.id, formData, currentUser);
      if (res.success && res.patient) {
        const updatedList = getAllPatients();
        setPatients(updatedList);
        setIsRegisterModalOpen(false);
        setPatientToEdit(null);
        showToast(`Patient ${res.patient.fullName} (${res.patient.mrNumber}) updated successfully.`);

        // If drawer is currently open for this patient, update it
        if (detailDrawerPatient?.id === res.patient.id) {
          setDetailDrawerPatient(res.patient);
        }
      } else {
        showToast(res.error || 'Failed to update patient.', 'error');
      }
    } else {
      // Create new
      const res = await createPatient(formData, currentUser);
      if (res.success && res.patient) {
        const updatedList = getAllPatients();
        setPatients(updatedList);
        setIsRegisterModalOpen(false);
        showToast(
          `Registered ${res.patient.fullName} with permanent MR Number: ${res.patient.mrNumber}`
        );
      } else {
        showToast(res.error || 'Failed to register patient.', 'error');
      }
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (patient: Patient) => {
    setPatientToEdit(patient);
    setIsRegisterModalOpen(true);
  };

  // Open Detail Drawer
  const handleOpenDetail = (patient: Patient) => {
    setDetailDrawerPatient(patient);
    setIsDetailDrawerOpen(true);
  };

  // Open Status Modal
  const handleOpenStatusModal = (patient: Patient) => {
    setStatusModalPatient(patient);
    setIsStatusModalOpen(true);
  };

  // Open Dossier Modal
  const handleOpenDossier = (patient: Patient) => {
    setDossierPatient(patient);
    setIsDossierModalOpen(true);
  };

  // Confirm Status Change
  const handleConfirmStatus = async (patientId: string, newStatus: PatientStatus) => {
    const res = await updatePatientStatus(patientId, newStatus, currentUser);
    if (res.success && res.patient) {
      const updatedList = getAllPatients();
      setPatients(updatedList);
      showToast(
        `Patient ${res.patient.fullName} (${res.patient.mrNumber}) status changed to ${newStatus}.`
      );
      if (detailDrawerPatient?.id === patientId) {
        setDetailDrawerPatient(res.patient);
      }
    } else {
      showToast(res.error || 'Failed to update status.', 'error');
    }
  };

  // Import completed
  const handleImportComplete = (summary: ImportSummary) => {
    const updatedList = getAllPatients();
    setPatients(updatedList);
    showToast(
      `Import complete: ${summary.patientsCreated} patient(s) registered with permanent MR numbers.`
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading patient registry…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-rose-500" />
        <p className="text-sm text-rose-700 font-medium">{loadError}</p>
        <button
          type="button"
          onClick={loadPatients}
          className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Section 4.1 Card Page Header Block */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center shadow-2xs">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#123e2b] tracking-tight">
                  Patient Registry
                </h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#08775A] animate-pulse" />
                  MPI Central Directory
                </span>
              </div>
              <p className="text-xs text-[#52665e] mt-0.5">
                Permanent Master Patient Index (MPI), collision-safe MR number allocation, and corporate panels
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Import Excel */}
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6f8f7] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              title="Import Patients via Excel Spreadsheets"
            >
              <Upload className="w-3.5 h-3.5 text-[#08775A]" />
              <span>Import Excel</span>
            </button>

            {/* Export */}
            <button
              onClick={() => setIsExportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6f8f7] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              title="Export Registry as PDF or Excel"
            >
              <Download className="w-3.5 h-3.5 text-[#08775A]" />
              <span>Export</span>
            </button>

            {/* Register New Patient */}
            <button
              onClick={() => {
                setPatientToEdit(null);
                setIsRegisterModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              title="Register a new patient and allocate permanent MR Number"
            >
              <Plus className="w-4 h-4" />
              <span>Register Patient</span>
            </button>
          </div>
        </div>
      </div>

      {/* Section 4.2 & Section 9 HospitalKpiHeader */}
      <HospitalKpiHeader
        columns="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
        items={[
          {
            category: 'MASTER REGISTRY',
            title: 'Total Patients',
            value: kpis.total,
            icon: Users,
            subtitle: 'Permanent MR numbers',
            tone: 'default',
          },
          {
            category: 'CLINICAL ELIGIBILITY',
            title: 'Active Patients',
            value: kpis.active,
            icon: UserCheck,
            subtitle: 'Eligible for hospital visits',
            tone: 'success',
          },
          {
            category: 'BILLING CLASSIFICATION',
            title: 'Self Pay Patients',
            value: kpis.selfPay,
            icon: CreditCard,
            subtitle: 'Direct cash/card billing',
            tone: 'default',
          },
          {
            category: 'CORPORATE COVER',
            title: 'Panel Patients',
            value: kpis.panel,
            icon: Building,
            subtitle: 'Institutional coverage',
            tone: 'info',
          },
          {
            category: 'GROWTH INTAKE',
            title: 'New This Month',
            value: kpis.newThisMonth,
            icon: CalendarPlus,
            subtitle: 'Current monthly admissions',
            tone: 'warning',
          },
        ]}
      />

      {/* Time Filter Tabs (All Patients vs Today's Patients) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTimeFilter('TODAY')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              timeFilter === 'TODAY'
                ? 'bg-[#08775A] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Today's Patients</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                timeFilter === 'TODAY' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-[#08775A]'
              }`}
            >
              {todayCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTimeFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              timeFilter === 'ALL'
                ? 'bg-[#08775A] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>All Registered Patients</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                timeFilter === 'ALL' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {patients.length}
            </span>
          </button>
        </div>

        {timeFilter === 'TODAY' && (
          <span className="text-xs text-slate-500 font-medium italic">
            Showing all patients registered or visiting hospital today ({todayISO})
          </span>
        )}
      </div>

      {/* Filter Bar */}
      <PatientFilterBar
        filters={filters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
        totalCount={patients.length}
        filteredCount={filteredPatients.length}
      />

      {/* Table */}
      <PatientTable
        patients={filteredPatients}
        totalUnfilteredCount={patients.length}
        onViewPatient={handleOpenDetail}
        onEditPatient={handleOpenEdit}
        onChangeStatus={handleOpenStatusModal}
        onRegisterNew={() => {
          setPatientToEdit(null);
          setIsRegisterModalOpen(true);
        }}
        onResetFilters={handleResetFilters}
      />

      {/* MODALS */}
      {/* Register / Edit Patient Modal */}
      <PatientModal
        isOpen={isRegisterModalOpen}
        onClose={() => {
          setIsRegisterModalOpen(false);
          setPatientToEdit(null);
        }}
        onSave={handleSavePatient}
        patientToEdit={patientToEdit}
        onOpenExistingPatient={(existing) => {
          setIsRegisterModalOpen(false);
          setPatientToEdit(null);
          handleOpenDetail(existing);
        }}
      />

      {/* Patient Detail Drawer */}
      <PatientDetailDrawer
        isOpen={isDetailDrawerOpen}
        onClose={() => {
          setIsDetailDrawerOpen(false);
          setDetailDrawerPatient(null);
        }}
        patient={detailDrawerPatient}
        onEdit={handleOpenEdit}
        onChangeStatus={handleOpenStatusModal}
        onPrintDossier={handleOpenDossier}
      />

      {/* Patient Status Change Modal */}
      <PatientStatusModal
        isOpen={isStatusModalOpen}
        onClose={() => {
          setIsStatusModalOpen(false);
          setStatusModalPatient(null);
        }}
        patient={statusModalPatient}
        onConfirmStatus={handleConfirmStatus}
      />

      {/* Patient Import Modal */}
      <PatientImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={handleImportComplete}
        currentUser={currentUser}
      />

      {/* Patient Export Modal */}
      <PatientExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        patients={filteredPatients}
        filters={filters}
        currentUser={currentUser}
      />

      {/* Patient Printable Dossier Modal */}
      <PatientDossierModal
        isOpen={isDossierModalOpen}
        onClose={() => {
          setIsDossierModalOpen(false);
          setDossierPatient(null);
        }}
        patient={dossierPatient}
      />
    </div>
  );
};
