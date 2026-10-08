import { DoctorChargeForm } from '../../components/forms/DoctorChargeForm';
import { ServiceSourcePicker } from '../../components/forms/ServiceSourcePicker';
import { selectionFromSource } from '../../utils/serviceSelection';
import { AdmissionLedgerButton } from './AdmissionLedgerButton';
import { fetchAdmissionLedger, AdmissionLedger } from '../../services/admissionBillingService';
import { HOSPITAL_SERVICE_SOURCE, OUTSOURCED_SERVICE_SOURCE, NO_ACTIVE_DEPARTMENT_SERVICES, serviceSourceOptions, servicesForSource } from '../../utils/serviceSelection';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  User,
  Stethoscope,
  Pill,
  ArrowLeftRight,
  ShieldCheck,
  Plus,
  FileText,
  CheckCircle2,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { PanelBadge } from '../../components/common/PanelBadge';
import { Select, NumberInput, TextInput, Textarea, Toggle, ServiceChecklist } from '../../components/forms/FormControls';
import { formatPKR } from '../../utils/formatters';
import { useToast } from '../../context/ToastContext';
import { DepartmentService, fetchDepartments } from '../../services/departmentService';
import { Department } from '../../types/department';
import { StaffUserService, fetchStaffUsers } from '../../services/staffUserService';
import { StaffUser } from '../../types/staffUser';
import { ServiceRatesService, fetchServices } from '../../services/serviceRatesService';
import { HospitalService } from '../../types/serviceRates';
import { TransferLocationFields } from './TransferLocationFields';
import { pharmacyApiService, BackendMedicine } from '../../services/pharmacyApiService';
import {
  fetchAdmissionDetail,
  checkInAdmission,
  transferAdmissionBed,
  addAdmissionService,
  changeAdmissionMedicationMode,
  createAdmissionPharmacyRequest,
  grantAdmissionClearance,
  dischargeAdmission,
  AdmissionDetail,
  AdmissionPharmacyRequestRecord,
  MedicationMode,
  ClearanceType,
} from '../../services/admissionService';
import { ClinicalDischargeModal } from './ClinicalDischargeModal';
import { HighCostMedicineAuthorizationModal } from './HighCostMedicineAuthorizationModal';

type Tab = 'overview' | 'services' | 'medication' | 'pharmacy' | 'bed' | 'clearances';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: User },
  { id: 'services', label: 'Services & Charges', icon: Stethoscope },
  { id: 'medication', label: 'Medication Mode', icon: Pill },
  { id: 'pharmacy', label: 'Pharmacy Requests', icon: Pill },
  { id: 'bed', label: 'Transfer Ward / Room / Bed', icon: ArrowLeftRight },
  { id: 'clearances', label: 'Clearances', icon: ShieldCheck },
];

const CLEARANCE_LABEL: Record<ClearanceType, string> = {
  CLINICAL: 'Clinical',
  HOSPITAL_BILLING: 'Hospital Billing',
  PHARMACY: 'Pharmacy',
};

interface AdmissionDetailModalProps {
  admissionId: string;
  initialTab?: Tab;
  onClose: () => void;
  onChanged?: () => void;
}

/**
 * Central action surface for an Active Admission — Services/Charges,
 * Medication Mode, Pharmacy Requests, Bed Transfer and Clearances all live
 * as tabs here (mirrors `InvoiceDetailModal`'s always-all-actions-visible
 * pattern), reused across several Admission nav items that all ultimately
 * act on one admission record.
 *
 * Clearances reflect the CURRENT backend mechanism — any portal user can
 * grant any gate. Doctor-credential re-authentication (v7.2 §2.4) is a
 * separate, not-yet-built pass; this modal doesn't pretend otherwise.
 */
export const AdmissionDetailModal: React.FC<AdmissionDetailModalProps> = ({ admissionId, initialTab = 'overview', onClose, onChanged }) => {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [detail, setDetail] = useState<AdmissionDetail | null>(null);
  const [ledgerSummary, setLedgerSummary] = useState<AdmissionLedger['summary'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [allStaff, setAllStaff] = useState<StaffUser[]>(() => StaffUserService.getStaffUsers());
  const doctors = useMemo(() => allStaff.filter((s) => s.staffCategory === 'Doctor' && s.status === 'ACTIVE'), [allStaff]);

  // ── Hierarchical Service Selection (Category/Department -> Services) ──────────
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>(HOSPITAL_SERVICE_SOURCE);
  const [allDepartments, setAllDepartments] = useState<Department[]>(() => DepartmentService.getDepartments());
  const [allServices, setAllServices] = useState<HospitalService[]>(() => ServiceRatesService.getServices());

  useEffect(() => {

    fetchDepartments().then(setAllDepartments).catch(() => {});
    fetchStaffUsers().then(setAllStaff).catch(() => {});
  }, []);


  const availableServices = useMemo(
    () => servicesForSource(allServices, selectedDeptFilter),
    [allServices, selectedDeptFilter]
  );

  const selectedDeptObj = useMemo(() => {
    return allDepartments.find((d) => d.id === selectedDeptFilter) || null;
  }, [allDepartments, selectedDeptFilter]);

  const isCurrentSelectionOutsourced = useMemo(() => {
    return selectionFromSource(selectedDeptFilter).providerType === 'OUTSOURCED' || selectedDeptObj?.fulfillmentOwnership === 'Outsourced';
  }, [selectedDeptFilter, selectedDeptObj, allDepartments]);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [admission, ledger] = await Promise.all([fetchAdmissionDetail(admissionId), fetchAdmissionLedger(admissionId, true)]);
      setDetail(admission);
      setLedgerSummary(ledger.summary);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load admission.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissionId]);

  const refresh = async (message: string) => {
    toast.success(message);
    setActionError(null);
    await load();
    onChanged?.();
  };

  // ── Services & Charges ──────────────────────────────────────────────
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  useEffect(() => {
    setSelectedServiceIds((ids) => ids.filter((id) => availableServices.some((s) => s.id === id)));
  }, [availableServices]);
  const [lineQty, setLineQty] = useState(1);
  const [linePerformedBy, setLinePerformedBy] = useState('');
  const [lineArrangementMode, setLineArrangementMode] = useState<'HOSPITAL_MANAGED' | 'SELF'>('HOSPITAL_MANAGED');

  // Inline Fulfillment Mode editing state
  const [isEditingMedMode, setIsEditingMedMode] = useState(false);
  const [inlineMode, setInlineMode] = useState<MedicationMode>('HOSPITAL_MANAGED');
  const [inlineReason, setInlineReason] = useState('Updated during active care');
  const [isUpdatingMode, setIsUpdatingMode] = useState(false);

  useEffect(() => {
    const defaultMode = isCurrentSelectionOutsourced
      ? detail?.outsourcedFulfillmentMode ?? 'HOSPITAL_MANAGED'
      : detail?.medicationMode === 'SELF'
      ? 'SELF'
      : 'HOSPITAL_MANAGED';
    setLineArrangementMode(defaultMode);
  }, [isCurrentSelectionOutsourced, detail?.outsourcedFulfillmentMode, detail?.medicationMode]);

  const handleSaveInlineMode = async () => {
    if (!detail) return;
    setIsUpdatingMode(true);
    try {
      await changeAdmissionMedicationMode(admissionId, {
        mode: inlineMode,
        reason: inlineReason.trim() || 'Updated during active care',
      });
      setIsEditingMedMode(false);
      setLineArrangementMode(inlineMode === 'HOSPITAL_MANAGED' ? 'HOSPITAL_MANAGED' : 'SELF');
      await refresh('Admission fulfillment mode updated successfully.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update fulfillment mode.');
    } finally {
      setIsUpdatingMode(false);
    }
  };

  const selectedServices = useMemo(() => {
    return allServices.filter((s) => selectedServiceIds.includes(s.id));
  }, [allServices, selectedServiceIds]);

  const selectedServicesTotal = useMemo(() => {
    return selectedServices.reduce((sum, s) => sum + (s.standardRate || 0), 0) * (lineQty || 1);
  }, [selectedServices, lineQty]);

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedServiceIds.length === 0) {
      setActionError('Please select at least one service or procedure.');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      for (const serviceId of selectedServiceIds) {
        await addAdmissionService(admissionId, {
          serviceRateId: serviceId,
          ...selectionFromSource(selectedDeptFilter),
          quantity: lineQty,
          performedByStaffId: linePerformedBy || undefined,
          arrangementMode: lineArrangementMode,
        });
      }
      const count = selectedServiceIds.length;
      setSelectedServiceIds([]);
      setLineQty(1);
      setLinePerformedBy('');
      setLineArrangementMode(isCurrentSelectionOutsourced ? detail?.outsourcedFulfillmentMode ?? 'HOSPITAL_MANAGED' : 'HOSPITAL_MANAGED');
      await refresh(
        lineArrangementMode === 'SELF'
          ? `${count} ${count === 1 ? 'service' : 'services'} added as Self-Arranged (PKR 0).`
          : `${count} ${count === 1 ? 'service' : 'services'} added to patient invoice.`,
      );
    } catch (err: any) {
      setActionError(err?.message || 'Failed to add service.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Medication Mode ──────────────────────────────────────────────────
  const [newMode, setNewMode] = useState<MedicationMode>('SELF');
  const [modeReason, setModeReason] = useState('');

  useEffect(() => {
    if (detail) setNewMode(detail.medicationMode);
  }, [detail?.medicationMode]);

  const handleChangeMode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modeReason.trim()) {
      setActionError('Reason for medication mode change is required.');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      await changeAdmissionMedicationMode(admissionId, { mode: newMode, reason: modeReason.trim() });
      setModeReason('');
      await refresh('Medication mode updated.');
    } catch (err: any) {
      setActionError(err?.message || 'Failed to change medication mode.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Pharmacy Requests ────────────────────────────────────────────────
  const [medicines, setMedicines] = useState<BackendMedicine[]>([]);
  const [pharmLines, setPharmLines] = useState<{ medicineId: string; requestedQuantity: number }[]>([{ medicineId: '', requestedQuantity: 1 }]);
  const [pharmNotes, setPharmNotes] = useState('');

  useEffect(() => {
    if (tab === 'pharmacy') {
      pharmacyApiService.getMedicines().then(setMedicines).catch(() => setMedicines([]));
    }
  }, [tab]);

  const handleCreatePharmacyRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const validLines = pharmLines.filter((l) => l.medicineId && l.requestedQuantity > 0);
    if (validLines.length === 0) {
      setActionError('Add at least one medicine with a quantity.');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      const created = await createAdmissionPharmacyRequest(admissionId, { notes: pharmNotes.trim() || undefined, lines: validLines });
      setPharmLines([{ medicineId: '', requestedQuantity: 1 }]);
      setPharmNotes('');
      if (created.status === 'AUTHORIZATION_REQUIRED') {
        toast.success('Pharmacy request created.');
        setActionError(null);
        await load();
        onChanged?.();
        setHighCostTarget(created);
      } else {
        await refresh('Pharmacy request created.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to create pharmacy request.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Bed Transfer ─────────────────────────────────────────────────────
  const [targetBedId, setTargetBedId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferVersion, setTransferVersion] = useState(0);

  const handleTransferBed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetBedId) {
      setActionError('Select a target bed.');
      return;
    }
    if (!transferReason.trim()) {
      setActionError('Reason for bed transfer is required.');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      await transferAdmissionBed(admissionId, { targetBedId, reason: transferReason.trim() });
      setTargetBedId('');
      setTransferVersion((version) => version + 1);
      setTransferReason('');
      await refresh('Bed transfer completed.');
    } catch (err: any) {
      setActionError(err?.message || 'Failed to transfer bed.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Clearances ───────────────────────────────────────────────────────
  const handleGrantClearance = async (clearanceType: ClearanceType) => {
    setIsSaving(true);
    setActionError(null);
    try {
      await grantAdmissionClearance(admissionId, { clearanceType });
      await refresh(`${CLEARANCE_LABEL[clearanceType]} clearance granted.`);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to grant clearance.');
    } finally {
      setIsSaving(false);
    }
  };

  const [isClinicalDischargeOpen, setIsClinicalDischargeOpen] = useState(false);
  const [highCostTarget, setHighCostTarget] = useState<AdmissionPharmacyRequestRecord | null>(null);
  const [isDischarging, setIsDischarging] = useState(false);

  const isAllClearancesReady = useMemo(() => {
    if (!detail?.clearances || detail.clearances.length === 0) return false;
    return detail.clearances.every((c) => c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE');
  }, [detail?.clearances]);

  const handleFinalDischarge = async () => {
    setIsDischarging(true);
    setActionError(null);
    try {
      await dischargeAdmission(admissionId);
      await refresh('Patient discharged successfully. Bed freed to AVAILABLE.');
    } catch (err: any) {
      setActionError(err?.message || 'Failed to discharge patient.');
    } finally {
      setIsDischarging(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={detail ? `${detail.admissionNumber} — ${detail.patientName}` : 'Admission'}
      subtitle={detail ? `${detail.departmentName} • ${detail.doctorName || 'No doctor assigned'} • ${detail.bedLabel || 'No bed assigned'}` : undefined}
      maxWidth="4xl"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-500 gap-2 text-sm">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading admission…
        </div>
      ) : loadError || !detail ? (
        <div className="text-center py-10">
          <p className="text-rose-600 text-sm">{loadError}</p>
          <button onClick={load} className="mt-2 px-3 py-1.5 bg-[#08775A] text-white text-xs rounded-lg">Retry</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex border-b border-slate-200 overflow-x-auto -mx-6 px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                  tab === t.id
                    ? 'border-emerald-600 text-emerald-700 font-semibold'
                    : 'border-transparent text-slate-500 hover:text-slate-800 font-medium'
                }`}
              >
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            ))}
          </div>

          {actionError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {actionError}
            </div>
          )}

          {tab === 'overview' && (
            <div className="space-y-3">
              {/* Cohesive Admission Summary Card */}
              <div className="bg-slate-50/70 border border-slate-200/90 rounded-xl overflow-hidden shadow-2xs [font-family:'Inter',system-ui,sans-serif]">
                {/* Card Header: Status, Payer, MRN & Ledger Action */}
                <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center justify-between flex-wrap gap-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Status Badge */}
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                        detail.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : detail.status === 'DISCHARGE_PENDING'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : detail.status === 'DISCHARGED'
                          ? 'bg-slate-100 text-slate-700 border-slate-200'
                          : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          detail.status === 'ACTIVE'
                            ? 'bg-emerald-500'
                            : detail.status === 'DISCHARGE_PENDING'
                            ? 'bg-amber-500'
                            : 'bg-slate-400'
                        }`}
                      />
                      {detail.status.replace(/_/g, ' ')}
                    </span>

                    {/* Payer Badge */}
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200/80">
                      {detail.payerType === 'Corporate / Panel' ? <PanelBadge /> : 'Self-Pay'}
                    </span>

                    {/* MR Number - semibold */}
                    <span className="text-xs text-slate-800 font-semibold px-2.5 py-0.5 rounded bg-slate-100 border border-slate-200">
                      MRN: {detail.patientMrNumber}
                    </span>
                  </div>

                  {/* Integrated View Ledger Button */}
                  <AdmissionLedgerButton
                    admissionId={admissionId}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100/90 border border-emerald-200/80 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>View Ledger</span>
                  </AdmissionLedgerButton>
                </div>

                {/* Card Body: Balanced 4-Column Metadata Layout with semibold values */}
                <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-[11px] font-medium text-slate-400 block">Department</span>
                    <span className="font-semibold text-slate-900 truncate block mt-0.5" title={detail.departmentName}>
                      {detail.departmentName || 'Not assigned'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium text-slate-400 block">Ward / Room / Bed</span>
                    <span className="font-semibold text-slate-900 truncate block mt-0.5" title={detail.bedLabel || ''}>
                      {detail.bedLabel || 'No bed assigned'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium text-slate-400 block">Attending Doctor</span>
                    <span className="font-semibold text-slate-900 truncate block mt-0.5" title={detail.doctorName}>
                      {detail.doctorName || 'Not assigned'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium text-slate-400 block">Medication Mode</span>
                    <span className="font-semibold text-slate-900 truncate block mt-0.5">
                      {detail.medicationMode === 'HOSPITAL_MANAGED' ? 'Hospital Managed' : 'Self (Patient Arranged)'}
                    </span>
                  </div>
                </div>

                {/* Diagnosis (if provided) */}
                {detail.diagnosis && (
                  <div className="px-4 py-2.5 bg-white border-t border-slate-200/80 text-xs flex items-start gap-2">
                    <span className="text-[11px] font-semibold text-slate-500 shrink-0 mt-0.5">Diagnosis:</span>
                    <span className="text-slate-800 font-medium leading-relaxed">{detail.diagnosis}</span>
                  </div>
                )}

                {/* Card Footer: Clean Timeline */}
                <div className="px-4 py-2.5 bg-slate-50/90 border-t border-slate-200/80 text-[11px] text-slate-600 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span>
                      <strong className="font-semibold text-slate-700">Expected:</strong> {detail.expectedAt || '—'}
                    </span>
                    <span>
                      <strong className="font-semibold text-slate-700">Admitted:</strong> {detail.admittedAt || '—'}
                    </span>
                    <span>
                      <strong className="font-semibold text-slate-700">Discharged:</strong> {detail.dischargedAt || '—'}
                    </span>
                  </div>
                </div>
              </div>

              {detail.status === 'DISCHARGE_PENDING' && isAllClearancesReady && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-emerald-900 font-semibold">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-bold text-emerald-950">Discharge Cleared & Ready</p>
                      <p className="text-[11px] text-emerald-800 font-normal">All 3 clearance gates are approved. Ready to finalize discharge.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleFinalDischarge}
                    disabled={isDischarging}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-medium rounded-lg shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-60 text-xs transition-colors"
                  >
                    {isDischarging && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>Complete Final Discharge & Free Bed</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'services' && (
            <div className="space-y-4">
              {/* Inline Fulfillment Mode Banner & Interactive Switcher */}
              {!isEditingMedMode ? (
                <div className="flex items-center justify-between p-3 bg-slate-50/80 rounded-xl border border-slate-200 text-xs flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-600 font-medium">
                      Fulfillment Mode (set at admission):
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${
                        detail.medicationMode === 'HOSPITAL_MANAGED'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-slate-100 text-slate-700 border-slate-300'
                      }`}
                    >
                      {detail.medicationMode === 'HOSPITAL_MANAGED' ? 'Hospital Managed' : 'Self (Patient Arranged)'}
                    </span>
                    <span className="text-[11px] text-slate-400 hidden sm:inline">
                      • Default for newly added services
                    </span>
                  </div>
                  {detail.status === 'ACTIVE' && (
                    <button
                      type="button"
                      onClick={() => {
                        setInlineMode(detail.medicationMode);
                        setInlineReason('Updated during active care');
                        setIsEditingMedMode(true);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-[#08775A] hover:text-[#065f46] hover:underline cursor-pointer px-2.5 py-1 rounded-md bg-white border border-slate-200 shadow-2xs"
                    >
                      <Pencil className="h-3 w-3" />
                      <span>Change</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="p-3.5 bg-white rounded-xl border-2 border-[#08775A]/40 shadow-xs text-xs space-y-3 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <Pill className="h-4 w-4 text-[#08775A]" />
                      Change Admission Fulfillment Mode
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsEditingMedMode(false)}
                      className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setInlineMode('HOSPITAL_MANAGED')}
                      className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                        inlineMode === 'HOSPITAL_MANAGED'
                          ? 'border-[#08775A] bg-[#effaf5] text-[#08775A] font-bold ring-1 ring-[#08775A]'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs">Hospital Managed</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-semibold">Billable</span>
                      </div>
                      <p className="text-[10.5px] font-normal text-slate-500 mt-0.5">Hospital supplies medications &amp; services</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setInlineMode('SELF')}
                      className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                        inlineMode === 'SELF'
                          ? 'border-slate-800 bg-slate-100 text-slate-900 font-bold ring-1 ring-slate-800'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs">Self Arranged (Patient)</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 font-semibold">PKR 0</span>
                      </div>
                      <p className="text-[10.5px] font-normal text-slate-500 mt-0.5">Patient / attendant arranges externally</p>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={inlineReason}
                      onChange={(e) => setInlineReason(e.target.value)}
                      placeholder="Reason for change (e.g. Attendant preference, clinical order)..."
                      className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
                    />
                    <button
                      type="button"
                      disabled={isUpdatingMode || !inlineReason.trim()}
                      onClick={handleSaveInlineMode}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isUpdatingMode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      <span>Save Mode</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingMedMode(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {ledgerSummary && (
                <div className="p-2.5 bg-[#effaf5] rounded-lg border border-[#c2e7db] text-xs">
                  <span className="text-[10px] text-[#08775A] uppercase block">Remaining Amount (Available Credit)</span>
                  <span className="font-bold text-[#08775A]">{formatPKR(ledgerSummary.availableCredit)}</span>
                </div>
              )}
              {detail.invoices.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase block">Total Billed</span>
                    <span className="font-bold text-slate-800">{formatPKR(detail.invoices.reduce((s, i) => s + i.total, 0))}</span>
                  </div>
                  {detail.unallocatedAdvanceTotal > 0 && (
                    <div className="p-2.5 bg-[#effaf5] rounded-lg border border-[#c2e7db]">
                      <span className="text-[10px] text-[#08775A] uppercase block">Advance / Deposit Applied</span>
                      <span className="font-bold text-[#08775A]">{formatPKR(detail.unallocatedAdvanceTotal)}</span>
                    </div>
                  )}
                  <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200">
                    <span className="text-[10px] text-amber-700 uppercase block">Total Outstanding</span>
                    <span className="font-bold text-amber-800">{formatPKR(ledgerSummary?.outstandingBalance ?? detail.totalOutstanding)}</span>
                  </div>
                </div>
              )}

              {detail.invoices.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">No department invoices posted yet.</p>
              ) : (
                detail.invoices.map((inv) => (
                  <div key={inv.id} className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-2xs">
                    <div className="bg-slate-50 border-b border-slate-200 px-3.5 py-2 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">{inv.departmentName} — {inv.invoiceNumber}</span>
                      <span className="text-xs font-bold text-amber-700">Outstanding: {formatPKR(inv.outstanding)}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-100/75 border-b border-slate-200 text-[10.5px] font-semibold text-slate-600 uppercase tracking-wider">
                          <tr>
                            <th className="py-2 px-3.5">Service / Procedure</th>
                            <th className="py-2 px-3 text-right">Qty</th>
                            <th className="py-2 px-3.5 text-right">Amount (PKR)</th>
                            <th className="py-2 px-3.5">Performed By</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {inv.lines.map((l) => {
                            const isSelf =
                              l.discountReason?.includes('Self-Arranged') ||
                              l.discountReason?.includes('Self Arranged') ||
                              (l.lineNet === 0 && l.lineGross === 0);
                            return (
                              <tr key={l.id} className="hover:bg-slate-50/50">
                                <td className="py-2 px-3.5 font-medium text-slate-900">
                                  <div className="flex items-center gap-2">
                                    <span>{l.serviceName}</span>
                                    {isSelf && (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                        Self Arranged
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-right text-slate-600">{l.quantity}</td>
                                <td className="py-2 px-3.5 text-right font-mono font-semibold">
                                  {isSelf ? (
                                    <span className="text-slate-600 text-xs">
                                      PKR 0 <span className="text-[10px] text-slate-400 font-normal">(Self)</span>
                                    </span>
                                  ) : (
                                    <span className="text-slate-900">{formatPKR(l.lineNet)}</span>
                                  )}
                                </td>
                                <td className="py-2 px-3.5 text-slate-500">{l.performedByName || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}

              {detail.status === 'ACTIVE' && (
                <form onSubmit={handleAddService} className="space-y-3.5 p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#08775A] flex items-center gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Add Service / Investigation
                    </h4>
                    <span className="text-[10.5px] font-semibold text-slate-500">
                      Auto-adds to patient's admission invoice
                    </span>
                  </div>

                  {/* Department / Source Filter */}
                  <div>
                    <DoctorChargeForm target="admissions" id={admissionId} onPosted={() => { load(); }} />
                      <ServiceSourcePicker value={selectedDeptFilter} onChange={value => { setSelectedDeptFilter(value); setSelectedServiceIds([]); }} departments={allDepartments} onServices={setAllServices} />
                  </div>

                  {/* Searchable Multi-Select Service Checklist */}
                  <ServiceChecklist
                    label="2. Select Services / Procedures / Investigations"
                    services={availableServices}
                    selectedServiceIds={selectedServiceIds}
                    onChange={setSelectedServiceIds}
                    emptyMessage={
                      availableServices.length === 0
                        ? NO_ACTIVE_DEPARTMENT_SERVICES
                        : 'No services available in this department'
                    }
                  />

                  {/* Compact Service Arrangement Toggle */}
                  <div className="flex items-center justify-between gap-3 p-2.5 bg-slate-50/90 rounded-xl border border-slate-200 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-700">Service Arrangement:</span>
                      <span className="text-[11px] text-slate-400 hidden sm:inline">
                        (Inherited from admission default)
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-200 shadow-2xs">
                      <button
                        type="button"
                        onClick={() => setLineArrangementMode('HOSPITAL_MANAGED')}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                          lineArrangementMode === 'HOSPITAL_MANAGED'
                            ? 'bg-[#effaf5] text-[#08775A] border border-[#c2e7db] shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900 border border-transparent'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-[#08775A]" />
                        <span>Hospital Managed (Billable)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setLineArrangementMode('SELF')}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                          lineArrangementMode === 'SELF'
                            ? 'bg-slate-100 text-slate-900 border border-slate-300 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900 border border-transparent'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-slate-500" />
                        <span>Self Arranged (PKR 0)</span>
                      </button>
                    </div>
                  </div>

                  {selectedServices.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-white px-3.5 py-2.5 rounded-lg border border-slate-200">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Selected:</span>
                        <span className="font-semibold text-slate-800">
                          {selectedServices.length} {selectedServices.length === 1 ? 'service' : 'services'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Destination:</span>
                        <span className="font-semibold text-slate-800">
                          Admission Invoice ({detail.invoices[0]?.invoiceNumber || 'Main'})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Arrangement:</span>
                        {lineArrangementMode === 'SELF' ? (
                          <span className="font-semibold text-slate-700">Self Arranged (Outside)</span>
                        ) : (
                          <span className="font-semibold text-[#08775A]">
                            {isCurrentSelectionOutsourced ? 'Outsourced Hospital Managed' : 'Hospital Managed'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Total:</span>
                        {lineArrangementMode === 'SELF' ? (
                          <span className="font-bold text-slate-700">
                            PKR 0 <span className="font-normal text-[10.5px] text-slate-400">(Non-billable)</span>
                          </span>
                        ) : (
                          <span className="font-bold text-slate-900">
                            {formatPKR(selectedServicesTotal)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <NumberInput label="Quantity (per service)" min={1} value={lineQty} onChange={(e) => setLineQty(Number(e.target.value) || 1)} />
                    <Select
                      label="Performed By (optional)"
                      options={doctors.map((d) => ({ label: d.fullName, value: d.id }))}
                      value={linePerformedBy}
                      onChange={(e) => setLinePerformedBy(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={isSaving || selectedServiceIds.length === 0}
                      className="px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-xl shadow-xs disabled:opacity-60 cursor-pointer"
                    >
                      {isSaving
                        ? 'Adding…'
                        : selectedServiceIds.length > 1
                        ? `Add ${selectedServiceIds.length} Services to Patient`
                        : 'Add Service to Patient'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {tab === 'medication' && (
            <div className="space-y-4">
              <form onSubmit={handleChangeMode} className="space-y-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <Toggle
                  label="Hospital Managed Medication"
                  hint={newMode === 'HOSPITAL_MANAGED' ? 'Medicines requested via Hospital Pharmacy' : 'Patient/attendant sources medicines (Self)'}
                  checked={newMode === 'HOSPITAL_MANAGED'}
                  onChange={(checked) => setNewMode(checked ? 'HOSPITAL_MANAGED' : 'SELF')}
                />
                <Textarea label="Reason" required rows={2} value={modeReason} onChange={(e) => setModeReason(e.target.value)} />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSaving || newMode === detail.medicationMode}
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-[#08775A] rounded-lg disabled:opacity-60"
                  >
                    {isSaving ? 'Saving…' : 'Update Mode'}
                  </button>
                </div>
              </form>

              {detail.medicationModeHistory.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 border-b border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 uppercase">History</div>
                  <table className="w-full text-left text-xs border-collapse">
                    <tbody className="divide-y divide-slate-100">
                      {detail.medicationModeHistory.map((h) => (
                        <tr key={h.id}>
                          <td className="py-1.5 px-3">{h.previousMode} → <strong>{h.newMode}</strong></td>
                          <td className="py-1.5 px-3 text-slate-500">{h.reason}</td>
                          <td className="py-1.5 px-3 text-slate-400 text-right whitespace-nowrap">{h.changedAt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'pharmacy' && (
            <div className="space-y-4">
              {detail.medicationMode !== 'HOSPITAL_MANAGED' ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  Pharmacy requests are only permitted when Medication Mode is Hospital Managed. Switch mode in the Medication Mode tab first.
                </p>
              ) : (
                <form onSubmit={handleCreatePharmacyRequest} className="space-y-3.5 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#08775A] flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> New Medicine Request
                    </h4>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db] rounded-full">
                      Live Pharmacy Inventory
                    </span>
                  </div>

                  {pharmLines.map((line, idx) => {
                    const selMed = medicines.find((m) => m.id === line.medicineId);
                    return (
                      <div key={idx} className="space-y-2 p-3 bg-white border border-slate-200/90 rounded-xl shadow-2xs">
                        <div className="flex items-start gap-2.5">
                          <div className="flex-1">
                            <Select
                              label={idx === 0 ? 'Select Medicine from Pharmacy Stock' : undefined}
                              placeholder="Choose medicine from pharmacy…"
                              options={medicines.map((m) => ({
                                label: m.name,
                                value: m.id,
                              }))}
                              value={line.medicineId}
                              onChange={(e) => {
                                const next = [...pharmLines];
                                next[idx] = { ...next[idx], medicineId: e.target.value };
                                setPharmLines(next);
                              }}
                            />
                          </div>
                          <div className="w-28 shrink-0">
                            <NumberInput
                              label={idx === 0 ? 'Requested Qty' : undefined}
                              min={1}
                              value={line.requestedQuantity}
                              onChange={(e) => {
                                const next = [...pharmLines];
                                next[idx] = { ...next[idx], requestedQuantity: Number(e.target.value) || 1 };
                                setPharmLines(next);
                              }}
                            />
                          </div>
                          {pharmLines.length > 1 && (
                            <div className={idx === 0 ? 'pt-6' : 'pt-1'}>
                              <button
                                type="button"
                                title="Remove item"
                                onClick={() => setPharmLines(pharmLines.filter((_, i) => i !== idx))}
                                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Medicine Details Card Shown Underneath When Selected */}
                        {selMed && (
                          <div className="mt-2 p-2.5 bg-slate-50/80 rounded-lg border border-slate-200/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs animate-in fade-in duration-150">
                            <div>
                              <span className="text-[11px] font-medium text-slate-400 block">Unit Price</span>
                              <span className="font-semibold text-slate-900 block mt-0.5">
                                {formatPKR(Number(selMed.saleRate || 0))}
                              </span>
                            </div>
                            <div>
                              <span className="text-[11px] font-medium text-slate-400 block">Available Stock</span>
                              <span
                                className={`font-semibold block mt-0.5 ${
                                  Number(selMed.currentStock) > 0 ? 'text-emerald-700' : 'text-rose-600'
                                }`}
                              >
                                {selMed.currentStock} {selMed.unit || 'units'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[11px] font-medium text-slate-400 block">Category</span>
                              <span className="font-semibold text-slate-900 block mt-0.5 truncate" title={selMed.category || 'General'}>
                                {selMed.category || 'General'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[11px] font-medium text-slate-400 block">Estimated Subtotal</span>
                              <span className="font-semibold text-emerald-700 block mt-0.5">
                                {formatPKR(Number(selMed.saleRate || 0) * (line.requestedQuantity || 1))}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setPharmLines([...pharmLines, { medicineId: '', requestedQuantity: 1 }])}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add another medicine</span>
                  </button>

                  <Textarea
                    label="Special Clinical Instructions (optional)"
                    rows={2}
                    placeholder="Dosage instructions, route (IV/IM/Oral), emergency priority…"
                    value={pharmNotes}
                    onChange={(e) => setPharmNotes(e.target.value)}
                  />

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-lg shadow-xs disabled:opacity-60 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>{isSaving ? 'Sending to Pharmacy…' : 'Send Pharmacy Request'}</span>
                    </button>
                  </div>
                </form>
              )}

              {detail.pharmacyRequests.length > 0 && (
                <div className="border border-slate-200/90 rounded-xl overflow-hidden shadow-xs bg-white mt-4">
                  <div className="bg-slate-50/90 border-b border-slate-200/80 px-3.5 py-2 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Request History</span>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-200/80 text-slate-700 rounded-full">
                      {detail.pharmacyRequests.length} {detail.pharmacyRequests.length === 1 ? 'request' : 'requests'}
                    </span>
                  </div>
                  {detail.pharmacyRequests.map((r) => {
                    const shortReqId = r.medicineRequestNumber.replace(/^REQ-\d{2}-/, 'REQ-');
                    return (
                      <div key={r.id} className="px-3.5 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-bold text-slate-900 tracking-tight">
                            {shortReqId}
                          </span>
                          {r.status === 'DISPENSED' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              DISPENSED
                            </span>
                          ) : r.status === 'AUTHORIZATION_REQUIRED' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200/70">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              AUTH REQUIRED
                            </span>
                          ) : r.status === 'REJECTED' || r.status === 'CANCELLED' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200/70">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                              {r.status}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200/70">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                              REQUESTED
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {r.lines.map((l, idx) => (
                            <span
                              key={`${l.medicineName}-${idx}`}
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-100/80 border border-slate-200/60 text-slate-800 text-[11.5px] font-medium"
                            >
                              <span>{l.medicineName}</span>
                              <strong className="text-[#08775A] font-semibold">× {l.requestedQuantity}</strong>
                            </span>
                          ))}
                        </div>
                        {r.status === 'AUTHORIZATION_REQUIRED' && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => setHighCostTarget(r)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md"
                            >
                              Authorize / Reject
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'bed' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600">Current bed: <strong>{detail.bedLabel || 'Not assigned'}</strong></p>
              {detail.status === 'ACTIVE' && (
                <form onSubmit={handleTransferBed} className="space-y-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <TransferLocationFields refreshVersion={transferVersion} bedId={targetBedId} onChange={setTargetBedId} currentBedId={detail.bedId} />
                  <TextInput label="Reason" required value={transferReason} onChange={(e) => setTransferReason(e.target.value)} />
                  <div className="flex justify-end">
                    <button type="submit" disabled={isSaving} className="px-4 py-1.5 text-xs font-semibold text-white bg-[#08775A] rounded-lg disabled:opacity-60">
                      {isSaving ? 'Transferring…' : 'Transfer Ward / Room / Bed'}
                    </button>
                  </div>
                </form>
              )}

              {detail.bedTransfers.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 border-b border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 uppercase">Transfer History</div>
                  <table className="w-full text-left text-xs border-collapse">
                    <tbody className="divide-y divide-slate-100">
                      {detail.bedTransfers.map((t) => (
                        <tr key={t.id}>
                          <td className="py-1.5 px-3">{t.fromBedLabel} → <strong>{t.toBedLabel}</strong></td>
                          <td className="py-1.5 px-3 text-slate-500">{t.reason}</td>
                          <td className="py-1.5 px-3 text-slate-500">{t.transferredByLabel}</td>
                          <td className="py-1.5 px-3 text-slate-400 text-right whitespace-nowrap">{t.transferredAt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'clearances' && (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-500">
                Clinical discharge requires the authorizing doctor's own credential (§2.4) — an Admission user can never self-clear it. Hospital
                Billing and Pharmacy gates are granted by an authorized portal user as before.
              </p>
              {detail.clearances.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <div>
                    <span className="text-xs font-semibold text-slate-800">{CLEARANCE_LABEL[c.clearanceType]}</span>
                    {c.status === 'CLEARED' && c.clearedByLabel && (
                      <span className="text-[10px] text-slate-500 ml-2">by {c.clearedByLabel} • {c.clearedAt}</span>
                    )}
                  </div>
                  {c.status === 'CLEARED' ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Cleared</span>
                  ) : c.status === 'NOT_APPLICABLE' ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-600">N/A</span>
                  ) : c.clearanceType === 'CLINICAL' ? (
                    <button
                      type="button"
                      onClick={() => setIsClinicalDischargeOpen(true)}
                      className="px-3 py-1 text-[11px] font-semibold text-white bg-[#08775A] rounded-lg"
                    >
                      Doctor Discharge Authorization
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleGrantClearance(c.clearanceType)}
                      className="px-3 py-1 text-[11px] font-semibold text-white bg-[#08775A] rounded-lg disabled:opacity-60"
                    >
                      Grant
                    </button>
                  )}
                </div>
              ))}

              {detail.dischargeSummary && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 border-b border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 uppercase">Discharge Summary</div>
                  <div className="p-3 space-y-1.5 text-xs">
                    <p><span className="text-slate-500">Final Diagnosis:</span> {detail.dischargeSummary.finalDiagnosis}</p>
                    <p><span className="text-slate-500">Condition at Discharge:</span> {detail.dischargeSummary.conditionAtDischarge}</p>
                    <p className="text-[11px] text-slate-400 pt-1">
                      Authorized by {detail.dischargeSummary.doctorNameSnapshot}
                      {detail.dischargeSummary.doctorDepartmentSnapshot && ` (${detail.dischargeSummary.doctorDepartmentSnapshot})`} •{' '}
                      {detail.dischargeSummary.authorizedAt}
                    </p>
                  </div>
                </div>
              )}

              {isAllClearancesReady && detail.status !== 'DISCHARGED' && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-emerald-900 font-semibold">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-bold text-emerald-950">All Clearances Satisfied</p>
                      <p className="text-[11px] text-emerald-800 font-normal">Clinical, Hospital Billing, and Pharmacy gates are fully approved.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleFinalDischarge}
                    disabled={isDischarging}
                    className="px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white font-bold rounded-lg shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-60 text-xs"
                  >
                    {isDischarging && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>Complete Final Discharge & Free Bed</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isClinicalDischargeOpen && (
        <ClinicalDischargeModal
          admission={detail}
          onClose={() => setIsClinicalDischargeOpen(false)}
          onDischarged={async () => {
            setIsClinicalDischargeOpen(false);
            await load();
            onChanged?.();
          }}
        />
      )}

      {highCostTarget && (
        <HighCostMedicineAuthorizationModal
          admissionId={admissionId}
          request={highCostTarget}
          onClose={() => setHighCostTarget(null)}
          onResolved={async () => {
            setHighCostTarget(null);
            await load();
            onChanged?.();
          }}
        />
      )}
    </Modal>
  );
};
