import type { PanelMembershipDetails } from '../../../types/patient';
import { doctorsForEncounter } from '../../../utils/doctorAvailability';
import { formatDateISO, getHospitalCurrentDate, formatDisplayDate } from '../../../utils/dateConstants';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  BedDouble,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Wallet,
  RefreshCw,
  Building2,
  DollarSign,
  User,
  Receipt,
  Search,
  X,
  Loader2,
  Calendar,
} from 'lucide-react';
import { PatientGender, PayerType, GuardianRelation, GUARDIAN_RELATIONS } from '../../../types/patient';
import {
  createPatient,
  normalizePhone,
  isValidPhone,
  normalizeCnic,
  isValidCnic,
  calculateAgeFromDob,
  searchPanelPatients,
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
import { DepartmentService, fetchDepartments } from '../../../services/departmentService';
import { Department } from '../../../types/department';
import { WardsRoomsBedsService, fetchWardHierarchy } from '../../../services/wardsRoomsBedsService';
import { Ward, Room, Bed } from '../../../types/wardsRoomsBeds';
import {
  createAdmission,
  CreateAdmissionFormValues,
  AdmissionRecord,
  AdmissionAdvanceReceipt,
  AdmissionPaymentMethod,
  MedicationMode,
} from '../../../services/admissionService';
import { InvoiceDetailModal } from '../billing/InvoiceDetailModal';
import {
  formatPKR,
  formatSentenceCase,
  normalizeSentenceCase,
} from '../../../utils/formatters';
import { useAuth } from '../../../context/AuthContext';
import { Select, Textarea, NumberInput, TextInput, CNICInput } from '../../../components/forms/FormControls';
import { focusNextField, focusNextFieldOnEnter } from '../../../utils/formNavigation';
import { useToast } from '../../../context/ToastContext';

// Ward-dropdown sentinel meaning "browse standalone Rooms with no parent Ward"
// (the Room -> Bed structure) — never a real ward id.
const STANDALONE_ROOMS_SENTINEL = '__STANDALONE_ROOMS__';

const PAYMENT_METHODS: { label: string; value: AdmissionPaymentMethod }[] = [
  { label: 'Cash', value: 'CASH' },
  { label: 'Card', value: 'CARD' },
  { label: 'Bank Transfer', value: 'BANK' },
  { label: 'Online', value: 'ONLINE' },
];

const emptyForm = (): CreateAdmissionFormValues => ({
  panelPatientId: '',
  selfPayEncounterId: '',
  departmentId: '',
  doctorStaffId: '',
  preferredBedId: '',
  expectedAt: formatDateISO(getHospitalCurrentDate()),
  diagnosis: '',
  weightKg: '',
  estimatedAmount: '',
  medicationMode: 'HOSPITAL_MANAGED',
  outsourcedFulfillmentMode: 'HOSPITAL_MANAGED',
  notes: '',
  advanceAmount: '',
  paymentMethod: 'CASH',
  paymentReference: '',
});

/**
 * v7.2 §2.9 (HMS_V7.2_NEW_REQUIREMENTS.md) — "Admission begins at Front Desk".
 * Landscape 2-column intake layout: Left = Patient Demographics & Payer; Right = Clinical Booking & Bed.
 */
export const NewAdmissionView: React.FC = () => {
  const { currentUser } = useAuth();
  const toast = useToast();
  const formContainerRef = useRef<HTMLDivElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const handleEnterNext = (e: React.KeyboardEvent<HTMLElement>) => focusNextFieldOnEnter(e, formContainerRef.current);

  const handleSelectKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const el = e.currentTarget;
    if (el.value) {
      focusNextField(el, formContainerRef.current);
    } else {
      try {
        if (typeof (el as any).showPicker === 'function') {
          (el as any).showPicker();
        } else {
          el.click();
        }
      } catch {
        el.click();
      }
    }
  };

  // New Patient Inline Fields
  const [fullName, setFullName] = useState('');
  const [fatherGuardianName, setFatherGuardianName] = useState('');
  const [guardianRelation, setGuardianRelation] = useState<GuardianRelation | ''>('');
  const [guardianCnic, setGuardianCnic] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<PatientGender>('Male');
  const [address, setAddress] = useState('');
  const [payerType, setPayerType] = useState<PayerType>('Self Pay');
  const [panelId, setPanelId] = useState('');
  const [panelMemberId, setPanelMemberId] = useState('');
  const [membershipDetails, setMembershipDetails] = useState<PanelMembershipDetails>({});
  // Case authorization/guarantee (panel.md §15 backlog item 2) — required
  // by the backend before this admission can be created when the selected
  // company's authorizationRequired policy is on.
  const [authorizationNumber, setAuthorizationNumber] = useState('');
  const [authorizationLimit, setAuthorizationLimit] = useState<number | ''>('');
  const [authorizationValidUntil, setAuthorizationValidUntil] = useState('');

  // Panel Patient Registry search (admission.md §2.1 point 2 — "search the permanent Panel Patient
  // Registry, validate active membership" — reuse an existing record instead of always
  // inline-registering a brand-new PanelPatient for the same real person).
  const [panelSearchQuery, setPanelSearchQuery] = useState('');
  const [panelSearchResults, setPanelSearchResults] = useState<PanelPatientSearchResult[]>([]);
  const [isSearchingPanel, setIsSearchingPanel] = useState(false);
  const [panelSearchError, setPanelSearchError] = useState<string | null>(null);
  const [hasSearchedPanel, setHasSearchedPanel] = useState(false);
  const [selectedExistingPatient, setSelectedExistingPatient] = useState<PanelPatientSearchResult | null>(null);

  // Admission form state
  const [formValues, setFormValues] = useState<CreateAdmissionFormValues>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [createdAdmission, setCreatedAdmission] = useState<AdmissionRecord | null>(null);
  const [createdAdvanceReceipt, setCreatedAdvanceReceipt] = useState<AdmissionAdvanceReceipt | null>(null);
  const [createdInvoice, setCreatedInvoice] = useState<{ id: string; invoiceNumber: string } | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  // Live master data caches (re-fetched on mount so direct navigation never gets stuck on an unprimed memory cache)
  const [corporatePanels, setCorporatePanels] = useState<CorporatePanel[]>(getActiveCorporatePanels);
  const [allWards, setAllWards] = useState<Ward[]>(WardsRoomsBedsService.getWards());
  const [allRooms, setAllRooms] = useState<Room[]>(WardsRoomsBedsService.getRooms());
  const [allBeds, setAllBeds] = useState<Bed[]>(WardsRoomsBedsService.getBeds());
  const [allStaff, setAllStaff] = useState<StaffUser[]>(() => StaffUserService.getStaffUsers());
  const [departments, setDepartments] = useState<Department[]>(() => DepartmentService.getDepartments());
  const doctors = useMemo(() => doctorsForEncounter(allStaff, 'ADMISSION'), [allStaff]);
  useEffect(() => {
    setFormValues((prev) => prev.doctorStaffId && !doctors.some((doctor) => doctor.id === prev.doctorStaffId)
      ? { ...prev, doctorStaffId: '' } : prev);
  }, [doctors]);

  // No separate Ward/Room selection is kept in CreateAdmissionFormValues — they only exist here
  // to narrow the Bed dropdown; the backend only needs the final preferredBedId + departmentId.
  const [selectedWardId, setSelectedWardId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');

  const refreshHierarchy = () => {
    fetchWardHierarchy().then(({ wards, rooms, beds }) => {
      setAllWards(wards);
      setAllRooms(rooms);
      setAllBeds(beds);
    }).catch(() => {});
  };

  useEffect(() => {
    fetchCorporatePanels().then(setCorporatePanels).catch(() => {});
    refreshHierarchy();
    fetchStaffUsers().then(setAllStaff).catch(() => {});
    fetchDepartments().then(setDepartments).catch(() => {});
  }, []);

  // Land cursor directly in Patient Full Name on open, just like Walk-In Intake
  useEffect(() => {
    const timer = setTimeout(() => {
      const nameInput = formContainerRef.current?.querySelector<HTMLInputElement>('#patient-full-name');
      nameInput?.focus();
    }, 60);
    return () => clearTimeout(timer);
  }, []);

  const departmentOptions = useMemo(() => {
    const sorted = [...departments].sort((a, b) => a.name.localeCompare(b.name));
    return [
      { label: '-- Select Department --', value: '' },
      ...sorted.map((d) => ({
        label: d.status === 'Inactive' ? `${d.name} (Inactive)` : d.name,
        value: d.id,
      })),
    ];
  }, [departments]);

  const activeWards = useMemo(() => allWards.filter((w) => w.status === 'Active'), [allWards]);
  // A sentinel Ward-dropdown value that means "browse standalone rooms with
  // no parent ward at all" (the Room -> Bed structure) rather than an actual ward id.
  const selectedWard = useMemo(
    () => (selectedWardId === STANDALONE_ROOMS_SENTINEL ? undefined : allWards.find((w) => w.id === selectedWardId)),
    [allWards, selectedWardId]
  );

  useEffect(() => {
    if (!formValues.departmentId && selectedWard?.departmentId) {
      setFormValues((prev) => ({ ...prev, departmentId: selectedWard.departmentId }));
    }
  }, [selectedWard, formValues.departmentId]);

  // Only show rooms that have at least one currently available, active bed —
  // either the current ward's own rooms, or (sentinel) standalone rooms with no ward.
  const wardRooms = useMemo(() => {
    const wantsStandalone = selectedWardId === STANDALONE_ROOMS_SENTINEL;
    const filtered = allRooms.filter((r) => {
      if (wantsStandalone ? Boolean(r.wardId) : r.wardId !== selectedWardId) return false;
      if (r.status !== 'Active') return false;
      return allBeds.some(
        (b) => b.roomId === r.id && b.occupancyStatus === 'Available' && b.operationalStatus === 'Active'
      );
    });
    return filtered.slice().sort((a, b) =>
      (a.roomNumber || a.name || '').localeCompare(b.roomNumber || b.name || '', undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    );
  }, [allRooms, allBeds, selectedWardId]);

  // A real Ward may also carry beds directly (no Room in between).
  const wardHasDirectBeds = useMemo(() => {
    if (!selectedWardId || selectedWardId === STANDALONE_ROOMS_SENTINEL) return false;
    return allBeds.some(
      (b) => b.wardId === selectedWardId && !b.roomId && b.occupancyStatus === 'Available' && b.operationalStatus === 'Active'
    );
  }, [allBeds, selectedWardId]);

  const roomBeds = useMemo(() => {
    let list: Bed[] = [];
    if (selectedRoomId) {
      list = allBeds.filter(
        (b) => b.roomId === selectedRoomId && b.occupancyStatus === 'Available' && b.operationalStatus === 'Active'
      );
    } else if (selectedWardId && selectedWardId !== STANDALONE_ROOMS_SENTINEL) {
      list = allBeds.filter(
        (b) => b.wardId === selectedWardId && !b.roomId && b.occupancyStatus === 'Available' && b.operationalStatus === 'Active'
      );
    }
    return list.slice().sort((a, b) =>
      (a.bedNumber || '').localeCompare(b.bedNumber || '', undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [allBeds, selectedRoomId, selectedWardId]);


  const handleRoomSelect = (roomId: string) => {
    setSelectedRoomId(roomId);
    setFormValues((prev) => ({ ...prev, preferredBedId: '' }));
  };

  const handleBedSelect = (bedId: string) => {
    setFormValues((prev) => ({ ...prev, preferredBedId: bedId }));
  };

  const handleReset = () => {
    setFullName('');
    setFatherGuardianName('');
    setGuardianRelation('');
    setGuardianCnic('');
    setPrimaryPhone('');
    setAge('');
    setGender('Male');
    setAddress('');
    setPayerType('Self Pay');
    setPanelId('');
    setPanelMemberId('');
    setMembershipDetails({});
    setAuthorizationNumber('');
    setAuthorizationLimit('');
    setAuthorizationValidUntil('');
    setSelectedWardId('');
    setSelectedRoomId('');
    setFormValues(emptyForm());
    setFormError(null);
    setCreatedAdmission(null);
    setCreatedAdvanceReceipt(null);
    setCreatedInvoice(null);
    setShowInvoiceModal(false);
    setPanelSearchQuery('');
    setPanelSearchResults([]);
    setHasSearchedPanel(false);
    setPanelSearchError(null);
    setSelectedExistingPatient(null);
    refreshHierarchy();
    setTimeout(() => {
      const nameInput = formContainerRef.current?.querySelector<HTMLInputElement>('#patient-full-name');
      nameInput?.focus();
    }, 60);
  };

  const handleSearchPanelPatients = async () => {
    if (!panelSearchQuery.trim()) return;
    setIsSearchingPanel(true);
    setPanelSearchError(null);
    try {
      setPanelSearchResults(await searchPanelPatients(panelSearchQuery));
      setHasSearchedPanel(true);
    } catch (err: any) {
      setPanelSearchError(err?.message || 'Failed to search the Panel Patient Registry.');
    } finally {
      setIsSearchingPanel(false);
    }
  };

  const handleUseExistingPatient = (match: PanelPatientSearchResult) => {
    setFullName(match.fullName.toUpperCase());
    setFatherGuardianName((match.guardianName || '').toUpperCase());
    setGuardianRelation((match.guardianRelation as GuardianRelation) || '');
    setPrimaryPhone(match.phone || '');
    setAge(match.dob ? String(calculateAgeFromDob(match.dob)) : '');
    setGender((match.gender as PatientGender) || 'Other / Not Specified');
    setAddress(match.addressLine1 || '');
    setPanelId(match.panelId);
    setPanelMemberId(match.panelMemberId || '');
    setSelectedExistingPatient(match);
    setPanelSearchResults([]);
    setPanelSearchQuery('');
    setHasSearchedPanel(false);
  };

  const handleClearExistingPatient = () => {
    setSelectedExistingPatient(null);
    setFullName('');
    setFatherGuardianName('');
    setGuardianRelation('');
    setPrimaryPhone('');
    setAge('');
    setGender('Male');
    setAddress('');
    setPanelId('');
    setPanelMemberId('');
    setMembershipDetails({});
    setAuthorizationNumber('');
    setAuthorizationLimit('');
    setAuthorizationValidUntil('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const showValidationError = (msg: string) => { setFormError(msg); toast.error(msg, 'Validation Error'); };

    // 1. Patient Fields Validation
    if (!fullName.trim()) { showValidationError('Patient Full Name is required.'); return; }
    if (!fatherGuardianName.trim()) { showValidationError('Guardian Name is required.'); return; }
    if (!guardianRelation) { showValidationError('Please select Guardian Relation.'); return; }
    if (guardianCnic.trim() && !isValidCnic(normalizeCnic(guardianCnic))) {
      showValidationError('Father / Guardian CNIC must follow the Pakistani format: XXXXX-XXXXXXX-X (13 digits).');
      return;
    }
    if (!primaryPhone.trim()) { showValidationError('Contact Phone is required.'); return; }
    if (!isValidPhone(primaryPhone)) { showValidationError('Please enter a valid phone number (at least 10 digits).'); return; }
    const ageNum = Number(age);
    if (!age.trim() || isNaN(ageNum) || ageNum < 0 || ageNum > 130) { showValidationError('Please enter a valid age in years.'); return; }
    if (payerType === 'Corporate / Panel') {
      if (!selectedExistingPatient) {
        showValidationError('Front Desk cannot register new panel patients. Please search and select an existing verified panel patient from the registry above, or contact Super Admin / Admin.');
        return;
      }
      if (!panelId) { showValidationError('Please select a Corporate Panel.'); return; }
      if (corporatePanels.find(p => p.id === panelId)?.memberIdRequired && !panelMemberId.trim()) {
        showValidationError('Panel Member ID / Card Number is required.'); return;
      }
      if (corporatePanels.find(p => p.id === panelId)?.authorizationRequired && !authorizationNumber.trim()) {
        showValidationError('Authorization / Guarantee Number is required by this company before admission.'); return;
      }
      if (selectedExistingPatient.status !== 'ACTIVE') {
        showValidationError(`This panel patient's membership is ${selectedExistingPatient.status} — cannot admit against an inactive registry record.`);
        return;
      }
    }
    // 2. Admission Fields Validation
    if (!selectedWard && !selectedRoomId) {
      showValidationError('Please select an Inpatient Ward, or a standalone Room, for admission.');
      return;
    }

    setIsSaving(true);
    try {
      // 3. Register Patient — reuse the selected Panel Patient Registry
      // record as-is (admission.md §2.1 point 2). Only Self Pay creates a new patient.
      let activePatient: { id: string; payerType: PayerType };

      if (payerType === 'Corporate / Panel') {
        if (!selectedExistingPatient) {
          showValidationError('Front Desk cannot register new panel patients. Please search and select an existing verified panel patient.');
          setIsSaving(false);
          return;
        }
        activePatient = { id: selectedExistingPatient.id, payerType: 'Corporate / Panel' };
      } else {
        const birthYear = new Date().getFullYear() - Math.max(0, Math.floor(ageNum));
        const dob = `${birthYear}-01-01`;

        const regRes = await createPatient(
          {
            fullName: fullName.trim(),
            fatherGuardianName: fatherGuardianName.trim(),
            guardianRelation,
            guardianCnic: guardianCnic.trim() ? normalizeCnic(guardianCnic) : '',
            dateOfBirth: dob,
            age: ageNum,
            ageIsEstimated: true,
            gender,
            cnic: '',
            passportNumber: '',
            primaryPhone: normalizePhone(primaryPhone),
            alternatePhone: '',
            email: '',
            addressLine1: address.trim(),
            addressLine2: '',
            city: 'Karachi',
            province: 'Sindh',
            country: 'Pakistan',
            bloodGroup: 'Unknown',
            payerType: 'Self Pay',
            panelId: '',
            panelName: '',
            panelMemberId: '',
            emergencyContactName: fatherGuardianName.trim(),
            emergencyContactRelation: guardianRelation,
            emergencyContactPhone: guardianCnic.trim() ? normalizeCnic(guardianCnic) : normalizePhone(primaryPhone),
            status: 'ACTIVE',
          },
          currentUser
        );

        if (!regRes.success || !regRes.patient) {
          showValidationError(regRes.error || 'Failed to register patient for admission.');
          setIsSaving(false);
          return;
        }

        activePatient = regRes.patient;
      }

      // 4. Create Admission
      const extraNotesParts = [
        formValues.notes.trim(),
        guardianCnic.trim() ? `Guardian CNIC: ${normalizeCnic(guardianCnic)}` : '',
        guardianRelation ? `Guardian Relation: ${guardianRelation}` : '',
        address.trim() ? `Address: ${address.trim()}` : '',
      ].filter(Boolean);

      const admissionPayload: CreateAdmissionFormValues = {
        ...formValues,
        // The "standalone rooms" sentinel is a UI-only browsing mode, never a real ward.
        wardId: selectedWard?.id || undefined,
        notes: extraNotesParts.join(' | '),
        panelPatientId: activePatient.payerType === 'Corporate / Panel' ? activePatient.id : '',
        selfPayEncounterId: activePatient.payerType === 'Self Pay' ? activePatient.id : '',
        authorizationNumber: activePatient.payerType === 'Corporate / Panel' ? authorizationNumber.trim() || undefined : undefined,
        authorizationLimit: activePatient.payerType === 'Corporate / Panel' ? authorizationLimit : '',
        authorizationValidUntil: activePatient.payerType === 'Corporate / Panel' ? authorizationValidUntil || undefined : undefined,
      };
      const { admission, advanceReceipt, invoice } = await createAdmission(admissionPayload);
      setCreatedAdmission(admission);
      setCreatedAdvanceReceipt(advanceReceipt);
      setCreatedInvoice(invoice);
      refreshHierarchy();
      toast.success(
        `Admission ${admission.admissionNumber} created for ${admission.patientName}.`,
        'Admission Created'
      );
    } catch (err: any) {
      const errMsg = err?.response?.data?.error?.message || err?.message || 'Failed to create admission.';
      setFormError(errMsg);
      toast.error(errMsg, 'Admission Failed');
    } finally {
      setIsSaving(false);
    }
  };

  if (createdAdmission) {
    return (
      <div className="max-w-2xl mx-auto space-y-5 animate-in fade-in duration-150 pb-12">
        <div className="bg-white rounded-xl border border-emerald-200 shadow-xs overflow-hidden">
          <div className="bg-[#effaf5] border-b border-emerald-200 p-5 flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-[#08775A] text-white flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Admission Created Successfully</h2>
              <p className="text-xs text-slate-600">
                Created at Front Desk and sent to Admission Portal for bed allocation & stay management.
              </p>
            </div>
          </div>
          <div className="p-5 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase block">Admission Number</span>
                <span className="font-mono font-bold text-slate-900 text-sm">{createdAdmission.admissionNumber}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase block">Status</span>
                <span className="font-bold text-amber-700">{createdAdmission.status}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase block">Patient</span>
                <span className="font-semibold text-slate-900">{createdAdmission.patientName}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase block">MR Number</span>
                <span className="font-semibold font-mono text-slate-900">{createdAdmission.patientMrNumber || 'Not available'}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase block">Payer Type</span>
                <span className="font-semibold text-slate-900">{createdAdmission.payerType}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase block">Guardian &amp; Relation</span>
                <span className="font-semibold text-slate-900">{fatherGuardianName} ({guardianRelation})</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase block">Father / Guardian CNIC</span>
                <span className="font-semibold font-mono text-slate-900">{guardianCnic ? normalizeCnic(guardianCnic) : 'Not provided'}</span>
              </div>
              {address && (
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 col-span-2">
                  <span className="text-[10px] text-slate-500 uppercase block">Residential Address</span>
                  <span className="font-semibold text-slate-900">{address}</span>
                </div>
              )}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase block">Department</span>
                <span className="font-semibold text-slate-900">{createdAdmission.departmentName}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase block">Admitting Doctor</span>
                <span className="font-semibold text-slate-900">{createdAdmission.doctorName || 'Not Assigned Yet'}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-500 uppercase block">Room &amp; Bed</span>
                <span className="font-semibold text-slate-900">{createdAdmission.bedLabel || 'Pending Check-in'}</span>
              </div>
              {createdAdmission.estimatedAmount != null && (
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 uppercase block">Estimated Amount - Subject to Final Billing</span>
                  <span className="font-bold text-[#08775A] font-mono">{formatPKR(createdAdmission.estimatedAmount)}</span>
                </div>
              )}
            </div>

            {/* Advance Receipt Banner */}
            {createdAdvanceReceipt ? (
              <div className="p-3 bg-[#effaf5] border border-emerald-200 rounded-lg text-emerald-900 flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5 shrink-0" />
                  Advance collected — receipt <strong className="font-mono">{createdAdvanceReceipt.receiptNumber}</strong> ({createdAdvanceReceipt.method})
                </span>
                <span className="font-bold font-mono">{formatPKR(createdAdvanceReceipt.amount)}</span>
              </div>
            ) : (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-[11px]">
                No advance was collected at admission — a receipt can be recorded any time from Hospital Invoices once the stay has an invoice.
              </div>
            )}

            {/* Instant Admission Invoice Card */}
            {createdInvoice && (
              <div className="p-3.5 bg-white border border-emerald-300 rounded-xl flex items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#08775A]/10 text-[#08775A] flex items-center justify-center shrink-0">
                    <Receipt className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-bold tracking-wide">Admission Invoice Generated</span>
                    <span className="font-mono font-bold text-slate-900 text-xs">{createdInvoice.invoiceNumber}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInvoiceModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer transition-colors"
                >
                  <Receipt className="h-3.5 w-3.5" /> View &amp; Print Invoice
                </button>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Create Another Admission
              </button>
            </div>
          </div>
        </div>

        {/* Immediate Invoice Detail Modal */}
        {showInvoiceModal && createdInvoice && (
          <InvoiceDetailModal
            invoiceId={createdInvoice.id}
            onClose={() => setShowInvoiceModal(false)}
            onChanged={() => {}}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={formContainerRef} className="w-full space-y-4 animate-in fade-in duration-150 pb-12">
      {/* Breadcrumb Header Bar */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
          <span className="text-slate-600">Front Desk</span>
          <span className="text-slate-300">/</span>
          <span className="uppercase text-slate-500 font-semibold tracking-wide">PATIENT FLOW</span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-900 font-bold">New Admission</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border bg-slate-50 text-slate-700 border-slate-200">
            <Calendar className="h-3.5 w-3.5 text-[#08775A]" />
            <span>Entry Date: {formatDisplayDate(new Date())}</span>
          </div>
          <span className="px-2.5 py-1 rounded-md text-xs font-bold border uppercase tracking-wide bg-[#effaf5] text-[#08775A] border-[#c2e7db]">
            Inpatient Admission Intake
          </span>
          <button
            type="button"
            onClick={handleReset}
            title="Reset Form"
            className="px-2.5 py-1 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="h-3 w-3 text-slate-400" />
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

      {/* Landscape Two-Column Form Grid */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: Patient Category & Demographics (7 cols on desktop) */}
        <div className="lg:col-span-7 space-y-4">
          {/* 1. Patient Category Cards (Self Pay vs Panel) */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              1. Patient Category &amp; Billing
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Self Pay Card */}
              <button
                type="button"
                onClick={() => {
                  setPayerType('Self Pay');
                  if (selectedExistingPatient) handleClearExistingPatient();
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
                  <DollarSign className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs">Self Pay (Direct Patient)</span>
                    {payerType === 'Self Pay' && <CheckCircle2 className="h-3.5 w-3.5 text-[#08775A]" />}
                  </div>
                  <span className="text-[11px] text-slate-500 block mt-0.5">
                    Self-financed inpatient admission.
                  </span>
                </div>
              </button>

              {/* Corporate / Panel Card */}
              <button
                type="button"
                onClick={() => setPayerType('Corporate / Panel')}
                className={`p-3 rounded-xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${
                  payerType === 'Corporate / Panel'
                    ? 'border-blue-600 bg-blue-50/50 shadow-xs ring-1 ring-blue-600/20'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div
                  className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    payerType === 'Corporate / Panel' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs">Corporate / Panel</span>
                    {payerType === 'Corporate / Panel' && <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />}
                  </div>
                  <span className="text-[11px] text-slate-500 block mt-0.5">
                    Company/Insurance credit guarantee admission.
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* 2. Patient Demographics Form */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                2. Patient Information
              </label>
              <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                selectedExistingPatient
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : payerType === 'Corporate / Panel'
                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                  : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}>
                {selectedExistingPatient
                  ? `From Panel Registry (${selectedExistingPatient.mrNumber})`
                  : payerType === 'Corporate / Panel'
                  ? 'Search Required (Panel)'
                  : 'Admission Slip Details'}
              </span>
            </div>

            {/* Corporate / Panel Search Section */}
            {payerType === 'Corporate / Panel' && (
              <PanelPatientSearchSection
                selectedPatient={selectedExistingPatient}
                onSelectPatient={handleUseExistingPatient}
                onClearPatient={handleClearExistingPatient}
              />
            )}

            {/* Name & Guardian */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput
                id="patient-full-name"
                autoFocus
                label="Patient Full Name"
                required
                disabled={payerType === 'Corporate / Panel'}
                placeholder={payerType === 'Corporate / Panel' ? (selectedExistingPatient ? selectedExistingPatient.fullName : 'Search and select panel patient above') : "Patient's legal name"}
                value={fullName}
                onChange={(e) => setFullName(e.target.value.toUpperCase())}
                onKeyDown={handleEnterNext}
              />
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                <div className="sm:col-span-3">
                  <TextInput
                    label="Guardian Name"
                    required
                    disabled={payerType === 'Corporate / Panel'}
                    placeholder={payerType === 'Corporate / Panel' ? (selectedExistingPatient ? (selectedExistingPatient.guardianName || 'N/A') : 'Search and select panel patient above') : 'Father / Guardian name'}
                    value={fatherGuardianName}
                    onChange={(e) => setFatherGuardianName(e.target.value.toUpperCase())}
                    onKeyDown={handleEnterNext}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Select
                    label="Relation"
                    required
                    disabled={payerType === 'Corporate / Panel'}
                    options={[
                      { label: 'Relation', value: '' },
                      ...GUARDIAN_RELATIONS.map((r) => ({ label: r, value: r })),
                    ]}
                    value={guardianRelation}
                    onChange={(e) => {
                      setGuardianRelation(e.target.value as GuardianRelation);
                    }}
                    onKeyDown={handleSelectKeyDown}
                  />
                </div>
              </div>
            </div>

            {/* Guardian CNIC & Phone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CNICInput
                label="Father / Guardian CNIC"
                disabled={payerType === 'Corporate / Panel'}
                placeholder="XXXXX-XXXXXXX-X"
                value={guardianCnic}
                onChange={(e) => setGuardianCnic(e.target.value)}
                onKeyDown={handleEnterNext}
              />
              <TextInput
                label="Contact Phone"
                required
                disabled={payerType === 'Corporate / Panel'}
                placeholder={payerType === 'Corporate / Panel' ? (selectedExistingPatient ? selectedExistingPatient.phone : 'Auto-filled from registry') : '0300-1234567'}
                value={primaryPhone}
                onChange={(e) => setPrimaryPhone(e.target.value)}
                onKeyDown={handleEnterNext}
              />
            </div>

            {/* Age, Gender, Weight */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
              <div className="sm:col-span-3">
                <TextInput
                  label="Age (Years)"
                  required
                  disabled={payerType === 'Corporate / Panel'}
                  type="number"
                  min="0"
                  max="130"
                  placeholder={payerType === 'Corporate / Panel' ? 'Auto-filled' : 'e.g. 35'}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  onKeyDown={handleEnterNext}
                />
              </div>
              <div className="sm:col-span-5">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Gender <span className="text-rose-500">*</span>
                </label>
                <div className="flex gap-1">
                  {(['Male', 'Female', 'Other / Not Specified'] as PatientGender[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      disabled={payerType === 'Corporate / Panel'}
                      onClick={() => setGender(g)}
                      className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all text-center ${
                        payerType === 'Corporate / Panel' ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
                      } ${
                        gender === g
                          ? 'bg-[#08775A] text-white border-[#08775A] shadow-xs'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {g === 'Other / Not Specified' ? 'Other' : g}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-4">
                <TextInput
                  label="Weight (kg) — optional"
                  type="number"
                  min="0.5"
                  max="999"
                  step="0.1"
                  placeholder="e.g. 70.5"
                  value={formValues.weightKg === '' ? '' : String(formValues.weightKg)}
                  onChange={(e) =>
                    setFormValues({
                      ...formValues,
                      weightKg: e.target.value === '' ? '' : parseFloat(e.target.value),
                    })
                  }
                  onKeyDown={handleEnterNext}
                />
              </div>
            </div>

            {/* Residential Address */}
            <TextInput
              label="Residential Address"
              disabled={payerType === 'Corporate / Panel'}
              placeholder={payerType === 'Corporate / Panel' ? (selectedExistingPatient ? (selectedExistingPatient.addressLine1 || 'N/A') : 'Auto-filled from registry') : 'e.g. Landhi Hospital Karachi'}
              value={address}
              onChange={(e) => setAddress(e.target.value.toUpperCase())}
              onKeyDown={handleEnterNext}
            />

            {/* Corporate / Panel Specific Fields (Only if Panel selected) */}
            {payerType === 'Corporate / Panel' && (
              <div className="pt-3 border-t border-slate-200 space-y-3 bg-slate-50/70 p-3.5 rounded-xl border border-slate-200 animate-in fade-in">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                  <Building2 className="h-4 w-4 text-[#08775A]" />
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
                    onKeyDown={handleSelectKeyDown}
                    hint={selectedExistingPatient ? "From the patient's registry record." : "Select patient above."}
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
                        hint="Required by this company before admission can be created."
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
                        type="date"
                        value={authorizationValidUntil}
                        onChange={(e) => setAuthorizationValidUntil(e.target.value)}
                        onKeyDown={handleEnterNext}
                        hint="Charges are blocked once this date passes, until renewed."
                      />
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Clinical & Admission Details (5 cols on desktop) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#08775A]">
                3. Admission &amp; Ward Details
              </label>
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <BedDouble className="h-3.5 w-3.5 text-[#08775A]" /> Booking
              </span>
            </div>

            {/* Department → Ward → Room → Bed cascade & Fulfillment */}
            <div className="space-y-3">
              <Select
                label="Admitting Doctor (Optional)"
                options={[
                  { label: 'Not Assigned / Select Later', value: '' },
                  ...doctors.map((doctor) => ({ label: doctor.fullName, value: doctor.id })),
                ]}
                value={formValues.doctorStaffId}
                onChange={(event) => setFormValues((prev) => ({ ...prev, doctorStaffId: event.target.value }))}
                onKeyDown={handleSelectKeyDown}
              />
              <Select
                label="Department"
                hint={
                  departments.length === 0
                    ? 'Loading departments...'
                    : 'Optional — auto-resolved from the selected Ward if left blank.'
                }
                options={departmentOptions}
                value={formValues.departmentId}
                onChange={(e) => {
                  setFormValues((prev) => ({ ...prev, departmentId: e.target.value }));
                }}
                onKeyDown={handleSelectKeyDown}
              />
              <Select
                label="Ward"
                hint={
                  activeWards.length === 0
                    ? 'No active wards configured.'
                    : 'Optional — pick "Standalone Rooms" below to admit into a room with no parent ward.'
                }
                options={[
                  { label: '-- Select Ward --', value: '' },
                  ...activeWards.map((w) => ({ label: w.name, value: w.id })),
                  { label: '— Standalone Rooms (No Ward) —', value: STANDALONE_ROOMS_SENTINEL },
                ]}
                value={selectedWardId}
                onChange={(e) => {
                  const newWardId = e.target.value;
                  setSelectedWardId(newWardId);
                  setSelectedRoomId('');
                  setFormValues((prev) => ({
                    ...prev,
                    preferredBedId: '',
                  }));
                }}
                onKeyDown={handleSelectKeyDown}
              />
              <Select
                label="Room"
                required={selectedWardId === STANDALONE_ROOMS_SENTINEL}
                hint={
                  !selectedWardId
                    ? 'Select a ward first, or choose "Standalone Rooms" above.'
                    : wardRooms.length === 0
                    ? (selectedWardId === STANDALONE_ROOMS_SENTINEL
                        ? 'No standalone rooms with available beds.'
                        : wardHasDirectBeds
                          ? 'No rooms with available beds — this ward has direct beds instead (see below).'
                          : 'No rooms with available beds in this ward.')
                    : undefined
                }
                options={[
                  {
                    label: wardHasDirectBeds ? 'No Room (Direct Ward Bed)' : '-- Select Room --',
                    value: '',
                  },
                  ...wardRooms.map((r) => {
                    const availCount = allBeds.filter(
                      (b) => b.roomId === r.id && b.occupancyStatus === 'Available' && b.operationalStatus === 'Active'
                    ).length;

                    const cleanRoomNum = (r.roomNumber || '').trim();
                    const roomPrefix = cleanRoomNum
                      ? (/^room\b/i.test(cleanRoomNum) ? `${cleanRoomNum} - ` : `Room ${cleanRoomNum} - `)
                      : '';

                    return {
                      label: `${roomPrefix}${r.name} (${availCount} bed${availCount > 1 ? 's' : ''} available)`,
                      value: r.id,
                    };
                  }),
                ]}
                value={selectedRoomId}
                onChange={(e) => {
                  handleRoomSelect(e.target.value);
                }}
                onKeyDown={handleSelectKeyDown}
              />
              <Select
                label="Bed Preference (optional)"
                hint={
                  !selectedRoomId && !wardHasDirectBeds
                    ? 'Select a room (or a ward with direct beds) to see available beds.'
                    : roomBeds.length === 0
                    ? `No available beds in this ${selectedRoomId ? 'room' : 'ward'} right now.`
                    : 'Tentative only — bed becomes occupied at Admission Portal check-in.'
                }
                options={[
                  { label: '-- Select Bed Preference (optional) --', value: '' },
                  ...roomBeds.map((b) => {
                    const rawBedNum = (b.bedNumber || '').trim();
                    const cleanBedLabel = /^bed\b/i.test(rawBedNum)
                      ? rawBedNum
                      : `Bed ${rawBedNum}`;
                    return {
                      label: cleanBedLabel,
                      value: b.id,
                    };
                  }),
                ]}
                value={formValues.preferredBedId}
                onChange={(e) => {
                  handleBedSelect(e.target.value);
                }}
                onKeyDown={handleSelectKeyDown}
              />

              <NumberInput
                label="Estimated Amount (PKR)"
                min={0}
                step="any"
                placeholder="Optional"
                value={formValues.estimatedAmount}
                onChange={(event) => setFormValues((prev) => ({
                  ...prev, estimatedAmount: event.target.value === '' ? '' : Number(event.target.value),
                }))}
                onKeyDown={handleEnterNext}
                hint="Estimated Amount - Subject to Final Billing. For information only."
              />

              <Select
                label="Outsourced Services"
                placeholder=""
                options={[
                  { label: 'Hospital Managed', value: 'HOSPITAL_MANAGED' },
                  { label: 'Self Managed / External', value: 'SELF' },
                ]}
                value={formValues.outsourcedFulfillmentMode}
                onChange={(e) => setFormValues((prev) => ({ ...prev, outsourcedFulfillmentMode: e.target.value as MedicationMode }))}
                onKeyDown={handleSelectKeyDown}
              />
              <Select
                label="Pharmacy Fulfillment"
                placeholder=""
                hint="Self = arranges own medicines. Hospital Managed = Pharmacy fulfills via requests."
                options={[
                  { label: 'Hospital Managed', value: 'HOSPITAL_MANAGED' },
                  { label: 'Self Managed / External', value: 'SELF' },
                ]}
                value={formValues.medicationMode}
                onChange={(e) => {
                  setFormValues((prev) => ({ ...prev, medicationMode: e.target.value as MedicationMode }));
                }}
                onKeyDown={handleSelectKeyDown}
              />
            </div>

            {/* Expected Date */}
            <div>
              <TextInput
                label="Expected Admission Date"
                type="date"
                value={formValues.expectedAt}
                onChange={(e) => setFormValues({ ...formValues, expectedAt: e.target.value })}
                onKeyDown={handleEnterNext}
              />
            </div>

            {/* Advance Received Now — real money, posts a real receipt + cashier ledger entry on submit */}
            <div className="p-3.5 bg-[#effaf5] border border-[#c2e7db] rounded-xl space-y-3">
              <div className="flex items-center justify-between pb-1.5 border-b border-[#c2e7db]/70">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#08775A]">
                  <Wallet className="h-3.5 w-3.5" />
                  <span>Advance Received Now (optional)</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <NumberInput
                  label="Advance Amount (PKR)"
                  min={0}
                  step="any"
                  placeholder="0"
                  value={formValues.advanceAmount}
                  onChange={(e) =>
                    setFormValues({
                      ...formValues,
                      advanceAmount: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                  onKeyDown={handleEnterNext}
                  hint="Optional advance collected at entry, recorded separately as payment/credit."
                />
                <Select
                  label="Payment Method"
                  options={PAYMENT_METHODS}
                  value={formValues.paymentMethod}
                  onChange={(e) => {
                    setFormValues((prev) => ({ ...prev, paymentMethod: e.target.value as AdmissionPaymentMethod }));
                  }}
                  onKeyDown={handleSelectKeyDown}
                />
              </div>
              {Number(formValues.advanceAmount) > 0 && (
                <TextInput
                  label="Reference / Receipt # (optional)"
                  placeholder="e.g. Cash Receipt # / Card Auth Code"
                  value={formValues.paymentReference}
                  onChange={(e) => setFormValues({ ...formValues, paymentReference: e.target.value })}
                  onKeyDown={handleEnterNext}
                />
              )}
            </div>

            {/* Diagnosis & Notes */}
            <div className="space-y-1">
              <Textarea
                label="Diagnosis / Admission Reason"
                rows={2}
                placeholder="Primary admitting complaint or diagnosis… (Press Enter to jump to Register button)"
                value={formValues.diagnosis}
                onChange={(e) => setFormValues({ ...formValues, diagnosis: formatSentenceCase(e.target.value) })}
                onBlur={(e) => setFormValues({ ...formValues, diagnosis: normalizeSentenceCase(e.target.value) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitButtonRef.current?.focus();
                    submitButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  }
                }}
              />
              <div className="flex items-center justify-between text-[10.5px] text-slate-400 px-0.5">
                <span>Press <strong className="font-semibold text-slate-600">Enter</strong> to jump straight to Register button</span>
                <span>Shift+Enter for multi-line</span>
              </div>
            </div>

            <div className="space-y-1">
              <Textarea
                label="Intake Notes (optional)"
                rows={2}
                placeholder="Special instructions, allergies, dietary… (Press Enter to jump to Register button)"
                value={formValues.notes}
                onChange={(e) => setFormValues({ ...formValues, notes: formatSentenceCase(e.target.value) })}
                onBlur={(e) => setFormValues({ ...formValues, notes: normalizeSentenceCase(e.target.value) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitButtonRef.current?.focus();
                    submitButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  }
                }}
              />
            </div>

            {payerType === 'Corporate / Panel' && (
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-[11px] text-purple-900 flex items-start gap-2">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-purple-600" />
                <span>
                  Panel admission — invoices will separate Patient Co-pay share from Panel Receivable per agreement.
                </span>
              </div>
            )}

            {/* Submit & Reset Buttons */}
            <div className="pt-3 border-t border-slate-200 space-y-2">
              <button
                ref={submitButtonRef}
                type="submit"
                disabled={isSaving}
                className="w-full py-3 px-4 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-xl shadow-xs disabled:opacity-60 transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <BedDouble className="h-4 w-4" />
                <span>{isSaving ? 'Creating Admission…' : 'Create Admission & Handover'}</span>
              </button>

              <button
                type="button"
                onClick={handleReset}
                className="w-full py-2 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
              >
                Reset All Fields
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
