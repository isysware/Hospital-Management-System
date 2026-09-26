import type { PanelMembershipDetails } from '../../../types/patient';
import { doctorsForEncounter } from '../../../utils/doctorAvailability';
import { InvoiceDetailModal } from '../billing/InvoiceDetailModal';
import { useRouter } from '../../../context/RouterContext';
import { HOSPITAL_SERVICE_SOURCE, NO_ACTIVE_DEPARTMENT_SERVICES, serviceSourceOptions, servicesForSource, retainAvailableServiceIds } from '../../../utils/serviceSelection';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Stethoscope,
  Eye,
  AlertTriangle,
  UserPlus,
  AlertCircle,
  Receipt,
  Building2,
  CheckCircle2,
  User,
  RotateCcw,
  Plus,
  X,
  FlaskConical,
  Calendar,
} from 'lucide-react';
import { formatDisplayDate } from '../../../utils/dateConstants';
import { PatientGender, PayerType, GuardianRelation, GUARDIAN_RELATIONS } from '../../../types/patient';
import {
  normalizePhone,
  isValidPhone,
  calculateAgeFromDob,
  PanelPatientSearchResult,
} from '../../../services/patientRegistryService';
import { PanelPatientSearchSection } from '../../../components/common/PanelPatientSearchSection';
import {
  fetchCorporatePanels,
  getActiveCorporatePanels,
  CorporatePanel,
} from '../../../services/panelService';
import { StaffUserService, fetchStaffUsers } from '../../../services/staffUserService';
import { StaffUser } from '../../../types/staffUser';
import {
  createEncounter,
  addServiceLine,
  EncounterType,
  InvoiceDetail,
} from '../../../services/invoiceService';
import { fetchServices } from '../../../services/serviceRatesService';
import { fetchDepartments, DepartmentService } from '../../../services/departmentService';
import { Department } from '../../../types/department';
import { HospitalService } from '../../../types/serviceRates';
import { TextInput, Select, Textarea, CNICInput, MultiSelect, ServiceChecklist, NumberInput } from '../../../components/forms/FormControls';
import { formatPKR } from '../../../utils/formatters';
import { focusNextField, focusNextFieldOnEnter } from '../../../utils/formNavigation';
import { useToast } from '../../../context/ToastContext';

export function departmentSupportsEncounter(dept: Department, type: EncounterType | ''): boolean {
  if (!type) return true;
  const code = (dept.code || '').trim().toUpperCase();
  const name = (dept.name || '').trim().toUpperCase();

  if (type === 'EMERGENCY') {
    return (
      code === 'ER' ||
      code === 'EMER' ||
      name.includes('EMERGENCY') ||
      dept.emergencyEnabled ||
      dept.type === 'Emergency' ||
      dept.type === 'Clinical'
    );
  }

  // OPD & Observation are clinical workflows available across clinical and surgical departments
  return dept.type === 'Clinical' || dept.type === 'Surgical' || dept.opdEnabled || dept.observationEnabled || true;
}

export function resolveDoctorDepartmentForEncounter(
  doc: StaffUser | null | undefined,
  allDepts: Department[],
  type: EncounterType | ''
): Department | null {
  if (!type) return null;

  if (doc) {
    const docDeptIds = doc.departmentIds?.length ? doc.departmentIds : doc.departmentId ? [doc.departmentId] : [];
    const docDepts = allDepts.filter((d) => docDeptIds.includes(d.id));

    if (type === 'EMERGENCY') {
      const exactEr = docDepts.find((d) => (d.code || '').toUpperCase() === 'ER' || d.name.toUpperCase().includes('EMERGENCY'));
      if (exactEr) return exactEr;
    }

    if (docDepts.length > 0) {
      return docDepts[0];
    }
  }

  // Fallback: general department matching this encounter type across hospital
  if (type === 'EMERGENCY') {
    return allDepts.find((d) => (d.code || '').toUpperCase() === 'ER' || d.name.toUpperCase().includes('EMERGENCY')) || allDepts[0] || null;
  }

  // For OPD / Observation, prefer a clinical department (e.g. General Medicine)
  return allDepts.find((d) => d.type === 'Clinical' || (d.code || '').toUpperCase() === 'GMED') || allDepts[0] || null;
}

export const WalkInIntakeView: React.FC = () => {
  const { currentPath } = useRouter();
  const toast = useToast();
  const formContainerRef = useRef<HTMLDivElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const doctorDropdownOpenRef = useRef(false);
  const handleEnterNext = (e: React.KeyboardEvent<HTMLElement>) => focusNextFieldOnEnter(e, formContainerRef.current);

  // Detect if user navigated from Dashboard or URL with a specific encounter type
  const queryType = useMemo<EncounterType | null>(() => {
    try {
      const searchString = currentPath.includes('?') ? currentPath.split('?')[1] : window.location.search;
      const urlParams = new URLSearchParams(searchString);
      const val = (urlParams.get('type') || urlParams.get('encounterType') || '').toUpperCase();
      if (val === 'OPD' || val === 'OBSERVATION' || val === 'EMERGENCY' || val === 'CUSTOM') {
        return val as EncounterType;
      }
    } catch {
      // fallback
    }
    return null;
  }, [currentPath]);

  // Direct navigation (no dashboard-supplied type) starts blank so Front Desk
  // must explicitly pick OPD / Observation / Emergency from the dropdown below.
  const [encounterType, setEncounterType] = useState<EncounterType | ''>(() => queryType || '');

  // Billing / Payer Category: New Patient (Self Pay) vs Panel Patient
  const [payerType, setPayerType] = useState<PayerType>('Self Pay');

  // Patient Registration Inline Fields (Always New Registration)
  const [fullName, setFullName] = useState('');
  const [fatherGuardianName, setFatherGuardianName] = useState('');
  const [guardianRelation, setGuardianRelation] = useState<GuardianRelation>('Father');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<PatientGender>('Male');
  const [weight, setWeight] = useState('');
  const [cnic, setCnic] = useState('');
  const [address, setAddress] = useState('');

  // Panel Specific Fields
  const [panelId, setPanelId] = useState('');
  const [panelMemberId, setPanelMemberId] = useState('');
  const [membershipDetails, setMembershipDetails] = useState<PanelMembershipDetails>({});
  const [selectedExistingPatient, setSelectedExistingPatient] = useState<PanelPatientSearchResult | null>(null);
  // Case authorization/guarantee (panel.md §15 backlog item 2) — required
  // by the backend before this encounter can be created when the selected
  // company's authorizationRequired policy is on.
  const [authorizationNumber, setAuthorizationNumber] = useState('');
  const [authorizationLimit, setAuthorizationLimit] = useState<number | ''>('');
  const [authorizationValidUntil, setAuthorizationValidUntil] = useState('');

  const handleUseExistingPatient = (match: PanelPatientSearchResult) => {
    setFullName(match.fullName.toUpperCase());
    setFatherGuardianName((match.guardianName || '').toUpperCase());
    setGuardianRelation((match.guardianRelation as GuardianRelation) || 'Father');
    setPrimaryPhone(match.phone || '');
    if (match.dob) {
      const ageNum = calculateAgeFromDob(match.dob);
      setAge(String(ageNum));
    }
    setGender((match.gender as PatientGender) || 'Male');
    setCnic(match.cnicOrPassport || '');
    setAddress(match.addressLine1 || '');
    setPanelId(match.panelId);
    setPanelMemberId(match.panelMemberId || '');
    setSelectedExistingPatient(match);
  };

  const handleClearExistingPatient = () => {
    setSelectedExistingPatient(null);
    setFullName('');
    setFatherGuardianName('');
    setGuardianRelation('Father');
    setPrimaryPhone('');
    setAge('');
    setGender('Male');
    setCnic('');
    setAddress('');
    setPanelId('');
    setPanelMemberId('');
    setMembershipDetails({});
    setAuthorizationNumber('');
    setAuthorizationLimit('');
    setAuthorizationValidUntil('');
  };

  // Department & Doctor selection (Department is Required)
  const [departments, setDepartments] = useState<Department[]>(() => DepartmentService.getDepartments().filter((d) => d.status === 'Active'));
  const [departmentId, setDepartmentId] = useState<string>('');
  const [doctorId, setDoctorId] = useState('');
  const [notes, setNotes] = useState('');

  // Additional billable services attached to the encounter (Emergency procedures,
  // Observation care add-ons, Lab tests, Injections, etc.) loaded live from DB.
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);

  // Live master data
  const [corporatePanels, setCorporatePanels] = useState<CorporatePanel[]>(getActiveCorporatePanels);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>(() => StaffUserService.getStaffUsers());
  const [services, setServices] = useState<HospitalService[]>([]);

  // Submission state
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    fetchCorporatePanels().then(setCorporatePanels).catch(() => { });
    fetchStaffUsers().then(setStaffUsers).catch(() => { });
    fetchDepartments().then((depts) => {
      const active = depts.filter((d) => d.status === 'Active');
      setDepartments(active);
    }).catch(() => { });
    fetchServices().then(setServices).catch(() => { });
    try {
      sessionStorage.removeItem('preferred_encounter_type');
    } catch { }
  }, []);

  useEffect(() => {
    if (queryType) {
      setEncounterType(queryType);
    }
  }, [queryType]);

  // Land the cursor directly in the Patient Full Name field on open, so Front
  // Desk can start typing immediately (walk-in registration is time-critical).
  useEffect(() => {
    const nameInput = formContainerRef.current?.querySelector<HTMLInputElement>('#patient-full-name');
    nameInput?.focus();
  }, []);

  // When switching to OPD, clear additional services because OPD is consultation only
  useEffect(() => {
    if (encounterType === 'OPD') {
      setSelectedServiceIds([]);
    }
  }, [encounterType]);

  // All active doctors across the hospital
  const allActiveDoctors = useMemo(
    () => staffUsers.filter((s) => s.staffCategory === 'Doctor' && s.status === 'ACTIVE'),
    [staffUsers]
  );

  const selectedDoctorObj = useMemo(
    () => allActiveDoctors.find((d) => d.id === doctorId),
    [allActiveDoctors, doctorId]
  );

  const handleDoctorChange = (selectedDocId: string) => {
    setDoctorId(selectedDocId);
    setDepartmentId('');
  };

  // Consulting Doctor dropdown gets two-step Enter behavior: a closed <select>
  // ignores Enter by default, so the first Enter press opens the native
  // options popup; arrow keys + a second Enter then pick the highlighted
  // doctor (native browser behavior once the popup is open) and onChange
  // below advances focus to the next field automatically.
  const handleDoctorSelectKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>) => {
    if (e.key !== 'Enter') return;
    if (doctorDropdownOpenRef.current) return;
    e.preventDefault();
    doctorDropdownOpenRef.current = true;
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

  const doctorsForEncounterType = useMemo(
    () => doctorsForEncounter(staffUsers, encounterType),
    [staffUsers, encounterType]
  );

  // If the selected doctor no longer supports the (newly changed) Encounter
  // Service, clear the doctor so Front Desk re-picks an authorized doctor.
  useEffect(() => {
    if (doctorId && !doctorsForEncounterType.some((d) => d.id === doctorId)) {
      setDoctorId('');
      setDepartmentId('');
    }
  }, [doctorsForEncounterType, doctorId]);

  // Keep Clinical Department synchronized with selected doctor or encounter type
  useEffect(() => {
    if (selectedDoctorObj) {
      const docDeptIds = selectedDoctorObj.departmentIds?.length ? selectedDoctorObj.departmentIds : selectedDoctorObj.departmentId ? [selectedDoctorObj.departmentId] : [];
      if (docDeptIds.length > 0 && !docDeptIds.includes(departmentId)) {
        setDepartmentId(docDeptIds[0]);
      }
    }
  }, [encounterType, selectedDoctorObj, departments, departmentId]);

  // Core encounter services use the same department scope as the selected fee,
  // PLUS whatever real services the selected doctor is actually assigned to
  // (staff.md §4/§7) — a doctor's Assigned Services always count, even when a
  // service is hospital-wide (no department) or scoped to a different
  // department than the doctor's primary one. No hardcoded fallback list.
  const encounterServices = useMemo(() => {
    const departmentScoped = servicesForSource(services, departmentId || HOSPITAL_SERVICE_SOURCE);
    const assignedIds = selectedDoctorObj?.assignedServiceIds;
    if (!assignedIds || assignedIds.length === 0) return departmentScoped;
    const merged = new Map(departmentScoped.map((s) => [s.id, s]));
    services
      .filter((s) => s.status === 'Active' && assignedIds.includes(s.id))
      .forEach((s) => merged.set(s.id, s));
    return Array.from(merged.values());
  }, [services, departmentId, selectedDoctorObj]);
  const opdCoreService = useMemo(() => {
    return (
      encounterServices.find((s) => s.encounterType === 'OPD' && s.isDefaultEncounterService) ||
      encounterServices.find((s) => s.encounterType === 'OPD') ||
      null
    );
  }, [encounterServices]);

  const obsCoreService = useMemo(() => {
    return (
      encounterServices.find((s) => s.encounterType === 'OBSERVATION' && s.isDefaultEncounterService) ||
      encounterServices.find((s) => s.encounterType === 'OBSERVATION') ||
      null
    );
  }, [encounterServices]);

  const erCoreService = useMemo(() => {
    return (
      encounterServices.find((s) => s.encounterType === 'EMERGENCY' && s.isDefaultEncounterService) ||
      encounterServices.find((s) => s.encounterType === 'EMERGENCY') ||
      null
    );
  }, [encounterServices]);

  const selectedCoreService = useMemo(() => {
    if (encounterType === 'OPD') return opdCoreService;
    if (encounterType === 'OBSERVATION') return obsCoreService;
    if (encounterType === 'EMERGENCY') return erCoreService;
    return null;
  }, [encounterType, opdCoreService, obsCoreService, erCoreService]);

  const isSelectedCoreServiceInactive = Boolean(selectedCoreService && selectedCoreService.status !== 'Active');

  // Never fall back to another department's encounter service.
  const defaultEncounterService = useMemo<HospitalService | null>(() => {
    if (!encounterType) return null;
    const active = encounterServices;
    return active.find((service) => service.encounterType === encounterType && service.isDefaultEncounterService)
      || active.find((service) => service.encounterType === encounterType)
      || null;
  }, [encounterServices, encounterType]);

  // All active billable services in the database that Front Desk can add to the encounter
  // (Observation services, Emergency procedures, Lab tests, Injections, etc.)
  // Excludes only the base encounter service itself so the base fee is not duplicated.
  const additionalBillableServices = useMemo<HospitalService[]>(() => {
    return services.filter(
      (s) =>
        s.status === 'Active' &&
        s.id !== defaultEncounterService?.id
    );
  }, [services, defaultEncounterService]);

  const selectedAdditionalServices = useMemo(
    () => additionalBillableServices.filter((s) => selectedServiceIds.includes(s.id)),
    [additionalBillableServices, selectedServiceIds]
  );

  const selectedServicesTotal = useMemo(
    () => selectedAdditionalServices.reduce((sum, s) => sum + s.standardRate, 0),
    [selectedAdditionalServices]
  );

  // Additional services cascading selection (Department / Source -> Service)
  const [selectedServiceStream, setSelectedServiceStream] = useState<string>(HOSPITAL_SERVICE_SOURCE);

  const serviceStreamOptions = useMemo(() => serviceSourceOptions(departments), [departments]);

  const filteredStreamServices = useMemo(
    () => servicesForSource(additionalBillableServices, selectedServiceStream),
    [additionalBillableServices, selectedServiceStream]
  );

  useEffect(() => {
    setSelectedServiceIds((ids) => retainAvailableServiceIds(ids, additionalBillableServices));
  }, [additionalBillableServices]);

  const handleRemoveAdditionalService = (idToRemove: string) => {
    setSelectedServiceIds((prev) => prev.filter((id) => id !== idToRemove));
  };

  const getServiceStreamBadge = (s: HospitalService) => {
    const isRad =
      s.category === 'Radiology' ||
      (s.departmentName || '').toLowerCase().includes('radiology') ||
      (s.departmentName || '').toLowerCase().includes('imaging') ||
      (s.name || '').toLowerCase().includes('x-ray') ||
      (s.name || '').toLowerCase().includes('ultrasound') ||
      (s.name || '').toLowerCase().includes('ct scan') ||
      (s.name || '').toLowerCase().includes('mri');
    if (isRad) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
          Radiology (Outsourced)
        </span>
      );
    }
    const isLab =
      s.serviceStream === 'LAB' ||
      s.category === 'Laboratory' ||
      s.category === 'Diagnostic' ||
      (s.departmentName || '').toLowerCase().includes('lab') ||
      (s.departmentName || '').toLowerCase().includes('pathology');
    if (isLab) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
          Laboratory (Outsourced)
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
        Hospital Services
      </span>
    );
  };

  // Clear selected add-on services when Encounter Service changes
  useEffect(() => {
    if (selectedServiceIds.length > 0) {
      setSelectedServiceIds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounterType]);

  const handleReset = () => {
    setFullName('');
    setFatherGuardianName('');
    setGuardianRelation('Father');
    setPrimaryPhone('');
    setAge('');
    setGender('Male');
    setWeight('');
    setPayerType('Self Pay');
    setPanelId('');
    setPanelMemberId('');
    setMembershipDetails({});
    setAuthorizationNumber('');
    setAuthorizationLimit('');
    setAuthorizationValidUntil('');
    setCnic('');
    setEncounterType(queryType || '');
    setDepartmentId('');
    setDoctorId('');
    setNotes('');
    setSelectedServiceIds([]);
    setFormError(null);
    setCreatedInvoiceId(null);
    setSelectedExistingPatient(null);
  };

  const handleCreateEncounter = async () => {
    setFormError(null);
    // Helper: show inline banner + toast together
    const showValidationError = (msg: string) => {
      setFormError(msg);
      toast.error(msg, 'Validation Error');
    };

    // 0. Encounter Service Selection
    if (!encounterType) {
      showValidationError('Please select an Encounter Service (e.g. OPD Consultation, Observation Care, or Emergency Triage).');
      return;
    }

    // 1. Patient Info Validation
    if (!fullName.trim()) {
      showValidationError('Patient Full Name is required.');
      return;
    }
    if (!fatherGuardianName.trim()) {
      showValidationError('Father / Guardian Name is required.');
      return;
    }
    if (!primaryPhone.trim()) {
      showValidationError('Contact Phone is required.');
      return;
    }
    if (!isValidPhone(primaryPhone)) {
      showValidationError('Please enter a valid Pakistani mobile number (at least 10 digits, e.g. 0300-1234567).');
      return;
    }
    const ageNum = Number(age);
    if (!age.trim() || isNaN(ageNum) || ageNum < 0 || ageNum > 130) {
      showValidationError('Please enter a valid age in years (0 - 130).');
      return;
    }

    // 2. Panel Details Validation
    if (payerType === 'Corporate / Panel') {
      if (!selectedExistingPatient) {
        showValidationError('Front Desk cannot register new panel patients. Please search and select an existing verified panel patient from the registry above, or contact Super Admin / Admin to register them.');
        return;
      }
      if (!panelId) {
        showValidationError('Please select a Corporate Panel.');
        return;
      }
      if (corporatePanels.find(p => p.id === panelId)?.memberIdRequired && !panelMemberId.trim()) {
        showValidationError('Panel Member ID / Card Number is required for Corporate / Panel billing.');
        return;
      }
      if (corporatePanels.find(p => p.id === panelId)?.authorizationRequired && !authorizationNumber.trim()) {
        showValidationError('Authorization / Guarantee Number is required by this company before billing.');
        return;
      }
    }

    // Doctor assignment is optional; use the selected service when unassigned.
    let effectiveDeptId = '';
    if (!doctorId) {
      // No doctor context: attribute the lead department from the first selected
      // service (e.g. Laboratory / Radiology / a clinical department) so the
      // invoice header reflects the actual department billed, not a generic one.
      // Each line item still carries its own service's department regardless.
      effectiveDeptId = defaultEncounterService?.departmentId || additionalBillableServices.find((s) => s.id === selectedServiceIds[0])?.departmentId || '';
    } else {
      const targetDept = resolveDoctorDepartmentForEncounter(selectedDoctorObj, departments, encounterType);
      effectiveDeptId = targetDept?.id || departmentId;
      if (!effectiveDeptId) {
        const doc = allActiveDoctors.find((s) => s.id === doctorId);
        const fallbackTarget = resolveDoctorDepartmentForEncounter(doc, departments, encounterType);
        if (fallbackTarget?.id) {
          effectiveDeptId = fallbackTarget.id;
          setDepartmentId(fallbackTarget.id);
        } else if (doc?.departmentId) {
          effectiveDeptId = doc.departmentId;
          setDepartmentId(doc.departmentId);
        } else if (departments.length > 0) {
          const streamDept = departments.find((d) => departmentSupportsEncounter(d, encounterType));
          effectiveDeptId = streamDept ? streamDept.id : departments[0].id;
          setDepartmentId(effectiveDeptId);
        }
      }

      if (!effectiveDeptId) {
        showValidationError('Clinical Department could not be determined. Please ensure hospital departments exist.');
        return;
      }
    }

    // 4. Default Encounter Service Validation
    if (isSelectedCoreServiceInactive) {
      showValidationError(`The ${selectedCoreService?.name || encounterType} service is currently deactivated in Services & Rates. Please activate it in setup to proceed.`);
      return;
    }

    if (encounterType === 'OPD' && !defaultEncounterService) {
      showValidationError(servicesForSource(services, departmentId || HOSPITAL_SERVICE_SOURCE).length === 0
        ? NO_ACTIVE_DEPARTMENT_SERVICES
        : 'No default OPD Consultation service is configured. Please ask Admin to configure Services & Rates.');
      return;
    }

    if (!defaultEncounterService && selectedServiceIds.length === 0) {
      showValidationError(`No default rate configured for ${encounterType} and no services selected. Please add at least one service above or configure Services & Rates.`);
      return;
    }

    setIsSaving(true);
    try {
      const birthYear = new Date().getFullYear() - Math.max(0, Math.floor(ageNum));
      const dob = `${birthYear}-01-01`;
      const weightNote = weight.trim() ? `Weight: ${weight.trim()} kg` : '';
      const combinedNotes = [notes.trim(), weightNote].filter(Boolean).join(' | ');

      let targetInvoiceId = '';

      if (payerType === 'Self Pay') {
        // Direct Self Pay: Instant Encounter & Invoice shell
        const invoice: InvoiceDetail = await createEncounter({
          encounterType,
          newSelfPayPatient: {
            fullName: fullName.trim(),
            guardianName: fatherGuardianName.trim(),
            gender,
            dob,
            phone: normalizePhone(primaryPhone),
          },
          departmentId: effectiveDeptId || undefined,
          doctorStaffId: doctorId || undefined,
          notes: combinedNotes,
        });
        targetInvoiceId = invoice.id;
      } else {
        // Corporate / Panel: Must use selected existing panel patient (registration restricted to Super Admin / Admin)
        if (!selectedExistingPatient?.id) {
          setFormError('Front Desk cannot register new panel patients. Please search and select an existing verified panel patient.');
          setIsSaving(false);
          return;
        }

        const invoice = await createEncounter({
          encounterType,
          panelPatientId: selectedExistingPatient.id,
          departmentId: effectiveDeptId || undefined,
          doctorStaffId: doctorId || undefined,
          notes: combinedNotes,
          authorizationNumber: authorizationNumber.trim() || undefined,
          authorizationLimit: authorizationLimit === '' ? undefined : Number(authorizationLimit),
          authorizationValidUntil: authorizationValidUntil.trim() || undefined,
        });
        targetInvoiceId = invoice.id;
      }

      // Automatically attach Admin-configured default encounter service to invoice
      if (targetInvoiceId && defaultEncounterService) {
        try {
          await addServiceLine(targetInvoiceId, {
            serviceRateId: defaultEncounterService.id,
            quantity: 1,
            performedByStaffId: doctorId || undefined,
          });
        } catch (srvErr) {
          console.warn('Could not auto-attach encounter service line:', srvErr);
        }
      }

      // Attach any additional services Front Desk selected (Emergency procedures,
      // Observation care add-ons, Lab tests, Injections, etc.) — each becomes its
      // own invoice line, so the amount adds directly onto the encounter invoice total.
      if ((encounterType === 'OBSERVATION' || encounterType === 'EMERGENCY' || encounterType === 'CUSTOM') && targetInvoiceId && selectedServiceIds.length > 0) {
        for (const serviceId of selectedServiceIds) {
          try {
            await addServiceLine(targetInvoiceId, {
              serviceRateId: serviceId,
              quantity: 1,
              performedByStaffId: doctorId || undefined,
            });
          } catch (srvErr) {
            console.warn('Could not attach additional service line:', srvErr);
          }
        }
      }

      setCreatedInvoiceId(targetInvoiceId);
      toast.success(
        `Encounter created successfully. Invoice has been opened.`,
        'Encounter Created'
      );
    } catch (err: any) {
      const errMsg = err?.response?.data?.error?.message || err?.message || 'Failed to create encounter & invoice.';
      setFormError(errMsg);
      toast.error(errMsg, 'Encounter Failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div ref={formContainerRef} className="w-full max-w-7xl mx-auto space-y-4 animate-in fade-in duration-150 pb-12">
      {/* Breadcrumb Header */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
          <span className="text-slate-600">Front Desk</span>
          <span className="text-slate-300">/</span>
          <span className="uppercase text-slate-500 font-semibold tracking-wide">PATIENT FLOW</span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-600 font-medium">Walk-In / Encounter Intake</span>
          {encounterType && (
            <>
              <span className="text-slate-300">/</span>
              <span className="text-slate-900 font-bold">
                {encounterType === 'OPD'
                  ? 'OPD'
                  : encounterType === 'OBSERVATION'
                    ? 'Observation'
                    : encounterType === 'EMERGENCY'
                      ? 'Emergency'
                      : 'Custom Billing'}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border bg-slate-50 text-slate-700 border-slate-200">
            <Calendar className="h-3.5 w-3.5 text-[#08775A]" />
            <span>Entry Date: {formatDisplayDate(new Date())}</span>
          </div>
          <span
            className={`px-2.5 py-1 rounded-md text-xs font-bold border uppercase tracking-wide ${encounterType === 'OPD'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : encounterType === 'OBSERVATION'
                ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                : encounterType === 'EMERGENCY'
                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                  : encounterType === 'CUSTOM'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
          >
            {encounterType === 'CUSTOM' ? 'Custom Billing Intake' : encounterType ? `${encounterType} Intake` : 'Walk-In Intake'}
          </span>
          <button
            type="button"
            onClick={handleReset}
            title="Reset Form"
            className="px-2.5 py-1 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="h-3 w-3 text-slate-400" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {formError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700 font-medium animate-in fade-in">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{formError}</span>
        </div>
      )}

      {/* 0. Encounter Service Selector (OPD, Observation, Emergency) — only shown when arriving without pre-selection */}
      {!queryType && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Select Encounter Service <span className="text-rose-500">*</span>
              </label>
              <p className="text-xs text-slate-500 mt-0.5">
                Choose the care stream for this walk-in patient: OPD, Observation, Emergency, or Custom Billing
              </p>
            </div>
            {encounterType ? (
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border uppercase tracking-wide ${
                  encounterType === 'OPD'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : encounterType === 'OBSERVATION'
                    ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                    : encounterType === 'EMERGENCY'
                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                Active: {encounterType}
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                Selection Required
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 1. OPD Consultation Button */}
            <button
              type="button"
              onClick={() => setEncounterType('OPD')}
              className={`p-3.5 rounded-xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${
                encounterType === 'OPD'
                  ? 'border-[#08775A] bg-[#effaf5] shadow-xs ring-1 ring-[#08775A]/20'
                  : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700'
              }`}
            >
              <div
                className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                  encounterType === 'OPD'
                    ? 'bg-[#08775A] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                <Stethoscope className="h-5 w-5" />
              </div>
              <div className="grow min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-slate-900">OPD Consultation</span>
                  <div className="flex items-center gap-1.5">
                    {opdCoreService && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        opdCoreService.status === 'Active'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>
                        {opdCoreService.status === 'Active' ? formatPKR(opdCoreService.standardRate) : 'Inactive'}
                      </span>
                    )}
                    <div
                      className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                        encounterType === 'OPD'
                          ? 'border-[#08775A] bg-[#08775A]'
                          : 'border-slate-300'
                      }`}
                    >
                      {encounterType === 'OPD' && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                  Outpatient clinic, specialist consult &amp; prescriptions
                </p>
              </div>
            </button>

            {/* 2. Observation Care Button */}
            <button
              type="button"
              onClick={() => setEncounterType('OBSERVATION')}
              className={`p-3.5 rounded-xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${
                encounterType === 'OBSERVATION'
                  ? 'border-indigo-600 bg-indigo-50/70 shadow-xs ring-1 ring-indigo-500/20'
                  : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700'
              }`}
            >
              <div
                className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                  encounterType === 'OBSERVATION'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                <Eye className="h-5 w-5" />
              </div>
              <div className="grow min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-slate-900">Observation Care</span>
                  <div className="flex items-center gap-1.5">
                    {obsCoreService && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        obsCoreService.status === 'Active'
                          ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>
                        {obsCoreService.status === 'Active' ? formatPKR(obsCoreService.standardRate) : 'Inactive'}
                      </span>
                    )}
                    <div
                      className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                        encounterType === 'OBSERVATION'
                          ? 'border-indigo-600 bg-indigo-600'
                          : 'border-slate-300'
                      }`}
                    >
                      {encounterType === 'OBSERVATION' && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                  Short-stay monitoring, IV drip therapy &amp; vitals check
                </p>
              </div>
            </button>

            {/* 3. Emergency Triage Button */}
            <button
              type="button"
              onClick={() => setEncounterType('EMERGENCY')}
              className={`p-3.5 rounded-xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${
                encounterType === 'EMERGENCY'
                  ? 'border-rose-600 bg-rose-50/70 shadow-xs ring-1 ring-rose-500/20'
                  : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700'
              }`}
            >
              <div
                className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                  encounterType === 'EMERGENCY'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="grow min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-slate-900">Emergency Triage</span>
                  <div className="flex items-center gap-1.5">
                    {erCoreService && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        erCoreService.status === 'Active'
                          ? 'bg-rose-50 text-rose-800 border-rose-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>
                        {erCoreService.status === 'Active' ? formatPKR(erCoreService.standardRate) : 'Inactive'}
                      </span>
                    )}
                    <div
                      className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                        encounterType === 'EMERGENCY'
                          ? 'border-rose-600 bg-rose-600'
                          : 'border-slate-300'
                      }`}
                    >
                      {encounterType === 'EMERGENCY' && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                  24/7 urgent resuscitation, acute trauma &amp; triage care
                </p>
              </div>
            </button>

            {/* 4. Custom Billing Button */}
            <button
              type="button"
              onClick={() => setEncounterType('CUSTOM')}
              className={`p-3.5 rounded-xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${
                encounterType === 'CUSTOM'
                  ? 'border-amber-600 bg-amber-50/70 shadow-xs ring-1 ring-amber-500/20'
                  : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700'
              }`}
            >
              <div
                className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                  encounterType === 'CUSTOM'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                <FlaskConical className="h-5 w-5" />
              </div>
              <div className="grow min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-slate-900">Custom Billing</span>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                        encounterType === 'CUSTOM'
                          ? 'border-amber-600 bg-amber-600'
                          : 'border-slate-300'
                      }`}
                    >
                      {encounterType === 'CUSTOM' && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                  Lab / Radiology / any service only — no doctor required
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Landscape Two-Column Grid: Left = Patient Demographics & Payer; Right = Service, Doctor, Fee & Submit */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: Patient Registration (7 cols on desktop) */}
        <div className="lg:col-span-7 space-y-4">
          {/* 1. Patient Category Cards (New Patient vs Panel Patient) */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3">
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
                className={`p-3 rounded-xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${payerType === 'Self Pay'
                  ? 'border-[#08775A] bg-[#effaf5] shadow-xs ring-1 ring-[#08775A]/20'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
              >
                <div
                  className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${payerType === 'Self Pay' ? 'bg-[#08775A] text-white shadow-xs' : 'bg-slate-100 text-slate-500'
                    }`}
                >
                  <UserPlus className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900">New Patient</span>
                    {payerType === 'Self Pay' && (
                      <CheckCircle2 className="h-4 w-4 text-[#08775A] shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] font-semibold text-[#08775A] mt-0.5">Self Pay / General Walk-In</p>
                  <span className="text-[10px] text-slate-500 block mt-0.5 leading-tight">
                    Cash or Card. Immediate invoice shell.
                  </span>
                </div>
              </button>

              {/* Panel Patient Card */}
              <button
                type="button"
                onClick={() => setPayerType('Corporate / Panel')}
                className={`p-3 rounded-xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${payerType === 'Corporate / Panel'
                  ? 'border-amber-500 bg-amber-50/70 shadow-xs ring-1 ring-amber-500/20'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
              >
                <div
                  className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${payerType === 'Corporate / Panel' ? 'bg-amber-600 text-white shadow-xs' : 'bg-slate-100 text-slate-500'
                    }`}
                >
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900">Panel Patient</span>
                    {payerType === 'Corporate / Panel' && (
                      <CheckCircle2 className="h-4 w-4 text-amber-600 shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] font-semibold text-amber-800 mt-0.5">Corporate / Insurance</p>
                  <span className="text-[10px] text-slate-500 block mt-0.5 leading-tight">
                    Credit encounter backed by company tariff.
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* 2. Patient Demographics & Information Form */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3.5">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-[#08775A]" /> 2. Patient Information
              </span>
              <span className={`text-[10.5px] font-medium px-2 py-0.5 rounded ${
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
                  : 'Instant Walk-In Entry'}
              </span>
            </div>

            {/* Corporate / Panel Search Section (When Panel is active) */}
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
                label="Patient Full Name"
                required
                disabled={payerType === 'Corporate / Panel'}
                placeholder={payerType === 'Corporate / Panel' ? (selectedExistingPatient ? selectedExistingPatient.fullName : 'Search and select panel patient above') : "Patient's legal name"}
                value={fullName}
                onChange={(e) => setFullName(e.target.value.toUpperCase())}
                onKeyDown={handleEnterNext}
              />
              <TextInput
                label="Father / Guardian Name"
                required
                disabled={payerType === 'Corporate / Panel'}
                placeholder={payerType === 'Corporate / Panel' ? (selectedExistingPatient ? (selectedExistingPatient.guardianName || 'N/A') : 'Search and select panel patient above') : 'Father / Husband / Guardian'}
                value={fatherGuardianName}
                onChange={(e) => setFatherGuardianName(e.target.value.toUpperCase())}
                onKeyDown={handleEnterNext}
              />
            </div>

            {/* Contact, Age, Weight */}
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
              <TextInput
                label="Weight (kg) (optional)"
                type="number"
                min="1"
                max="300"
                step="0.5"
                placeholder="e.g. 68"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                onKeyDown={handleEnterNext}
              />
            </div>

            {/* Gender */}
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
                    } ${gender === g
                      ? 'bg-[#08775A] text-white border-[#08775A] shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                  >
                    {g === 'Other / Not Specified' ? 'Other' : g}
                  </button>
                ))}
              </div>
            </div>

            {/* Corporate / Panel Specific Fields (Only if Panel selected) */}
            {payerType === 'Corporate / Panel' && (
              <div className="pt-3 border-t border-amber-200 space-y-3 bg-amber-50/40 p-3 rounded-lg animate-in fade-in">
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
                    onChange={(e) => setPanelId(e.target.value)}
                    onKeyDown={handleEnterNext}
                    hint={selectedExistingPatient ? "Populated from the selected panel patient's registry record." : "Select patient above."}
                  />
                  <TextInput
                    label={corporatePanels.find(p => p.id === panelId)?.memberIdLabel || 'Panel Member ID / Card #'}
                    required={corporatePanels.find(p => p.id === panelId)?.memberIdRequired}
                    disabled={true}
                    placeholder="Auto-filled from registry"
                    value={panelMemberId}
                    onChange={(e) => setPanelMemberId(e.target.value.toUpperCase())}
                    onKeyDown={handleEnterNext}
                  />
                  {corporatePanels.find(p => p.id === panelId)?.authorizationRequired && (
                    <>
                      <TextInput
                        label="Authorization / Guarantee Number"
                        required
                        placeholder="e.g. AUTH-2026-00123"
                        value={authorizationNumber}
                        onChange={(e) => setAuthorizationNumber(e.target.value.toUpperCase())}
                        onKeyDown={handleEnterNext}
                        hint="Required by this company before billing."
                      />
                      <NumberInput
                        label="Authorization Limit (PKR)"
                        placeholder="Optional case control"
                        value={authorizationLimit}
                        onChange={(e) => setAuthorizationLimit(e.target.value === '' ? '' : Number(e.target.value))}
                        onKeyDown={handleEnterNext}
                      />
                      <TextInput
                        label="Authorization Valid Until"
                        lang="en-GB" type="date"
                        value={authorizationValidUntil}
                        onChange={(e) => setAuthorizationValidUntil(e.target.value)}
                        onKeyDown={handleEnterNext}
                        hint="Charges are blocked once this date passes, until renewed."
                      />
                    </>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <CNICInput
                    label="CNIC (optional)"
                    disabled={!!selectedExistingPatient}
                    placeholder="XXXXX-XXXXXXX-X"
                    value={cnic}
                    onChange={(e) => setCnic(e.target.value)}
                    onKeyDown={handleEnterNext}
                  />
                  <Select
                    label="Guardian Relation (optional)"
                    disabled={!!selectedExistingPatient}
                    options={GUARDIAN_RELATIONS.map((r) => ({ label: r, value: r }))}
                    value={guardianRelation}
                    onChange={(e) => setGuardianRelation(e.target.value as GuardianRelation)}
                    onKeyDown={handleEnterNext}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Doctor, Fee Summary & Submit (5 cols on desktop) */}
        <div className="lg:col-span-5 space-y-4">
          {/* 3. Consulting Doctor Assignment (Service fixed, Department auto-resolved) */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3 shrink-0">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                3. Consulting Doctor <span className="text-slate-400 normal-case font-medium">(Optional)</span>
              </label>
              <span className="text-[10.5px] text-[#08775A] font-semibold bg-[#effaf5] border border-emerald-200 px-2 py-0.5 rounded">
                {encounterType === 'OPD'
                  ? 'OPD Consultation'
                  : encounterType === 'OBSERVATION'
                    ? 'Observation Care'
                    : encounterType === 'EMERGENCY'
                      ? 'Emergency Triage'
                      : encounterType === 'CUSTOM'
                        ? 'Custom Billing'
                        : 'Encounter'}
              </span>
            </div>

            {/* Consulting Doctor Dropdown ONLY */}
            <Select
              label="Consulting Doctor (Optional)"
              options={[
                { label: 'Not Assigned / Select Later', value: '' },
                ...doctorsForEncounterType.map((doctor) => ({ label: doctor.fullName, value: doctor.id })),
              ]}
              value={doctorId}
              onChange={(e) => {
                handleDoctorChange(e.target.value);
                doctorDropdownOpenRef.current = false;
                if (e.target.value) {
                  focusNextField(e.currentTarget, formContainerRef.current);
                }
              }}
              onKeyDown={handleDoctorSelectKeyDown}
              onBlur={() => {
                doctorDropdownOpenRef.current = false;
              }}
            />


          </div>

          {/* 3b. Additional Services / Procedures Selection (OBSERVATION, EMERGENCY & CUSTOM ONLY - Removed from OPD) */}
          {(encounterType === 'OBSERVATION' || encounterType === 'EMERGENCY' || encounterType === 'CUSTOM') && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#08775A] flex items-center gap-1.5">
                    <Plus className="h-3.5 w-3.5" />
                    {encounterType === 'OBSERVATION'
                      ? 'Observation Services & Investigations'
                      : encounterType === 'EMERGENCY'
                        ? 'Emergency Services, Procedures & Investigations'
                        : encounterType === 'CUSTOM'
                          ? 'Custom Billing Services & Tests'
                          : 'Additional Services / Tests'}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Select source (Hospital Services, Outsourced Lab, Radiology) and add required services
                  </p>
                </div>
                {selectedAdditionalServices.length > 0 && (
                  <span className="text-xs font-bold text-[#08775A] bg-[#effaf5] px-2.5 py-1 rounded-lg border border-[#c2e7db]">
                    {selectedAdditionalServices.length} Selected • {formatPKR(selectedServicesTotal)}
                  </span>
                )}
              </div>

              {/* Clean, well-aligned controls: Category on top, Service + Add button on row 2 */}
              <div className="space-y-3 pt-1">
                {/* 1. Category / Source Selection */}
                <div>
                  <Select
                    label="1. Service Category / Source"
                    options={serviceStreamOptions}
                    value={selectedServiceStream}
                    onChange={(e) => setSelectedServiceStream(e.target.value)}
                    onKeyDown={handleEnterNext}
                  />
                  <p className="text-[11px] text-slate-500 mt-1 pl-0.5">
                    {selectedServiceStream === 'HOSPITAL_SERVICES'
                      ? 'Internal hospital procedures, clinical care & nursing'
                      : 'Departmental clinical services'}
                  </p>
                </div>

                {/* 2. Searchable Multi-Select Service Checklist */}
                <ServiceChecklist
                  label="2. Select Services / Procedures / Tests"
                  services={filteredStreamServices}
                  selectedServiceIds={selectedServiceIds}
                  onChange={setSelectedServiceIds}
                  emptyMessage={
                    filteredStreamServices.length === 0
                      ? NO_ACTIVE_DEPARTMENT_SERVICES
                      : 'No services available in this category'
                  }
                />
              </div>

              {/* Added Services Table / List */}
              {selectedAdditionalServices.length > 0 ? (
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50 mt-2">
                  <div className="px-3 py-2 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <span>Selected Services ({selectedAdditionalServices.length})</span>
                    <button
                      type="button"
                      onClick={() => setSelectedServiceIds([])}
                      className="text-[11px] text-rose-600 hover:text-rose-800 font-semibold lowercase"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="divide-y divide-slate-200 max-h-56 overflow-y-auto">
                    {selectedAdditionalServices.map((s) => (
                      <div
                        key={s.id}
                        className="px-3 py-2.5 flex items-center justify-between bg-white hover:bg-slate-50/80 transition-colors text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          {getServiceStreamBadge(s)}
                          <div>
                            <span className="font-semibold text-slate-800">{s.name}</span>
                            <span className="font-mono text-[11px] text-slate-400 ml-1.5">({s.code})</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-slate-900">{formatPKR(s.standardRate)}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAdditionalService(s.id)}
                            className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                            title="Remove Service"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center text-xs text-slate-400">
                  No additional services added yet. Select category &amp; service above, then click <strong>Add</strong>.
                </div>
              )}
            </div>
          )}

          {/* 4. Billing & Standard Fee Summary Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5 text-[#08775A]" /> Billing Summary
              </span>
              {defaultEncounterService ? (
                <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                  {defaultEncounterService.code}
                </span>
              ) : selectedAdditionalServices.length > 0 ? (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                  {selectedAdditionalServices.length} {selectedAdditionalServices.length === 1 ? 'Service' : 'Services'}
                </span>
              ) : null}
            </div>

            {departmentId && encounterServices.length === 0 && (
              <p className="text-xs text-slate-500">{NO_ACTIVE_DEPARTMENT_SERVICES}</p>
            )}
            {!encounterType ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
                <Receipt className="h-4 w-4 shrink-0 text-slate-400" />
                <span>Select an Encounter Service above to calculate standard rates.</span>
              </div>
            ) : isSelectedCoreServiceInactive ? (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-900">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <span className="font-bold block">{selectedCoreService?.name || encounterType} is Deactivated</span>
                  <span className="text-[11px] text-amber-800">
                    This core encounter service is currently marked Inactive in Services &amp; Rates. Please activate it in setup to proceed with registration.
                  </span>
                </div>
              </div>
            ) : defaultEncounterService ? (
              <div className="p-3.5 rounded-xl bg-[#effaf5] border border-[#c2e7db] space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-xs text-slate-900">{defaultEncounterService.name}</div>
                    <div className="text-[10.5px] text-slate-500 mt-0.5">
                      {defaultEncounterService.departmentName || defaultEncounterService.category || 'Clinical Encounter'}
                    </div>
                  </div>
                  <div className="text-right">
                    {payerType === 'Self Pay' ? (
                      <div>
                        <div className="text-lg font-black text-[#08775A]">
                          {formatPKR(defaultEncounterService.standardRate)}
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">Standard Patient Fee</div>
                      </div>
                    ) : (
                      <div>
                        <span className="text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300 inline-block">
                          Panel Credit
                        </span>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Base: {formatPKR(defaultEncounterService.standardRate)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {encounterType !== 'OPD' && selectedAdditionalServices.length > 0 && (
                  <div className="pt-2 border-t border-emerald-200/70 space-y-1">
                    {selectedAdditionalServices.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-[11px] text-slate-600">
                        <span>{s.name}</span>
                        <span className="font-semibold">{formatPKR(s.standardRate)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-1.5 border-t border-emerald-200/70 text-xs">
                      <span className="font-bold text-slate-800">
                        Total {payerType === 'Self Pay' ? 'Patient Fee' : 'Billable'}
                      </span>
                      <span className="font-black text-[#08775A]">
                        {formatPKR(defaultEncounterService.standardRate + selectedServicesTotal)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : selectedAdditionalServices.length > 0 ? (
              <div className="p-3.5 rounded-xl bg-[#effaf5] border border-[#c2e7db] space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-xs text-slate-900">Encounter Services &amp; Procedures</div>
                    <div className="text-[10.5px] text-slate-500 mt-0.5">
                      No base {encounterType} consultation configured — billing selected services directly
                    </div>
                  </div>
                  <div className="text-right">
                    {payerType === 'Self Pay' ? (
                      <div>
                        <div className="text-lg font-black text-[#08775A]">
                          {formatPKR(selectedServicesTotal)}
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">Total Patient Fee</div>
                      </div>
                    ) : (
                      <div>
                        <span className="text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300 inline-block">
                          Panel Credit
                        </span>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Total: {formatPKR(selectedServicesTotal)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-emerald-200/70 space-y-1">
                  {selectedAdditionalServices.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-[11px] text-slate-600">
                      <span>{s.name}</span>
                      <span className="font-semibold">{formatPKR(s.standardRate)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1.5 border-t border-emerald-200/70 text-xs">
                    <span className="font-bold text-slate-800">
                      Total {payerType === 'Self Pay' ? 'Patient Fee' : 'Billable'}
                    </span>
                    <span className="font-black text-[#08775A]">
                      {formatPKR(selectedServicesTotal)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2 text-xs text-amber-800">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  No default rate configured for <strong>{encounterType}</strong> in Services &amp; Rates. Please select services above to bill this encounter.
                </span>
              </div>
            )}
          </div>

          {/* 5. Notes & Clinical Vitals */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="intake-notes-textarea" className="text-xs font-semibold text-slate-700">
                Notes &amp; Clinical Vitals (optional)
              </label>
              <button
                type="button"
                onClick={() => {
                  submitButtonRef.current?.focus();
                  submitButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-[#08775A] hover:text-[#065f46] hover:underline cursor-pointer"
                title="Click or press Enter in notes to jump straight to Register button"
              >
                <span>Jump to Register Button ➔</span>
              </button>
            </div>
            <textarea
              id="intake-notes-textarea"
              rows={2}
              placeholder="e.g. Presenting complaints, BP, pulse, referral notes... (Press Enter to jump to Register button)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitButtonRef.current?.focus();
                  submitButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
              }}
              className="w-full rounded-lg border bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-hidden focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70] border-slate-300"
            />
            <div className="flex items-center justify-between text-[10.5px] text-slate-400 px-0.5">
              <span>Press <strong className="font-semibold text-slate-600">Enter</strong> to jump straight to Register button</span>
              <span>Shift+Enter for multi-line</span>
            </div>
          </div>

          {/* 6. Action Submit Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-2.5">
            <button
              ref={submitButtonRef}
              id="btn-register-encounter"
              type="button"
              onClick={handleCreateEncounter}
              disabled={
                isSaving ||
                !encounterType ||
                isSelectedCoreServiceInactive ||
                (encounterType === 'OPD' && !defaultEncounterService) ||
                (!defaultEncounterService && selectedServiceIds.length === 0)
              }
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] focus:bg-[#065f46] focus:ring-4 focus:ring-[#08775A]/40 focus:outline-none rounded-xl shadow-sm disabled:opacity-60 transition-all cursor-pointer"
            >
              <Receipt className="h-4 w-4" />
              {isSaving
                ? 'Creating Encounter…'
                : !encounterType
                  ? 'Select Encounter Service to Proceed'
                  : isSelectedCoreServiceInactive
                    ? `${encounterType} Service Deactivated in Setup`
                    : encounterType === 'OPD' && !defaultEncounterService
                      ? 'Missing OPD Consultation Service'
                      : !defaultEncounterService && selectedServiceIds.length === 0
                        ? `Select Services for ${encounterType}`
                        : payerType === 'Self Pay'
                          ? `Register & Create ${encounterType} Invoice (${formatPKR((defaultEncounterService?.standardRate || 0) + selectedServicesTotal)})`
                          : `Register Panel & Create ${encounterType} Invoice`}
            </button>
            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
              <span>⚡ Fast-billing front desk</span>
              <span>Press Enter to register</span>
            </div>
          </div>
        </div>
      </div>

      {/* Immediate Invoice Detail Modal upon Creation */}
      {createdInvoiceId && (
        <InvoiceDetailModal invoiceId={createdInvoiceId} onClose={handleReset} onChanged={() => { }} autoOpenPayment />
      )}
    </div>
  );
};
