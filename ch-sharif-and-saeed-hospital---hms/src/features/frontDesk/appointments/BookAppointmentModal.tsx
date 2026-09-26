import type { PanelMembershipDetails } from '../../../types/patient';
import { doctorsForEncounter } from '../../../utils/doctorAvailability';
import { formatDateISO, getHospitalCurrentDate } from '../../../utils/dateConstants';
import { HOSPITAL_SERVICE_SOURCE, NO_ACTIVE_DEPARTMENT_SERVICES, servicesForSource } from '../../../utils/serviceSelection';
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  AlertCircle,
  Loader2,
  UserPlus,
  Building2,
  CheckCircle2,
  Stethoscope,
  Calendar,
  Wallet,
  User,
} from 'lucide-react';
import { Modal } from '../../../components/common/Modal';
import { Select, TextInput, Textarea, NumberInput, Toggle, CNICInput } from '../../../components/forms/FormControls';
import { DepartmentService, fetchDepartments } from '../../../services/departmentService';
import { StaffUserService, fetchStaffUsers } from '../../../services/staffUserService';
import { ServiceRatesService, fetchServices } from '../../../services/serviceRatesService';
import { normalizePhone, calculateAgeFromDob, PanelPatientSearchResult } from '../../../services/patientRegistryService';
import { PanelPatientSearchSection } from '../../../components/common/PanelPatientSearchSection';
import {
  fetchCorporatePanels,
  getActiveCorporatePanels,
  getPanelById,
  CorporatePanel,
} from '../../../services/panelService';
import { PatientGender, GuardianRelation } from '../../../types/patient';
import { Department } from '../../../types/department';
import { StaffUser } from '../../../types/staffUser';
import {
  formatPKR,
  formatSentenceCase,
  normalizeSentenceCase,
} from '../../../utils/formatters';
import { useToast } from '../../../context/ToastContext';
import { formatDisplayDate } from '../../../utils/dateConstants';
import { focusNextField, focusNextFieldOnEnter } from '../../../utils/formNavigation';
import {
  appointmentsApiService,
  AppointmentPaymentMethod,
  AppointmentRecord,
} from '../../../services/frontdeskApiService';

const PAYMENT_METHODS: { label: string; value: AppointmentPaymentMethod }[] = [
  { label: 'Cash', value: 'CASH' },
  { label: 'Card', value: 'CARD' },
  { label: 'Bank Transfer', value: 'BANK' },
  { label: 'Online', value: 'ONLINE' },
];

interface BookAppointmentModalProps {
  onClose: () => void;
  onBooked: () => void;
  /** When set, the modal reschedules/edits this appointment instead of booking a new one (§15). */
  rescheduleAppointment?: AppointmentRecord;
}

/** Resolves Panel Service coverage for a service */
function resolvePanelCoverage(panelId: string, serviceRateId: string, grossFee: number) {
  const panel = getPanelById(panelId);
  const now = new Date();
  const rule = panel?.discountRules.find((r) => {
    if (r.serviceRateId !== serviceRateId) return false;
    const from = new Date(r.effectiveFrom);
    const to = r.effectiveTo ? new Date(r.effectiveTo) : null;
    return from <= now && (!to || to >= now);
  });

  if (!rule || rule.coveragePercent == null) {
    return { covered: false, coveragePercent: 0, panelReceivable: 0, patientShare: grossFee, preauthRequired: rule?.preauthorizationRequired ?? false };
  }
  let panelReceivable = (grossFee * rule.coveragePercent) / 100;
  if (rule.capAmount != null && panelReceivable > rule.capAmount) panelReceivable = rule.capAmount;
  return {
    covered: true,
    coveragePercent: rule.coveragePercent,
    panelReceivable,
    patientShare: grossFee - panelReceivable,
    preauthRequired: !!rule.preauthorizationRequired,
  };
}

export const BookAppointmentModal: React.FC<BookAppointmentModalProps> = ({ onClose, onBooked, rescheduleAppointment }) => {
  const toast = useToast();
  const isReschedule = !!rescheduleAppointment;

  const formContainerRef = useRef<HTMLDivElement>(null);
  const serviceTypeDropdownOpenRef = useRef(false);
  const doctorDropdownOpenRef = useRef(false);
  const panelDropdownOpenRef = useRef(false);
  const paymentMethodDropdownOpenRef = useRef(false);

  const handleEnterNext = (e: React.KeyboardEvent<HTMLElement>) => {
    focusNextFieldOnEnter(e, formContainerRef.current);
  };

  const handleSelectKeyDown = (
    e: React.KeyboardEvent<HTMLSelectElement>,
    dropdownRef: React.MutableRefObject<boolean>
  ) => {
    if (e.key !== 'Enter') return;
    if (dropdownRef.current) return;
    e.preventDefault();
    dropdownRef.current = true;
    const el = e.currentTarget as HTMLSelectElement & { showPicker?: () => void };
    try {
      if (typeof el.showPicker === 'function') {
        el.showPicker();
      } else {
        el.click();
      }
    } catch {
      el.click();
    }
  };

  const [departments, setDepartments] = useState(() => DepartmentService.getDepartments().filter((d) => d.status === 'Active'));
  const [activeServices, setActiveServices] = useState(() => ServiceRatesService.getServices().filter((s) => s.status === 'Active'));
  useEffect(() => {
    fetchServices().then((services) => setActiveServices(services.filter((service) => service.status === 'Active'))).catch(() => {});
    fetchDepartments().then((list) => setDepartments(list.filter((department) => department.status === 'Active'))).catch(() => {});
  }, []);
  const [activeDoctors, setActiveDoctors] = useState(() => doctorsForEncounter(StaffUserService.getStaffUsers(), 'ADMISSION'));
  useEffect(() => {
    fetchStaffUsers().then((staff) => setActiveDoctors(doctorsForEncounter(staff, 'ADMISSION'))).catch(() => {});
  }, []);

  // Land cursor directly in Patient Full Name on open for new bookings
  useEffect(() => {
    if (!isReschedule) {
      const timer = setTimeout(() => {
        const nameInput = formContainerRef.current?.querySelector<HTMLInputElement>('#patient-full-name');
        nameInput?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isReschedule]);

  // Corporate Panels list
  const [corporatePanels, setCorporatePanels] = useState<CorporatePanel[]>(() => getActiveCorporatePanels());
  useEffect(() => {
    fetchCorporatePanels().then(setCorporatePanels).catch(() => {});
  }, []);

  // 1. Patient Category: 'Self Pay' vs 'Corporate / Panel'
  const [payerType, setPayerType] = useState<'Self Pay' | 'Corporate / Panel'>(
    rescheduleAppointment?.payerType === 'Corporate / Panel' ? 'Corporate / Panel' : 'Self Pay'
  );

  // 2. Patient Demographics (Uppercase text inputs)
  const [fullName, setFullName] = useState('');
  const [fatherGuardianName, setFatherGuardianName] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [age, setAge] = useState<string>('');
  const [gender, setGender] = useState<PatientGender>('Male');
  const [cnic, setCnic] = useState('');

  // Panel specific fields (when Corporate / Panel is selected)
  const [panelId, setPanelId] = useState('');
  const [panelMemberId, setPanelMemberId] = useState('');
  const [membershipDetails, setMembershipDetails] = useState<PanelMembershipDetails>({});
  const [selectedExistingPatient, setSelectedExistingPatient] = useState<PanelPatientSearchResult | null>(null);

  const handleUseExistingPatient = (match: PanelPatientSearchResult) => {
    setFullName(match.fullName.toUpperCase());
    setFatherGuardianName((match.guardianName || '').toUpperCase());
    setPrimaryPhone(match.phone || '');
    if (match.dob) {
      const ageNum = calculateAgeFromDob(match.dob);
      setAge(String(ageNum));
    }
    setGender((match.gender as PatientGender) || 'Male');
    setCnic(match.cnicOrPassport || '');
    setPanelId(match.panelId);
    setPanelMemberId(match.panelMemberId || '');
    setSelectedExistingPatient(match);
  };

  const handleClearExistingPatient = () => {
    setSelectedExistingPatient(null);
    setFullName('');
    setFatherGuardianName('');
    setPrimaryPhone('');
    setAge('');
    setGender('Male');
    setCnic('');
    setPanelId('');
    setPanelMemberId('');
    setMembershipDetails({});
  };

  // 3. Encounter Service / Type (No default OPD — user must choose)
  const initialEncounterType = rescheduleAppointment?.notes?.includes('[EMERGENCY]')
    ? 'EMERGENCY'
    : rescheduleAppointment?.notes?.includes('[OBSERVATION]')
    ? 'OBSERVATION'
    : rescheduleAppointment?.notes?.includes('[OPD]')
    ? 'OPD'
    : '';
  const [encounterType, setEncounterType] = useState<'OPD' | 'OBSERVATION' | 'EMERGENCY' | ''>(initialEncounterType);

  // 4. Doctor, Department & Service
  const [doctorStaffId, setDoctorStaffId] = useState(rescheduleAppointment?.doctorId || '');
  const [departmentId, setDepartmentId] = useState(rescheduleAppointment?.departmentId || '');
  const [serviceRateId, setServiceRateId] = useState(rescheduleAppointment?.serviceRateId || '');

  // 5. Slot
  const [date, setDate] = useState(formatDateISO(getHospitalCurrentDate()));
  const [time, setTime] = useState('10:00');
  const [notes, setNotes] = useState('');

  // 6. Advance
  const [collectAdvance, setCollectAdvance] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState<number | ''>('');
  const [advanceMethod, setAdvanceMethod] = useState<AppointmentPaymentMethod>('CASH');
  const [advanceReference, setAdvanceReference] = useState('');

  const [formError, setFormErrorState] = useState<string | null>(null);
  const setFormError = (msg: string | null) => {
    setFormErrorState(msg);
    if (msg) {
      toast.error(msg, 'Validation Error');
    }
  };
  const [isSaving, setIsSaving] = useState(false);

  // Helper: extract doctor's assigned departments
  const getDoctorDepts = (doc: StaffUser): Department[] => {
    const ids = doc.departmentIds?.length ? doc.departmentIds : doc.departmentId ? [doc.departmentId] : [];
    if (ids.length === 0) return [];
    return departments.filter((d) => ids.includes(d.id));
  };

  // Capability flag corresponding to selected encounter service
  const encounterDeptFlag = useMemo<'opdEnabled' | 'observationEnabled' | 'emergencyEnabled' | null>(() => {
    if (encounterType === 'OPD') return 'opdEnabled';
    if (encounterType === 'OBSERVATION') return 'observationEnabled';
    if (encounterType === 'EMERGENCY') return 'emergencyEnabled';
    return null;
  }, [encounterType]);

  const doctorsForEncounterType = useMemo(
    () => doctorsForEncounter(activeDoctors, encounterType),
    [activeDoctors, encounterType]
  );

  // If encounter type changes and current doctor is no longer in scope, clear doctor & dept
  useEffect(() => {
    if (doctorStaffId && !doctorsForEncounterType.some((d) => d.id === doctorStaffId)) {
      setDoctorStaffId('');
      setDepartmentId('');
      setServiceRateId('');
    }
  }, [doctorsForEncounterType, doctorStaffId]);

  // When doctor is selected, auto-resolve department matching the encounter service & service rate
  const handleDoctorChange = (selectedDocId: string) => {
    setDoctorStaffId(selectedDocId);
    if (!selectedDocId) {
      setDepartmentId('');
      setServiceRateId('');
      return;
    }

    const docObj = activeDoctors.find((d) => d.id === selectedDocId);
    if (!docObj) return;

    const docDepts = getDoctorDepts(docObj);
    const matchingDept = encounterDeptFlag
      ? docDepts.find((d) => d[encounterDeptFlag]) || docDepts[0] || departments[0]
      : docDepts[0] || departments[0];

    setDepartmentId(matchingDept?.id || '');
    setServiceRateId('');
  };

  // Department-scoped services PLUS whatever real services the selected
  // doctor is actually assigned to (staff.md §4/§7) — closes the gap where a
  // hospital-wide (no-department) or differently-scoped service a doctor was
  // explicitly assigned never surfaces once their own department is set.
  const departmentServices = useMemo(() => {
    const scoped = servicesForSource(activeServices, departmentId || HOSPITAL_SERVICE_SOURCE);
    const assignedIds = activeDoctors.find((d) => d.id === doctorStaffId)?.assignedServiceIds;
    if (!assignedIds || assignedIds.length === 0) return scoped;
    const merged = new Map(scoped.map((s) => [s.id, s]));
    activeServices.filter((s) => assignedIds.includes(s.id)).forEach((s) => merged.set(s.id, s));
    return Array.from(merged.values());
  }, [activeServices, departmentId, activeDoctors, doctorStaffId]);
  useEffect(() => {
    setServiceRateId((id) => {
      if (departmentServices.some((service) => service.id === id && service.encounterType === encounterType)) return id;
      return departmentServices.find((service) => service.encounterType === encounterType && service.isDefaultEncounterService)?.id
        || departmentServices.find((service) => service.encounterType === encounterType)?.id
        || departmentServices[0]?.id
        || '';
    });
  }, [departmentServices, encounterType]);

  const selectedDoctor = activeDoctors.find((d) => d.id === doctorStaffId);
  const selectedService = departmentServices.find((s) => s.id === serviceRateId);
  const grossFee = selectedService?.standardRate ?? 0;

  const panelPreview =
    payerType === 'Corporate / Panel' && panelId && selectedService
      ? resolvePanelCoverage(panelId, selectedService.id, grossFee)
      : null;

  const patientPayable =
    payerType === 'Corporate / Panel' ? (panelPreview ? panelPreview.patientShare : grossFee) : grossFee;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (isReschedule) {
      if (departmentId && !selectedService) {
        setFormError(NO_ACTIVE_DEPARTMENT_SERVICES);
        return;
      }
      setIsSaving(true);
      try {
        const slotAt = new Date(`${date}T${time}:00`).toISOString();
        await appointmentsApiService.updateAppointment(rescheduleAppointment!.id, {
          slotAt,
          doctorStaffId: doctorStaffId || null,
          departmentId: departmentId || undefined,
          serviceRateId: serviceRateId || undefined,
        });
        toast.success('Appointment rescheduled.');
        onBooked();
      } catch (err: any) {
        setFormError(err?.message || 'Failed to reschedule appointment.');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    // Demographics validation (same 5 fields)
    if (!fullName.trim()) {
      setFormError('Patient Full Name is required.');
      return;
    }
    if (!fatherGuardianName.trim()) {
      setFormError('Father / Guardian Name is required.');
      return;
    }
    if (!primaryPhone.trim()) {
      setFormError('Primary Phone number is required.');
      return;
    }
    const ageNum = Number(age);
    if (!age || isNaN(ageNum) || ageNum < 0) {
      setFormError('Valid Patient Age in years is required.');
      return;
    }

    // Corporate / Panel validation
    if (payerType === 'Corporate / Panel') {
      if (!selectedExistingPatient) {
        setFormError('Front Desk cannot register new panel patients. Please search and select an existing verified panel patient above, or contact Super Admin / Admin.');
        return;
      }
      if (!panelId) {
        setFormError('Please select a Corporate Panel company.');
        return;
      }
      if (corporatePanels.find(p => p.id === panelId)?.memberIdRequired && !panelMemberId.trim()) {
        setFormError('Panel Member ID / Card # is required.');
        return;
      }
    }

    if (!encounterType) {
      setFormError('Please select an Encounter Service Type (OPD, Observation, or Emergency).');
      return;
    }

    if (!selectedService) {
      setFormError('Consultation service could not be resolved.');
      return;
    }
    if (collectAdvance) {
      if (!advanceAmount || Number(advanceAmount) <= 0) {
        setFormError('Enter a valid advance amount.');
        return;
      }
      if (Number(advanceAmount) > patientPayable) {
        setFormError(`Advance (${formatPKR(Number(advanceAmount))}) cannot exceed the payable fee (${formatPKR(patientPayable)}).`);
        return;
      }
    }

    setIsSaving(true);
    try {
      const slotAt = new Date(`${date}T${time}:00`).toISOString();

      let finalPanelPatientId: string | undefined = undefined;

      if (payerType === 'Corporate / Panel') {
        if (!selectedExistingPatient?.id) {
          setFormError('Front Desk cannot register new panel patients. Please search and select an existing verified panel patient.');
          setIsSaving(false);
          return;
        }
        finalPanelPatientId = selectedExistingPatient.id;
      }

      const userNotes = notes.trim();
      const formattedNotes = encounterType
        ? (userNotes ? `[${encounterType}] ${userNotes}` : `[${encounterType}]`)
        : (userNotes || undefined);

      await appointmentsApiService.bookAppointment({
        panelPatientId: finalPanelPatientId,
        newSelfPayPatient:
          payerType === 'Self Pay'
            ? {
                fullName: fullName.trim().toUpperCase(),
                guardianName: fatherGuardianName.trim().toUpperCase() || undefined,
                phone: normalizePhone(primaryPhone),
                cnicOrPassport: cnic.trim() || undefined,
                gender: gender === 'Other / Not Specified' ? 'Other' : gender,
                dob: computedDob,
              }
            : undefined,
        departmentId:
          selectedService?.departmentId && !selectedService.isDefaultEncounterService
            ? selectedService.departmentId
            : departmentId || selectedService?.departmentId || departments.find((department) => encounterDeptFlag && department[encounterDeptFlag])?.id || departments[0]?.id || '',
        doctorStaffId: doctorStaffId || undefined,
        serviceRateId,
        slotAt,
        estimatedAmount: grossFee || undefined,
        advanceAmount: collectAdvance ? Number(advanceAmount) : undefined,
        paymentMethod: collectAdvance ? advanceMethod : undefined,
        paymentReference: collectAdvance ? advanceReference.trim().toUpperCase() || undefined : undefined,
        notes: formattedNotes,
      });

      toast.success('Appointment booked successfully.');
      onBooked();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to book appointment.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="3xl"
      title={isReschedule ? 'Reschedule Appointment' : 'Book Appointment'}
      subtitle={isReschedule ? `${rescheduleAppointment!.patientName} — ${rescheduleAppointment!.serviceName}` : 'Fast patient booking & doctor scheduling'}
      footer={
        <div className="flex items-center justify-between w-full font-sans">
          <div className="text-xs text-slate-500 font-semibold">
            {selectedDoctor && (
              <span>
                Doctor: <strong className="text-slate-800">{selectedDoctor.fullName}</strong> • Fee:{' '}
                <strong className="text-[#08775A]">{formatPKR(patientPayable)}</strong>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="book-appointment-form"
              disabled={isSaving}
              className="px-6 py-2 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs disabled:opacity-60 inline-flex items-center gap-1.5 cursor-pointer"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
              <span>{isReschedule ? 'Save Rescheduled Slot' : 'Confirm & Book Appointment'}</span>
            </button>
          </div>
        </div>
      }
    >
      <div ref={formContainerRef}>
        <form id="book-appointment-form" onSubmit={handleSubmit} className="space-y-4 font-sans font-medium text-slate-800">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700 font-semibold animate-in fade-in">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{formError}</span>
            </div>
          )}

          {!isReschedule && (
            <div className="space-y-4">
              {/* 1. Category Selection: 2 Large Prominent Cards */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-2.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  1. Patient Category &amp; Billing
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* New Patient (Self Pay) Card */}
                  <button
                    type="button"
                    onClick={() => {
                      setPayerType('Self Pay');
                      if (selectedExistingPatient) {
                        handleClearExistingPatient();
                      }
                    }}
                    className={`p-3 rounded-xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${
                      payerType === 'Self Pay'
                        ? 'border-[#08775A] bg-[#effaf5] shadow-xs ring-1 ring-[#08775A]/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        payerType === 'Self Pay' ? 'bg-[#08775A] text-white shadow-xs' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <UserPlus className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-900">New Patient</span>
                        {payerType === 'Self Pay' && <CheckCircle2 className="h-4 w-4 text-[#08775A] shrink-0" />}
                      </div>
                      <p className="text-[11px] font-semibold text-[#08775A] mt-0.5">Self Pay / General Appointment</p>
                      <span className="text-[10px] text-slate-500 block mt-0.5 leading-tight">
                        Cash or Card. Immediate consultation booking.
                      </span>
                    </div>
                  </button>

                  {/* Panel Patient Card */}
                  <button
                    type="button"
                    onClick={() => setPayerType('Corporate / Panel')}
                    className={`p-3 rounded-xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${
                      payerType === 'Corporate / Panel'
                        ? 'border-amber-500 bg-amber-50/70 shadow-xs ring-1 ring-amber-500/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        payerType === 'Corporate / Panel' ? 'bg-amber-600 text-white shadow-xs' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-900">Panel Patient</span>
                        {payerType === 'Corporate / Panel' && <CheckCircle2 className="h-4 w-4 text-amber-600 shrink-0" />}
                      </div>
                      <p className="text-[11px] font-semibold text-amber-800 mt-0.5">Corporate / Insurance</p>
                      <span className="text-[10px] text-slate-500 block mt-0.5 leading-tight">
                        Credit encounter backed by company tariff.
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* 2. Patient Demographics Form (All fields auto-capitalized + Enter advances) */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3.5">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-[#08775A]" /> 2. Patient Information
                  </span>
                  <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded ${
                    selectedExistingPatient
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : payerType === 'Corporate / Panel'
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {selectedExistingPatient
                      ? `From Panel Registry (${selectedExistingPatient.mrNumber})`
                      : payerType === 'Corporate / Panel'
                      ? 'Search Required (Panel)'
                      : 'Fast Entry'}
                  </span>
                </div>

                {/* Corporate / Panel Search Section */}
                {payerType === 'Corporate / Panel' && (
                  <>
                    <PanelPatientSearchSection
                      selectedPatient={selectedExistingPatient}
                      onSelectPatient={handleUseExistingPatient}
                      onClearPatient={handleClearExistingPatient}
                    />
                    {!selectedExistingPatient && (
                      <div className="p-3 bg-amber-50/90 border border-amber-200 rounded-lg text-xs text-amber-950 flex items-start gap-2.5 animate-in fade-in">
                        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-amber-950">Panel Patient Search Required</p>
                          <p className="text-amber-800 text-[11px] mt-0.5">
                            Front Desk can only search and select pre-registered panel patients. New panel patient registration is restricted to <strong>Super Admin</strong> and <strong>Admin</strong>.
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Full Name & Father / Guardian */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextInput
                    id="patient-full-name"
                    autoFocus={!isReschedule}
                    label="Patient Full Name"
                    required
                    disabled={payerType === 'Corporate / Panel'}
                    placeholder={payerType === 'Corporate / Panel' ? (selectedExistingPatient ? selectedExistingPatient.fullName : 'Search and select panel patient above') : "Patient's legal name"}
                    className="uppercase"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value.toUpperCase())}
                    onKeyDown={handleEnterNext}
                  />
                  <TextInput
                    label="Father / Guardian Name"
                    required
                    disabled={payerType === 'Corporate / Panel'}
                    placeholder={payerType === 'Corporate / Panel' ? (selectedExistingPatient ? (selectedExistingPatient.guardianName || 'N/A') : 'Search and select panel patient above') : 'Father / Husband / Guardian'}
                    className="uppercase"
                    value={fatherGuardianName}
                    onChange={(e) => setFatherGuardianName(e.target.value.toUpperCase())}
                    onKeyDown={handleEnterNext}
                  />
                </div>

                {/* Contact Phone, Age, and CNIC */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <TextInput
                    label="Contact Phone"
                    required
                    disabled={payerType === 'Corporate / Panel'}
                    placeholder={payerType === 'Corporate / Panel' ? (selectedExistingPatient ? selectedExistingPatient.phone : 'Auto-filled from registry') : '0300-1234567'}
                    value={primaryPhone}
                    onChange={(e) => setPrimaryPhone(e.target.value)}
                    onKeyDown={handleEnterNext}
                  />
                  <TextInput
                    label="Age (Years)"
                    required
                    disabled={payerType === 'Corporate / Panel'}
                    type="number"
                    min="0"
                    max="130"
                    placeholder={payerType === 'Corporate / Panel' ? 'Auto-filled' : 'e.g. 28'}
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    onKeyDown={handleEnterNext}
                  />
                  <CNICInput
                    label="CNIC (optional)"
                    disabled={payerType === 'Corporate / Panel'}
                    placeholder="XXXXX-XXXXXXX-X"
                    value={cnic}
                    onChange={(e) => setCnic(e.target.value)}
                    onKeyDown={handleEnterNext}
                  />
                </div>

                {/* Gender Pills */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Gender <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    {(['Male', 'Female', 'Other / Not Specified'] as PatientGender[]).map((g) => (
                      <button
                        key={g}
                        type="button"
                        disabled={payerType === 'Corporate / Panel'}
                        onClick={() => setGender(g)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                          payerType === 'Corporate / Panel' ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                        } ${
                          gender === g
                            ? 'bg-[#08775A] text-white border-[#08775A] shadow-xs font-bold'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {g === 'Other / Not Specified' ? 'Other' : g}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Corporate / Panel Specific Fields (Amber box, auto-capitalized) */}
                {payerType === 'Corporate / Panel' && (
                  <div className="pt-3 border-t border-amber-200 space-y-3 bg-amber-50/40 p-3.5 rounded-xl animate-in fade-in">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                      <Building2 className="h-3.5 w-3.5 text-amber-600" />
                      <span>Panel Contract &amp; Card Information</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select
                        label="Corporate Panel"
                        required
                        disabled={true}
                        options={[
                          { label: '-- Select Corporate Panel --', value: '' },
                          ...corporatePanels.map((p) => ({ label: `${p.name} (${p.code})`, value: p.id })),
                        ]}
                        value={panelId}
                        onChange={(e) => {
                          setPanelId(e.target.value);
                          panelDropdownOpenRef.current = false;
                          if (e.target.value) {
                            focusNextField(e.currentTarget, formContainerRef.current);
                          }
                        }}
                        onKeyDown={(e) => handleSelectKeyDown(e, panelDropdownOpenRef)}
                        onBlur={() => {
                          panelDropdownOpenRef.current = false;
                        }}
                        hint={selectedExistingPatient ? "Populated from the selected panel patient's registry record." : "Select patient above."}
                      />
                      <TextInput
                        label={corporatePanels.find(p => p.id === panelId)?.memberIdLabel || 'Panel Member ID / Card #'}
                        required={corporatePanels.find(p => p.id === panelId)?.memberIdRequired}
                        disabled={true}
                        placeholder="Auto-filled from registry"
                        className="uppercase"
                        value={panelMemberId}
                        onChange={(e) => setPanelMemberId(e.target.value.toUpperCase())}
                        onKeyDown={handleEnterNext}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. Encounter Service & Consulting Doctor */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3.5 shadow-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Stethoscope className="h-4 w-4 text-[#08775A]" /> 3. Service Type &amp; Consulting Doctor
              </span>
              <div className="flex items-center gap-2">
                {encounterType && (
                  <span className="text-[10.5px] text-[#08775A] font-semibold bg-[#effaf5] border border-emerald-200 px-2 py-0.5 rounded">
                    {encounterType === 'OPD'
                      ? 'OPD Consultation'
                      : encounterType === 'OBSERVATION'
                      ? 'Observation Care'
                      : 'Emergency Triage'}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Encounter Service Dropdown (User must select first) */}
              <div className="sm:col-span-2">
                <Select
                  label="Encounter Service"
                  required
                  options={[
                    { label: '-- Select Service Type --', value: '' },
                    { label: 'OPD Consultation', value: 'OPD' },
                    { label: 'Observation Care', value: 'OBSERVATION' },
                    { label: 'Emergency Triage', value: 'EMERGENCY' },
                  ]}
                  value={encounterType}
                  onChange={(e) => {
                    const newType = e.target.value as 'OPD' | 'OBSERVATION' | 'EMERGENCY' | '';
                    setEncounterType(newType);
                    serviceTypeDropdownOpenRef.current = false;
                    if (newType) {
                      focusNextField(e.currentTarget, formContainerRef.current);
                    }
                  }}
                  onKeyDown={(e) => handleSelectKeyDown(e, serviceTypeDropdownOpenRef)}
                  onBlur={() => {
                    serviceTypeDropdownOpenRef.current = false;
                  }}
                  hint="Select service first to see doctors marked available for it."
                />
              </div>

              {/* Consulting Doctor Dropdown (Filtered to doctors with matching department capability) */}
              <div className="sm:col-span-2">
                <Select
                  label="Consulting Doctor (Optional)"
                  disabled={!encounterType}
                  options={[
                    { label: 'Not Assigned / Select Later', value: '' },
                    ...doctorsForEncounterType.map((doctor) => ({ label: doctor.fullName, value: doctor.id })),
                  ]}
                  value={doctorStaffId}
                  onChange={(e) => {
                    handleDoctorChange(e.target.value);
                    doctorDropdownOpenRef.current = false;
                    if (e.target.value) {
                      focusNextField(e.currentTarget, formContainerRef.current);
                    }
                  }}
                  onKeyDown={(e) => handleSelectKeyDown(e, doctorDropdownOpenRef)}
                  onBlur={() => {
                    doctorDropdownOpenRef.current = false;
                  }}
                />
              </div>

              {/* Date & Time Slot */}
              <TextInput
                label="Appointment Date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onKeyDown={handleEnterNext}
              />
              <TextInput
                label="Time Slot"
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                onKeyDown={handleEnterNext}
              />
            </div>

            {departmentId && departmentServices.length === 0 && (
              <p className="text-xs text-slate-500">{NO_ACTIVE_DEPARTMENT_SERVICES}</p>
            )}

            {/* Fee & Department Auto-Resolution Summary Box */}
            {selectedService && (
              <div className="p-3 bg-[#effaf5] border border-[#c2e7db] rounded-lg flex items-center justify-between text-xs">
                <div className="space-y-0.5">
                  <span className="text-slate-500 font-semibold block">Consultation Service:</span>
                  <span className="font-bold text-slate-900 text-sm">{selectedService.name}</span>
                  {panelPreview && (
                    <span className="text-[11px] text-amber-800 font-semibold block">
                      {panelPreview.covered ? `Panel Coverage: ${panelPreview.coveragePercent}%` : 'Not Covered by Panel Tariff'}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-slate-500 font-semibold block">
                    {payerType === 'Corporate / Panel' ? 'Patient Payable Share:' : 'Consultation Fee:'}
                  </span>
                  <span className="font-extrabold text-[#08775A] text-base">{formatPKR(patientPayable)}</span>
                </div>
              </div>
            )}

            <Textarea
              label="Notes / Reason for Visit (optional)"
              rows={2}
              placeholder="e.g. Follow-up consultation, fever, BP review, referral note..."
              value={notes}
              onChange={(e) => setNotes(formatSentenceCase(e.target.value))}
              onBlur={(e) => setNotes(normalizeSentenceCase(e.target.value))}
            />
          </div>

          {/* 4. Optional Advance Collection */}
          {!isReschedule && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Wallet className="h-4 w-4 text-[#08775A]" /> Collect Advance / Token Fee?
                </span>
                <Toggle checked={collectAdvance} onChange={setCollectAdvance} />
              </div>

              {collectAdvance && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200/80 animate-in fade-in">
                  <NumberInput
                    label="Advance Amount (PKR)"
                    required
                    min={1}
                    placeholder={`Max ${patientPayable}`}
                    value={advanceAmount}
                    onChange={(e) => setAdvanceAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    onKeyDown={handleEnterNext}
                  />
                  <Select
                    label="Payment Method"
                    required
                    options={PAYMENT_METHODS}
                    value={advanceMethod}
                    onChange={(e) => {
                      setAdvanceMethod(e.target.value as AppointmentPaymentMethod);
                      paymentMethodDropdownOpenRef.current = false;
                      if (e.target.value) {
                        focusNextField(e.currentTarget, formContainerRef.current);
                      }
                    }}
                    onKeyDown={(e) => handleSelectKeyDown(e, paymentMethodDropdownOpenRef)}
                    onBlur={() => {
                      paymentMethodDropdownOpenRef.current = false;
                    }}
                  />
                  <TextInput
                    label="Reference (optional)"
                    placeholder="Receipt # / Auth code"
                    className="uppercase"
                    value={advanceReference}
                    onChange={(e) => setAdvanceReference(e.target.value.toUpperCase())}
                    onKeyDown={handleEnterNext}
                  />
                </div>
              )}
            </div>
          )}
        </form>
      </div>
    </Modal>
  );
};
