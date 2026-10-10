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
  Printer,
  Plus,
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
import { fetchInvoiceDetail, InvoiceDetail } from '../../../services/invoiceService';
import { getHospitalProfile } from '../../../services/hospitalProfileService';
import { InvoiceDetailModal, formatServiceName, formatServiceCode, getInvoiceEncounterLabel } from '../billing/InvoiceDetailModal';
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
  const [liveInvoiceDetail, setLiveInvoiceDetail] = useState<InvoiceDetail | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  useEffect(() => {
    if (createdInvoice?.id) {
      fetchInvoiceDetail(createdInvoice.id)
        .then((inv) => setLiveInvoiceDetail(inv))
        .catch((err) => console.error('Failed to load created invoice detail:', err));
    } else {
      setLiveInvoiceDetail(null);
    }
  }, [createdInvoice?.id]);

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
    setLiveInvoiceDetail(null);
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
      if (invoice?.id) {
        fetchInvoiceDetail(invoice.id).then(setLiveInvoiceDetail).catch(() => {});
      }
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

  const handlePrintLiveInvoice = () => {
    const printWindow = window.open('', '_blank', 'width=850,height=950');
    if (!printWindow) {
      window.print();
      return;
    }
    const profile = getHospitalProfile();
    const inv = liveInvoiceDetail || {
      id: createdInvoice?.id || '',
      invoiceNumber: createdInvoice?.invoiceNumber || 'INV-26-0001',
      sourceType: 'ADMISSION',
      encounterType: 'ADMISSION',
      status: (createdAdvanceReceipt && createdAdmission?.estimatedAmount && createdAdvanceReceipt.amount >= createdAdmission.estimatedAmount) ? 'PAID' : (createdAdvanceReceipt ? 'PARTIALLY_PAID' : 'UNPAID'),
      patientName: createdAdmission?.patientName || fullName,
      patientMr: createdAdmission?.patientMrNumber || '—',
      patientGuardian: fatherGuardianName ? `${fatherGuardianName} (${guardianRelation || 'Guardian'})` : '—',
      patientPhone: primaryPhone || '—',
      payerType: createdAdmission?.payerType || payerType,
      admissionNumber: createdAdmission?.admissionNumber || '',
      departmentName: createdAdmission?.departmentName || '',
      doctorName: createdAdmission?.doctorName || 'Consultant',
      wardName: createdAdmission?.bedLabel || '',
      admissionEstimatedAmount: createdAdmission?.estimatedAmount || null,
      subtotal: createdAdmission?.estimatedAmount || 0,
      discountTotal: 0,
      total: createdAdmission?.estimatedAmount || 0,
      patientShare: createdAdmission?.estimatedAmount || 0,
      advancePaid: createdAdvanceReceipt?.amount || 0,
      paidTotal: createdAdvanceReceipt?.amount || 0,
      balanceDue: Math.max(0, (createdAdmission?.estimatedAmount || 0) - (createdAdvanceReceipt?.amount || 0)),
      panelReceivable: 0,
      hasRefund: false,
      refundedAmount: 0,
      panelName: '',
      createdAt: formatDisplayDate(new Date()),
      createdAtIso: new Date().toISOString(),
      lines: [
        {
          id: 'adm-fee',
          serviceName: 'Inpatient Stay & Ward Admission Tariff',
          serviceCode: 'ADM-TARIFF',
          quantity: 1,
          rate: createdAdmission?.estimatedAmount || 0,
          lineGross: createdAdmission?.estimatedAmount || 0,
          discountAmount: 0,
          discountReason: '',
          lineNet: createdAdmission?.estimatedAmount || 0,
          performedByName: createdAdmission?.doctorName || 'Staff',
        }
      ],
      receipts: createdAdvanceReceipt ? [
        {
          id: 'rec-1',
          receiptNumber: createdAdvanceReceipt.receiptNumber,
          amount: createdAdvanceReceipt.amount,
          method: createdAdvanceReceipt.method,
          reference: createdAdvanceReceipt.reference || '',
          isReversed: false,
          collectedByName: 'Front Desk',
          collectedAt: formatDisplayDate(new Date()),
        }
      ] : [],
    };

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice - ${inv.invoiceNumber}</title>
          <style>
            @page { size: A4 portrait; margin: 12mm; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 11.5px; color: #0f172a; margin: 0; padding: 10px; }
            .header { text-align: center; border-bottom: 2px solid #08775A; padding-bottom: 10px; margin-bottom: 14px; }
            .header h1 { font-size: 19px; font-weight: 800; color: #0f172a; margin: 0 0 3px 0; text-transform: uppercase; letter-spacing: 0.5px; }
            .header p { margin: 2px 0; color: #475569; font-size: 10.5px; }
            .header .title { font-size: 13px; font-weight: 700; color: #08775A; text-transform: uppercase; margin-top: 5px; }
            .meta-grid { display: flex; justify-content: space-between; margin-bottom: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; gap: 16px; }
            .meta-col { flex: 1; }
            .meta-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 11px; }
            .meta-label { color: #64748b; font-weight: 600; }
            .meta-val { color: #0f172a; font-weight: 600; }
            .meta-val.mr { color: #08775A; font-weight: 800; }
            .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; border: 1px solid #c2e7db; background: #effaf5; color: #08775A; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 11px; }
            th { background: #f1f5f9; color: #334155; font-weight: 700; text-transform: uppercase; font-size: 10px; padding: 8px 10px; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; text-align: left; }
            td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; color: #1e293b; }
            .summary-wrap { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
            .receipt-note { flex: 1; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px; font-size: 11px; color: #166534; }
            .summary-box { width: 280px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; font-size: 11px; }
            .summary-row { display: flex; justify-content: space-between; margin-bottom: 5px; color: #475569; }
            .summary-row.total { font-size: 12px; font-weight: 800; color: #0f172a; border-top: 1px solid #cbd5e1; padding-top: 6px; }
            .summary-row.balance { font-size: 13px; font-weight: 800; color: #b91c1c; border-top: 2px solid #cbd5e1; padding-top: 6px; }
            .signatures { display: flex; justify-content: space-between; margin-top: 36px; padding-top: 16px; border-top: 1px dashed #cbd5e1; font-size: 11px; color: #475569; }
            .sig-block { width: 180px; text-align: center; border-top: 1px solid #94a3b8; padding-top: 4px; }
            .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
          </style>
        </head>
        <body>
          <div class="header">
            ${profile.logo ? `<img src="${profile.logo}" style="height: 48px; max-width: 130px; object-fit: contain; margin-bottom: 4px; display: block; margin-left: auto; margin-right: auto;" />` : ''}
            <h1>${profile.name || 'CH Sharif and Saeed Hospital'}</h1>
            <p>Excellence in Clinical Care, Diagnostics &amp; Inpatient Services</p>
            <div class="title">Official Inpatient Admission Invoice / Bill</div>
          </div>
          <div class="meta-grid">
            <div class="meta-col">
              <div class="meta-row"><span class="meta-label">Invoice #:</span> <strong class="meta-val">${inv.invoiceNumber}</strong></div>
              <div class="meta-row"><span class="meta-label">Admission #:</span> <strong class="meta-val">${inv.admissionNumber || '—'}</strong></div>
              <div class="meta-row"><span class="meta-label">Date &amp; Time:</span> <span class="meta-val">${inv.createdAt}</span></div>
              <div class="meta-row"><span class="meta-label">Department:</span> <span class="meta-val">${inv.departmentName || 'Inpatient'}</span></div>
              <div class="meta-row"><span class="meta-label">Doctor:</span> <span class="meta-val">${inv.doctorName || 'Consultant On Duty'}</span></div>
              <div class="meta-row"><span class="meta-label">Ward / Bed:</span> <span class="meta-val">${inv.wardName || 'Assigned'}</span></div>
              <div class="meta-row"><span class="meta-label">Status:</span> <span class="badge">${inv.status}</span></div>
            </div>
            <div class="meta-col">
              <div class="meta-row"><span class="meta-label">MR Number:</span> <strong class="meta-val mr">${inv.patientMr || '—'}</strong></div>
              <div class="meta-row"><span class="meta-label">Patient Name:</span> <strong class="meta-val">${inv.patientName}</strong></div>
              <div class="meta-row"><span class="meta-label">Guardian:</span> <span class="meta-val">${inv.patientGuardian || '—'}</span></div>
              <div class="meta-row"><span class="meta-label">Phone:</span> <span class="meta-val">${inv.patientPhone || '—'}</span></div>
              <div class="meta-row"><span class="meta-label">Payer Type:</span> <span class="meta-val">${inv.payerType}</span></div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 30px; text-align: center;">#</th>
                <th>Service / Description</th>
                <th style="width: 50px; text-align: right;">Qty</th>
                <th style="width: 80px; text-align: right;">Rate (PKR)</th>
                <th style="width: 90px; text-align: right;">Total (PKR)</th>
              </tr>
            </thead>
            <tbody>
              ${inv.lines.map((l: any, i: number) => `
                <tr>
                  <td style="text-align: center; color: #64748b;">${i + 1}</td>
                  <td><strong>${formatServiceName(l.serviceName)}</strong></td>
                  <td style="text-align: right;">${l.quantity}</td>
                  <td style="text-align: right;">${formatPKR(l.rate)}</td>
                  <td style="text-align: right;"><strong>${formatPKR(l.lineGross)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="summary-wrap">
            <div class="receipt-note">
              ${inv.advancePaid > 0 ? `
                <strong>Advance Deposit Collected:</strong> ${formatPKR(inv.advancePaid)}<br/>
                Receipt: <strong>${inv.receipts?.[0]?.receiptNumber || createdAdvanceReceipt?.receiptNumber || 'REC-ADV'}</strong> (${inv.receipts?.[0]?.method || createdAdvanceReceipt?.method || 'CASH'})
              ` : `
                Standard inpatient intake billing. Daily stay charges, pharmacy, and diagnostics will be consolidated on discharge clearance.
              `}
            </div>
            <div class="summary-box">
              <div class="summary-row"><span>Gross Charges:</span><strong>${formatPKR(inv.subtotal || 0)}</strong></div>
              <div class="summary-row"><span>Discount:</span><span>${inv.discountTotal ? `- ${formatPKR(inv.discountTotal)}` : formatPKR(0)}</span></div>
              <div class="summary-row total"><span>Net Invoiced:</span><strong>${formatPKR(inv.patientShare || inv.subtotal || 0)}</strong></div>
              ${inv.advancePaid ? `<div class="summary-row" style="color: #08775A;"><span>Advance Deposit:</span><strong>- ${formatPKR(inv.advancePaid)}</strong></div>` : ''}
              <div class="summary-row balance"><span>Balance Due:</span><span>${formatPKR(inv.balanceDue || 0)}</span></div>
            </div>
          </div>
          <div class="signatures">
            <div class="sig-block">Prepared by (Front Desk)</div>
            <div class="sig-block">Patient / Guardian Signature</div>
          </div>
          <div class="footer">
            System-generated official computer invoice issued by CH Sharif &amp; Saeed Hospital HMS.
          </div>
        </body>
      </html>
    `;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 350);
  };

  if (createdAdmission) {
    const profile = getHospitalProfile();
    const effectiveInvoiceNumber = liveInvoiceDetail?.invoiceNumber || createdInvoice?.invoiceNumber || 'INV-26-0001';
    const effectiveLines = (liveInvoiceDetail?.lines && liveInvoiceDetail.lines.length > 0)
      ? liveInvoiceDetail.lines
      : [
          {
            id: 'tariff-1',
            serviceName: 'Inpatient Stay & Ward Tariff',
            serviceCode: 'ADM-STAY',
            serviceCategory: 'Room / Bed',
            quantity: 1,
            rate: createdAdmission.estimatedAmount || 0,
            lineGross: createdAdmission.estimatedAmount || 0,
          }
        ];

    const effectiveGross = liveInvoiceDetail?.subtotal ?? (createdAdmission.estimatedAmount || 0);
    const effectiveDiscount = liveInvoiceDetail?.discountTotal ?? 0;
    const effectiveNet = liveInvoiceDetail?.patientShare ?? (effectiveGross - effectiveDiscount);
    const effectiveAdvance = liveInvoiceDetail?.advancePaid ?? (createdAdvanceReceipt?.amount || 0);
    const effectiveBalanceDue = liveInvoiceDetail?.balanceDue ?? Math.max(0, effectiveNet - effectiveAdvance);

    return (
      <div className="max-w-4xl mx-auto space-y-4 animate-in fade-in duration-150 pb-16">
        {/* Top Notification Banner & Quick Actions */}
        <div className="bg-white rounded-2xl border border-emerald-200/90 shadow-xs p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-[#08775A] border border-emerald-200 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">Admission Intake Confirmed</h2>
                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-100/70 text-emerald-800 border border-emerald-200">
                  Live Bill Generated
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Official encounter invoice #{effectiveInvoiceNumber} generated and registered in live database.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handlePrintLiveInvoice}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <Printer className="h-4 w-4" />
              <span>Print Official Invoice</span>
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200/80 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
              <span>New Admission</span>
            </button>
          </div>
        </div>

        {/* Live Hospital Invoice Voucher Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden font-sans">
          {/* Hospital Header */}
          <div className="px-6 py-5 border-b border-slate-200 bg-linear-to-r from-slate-50 via-white to-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              {profile.logo ? (
                <img src={profile.logo} alt="Logo" className="h-12 w-12 object-contain rounded-lg border border-slate-200 p-1 bg-white shrink-0" />
              ) : (
                <div className="h-12 w-12 rounded-xl bg-[#08775A] text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs">
                  HMS
                </div>
              )}
              <div>
                <h1 className="text-lg font-black text-slate-900 tracking-tight leading-tight">
                  {profile.name || 'CH Sharif & Saeed Hospital'}
                </h1>
                <p className="text-[11px] text-slate-500 font-medium">
                  Excellence in Clinical Care, Diagnostics & Inpatient Services
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {profile.addressLine1 || '52-A Jail Road, Lahore'} • Tel: {profile.primaryPhone || '(042) 111-247-467'}
                </p>
              </div>
            </div>

            <div className="sm:text-right shrink-0">
              <span className="inline-block px-2.5 py-1 rounded-md text-[11px] font-extrabold uppercase tracking-wider bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                INPATIENT ADMISSION INVOICE
              </span>
              <div className="mt-1 font-mono font-black text-base text-slate-900">
                {effectiveInvoiceNumber}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Issue Date: {liveInvoiceDetail?.createdAt || formatDisplayDate(new Date())}
              </div>
            </div>
          </div>

          {/* Two-Column Metadata Box */}
          <div className="p-6 bg-slate-50/60 border-b border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            {/* Left: Patient Identification */}
            <div className="space-y-2.5 bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-[#08775A]" /> Patient Identification
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  {createdAdmission.payerType}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-slate-500 font-medium">MR Number:</span>
                <span className="col-span-2 font-mono font-bold text-[#08775A] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 w-fit">
                  {createdAdmission.patientMrNumber || liveInvoiceDetail?.patientMr || '—'}
                </span>

                <span className="text-slate-500 font-medium">Patient Name:</span>
                <span className="col-span-2 font-bold text-slate-900 text-sm">
                  {createdAdmission.patientName}
                </span>

                <span className="text-slate-500 font-medium">Guardian:</span>
                <span className="col-span-2 font-semibold text-slate-800">
                  {fatherGuardianName ? `${fatherGuardianName} (${guardianRelation || 'Guardian'})` : liveInvoiceDetail?.patientGuardian || '—'}
                </span>

                {guardianCnic && (
                  <>
                    <span className="text-slate-500 font-medium">Guardian CNIC:</span>
                    <span className="col-span-2 font-mono font-medium text-slate-700">
                      {normalizeCnic(guardianCnic)}
                    </span>
                  </>
                )}

                {address && (
                  <>
                    <span className="text-slate-500 font-medium">Address:</span>
                    <span className="col-span-2 text-slate-700">
                      {address}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Right: Admission & Encounter Particulars */}
            <div className="space-y-2.5 bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-[#08775A]" /> Inpatient Encounter Details
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-amber-50 text-amber-800 border border-amber-200">
                  {createdAdmission.status}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-slate-500 font-medium">Admission #:</span>
                <span className="col-span-2 font-mono font-bold text-slate-900">
                  {createdAdmission.admissionNumber}
                </span>

                <span className="text-slate-500 font-medium">Department:</span>
                <span className="col-span-2 font-semibold text-slate-800">
                  {createdAdmission.departmentName}
                </span>

                <span className="text-slate-500 font-medium">Admitting Doctor:</span>
                <span className="col-span-2 font-semibold text-slate-800">
                  {createdAdmission.doctorName || 'Consultant On Duty'}
                </span>

                <span className="text-slate-500 font-medium">Ward / Room / Bed:</span>
                <span className="col-span-2 font-semibold text-slate-900">
                  {createdAdmission.bedLabel || 'Pending Bed Check-in'}
                </span>

                {createdAdmission.estimatedAmount != null && (
                  <>
                    <span className="text-slate-500 font-medium">Estimated Tariff:</span>
                    <span className="col-span-2 font-bold font-mono text-[#08775A]">
                      {formatPKR(createdAdmission.estimatedAmount)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Table: Invoice Line Items */}
          <div className="p-6">
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 uppercase text-[10.5px] tracking-wide">
                    <th className="py-2.5 px-4 w-12 text-center">#</th>
                    <th className="py-2.5 px-4">Service Description</th>
                    <th className="py-2.5 px-4 text-center w-28">Category</th>
                    <th className="py-2.5 px-4 text-right w-16">Qty</th>
                    <th className="py-2.5 px-4 text-right w-28">Rate</th>
                    <th className="py-2.5 px-4 text-right w-32">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {effectiveLines.map((l: any, idx: number) => (
                    <tr key={l.id || idx}>
                      <td className="py-2.5 px-4 text-center text-slate-400 font-semibold">{idx + 1}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">
                        <span>{formatServiceName(l.serviceName)}</span>
                        {formatServiceCode(l.serviceCode) && (
                          <span className="text-slate-400 font-mono text-[11px] ml-1.5 font-normal">
                            ({formatServiceCode(l.serviceCode)})
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center text-slate-500 font-medium">
                        {l.serviceCategory || l.departmentName || 'Inpatient Care'}
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-800 font-medium">{l.quantity}</td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-800">{formatPKR(l.rate)}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">{formatPKR(l.lineGross)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Totals & Advance Breakdown */}
            <div className="mt-5 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
              {/* Left: Advance Collection Notice */}
              <div className="space-y-2 w-full sm:max-w-md">
                {createdAdvanceReceipt ? (
                  <div className="p-3.5 bg-emerald-50/80 border border-emerald-200 rounded-xl text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                        <Wallet className="h-4 w-4 text-[#08775A]" /> Advance Payment Collected
                      </span>
                      <span className="font-mono font-extrabold text-[#08775A] text-sm">
                        {formatPKR(createdAdvanceReceipt.amount)}
                      </span>
                    </div>
                    <div className="text-[11px] text-emerald-800 flex items-center justify-between">
                      <span>Receipt: <strong className="font-mono">{createdAdvanceReceipt.receiptNumber}</strong></span>
                      <span>Mode: <strong>{createdAdvanceReceipt.method}</strong></span>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500">
                    No initial advance deposit was collected at admission desk.
                  </div>
                )}
                <p className="text-[10.5px] text-slate-400 italic">
                  Note: Inpatient final bill will include ongoing daily room charges, pharmacy dispensing, and surgical procedures upon discharge clearance.
                </p>
              </div>

              {/* Right: Summary Box */}
              <div className="w-full sm:w-80 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between font-medium text-slate-600">
                  <span>Gross Charges:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {formatPKR(effectiveGross)}
                  </span>
                </div>

                <div className="flex justify-between font-medium text-slate-600">
                  <span>Discount:</span>
                  <span className="font-mono text-amber-700">
                    {effectiveDiscount > 0 ? `- ${formatPKR(effectiveDiscount)}` : formatPKR(0)}
                  </span>
                </div>

                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200">
                  <span>Net Invoiced:</span>
                  <span className="font-mono text-slate-900 text-sm">
                    {formatPKR(effectiveNet)}
                  </span>
                </div>

                {effectiveAdvance > 0 && (
                  <div className="flex justify-between font-semibold text-[#08775A]">
                    <span>Advance Deposit:</span>
                    <span className="font-mono">
                      - {formatPKR(effectiveAdvance)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-center font-extrabold text-sm pt-2 border-t-2 border-slate-200">
                  <span className="text-slate-900">Balance Due:</span>
                  <span className={`font-mono text-base ${
                    effectiveBalanceDue > 0 ? 'text-rose-600' : 'text-emerald-700'
                  }`}>
                    {formatPKR(effectiveBalanceDue)}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer Signature Blocks */}
            <div className="mt-8 pt-6 border-t border-dashed border-slate-200 grid grid-cols-2 text-center text-xs text-slate-500">
              <div>
                <div className="h-10"></div>
                <div className="border-t border-slate-300 w-44 mx-auto pt-1 font-semibold text-slate-700">
                  Prepared By (Front Desk)
                </div>
              </div>
              <div>
                <div className="h-10"></div>
                <div className="border-t border-slate-300 w-44 mx-auto pt-1 font-semibold text-slate-700">
                  Patient / Guardian Signature
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Actions Bar */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowInvoiceModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                <Receipt className="h-3.5 w-3.5 text-slate-500" />
                <span>Open Full Invoice Manager</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrintLiveInvoice}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                <span>Print Invoice</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create Another Admission</span>
              </button>
            </div>
          </div>
        </div>

        {/* Immediate Invoice Detail Modal (if cashier wants to collect further payment or record adjustments) */}
        {showInvoiceModal && createdInvoice && (
          <InvoiceDetailModal
            invoiceId={createdInvoice.id}
            onClose={() => {
              setShowInvoiceModal(false);
              fetchInvoiceDetail(createdInvoice.id).then(setLiveInvoiceDetail).catch(() => {});
            }}
            onChanged={() => {
              fetchInvoiceDetail(createdInvoice.id).then(setLiveInvoiceDetail).catch(() => {});
            }}
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
