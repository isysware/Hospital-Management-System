import PanelMembershipFields from './PanelMembershipFields';
import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Phone,
  MapPin,
  Building,
  AlertTriangle,
  AlertCircle,
  Search,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
  Info,
} from 'lucide-react';
import {
  Patient,
  PatientFormData,
  PatientGender,
  PayerType,
  BloodGroup,
  GuardianRelation,
  PATIENT_GENDERS,
  PAYER_TYPES,
  GUARDIAN_RELATIONS,
  DuplicateCheckResult,
} from '../../../types/patient';
import {
  calculateAgeFromDob,
  normalizeCnic,
  isValidCnic,
  isValidPhone,
  checkDuplicates,
  generateNextMrNumber,
  getAllPatients,
} from '../../../services/patientRegistryService';
import { getActiveCorporatePanels, fetchCorporatePanels, type CorporatePanel } from '../../../services/panelService';
import { useToast } from '../../../context/ToastContext';

export const PAKISTAN_CITIES = [
  'Lahore',
  'Karachi',
  'Islamabad',
  'Rawalpindi',
  'Faisalabad',
  'Gujrat',
  'Gujranwala',
  'Multan',
  'Peshawar',
  'Quetta',
  'Sialkot',
  'Hyderabad',
  'Bahawalpur',
  'Sargodha',
  'Abbottabad',
  'Other',
];

export const COUNTRIES = [
  'Pakistan',
  'United Arab Emirates',
  'Saudi Arabia',
  'United Kingdom',
  'United States',
  'Canada',
  'Other',
];

const CITY_PROVINCE_MAP: Record<string, string> = {
  Lahore: 'Punjab',
  Faisalabad: 'Punjab',
  Rawalpindi: 'Punjab',
  Gujrat: 'Punjab',
  Gujranwala: 'Punjab',
  Multan: 'Punjab',
  Sialkot: 'Punjab',
  Bahawalpur: 'Punjab',
  Sargodha: 'Punjab',
  Karachi: 'Sindh',
  Hyderabad: 'Sindh',
  Islamabad: 'Islamabad Capital Territory',
  Peshawar: 'Khyber Pakhtunkhwa',
  Abbottabad: 'Khyber Pakhtunkhwa',
  Quetta: 'Balochistan',
};

interface PatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: PatientFormData) => void;
  patientToEdit?: Patient | null;
  onOpenExistingPatient?: (patient: Patient) => void;
}

export const PatientModal: React.FC<PatientModalProps> = ({
  isOpen,
  onClose,
  onSave,
  patientToEdit,
  onOpenExistingPatient,
}) => {
  const toast = useToast();
  const isEditMode = Boolean(patientToEdit);
  // Company transfer is allowed (panel.md §14 backlog item 1 — every past
  // invoice now freezes its own payer, so moving a patient's live
  // membership forward can no longer misattribute old receivables), but it
  // stays an explicit, confirmed action rather than a plain editable field —
  // this is a real transfer of the patient's active company, not a typo fix.
  const [allowCompanyTransfer, setAllowCompanyTransfer] = useState(false);
  const [panels, setPanels] = useState<CorporatePanel[]>(getActiveCorporatePanels);
  const [panelLoadError, setPanelLoadError] = useState('');
  const activePanels = panels.filter(p => p.status === 'Active' || p.id === patientToEdit?.panelId);
  useEffect(() => {
    if (!isOpen) return;
    let ignore = false;
    setPanelLoadError('');
    fetchCorporatePanels().then(list => { if (!ignore) setPanels(list); }).catch(error => { if (!ignore) setPanelLoadError(error.message || 'Could not refresh companies'); });
    return () => { ignore = true; };
  }, [isOpen]);

  // Quick lookup search for existing patient
  const [quickSearchTerm, setQuickSearchTerm] = useState('');
  const [quickSearchResults, setQuickSearchResults] = useState<Patient[]>([]);

  // Projected MR for display
  const [previewMrNumber, setPreviewMrNumber] = useState('');

  // Form State
  const [formData, setFormData] = useState<PatientFormData>({
    fullName: '',
    fatherGuardianName: '',
    guardianRelation: 'Father',
    dateOfBirth: '',
    age: '',
    ageIsEstimated: false,
    gender: 'Male',
    cnic: '',
    passportNumber: '',
    primaryPhone: '',
    alternatePhone: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: 'Lahore',
    province: 'Punjab',
    country: 'Pakistan',
    bloodGroup: 'Unknown',
    payerType: 'Self Pay',
    panelId: '',
    panelName: '',
    panelMemberId: '',
    emergencyContactName: '',
    emergencyContactRelation: '',
    emergencyContactPhone: '',
    status: 'ACTIVE',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateCheckResult | null>(null);
  const [ignoreWeakDuplicateWarning, setIgnoreWeakDuplicateWarning] = useState(false);

  // Initialize or reset form
  useEffect(() => {
    if (isOpen) {
      setErrors({});
      setDuplicateWarning(null);
      setIgnoreWeakDuplicateWarning(false);
      setQuickSearchTerm('');
      setQuickSearchResults([]);
      setAllowCompanyTransfer(false);

      if (patientToEdit) {
        setFormData({
          fullName: patientToEdit.fullName,
          fatherGuardianName: patientToEdit.fatherGuardianName || '',
          guardianRelation: patientToEdit.guardianRelation || 'Father',
          dateOfBirth: patientToEdit.dateOfBirth || '',
          age: patientToEdit.age,
          ageIsEstimated: patientToEdit.ageIsEstimated,
          gender: patientToEdit.gender,
          cnic: patientToEdit.cnic || '',
          passportNumber: patientToEdit.passportNumber || '',
          primaryPhone: patientToEdit.primaryPhone,
          alternatePhone: patientToEdit.alternatePhone || '',
          email: patientToEdit.email || '',
          addressLine1: patientToEdit.addressLine1 || '',
          addressLine2: patientToEdit.addressLine2 || '',
          city: patientToEdit.city || 'Lahore',
          province: patientToEdit.province || 'Punjab',
          country: patientToEdit.country || 'Pakistan',
          bloodGroup: patientToEdit.bloodGroup || 'Unknown',
          payerType: patientToEdit.payerType,
          panelId: patientToEdit.panelId || '',
          panelName: patientToEdit.panelName || '',
          panelMemberId: patientToEdit.panelMemberId || '',
          membershipStatus: patientToEdit.membershipStatus || 'ACTIVE',
          membershipValidFrom: patientToEdit.membershipValidFrom || '',
          membershipValidTo: patientToEdit.membershipValidTo || '',
          policyNumber: patientToEdit.policyNumber || '',
          planName: patientToEdit.planName || '',
          principalMemberName: patientToEdit.principalMemberName || '',
          memberRelationship: patientToEdit.memberRelationship || '',
          emergencyContactName: patientToEdit.emergencyContactName || '',
          emergencyContactRelation: patientToEdit.emergencyContactRelation || '',
          emergencyContactPhone: patientToEdit.emergencyContactPhone || '',
          status: patientToEdit.status,
        });
        setPreviewMrNumber(patientToEdit.mrNumber);
      } else {
        // Register mode: reset and compute next MR
        const nextMr = generateNextMrNumber();
        setPreviewMrNumber(nextMr);
        setFormData({
          fullName: '',
          fatherGuardianName: '',
          guardianRelation: 'Father',
          dateOfBirth: '',
          age: '',
          ageIsEstimated: false,
          gender: 'Male',
          cnic: '',
          passportNumber: '',
          primaryPhone: '',
          alternatePhone: '',
          email: '',
          addressLine1: '',
          addressLine2: '',
          city: 'Lahore',
          province: 'Punjab',
          country: 'Pakistan',
          bloodGroup: 'Unknown',
          payerType: 'Self Pay',
          panelId: '',
          panelName: '',
          panelMemberId: '',
          emergencyContactName: '',
          emergencyContactRelation: '',
          emergencyContactPhone: '',
          status: 'ACTIVE',
        });
      }
    }
  }, [isOpen, patientToEdit]);

  // Handle quick lookup search
  useEffect(() => {
    const trimmed = quickSearchTerm.trim();
    if (!trimmed) {
      setQuickSearchResults([]);
      return;
    }
    const q = trimmed.toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    const all = getAllPatients();
    const matches = all.filter((p) => {
      const mMr = p.mrNumber.toLowerCase().includes(q);
      const mName = p.fullName.toLowerCase().includes(q);
      const mFather = (p.fatherGuardianName || '').toLowerCase().includes(q);
      const mPanelMember = p.panelMemberId ? p.panelMemberId.toLowerCase().includes(q) : false;
      const mCnic = p.cnic
        ? (qDigits.length >= 3 && p.cnic.replace(/\D/g, '').includes(qDigits)) || p.cnic.toLowerCase().includes(q)
        : false;
      const mPhone = p.primaryPhone
        ? (qDigits.length >= 3 && p.primaryPhone.replace(/\D/g, '').includes(qDigits)) || p.primaryPhone.toLowerCase().includes(q)
        : false;
      return mMr || mName || mFather || mPanelMember || mCnic || mPhone;
    });
    setQuickSearchResults(matches.slice(0, 5));
  }, [quickSearchTerm]);

  // Live duplicate detection — now a real backend query (panel.md §17
  // backlog item 3), so it's debounced (don't fire on every keystroke) and
  // guards against a stale response landing after a newer keystroke.
  useEffect(() => {
    if (!isOpen) return;

    const normCnic = normalizeCnic(formData.cnic);
    const hasCnic = normCnic && isValidCnic(normCnic);
    const hasPhone = isValidPhone(formData.primaryPhone);
    const hasPassport = Boolean(formData.passportNumber?.trim());
    const hasNameAndFather = Boolean(formData.fullName.trim() && formData.fatherGuardianName.trim());
    const hasNameAndDob = Boolean(formData.fullName.trim() && formData.dateOfBirth);
    const hasMemberId = Boolean(formData.payerType === 'Corporate / Panel' && formData.panelMemberId?.trim());

    if (!(hasCnic || hasPassport || (hasPhone && formData.primaryPhone.length >= 10) || hasNameAndFather || hasNameAndDob || hasMemberId)) {
      setDuplicateWarning(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      checkDuplicates(
        {
          cnic: normCnic,
          passportNumber: formData.passportNumber,
          primaryPhone: formData.primaryPhone,
          fullName: formData.fullName,
          fatherGuardianName: formData.fatherGuardianName,
          dateOfBirth: formData.dateOfBirth,
          panelMemberId: formData.payerType === 'Corporate / Panel' ? formData.panelMemberId : undefined,
        },
        patientToEdit?.id
      ).then((check) => {
        if (cancelled) return;
        setDuplicateWarning(check.isExactCnic || check.isExactPassport || check.isPossibleDuplicate ? check : null);
      });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    formData.cnic,
    formData.passportNumber,
    formData.primaryPhone,
    formData.fullName,
    formData.fatherGuardianName,
    formData.dateOfBirth,
    formData.panelMemberId,
    formData.payerType,
    isOpen,
    patientToEdit,
  ]);

  if (!isOpen) return null;

  // Handle DOB change: automatically calculate age and sync
  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dob = e.target.value;
    if (dob) {
      const computedAge = calculateAgeFromDob(dob);
      setFormData((prev) => ({
        ...prev,
        dateOfBirth: dob,
        age: computedAge,
        ageIsEstimated: false,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        dateOfBirth: '',
        age: '',
        ageIsEstimated: true,
      }));
    }
  };

  // Handle Manual Age change (only allowed when DOB is empty)
  const handleAgeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFormData((prev) => ({
      ...prev,
      age: val,
      ageIsEstimated: true,
    }));
  };

  // Handle CNIC with auto-normalization
  const handleCnicChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const cleanDigits = raw.replace(/\D/g, '').slice(0, 13);
    let formatted = cleanDigits;
    if (cleanDigits.length > 5 && cleanDigits.length <= 12) {
      formatted = `${cleanDigits.slice(0, 5)}-${cleanDigits.slice(5)}`;
    } else if (cleanDigits.length > 12) {
      formatted = `${cleanDigits.slice(0, 5)}-${cleanDigits.slice(5, 12)}-${cleanDigits.slice(12)}`;
    }
    setFormData((prev) => ({ ...prev, cnic: formatted }));
  };

  // Handle Payer Type Switch: if Self Pay, clear panel info
  const handlePayerTypeChange = (newPayer: PayerType) => {
    if (newPayer === 'Self Pay') {
      setFormData((prev) => ({
        ...prev,
        payerType: 'Self Pay',
        panelId: '',
        panelName: '',
        panelMemberId: '',
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        payerType: 'Corporate / Panel',
      }));
    }
  };

  // City and Country change handlers for panel patient address
  const handleCityChange = (cityName: string) => {
    setFormData((prev) => ({
      ...prev,
      city: cityName,
      province: CITY_PROVINCE_MAP[cityName] || prev.province || 'Punjab',
    }));
  };

  const handleCountryChange = (countryName: string) => {
    setFormData((prev) => ({
      ...prev,
      country: countryName,
    }));
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.fullName.trim()) {
      newErrors.fullName = 'Patient full name is required.';
    }

    if (!formData.gender) {
      newErrors.gender = 'Gender is required.';
    }

    if (!formData.primaryPhone.trim()) {
      newErrors.primaryPhone = 'Primary phone number is required.';
    } else if (!isValidPhone(formData.primaryPhone)) {
      newErrors.primaryPhone = 'Please enter a valid phone number (at least 10 digits).';
    }

    if (formData.cnic.trim()) {
      const norm = normalizeCnic(formData.cnic);
      if (!isValidCnic(norm)) {
        newErrors.cnic = 'CNIC must be 13 digits (format: XXXXX-XXXXXXX-X).';
      }
    }

    if (!formData.dateOfBirth && (formData.age === '' || Number(formData.age) < 0 || Number(formData.age) > 125)) {
      newErrors.age = 'Provide a valid age (0–125) or select Date of Birth.';
    }

    if (formData.payerType === 'Corporate / Panel') {
      if (!formData.panelId) {
        newErrors.panelId = 'Please select a Corporate Panel.';
      }
      if (activePanels.find(p => p.id === formData.panelId)?.memberIdRequired && !formData.panelMemberId.trim()) {
        newErrors.panelMemberId = 'Panel Member ID / Card Number is required.';
      }
    }

    setErrors(newErrors);
    const isValid = Object.keys(newErrors).length === 0;
    if (!isValid) {
      const firstError = Object.values(newErrors)[0];
      if (firstError) toast.error(firstError, 'Validation Error');
    }
    return isValid;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // If exact duplicate exists, block creation completely
    if (duplicateWarning?.isExactCnic || duplicateWarning?.isExactPassport) {
      toast.error('Exact duplicate detected (matching CNIC/Passport). Cannot register duplicate patient.', 'Duplicate Error');
      return;
    }

    // If weaker match exists and not yet dismissed by staff
    if (duplicateWarning?.isPossibleDuplicate && !ignoreWeakDuplicateWarning) {
      toast.warning('Possible duplicate patient found. Please review existing records or click proceed.', 'Duplicate Warning');
      return;
    }

    if (!validateForm()) {
      return;
    }

    onSave(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-[#e2eae5] overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#effaf5] border border-[#c2e7db] text-[#08775A] flex items-center justify-center">
                <User className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {isEditMode ? `Edit Patient Record` : `Register New Patient`}
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Permanent MR:</span>
                  <span className="font-mono font-bold text-[#08775A] bg-[#effaf5] px-1.5 py-0.5 rounded-sm border border-[#c2e7db]">
                    {previewMrNumber}
                  </span>
                  {isEditMode && (
                    <span className="text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-sm border border-amber-200">
                      Read-Only (Preserved)
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body with scroll */}
        <div className="overflow-y-auto px-6 py-5 space-y-6 flex-1 text-sm">
          {/* Quick Lookup Toolbar for New Registration */}
          {!isEditMode && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <Search className="w-3.5 h-3.5 text-[#08775A]" />
                  <span>Search Existing Patient First</span>
                </div>
                <span className="text-[11px] text-slate-500">
                  Recommended to prevent duplicate MR creation
                </span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={quickSearchTerm}
                  onChange={(e) => setQuickSearchTerm(e.target.value)}
                  placeholder="Check CNIC, Phone, MR Number, or Patient Name..."
                  className="w-full pl-3 pr-8 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-hidden focus:border-[#08775A] focus:ring-1 focus:ring-[#08775A]"
                />
                {quickSearchTerm && (
                  <button
                    type="button"
                    onClick={() => setQuickSearchTerm('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Quick Results Preview */}
              {quickSearchTerm.trim().length > 0 && (
                quickSearchResults.length > 0 ? (
                  <div className="mt-2.5 bg-white border border-emerald-200 rounded-lg divide-y divide-slate-100 overflow-hidden shadow-xs">
                    <div className="px-3 py-1.5 bg-emerald-50 text-[11px] font-semibold text-emerald-800">
                      Existing Patients Found ({quickSearchResults.length}):
                    </div>
                    {quickSearchResults.map((p) => (
                      <div
                        key={p.id}
                        className="px-3 py-2 flex items-center justify-between hover:bg-slate-50 text-xs"
                      >
                        <div>
                          <span className="font-mono font-bold text-[#08775A] mr-2">
                            {p.mrNumber}
                          </span>
                          <span className="font-semibold text-slate-800">{p.fullName}</span>
                          {p.fatherGuardianName && (
                            <span className="text-slate-400 ml-1">
                              ({p.guardianRelation}: {p.fatherGuardianName})
                            </span>
                          )}
                          <span className="text-slate-500 ml-2 font-mono">{p.primaryPhone}</span>
                          {p.cnic && (
                            <span className="text-slate-400 ml-2 font-mono">[{p.cnic}]</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (onOpenExistingPatient) {
                              onOpenExistingPatient(p);
                              onClose();
                            }
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#08775A] hover:underline cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open Patient
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2.5 px-3 py-2 bg-slate-100/80 border border-slate-200 rounded-lg text-xs text-slate-500 flex items-center justify-between">
                    <span>No existing patient matches "{quickSearchTerm.trim()}". Safe to proceed with new registration.</span>
                  </div>
                )
              )}
            </div>
          )}

          {/* DUPLICATE WARNING / BLOCKING BANNERS */}
          {duplicateWarning && (
            <div>
              {duplicateWarning.isExactCnic || duplicateWarning.isExactPassport ? (
                // Hard Duplicate Block (Exact CNIC or Passport)
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-900">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-red-800">
                        Duplicate Identity Blocked
                      </h4>
                      <p className="text-xs text-red-700 mt-0.5">
                        {duplicateWarning.reason}
                      </p>

                      {duplicateWarning.matchedPatients.map((matched) => (
                        <div
                          key={matched.id}
                          className="mt-2.5 bg-white border border-red-200 rounded-lg p-3 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-mono font-bold text-[#08775A] mr-2">
                              {matched.mrNumber}
                            </span>
                            <span className="font-semibold text-slate-800">
                              {matched.fullName}
                            </span>
                            <span className="text-slate-500 ml-2 font-mono">
                              Phone: {matched.primaryPhone}
                            </span>
                            {matched.cnic && (
                              <span className="text-slate-600 ml-2 font-mono">
                                CNIC: {matched.cnic}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (onOpenExistingPatient) {
                                onOpenExistingPatient(matched);
                                onClose();
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#08775A] text-white rounded-md text-xs font-medium hover:bg-[#07664d] transition-colors"
                          >
                            Open Existing Patient
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : duplicateWarning.isPossibleDuplicate && !ignoreWeakDuplicateWarning ? (
                // Weaker Match Warning (Phone or Name Match)
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-amber-800">
                        Possible Existing Patient Found
                      </h4>
                      <p className="text-xs text-amber-700 mt-0.5">
                        {duplicateWarning.reason}
                      </p>

                      <div className="mt-2 space-y-1.5">
                        {duplicateWarning.matchedPatients.map((matched) => (
                          <div
                            key={matched.id}
                            className="bg-white border border-amber-200 rounded-lg p-2.5 text-xs flex items-center justify-between"
                          >
                            <div>
                              <span className="font-mono font-bold text-[#08775A] mr-2">
                                {matched.mrNumber}
                              </span>
                              <span className="font-semibold text-slate-800">
                                {matched.fullName}
                              </span>
                              <span className="text-slate-500 ml-2 font-mono">
                                {matched.primaryPhone}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                if (onOpenExistingPatient) {
                                  onOpenExistingPatient(matched);
                                  onClose();
                                }
                              }}
                              className="text-xs font-semibold text-[#08775A] hover:underline"
                            >
                              Review Patient
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setIgnoreWeakDuplicateWarning(true)}
                          className="px-3 py-1 bg-amber-600 text-white rounded-md text-xs font-medium hover:bg-amber-700 transition-colors"
                        >
                          Continue Registration (Different Individual)
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <form id="patient-form" onSubmit={handleSubmit} className="space-y-5">
            {/* PAYER CATEGORY */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Payer Category <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                    formData.payerType === 'Self Pay'
                      ? 'border-[#08775A] bg-[#effaf5] text-[#08775A] font-semibold shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="payerType"
                    checked={formData.payerType === 'Self Pay'}
                    onChange={() => handlePayerTypeChange('Self Pay')}
                    className="text-[#08775A] focus:ring-[#08775A]"
                  />
                  <div>
                    <div className="text-sm">Self Pay</div>
                    <div className="text-xs text-slate-500 font-normal">
                      Patient pays directly at hospital billing counter
                    </div>
                  </div>
                </label>

                <label
                  className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                    formData.payerType === 'Corporate / Panel'
                      ? 'border-[#08775A] bg-[#effaf5] text-[#08775A] font-semibold shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="payerType"
                    checked={formData.payerType === 'Corporate / Panel'}
                    onChange={() => handlePayerTypeChange('Corporate / Panel')}
                    className="text-[#08775A] focus:ring-[#08775A]"
                  />
                  <div>
                    <div className="text-sm">Corporate / Panel</div>
                    <div className="text-xs text-slate-500 font-normal">
                      Company, insurance, or corporate panel coverage
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* PATIENT DEMOGRAPHICS (OPD / Admission fast-entry style) */}
            <div className="border border-slate-200 rounded-xl p-4 bg-white">
              <div className="flex items-center gap-2 pb-3 mb-4 border-b border-slate-100">
                <User className="w-4 h-4 text-[#08775A]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Patient Demographics
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Full Name */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="e.g. Muhammad Tariq Khan"
                    className={`w-full px-3 py-2 bg-slate-50 border rounded-lg text-sm text-slate-800 focus:outline-hidden focus:bg-white ${
                      errors.fullName
                        ? 'border-red-400 focus:border-red-500'
                        : 'border-slate-300 focus:border-[#08775A]'
                    }`}
                  />
                  {errors.fullName && (
                    <p className="text-xs text-red-500 mt-1">{errors.fullName}</p>
                  )}
                </div>

                {/* Gender */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Gender <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.gender}
                    onChange={(e) =>
                      setFormData({ ...formData, gender: e.target.value as PatientGender })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:bg-white focus:border-[#08775A]"
                  >
                    {PATIENT_GENDERS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Father / Guardian / Spouse Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Father / Guardian / Spouse Name
                  </label>
                  <input
                    type="text"
                    value={formData.fatherGuardianName}
                    onChange={(e) =>
                      setFormData({ ...formData, fatherGuardianName: e.target.value })
                    }
                    placeholder="e.g. Abdul Hameed Khan"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:bg-white focus:border-[#08775A]"
                  />
                </div>

                {/* Guardian Relation */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Guardian Relation
                  </label>
                  <select
                    value={formData.guardianRelation}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        guardianRelation: e.target.value as GuardianRelation,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:bg-white focus:border-[#08775A]"
                  >
                    {GUARDIAN_RELATIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.primaryPhone}
                    onChange={(e) => setFormData({ ...formData, primaryPhone: e.target.value })}
                    placeholder="0300-1234567"
                    className={`w-full px-3 py-2 font-mono bg-slate-50 border rounded-lg text-sm text-slate-800 focus:outline-hidden focus:bg-white ${
                      errors.primaryPhone
                        ? 'border-red-400 focus:border-red-500'
                        : 'border-slate-300 focus:border-[#08775A]'
                    }`}
                  />
                  {errors.primaryPhone && (
                    <p className="text-xs text-red-500 mt-1">{errors.primaryPhone}</p>
                  )}
                </div>

                {/* Date of Birth */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Date of Birth
                  </label>
                  <input
                    lang="en-GB"
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={handleDobChange}
                    max="2026-09-09"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:bg-white focus:border-[#08775A]"
                  />
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {formData.dateOfBirth ? 'Age auto-computed' : 'Optional if age entered'}
                  </p>
                </div>

                {/* Age */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Age (Years){' '}
                    {formData.ageIsEstimated && (
                      <span className="text-amber-600 font-normal">(Estimated)</span>
                    )}
                  </label>
                  <input
                    type="number"
                    onWheel={(e) => e.currentTarget.blur()}
                    value={formData.age}
                    onChange={handleAgeChange}
                    disabled={Boolean(formData.dateOfBirth)}
                    placeholder="e.g. 45"
                    min="0"
                    max="125"
                    className={`w-full px-3 py-2 bg-slate-50 border rounded-lg text-sm text-slate-800 focus:outline-hidden focus:bg-white ${
                      formData.dateOfBirth ? 'bg-slate-100 text-slate-600' : ''
                    } ${errors.age ? 'border-red-400' : 'border-slate-300'}`}
                  />
                  {errors.age && <p className="text-xs text-red-500 mt-1">{errors.age}</p>}
                </div>

                {/* CNIC */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    CNIC (Pakistani National ID)
                  </label>
                  <input
                    type="text"
                    value={formData.cnic}
                    onChange={handleCnicChange}
                    placeholder="35202-1234567-1"
                    maxLength={15}
                    className={`w-full px-3 py-2 font-mono bg-slate-50 border rounded-lg text-sm text-slate-800 focus:outline-hidden focus:bg-white ${
                      errors.cnic ? 'border-red-400' : 'border-slate-300 focus:border-[#08775A]'
                    }`}
                  />
                  {errors.cnic && <p className="text-xs text-red-500 mt-1">{errors.cnic}</p>}
                </div>
              </div>
            </div>

            {/* SECTION: CORPORATE PANEL & RESIDENTIAL ADDRESS (Rendered only for Corporate / Panel) */}
            {formData.payerType === 'Corporate / Panel' && (
              <div className="border border-emerald-200 rounded-xl p-4 bg-emerald-50/20">
                <div className="flex items-center gap-2 pb-3 mb-4 border-b border-emerald-100">
                  <Building className="w-4 h-4 text-[#08775A]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Corporate Panel & Address Details
                  </h3>
                </div>

                {panelLoadError && <p role="alert" className="text-xs text-red-600 mb-3">{panelLoadError}</p>}

                {/* Corporate Panel Entity & Member ID */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-700">
                        Corporate Panel Entity <span className="text-red-500">*</span>
                      </label>
                      {isEditMode && !allowCompanyTransfer && (
                        <button
                          type="button"
                          onClick={() => setAllowCompanyTransfer(true)}
                          className="text-[10.5px] font-semibold text-[#08775A] hover:underline"
                        >
                          Transfer to another company
                        </button>
                      )}
                    </div>
                    {isEditMode && allowCompanyTransfer && (
                      <p className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mb-1.5">
                        Past invoices stay billed to the original company — only new charges after saving will use the new company.
                      </p>
                    )}
                    <select
                      disabled={isEditMode && !allowCompanyTransfer}
                      value={formData.panelId}
                      onChange={(e) => {
                        const selectedId = e.target.value;
                        const p = activePanels.find((panel) => panel.id === selectedId);
                        setFormData({
                          ...formData,
                          panelId: selectedId,
                          panelName: p ? p.name : '',
                        });
                      }}
                      className={`w-full px-3 py-2 bg-white border rounded-lg text-sm text-slate-800 focus:outline-hidden focus:bg-white disabled:opacity-60 ${
                        errors.panelId ? 'border-red-400' : 'border-slate-300 focus:border-[#08775A]'
                      }`}
                    >
                      <option value="">-- Select Corporate Panel --</option>
                      {activePanels.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} - {p.name}
                        </option>
                      ))}
                    </select>
                    {errors.panelId && (
                      <p className="text-xs text-red-500 mt-1">{errors.panelId}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {activePanels.find((p) => p.id === formData.panelId)?.memberIdLabel || 'Panel Member ID / Card Number'}
                    </label>
                    <input
                      type="text"
                      value={formData.panelMemberId}
                      onChange={(e) =>
                        setFormData({ ...formData, panelMemberId: e.target.value })
                      }
                      placeholder="e.g. SLI-99214-PK / Card #"
                      className={`w-full px-3 py-2 font-mono bg-white border rounded-lg text-sm text-slate-800 focus:outline-hidden focus:bg-white ${
                        errors.panelMemberId
                          ? 'border-red-400'
                          : 'border-slate-300 focus:border-[#08775A]'
                      }`}
                    />
                    {errors.panelMemberId && (
                      <p className="text-xs text-red-500 mt-1">{errors.panelMemberId}</p>
                    )}
                  </div>
                </div>

                {/* Panel Status & Validity */}
                <PanelMembershipFields
                  key={patientToEdit?.id || 'new'}
                  value={formData}
                  onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
                  patientId={patientToEdit?.id}
                  datesRequired={activePanels.find((p) => p.id === formData.panelId)?.membershipValidityRequired}
                />

                {/* Residential Address with City & Country Dropdowns */}
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="flex items-center gap-1.5 mb-3 text-xs font-bold text-slate-700">
                    <MapPin className="w-3.5 h-3.5 text-[#08775A]" />
                    <span>Residential Address</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Street Address / Flat / Area
                      </label>
                      <input
                        type="text"
                        value={formData.addressLine1}
                        onChange={(e) => setFormData({ ...formData, addressLine1: e.target.value })}
                        placeholder="House / Flat No, Street, Sector, Area"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:border-[#08775A]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        City
                      </label>
                      <select
                        value={formData.city || 'Lahore'}
                        onChange={(e) => handleCityChange(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:border-[#08775A]"
                      >
                        {formData.city && !PAKISTAN_CITIES.includes(formData.city) && (
                          <option value={formData.city}>{formData.city}</option>
                        )}
                        {PAKISTAN_CITIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Country
                      </label>
                      <select
                        value={formData.country || 'Pakistan'}
                        onChange={(e) => handleCountryChange(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-hidden focus:border-[#08775A]"
                      >
                        {formData.country && !COUNTRIES.includes(formData.country) && (
                          <option value={formData.country}>{formData.country}</option>
                        )}
                        {COUNTRIES.map((cntry) => (
                          <option key={cntry} value={cntry}>
                            {cntry}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {isEditMode && (
                  <div className="mt-3 flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
                    <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <span>
                      Membership changes are recorded in history. The permanent MR number and company remain unchanged.
                    </span>
                  </div>
                )}
              </div>
            )}
          </form>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="text-xs text-slate-500">
            <span className="text-red-500 font-semibold">*</span> Required hospital identity fields
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200/70 rounded-lg transition-colors border border-slate-300 bg-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="patient-form"
              disabled={Boolean(
                duplicateWarning?.isExactCnic || duplicateWarning?.isExactPassport
              )}
              className="px-5 py-2 text-sm font-medium text-white bg-[#08775A] hover:bg-[#07664d] rounded-lg transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isEditMode ? 'Save Changes' : 'Register Patient'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
