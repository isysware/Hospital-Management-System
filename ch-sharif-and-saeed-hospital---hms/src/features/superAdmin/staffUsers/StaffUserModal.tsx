import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  AlertCircle,
  User,
  Stethoscope,
  Clock,
  Wallet,
  Percent,
  Landmark,
  ClipboardCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import {
  StaffUser,
  StaffUserFormValues,
  StaffStatus,
  StaffCategory,
  STAFF_CATEGORIES,
  SalaryBasis,
  SALARY_BASIS_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  PaymentMethod,
  CommissionRuleForm,
  WeeklyDayForm,
  isCommissionBasis,
  isDailyBasis,
  defaultWizardExtras,
  defaultWeeklySchedule,
} from '../../../types/staffUser';
import { Department } from '../../../types/department';
import { HospitalService } from '../../../types/serviceRates';
import { Shift } from '../../../types/shift';
import { StaffUserService, StaffWizardChanges } from '../../../services/staffUserService';
import { formatCnicInput, formatPKR } from '../../../utils/formatters';
import { useToast } from '../../../context/ToastContext';

interface StaffUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (values: StaffUserFormValues, changes: StaffWizardChanges) => Promise<void> | void;
  editingStaff?: StaffUser | null;
  departments: Department[];
  services: HospitalService[];
  shifts: Shift[];
}

type StepKey = 'basic' | 'assign' | 'discharge' | 'shift' | 'salary' | 'commission' | 'bank' | 'review';

const STEP_META: Record<StepKey, { label: string; icon: React.ElementType }> = {
  basic: { label: 'Basic Info', icon: User },
  assign: { label: 'Department & Services', icon: Stethoscope },
  discharge: { label: 'Discharge Credentials', icon: ShieldCheck },
  shift: { label: 'Shift & Timing', icon: Clock },
  salary: { label: 'Salary', icon: Wallet },
  commission: { label: 'Commission', icon: Percent },
  bank: { label: 'Bank / Account', icon: Landmark },
  review: { label: 'Review & Save', icon: ClipboardCheck },
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): StaffUserFormValues => ({
  fullName: '',
  employeeCode: StaffUserService.getNextNumericEmployeeCode(),
  fatherGuardianName: '',
  cnic: '',
  dateOfBirth: '',
  phone: '',
  alternatePhone: '',
  email: '',
  designation: '',
  staffCategory: 'Nurse',
  status: 'ACTIVE',
  departmentIds: [],
  serviceIds: [],
  assignedShiftId: '',
  salaryEnabled: true,
  salaryBasis: 'MONTHLY',
  baseSalary: '',
  salaryTaxMethod: '',
  salaryTaxValue: '',
  salaryEffectiveFrom: today(),
  ...defaultWizardExtras(),
  scheduleEnabled: true,
  bankEnabled: true,
});

// JSON snapshots of each wizard section — used on Edit to re-save only what changed.
const sectionSnapshot = (f: StaffUserFormValues) => ({
  schedule: JSON.stringify([f.weeklySchedule]),
  salary: JSON.stringify([f.salaryBasis, f.baseSalary, f.salaryTaxMethod, f.salaryTaxValue, f.salaryAllowance, f.salaryDeduction, f.salaryEffectiveFrom]),
  commission: JSON.stringify([f.commissionRules, f.commissionTaxMethod, f.commissionTaxValue, f.commissionEffectiveFrom]),
  bank: JSON.stringify([f.bank]),
});

// ── small themed form controls ───────────────────────────────────────────
const INPUT =
  'w-full h-9 px-3 bg-white border rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] disabled:bg-slate-100 disabled:text-slate-400';

const Field: React.FC<{ label: string; required?: boolean; error?: string; hint?: string; className?: string; children: React.ReactNode }> = ({
  label,
  required,
  error,
  hint,
  className,
  children,
}) => (
  <div className={className}>
    <label className="block text-xs font-semibold text-slate-600 mb-1">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
    {error ? <p className="text-[11px] text-rose-600 mt-1">{error}</p> : hint ? <p className="text-[11px] text-slate-400 mt-1">{hint}</p> : null}
  </div>
);

const inputCls = (error?: string) => `${INPUT} ${error ? 'border-rose-400' : 'border-slate-300'}`;

const NumberInput: React.FC<{ value: number | ''; onChange: (v: number | '') => void; error?: string; disabled?: boolean; step?: number; placeholder?: string }> = ({
  value,
  onChange,
  error,
  disabled,
  step,
  placeholder,
}) => (
  <input
    type="number"
    min={0}
    step={step}
    disabled={disabled}
    placeholder={placeholder}
    onWheel={(e) => e.currentTarget.blur()}
    value={value}
    onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    className={`${inputCls(error)} tabular-nums`}
  />
);

const SectionTitle: React.FC<{ title: string; note?: string }> = ({ title, note }) => (
  <div className="flex items-baseline justify-between gap-2 pb-2 mb-3 border-b border-slate-200">
    <h4 className="text-sm font-bold text-slate-900">{title}</h4>
    {note && <span className="text-[11px] text-slate-500">{note}</span>}
  </div>
);

const TH = 'py-2 px-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 border-r border-slate-200 last:border-r-0';
const TD = 'py-2 px-3 border-r border-slate-100 last:border-r-0 align-middle';

export const StaffUserModal: React.FC<StaffUserModalProps> = ({ isOpen, onClose, onSave, editingStaff, departments, services, shifts }) => {
  const toast = useToast();
  const isEdit = Boolean(editingStaff);
  const activeDepartments = departments.filter((d) => d.status === 'Active');
  const activeServices = services.filter((s) => s.status === 'Active');
  const activeShifts = shifts.filter((s) => s.status === 'ACTIVE');

  const [formData, setFormData] = useState<StaffUserFormValues>(emptyForm());
  const [initialSnapshot, setInitialSnapshot] = useState(sectionSnapshot(emptyForm()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<StepKey>('basic');
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const set = (patch: Partial<StaffUserFormValues>) => setFormData((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (!isOpen) return;
    setStep('basic');
    setErrors({});
    if (!editingStaff) {
      const fresh = emptyForm();
      setFormData(fresh);
      setInitialSnapshot(sectionSnapshot(fresh));
      return;
    }

    const base: StaffUserFormValues = {
      ...emptyForm(),
      fullName: editingStaff.fullName,
      employeeCode: editingStaff.employeeCode,
      fatherGuardianName: editingStaff.fatherGuardianName || '',
      cnic: editingStaff.cnic || '',
      dateOfBirth: editingStaff.dateOfBirth ? String(editingStaff.dateOfBirth).slice(0, 10) : '',
      phone: editingStaff.phone,
      alternatePhone: editingStaff.alternatePhone || '',
      email: editingStaff.email || '',
      designation: editingStaff.designation || '',
      staffCategory: editingStaff.staffCategory,
      status: editingStaff.status,
      departmentIds: editingStaff.departmentIds ?? [],
      serviceIds: editingStaff.assignedServiceIds ?? [],
      assignedShiftId: editingStaff.assignedShiftId || '',
      clinicalUsername: editingStaff.clinicalAuthUsername || '',
      clinicalExistingUsername: editingStaff.clinicalAuthUsername || '',
    };
    setFormData(base);
    setInitialSnapshot(sectionSnapshot(base));

    // Prefill every wizard section from Staff 360 so re-saving never blanks anything out.
    setIsLoadingProfile(true);
    StaffUserService.fetchFullProfile(editingStaff.id)
      .then((profile) => {
        const next: StaffUserFormValues = { ...base };
        if (profile?.overview?.joiningDate) next.joiningDate = String(profile.overview.joiningDate).slice(0, 10);

        const salary = profile?.salary?.current;
        if (salary) {
          next.salaryBasis = salary.salaryBasis as SalaryBasis;
          next.baseSalary = salary.baseAmount != null ? Number(salary.baseAmount) : '';
          next.salaryTaxMethod = (salary.salaryTaxMethod as 'PERCENTAGE' | 'FIXED' | '') || '';
          next.salaryTaxValue = salary.salaryTaxValue != null ? Number(salary.salaryTaxValue) : '';
          next.salaryAllowance = Number(salary.fixedAllowance) || '';
          next.salaryDeduction = Number(salary.fixedDeduction) || '';
          next.salaryEffectiveFrom = today();
        }

        const schedule = (profile?.weeklySchedule ?? []) as any[];
        if (schedule.length === 7) {
          next.weeklySchedule = schedule.map((d) => ({
            dayOfWeek: d.dayOfWeek,
            isWorking: d.isWorking,
            useShiftDefault: d.useShiftDefault,
            startTime: d.startTime || '',
            endTime: d.endTime || '',
            breakMinutes: d.breakMinutes ?? 0,
          }));
        }

        const openRules = ((profile?.commissionRules ?? []) as any[]).filter((r) => r.effectiveTo === null);
        if (openRules.length > 0) {
          next.commissionRules = openRules.map((r) => ({
            serviceRateId: r.serviceRateId,
            enabled: true,
            ruleType: r.ruleType,
            rate: Number(r.rate),
            basis: r.basis,
          }));
          next.commissionTaxMethod = openRules[0].commissionTaxMethod || '';
          next.commissionTaxValue = openRules[0].commissionTaxValue != null ? Number(openRules[0].commissionTaxValue) : '';
          next.commissionEffectiveFrom = today();
        }

        const bank = profile?.bankAccount?.current;
        if (bank) {
          next.bank = {
            paymentMethod: bank.paymentMethod as PaymentMethod,
            bankName: bank.bankName || '',
            branchName: bank.branchName || '',
            accountTitle: bank.accountTitle || '',
            accountNumber: bank.accountNumber || '',
            iban: bank.iban || '',
            walletAccount: bank.walletAccount || '',
            preferredForSalary: bank.preferredForSalary,
            preferredForCommission: bank.preferredForCommission,
          };
        }
        setFormData(next);
        setInitialSnapshot(sectionSnapshot(next));
      })
      .catch(() => {})
      .finally(() => setIsLoadingProfile(false));
  }, [isOpen, editingStaff]);

  const isDoctor = formData.staffCategory === 'Doctor';
  const hasCommission = isCommissionBasis(formData.salaryBasis);
  const selectedShift = activeShifts.find((s) => s.id === formData.assignedShiftId);

  const steps = useMemo<StepKey[]>(
    () => ['basic', ...(isDoctor ? (['assign', 'discharge'] as StepKey[]) : []), 'shift', 'salary', ...(hasCommission ? (['commission'] as StepKey[]) : []), 'bank', 'review'],
    [isDoctor, hasCommission],
  );
  const stepIndex = Math.max(0, steps.indexOf(step));

  // Keep one commission row per assigned service (+ a default row) whenever the service list changes.
  useEffect(() => {
    setFormData((prev) => {
      const byKey = new Map(prev.commissionRules.map((r) => [r.serviceRateId ?? 'DEFAULT', r]));
      const rows: CommissionRuleForm[] = prev.serviceIds.map(
        (id) => byKey.get(id) ?? { serviceRateId: id, enabled: true, ruleType: 'PERCENTAGE', rate: '', basis: 'NET' },
      );
      rows.push(byKey.get('DEFAULT') ?? { serviceRateId: null, enabled: false, ruleType: 'PERCENTAGE', rate: '', basis: 'NET' });
      if (JSON.stringify(rows) === JSON.stringify(prev.commissionRules)) return prev;
      return { ...prev, commissionRules: rows };
    });
  }, [formData.serviceIds, isOpen]);

  // Commission types need assigned services — only Doctors have them.
  useEffect(() => {
    if (!isDoctor && hasCommission) set({ salaryBasis: isDailyBasis(formData.salaryBasis) ? 'PER_DAY' : 'MONTHLY' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDoctor]);

  if (!isOpen) return null;

  // ── per-step validation ────────────────────────────────────────────────
  const validateStep = (key: StepKey): Record<string, string> => {
    const e: Record<string, string> = {};
    const f = formData;
    if (key === 'basic') {
      if (!f.fullName.trim()) e.fullName = 'Full Name is required.';
      if (!f.fatherGuardianName.trim()) e.fatherGuardianName = 'Father / Guardian Name is required.';
      if (!f.phone.trim()) e.phone = 'Mobile number is required.';
      else if (!StaffUserService.isValidPhone(f.phone)) e.phone = 'Enter a valid Pakistani mobile (e.g. 0300-1234567).';
      if (!f.cnic.trim()) e.cnic = 'CNIC is required.';
      else if (!StaffUserService.isValidCNIC(f.cnic)) e.cnic = 'CNIC must follow xxxxx-xxxxxxx-x.';
      if (!f.dateOfBirth) e.dateOfBirth = 'Date of Birth is required.';
      else if (!StaffUserService.isValidDateOfBirth(f.dateOfBirth)) e.dateOfBirth = 'Date of Birth must be a past date.';
      if (f.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'Enter a valid email address.';
      if (!f.joiningDate) e.joiningDate = 'Joining date is required.';
    }
    if (key === 'assign' && isDoctor) {
      if (f.departmentIds.length === 0) e.departmentIds = 'Select at least one Clinical Department.';
      if (f.serviceIds.length === 0) e.serviceIds = 'Select at least one Assigned Service.';
    }
    if (key === 'discharge' && isDoctor) {
      // Discharge credential: required for a new doctor (or one who never had it);
      // on Edit a blank password keeps the current one unless the username changes.
      const user = f.clinicalUsername.trim();
      const hasExisting = !!f.clinicalExistingUsername;
      const needsPassword = !hasExisting || user !== f.clinicalExistingUsername || !!f.clinicalPassword;
      if (!user) e.clinicalUsername = 'Discharge username is required.';
      else if (user.length < 3 || !/^[a-zA-Z0-9._-]+$/.test(user)) e.clinicalUsername = 'Min 3 characters: letters, numbers, dot, hyphen, underscore.';
      if (needsPassword) {
        if (f.clinicalPassword.length < 8) e.clinicalPassword = 'Password must be at least 8 characters.';
        if (f.clinicalPasswordConfirm !== f.clinicalPassword) e.clinicalPasswordConfirm = 'Passwords do not match.';
      }
    }
    if (key === 'shift') {
      if (!f.weeklySchedule.some((d) => d.isWorking)) e.schedule = 'At least one working day is required.';
      f.weeklySchedule.forEach((d) => {
        if (!d.isWorking) return;
        const custom = !d.useShiftDefault || !selectedShift;
        if (custom && (!d.startTime || !d.endTime)) e[`day_${d.dayOfWeek}`] = 'Start and end time required';
      });
    }
    if (key === 'salary') {
      if (f.baseSalary === '' || Number(f.baseSalary) <= 0) e.baseSalary = isDailyBasis(f.salaryBasis) ? 'Daily rate is required.' : 'Monthly salary is required.';
      if (f.salaryTaxMethod && f.salaryTaxValue === '') e.salaryTaxValue = 'Enter the tax value.';
      if (f.salaryTaxMethod === 'PERCENTAGE' && Number(f.salaryTaxValue) > 100) e.salaryTaxValue = 'Tax % cannot exceed 100.';
      if (!f.salaryEffectiveFrom) e.salaryEffectiveFrom = 'Effective date is required.';
    }
    if (key === 'commission' && hasCommission) {
      const enabled = f.commissionRules.filter((r) => r.enabled);
      if (enabled.length === 0) e.commission = 'Enable commission on at least one service.';
      f.commissionRules.forEach((r) => {
        if (!r.enabled) return;
        const k = `rule_${r.serviceRateId ?? 'DEFAULT'}`;
        if (r.rate === '' || Number(r.rate) <= 0) e[k] = 'Enter a value';
        else if (r.ruleType === 'PERCENTAGE' && Number(r.rate) > 100) e[k] = 'Max 100%';
      });
      if (f.commissionTaxMethod && f.commissionTaxValue === '') e.commissionTaxValue = 'Enter the commission tax value.';
    }
    if (key === 'bank') {
      const b = f.bank;
      if (b.paymentMethod === 'BANK') {
        if (!b.bankName.trim()) e.bankName = 'Bank name is required.';
        if (!b.accountTitle.trim()) e.accountTitle = 'Account title is required.';
        if (!b.accountNumber.trim()) e.accountNumber = 'Account number is required.';
      }
      if (b.paymentMethod === 'ONLINE' && !b.walletAccount.trim()) e.walletAccount = 'Wallet / account number is required.';
    }
    return e;
  };

  const goTo = (target: StepKey) => {
    // Moving forward validates every step in between; moving back never blocks.
    const targetIdx = steps.indexOf(target);
    for (let i = stepIndex; i < targetIdx; i++) {
      const e = validateStep(steps[i]);
      if (Object.keys(e).length > 0) {
        setErrors(e);
        setStep(steps[i]);
        toast.error(Object.values(e)[0], 'Please complete this step');
        return;
      }
    }
    setErrors({});
    setStep(target);
  };

  const handleSave = async () => {
    for (const s of steps) {
      const e = validateStep(s);
      if (Object.keys(e).length > 0) {
        setErrors(e);
        setStep(s);
        toast.error(Object.values(e)[0], 'Please complete this step');
        return;
      }
    }
    const now = sectionSnapshot(formData);
    const changes: StaffWizardChanges = {
      schedule: !isEdit || now.schedule !== initialSnapshot.schedule,
      salary: !isEdit || now.salary !== initialSnapshot.salary,
      commission: !isEdit || now.commission !== initialSnapshot.commission,
      bank: !isEdit || now.bank !== initialSnapshot.bank,
    };
    setIsSaving(true);
    try {
      await onSave(formData, changes);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleId = (key: 'departmentIds' | 'serviceIds', id: string) =>
    set({ [key]: formData[key].includes(id) ? formData[key].filter((x) => x !== id) : [...formData[key], id] } as Partial<StaffUserFormValues>);

  const updateDay = (day: WeeklyDayForm['dayOfWeek'], patch: Partial<WeeklyDayForm>) =>
    set({ weeklySchedule: formData.weeklySchedule.map((d) => (d.dayOfWeek === day ? { ...d, ...patch } : d)) });

  const updateRule = (serviceRateId: string | null, patch: Partial<CommissionRuleForm>) =>
    set({ commissionRules: formData.commissionRules.map((r) => (r.serviceRateId === serviceRateId ? { ...r, ...patch } : r)) });

  const serviceName = (id: string | null) => (id ? activeServices.find((s) => s.id === id)?.name ?? services.find((s) => s.id === id)?.name ?? 'Service' : 'All other assigned services');
  const serviceRate = (id: string | null) => (id ? activeServices.find((s) => s.id === id)?.standardRate ?? 0 : 0);

  // ── salary example (full attendance) ───────────────────────────────────
  const salaryExample = (() => {
    const amount = formData.baseSalary === '' ? 0 : Number(formData.baseSalary);
    const workingPerWeek = formData.weeklySchedule.filter((d) => d.isWorking).length || 6;
    const days = isDailyBasis(formData.salaryBasis) ? Math.round((workingPerWeek * 52) / 12) : 0;
    const earned = isDailyBasis(formData.salaryBasis) ? amount * days : amount;
    const allowance = formData.salaryAllowance === '' ? 0 : Number(formData.salaryAllowance);
    const deduction = formData.salaryDeduction === '' ? 0 : Number(formData.salaryDeduction);
    const gross = earned + allowance;
    const taxVal = formData.salaryTaxValue === '' ? 0 : Number(formData.salaryTaxValue);
    const tax = formData.salaryTaxMethod === 'PERCENTAGE' ? (gross * taxVal) / 100 : formData.salaryTaxMethod === 'FIXED' ? taxVal : 0;
    return { days, earned, allowance, deduction, gross, tax, net: Math.max(0, gross - tax - deduction) };
  })();

  const salaryTypeLabel = SALARY_BASIS_OPTIONS.find((o) => o.value === formData.salaryBasis)?.label ?? formData.salaryBasis;
  const methodLabel = (m: PaymentMethod) => PAYMENT_METHOD_OPTIONS.find((o) => o.value === m)?.label ?? m;

  // ── step bodies ────────────────────────────────────────────────────────
  const renderBasic = () => (
    <div className="space-y-5">
      <div>
        <SectionTitle title="Personal Information" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Full Name" required error={errors.fullName}>
            <input className={inputCls(errors.fullName)} value={formData.fullName} placeholder="e.g. Dr. Ahmed Raza" onChange={(e) => set({ fullName: e.target.value })} />
          </Field>
          <Field label="Father / Guardian Name" required error={errors.fatherGuardianName}>
            <input className={inputCls(errors.fatherGuardianName)} value={formData.fatherGuardianName} onChange={(e) => set({ fatherGuardianName: e.target.value })} />
          </Field>
          <Field label="CNIC" required error={errors.cnic}>
            <input className={`${inputCls(errors.cnic)} tabular-nums`} maxLength={15} placeholder="35201-1234567-1" value={formData.cnic} onChange={(e) => set({ cnic: formatCnicInput(e.target.value) })} />
          </Field>
          <Field label="Date of Birth" required error={errors.dateOfBirth}>
            <input type="date" lang="en-GB" className={inputCls(errors.dateOfBirth)} value={formData.dateOfBirth} onChange={(e) => set({ dateOfBirth: e.target.value })} />
          </Field>
          <Field label="Mobile Number" required error={errors.phone}>
            <input className={inputCls(errors.phone)} placeholder="0300-1234567" value={formData.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <Field label="Alternate Mobile">
            <input className={inputCls()} value={formData.alternatePhone} onChange={(e) => set({ alternatePhone: e.target.value })} />
          </Field>
          <Field label="Email" error={errors.email} className="lg:col-span-2">
            <input type="email" className={inputCls(errors.email)} value={formData.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Employee Code" hint="Auto-generated">
            <input readOnly className={`${inputCls()} bg-slate-100 font-bold text-[#08775A]`} value={formData.employeeCode} />
          </Field>
        </div>
      </div>
      <div>
        <SectionTitle title="Employment" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Staff Category" required>
            <select className={inputCls()} value={formData.staffCategory} onChange={(e) => set({ staffCategory: e.target.value as StaffCategory })}>
              {STAFF_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Designation">
            <input className={inputCls()} placeholder="e.g. Consultant" value={formData.designation} onChange={(e) => set({ designation: e.target.value })} />
          </Field>
          <Field label="Joining Date" required error={errors.joiningDate}>
            <input type="date" lang="en-GB" className={inputCls(errors.joiningDate)} value={formData.joiningDate} onChange={(e) => set({ joiningDate: e.target.value })} />
          </Field>
          <Field label="Status" required>
            <select className={inputCls()} value={formData.status} onChange={(e) => set({ status: e.target.value as StaffStatus })}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </Field>
        </div>
        <p className="text-[11px] text-slate-500 mt-3">
          Portal login is <span className="font-semibold">not</span> created here — grant it later from the Portal Access action on the staff list.
        </p>
      </div>
    </div>
  );

  const renderAssign = () => (
    <div className="space-y-5">
      <div>
        <SectionTitle title="Clinical Departments" note="A doctor can belong to several departments" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {activeDepartments.map((d) => {
            const on = formData.departmentIds.includes(d.id);
            return (
              <label key={d.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm ${on ? 'bg-[#effaf5] border-[#08775A] text-[#08775A] font-semibold' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                <input type="checkbox" checked={on} onChange={() => toggleId('departmentIds', d.id)} className="rounded text-[#08775A] focus:ring-[#08775A]" />
                <span className="truncate">{d.name}</span>
              </label>
            );
          })}
        </div>
        {errors.departmentIds && <p className="text-[11px] text-rose-600 mt-1.5">{errors.departmentIds}</p>}
      </div>
      <div>
        <SectionTitle title="Assigned Services" note="Services this doctor performs — commission is set per service later" />
        <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className={`${TH} w-10`} />
                <th className={TH}>Service</th>
                <th className={TH}>Code</th>
                <th className={TH}>Type</th>
                <th className={`${TH} text-right`}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {activeServices.map((s) => {
                const on = formData.serviceIds.includes(s.id);
                return (
                  <tr key={s.id} onClick={() => toggleId('serviceIds', s.id)} className={`border-t border-slate-100 cursor-pointer ${on ? 'bg-[#effaf5]' : 'hover:bg-slate-50'}`}>
                    <td className={`${TD} text-center`}>
                      <input type="checkbox" readOnly checked={on} className="rounded text-[#08775A] focus:ring-[#08775A]" />
                    </td>
                    <td className={`${TD} font-semibold text-slate-900`}>{s.name}</td>
                    <td className={`${TD} text-slate-500`}>{s.code}</td>
                    <td className={`${TD} text-slate-500`}>{s.encounterType && s.encounterType !== 'NONE' ? s.encounterType : '—'}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatPKR(Number(s.standardRate))}</td>
                  </tr>
                );
              })}
              {activeServices.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">No active services configured.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {errors.serviceIds && <p className="text-[11px] text-rose-600 mt-1.5">{errors.serviceIds}</p>}
      </div>
    </div>
  );

  const renderDischarge = () => (
    <div className="space-y-5">
      <div className="rounded-lg border border-[#c2e7db] bg-[#effaf5] px-4 py-3 text-xs text-slate-700 space-y-1">
        <p className="font-bold text-[#08775A]">How the doctor discharges a patient</p>
        <p>1. In the Admission portal, the staff opens <span className="font-semibold">Discharge</span> for the patient.</p>
        <p>2. This doctor enters the username and password set here → the system shows the doctor's name and department.</p>
        <p>3. The doctor writes the Discharge Summary, which is saved under this doctor's name. The Admission user cannot discharge on their own.</p>
      </div>
      <div>
        <SectionTitle
          title="Discharge Credentials"
          note="The doctor enters these in the Admission portal to discharge a patient — separate from any portal login"
        />
        {formData.clinicalExistingUsername && (
          <p className="text-[11px] text-slate-500 mb-2">
            Current discharge username: <span className="font-semibold text-slate-800">{formData.clinicalExistingUsername}</span>. Leave the password blank to keep the current one.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Discharge Username" required error={errors.clinicalUsername}>
            <input
              className={inputCls(errors.clinicalUsername)}
              autoComplete="off"
              placeholder="e.g. dr.ahmed"
              value={formData.clinicalUsername}
              onChange={(e) => set({ clinicalUsername: e.target.value.trim() })}
            />
          </Field>
          <Field label="Password" required={!formData.clinicalExistingUsername} error={errors.clinicalPassword} hint="Min 8 characters">
            <input
              type="password"
              autoComplete="new-password"
              className={inputCls(errors.clinicalPassword)}
              value={formData.clinicalPassword}
              onChange={(e) => set({ clinicalPassword: e.target.value })}
            />
          </Field>
          <Field label="Confirm Password" required={!formData.clinicalExistingUsername} error={errors.clinicalPasswordConfirm}>
            <input
              type="password"
              autoComplete="new-password"
              className={inputCls(errors.clinicalPasswordConfirm)}
              value={formData.clinicalPasswordConfirm}
              onChange={(e) => set({ clinicalPasswordConfirm: e.target.value })}
            />
          </Field>
        </div>
      </div>
    </div>
  );

  const renderShift = () => (
    <div className="space-y-5">
      <div>
        <SectionTitle title="Shift Assignment" note="From Shift Management" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Assigned Shift" hint={activeShifts.length === 0 ? 'No shifts configured yet — enter custom timings below.' : undefined}>
            <select
              className={inputCls()}
              value={formData.assignedShiftId}
              onChange={(e) => {
                const shift = activeShifts.find((s) => s.id === e.target.value);
                // Adopt the shift's weekly OFF days so the timing table starts from the shift default.
                set({
                  assignedShiftId: e.target.value,
                  weeklySchedule: shift
                    ? defaultWeeklySchedule().map((d) => ({ ...d, isWorking: !shift.defaultWeeklyOffDays.includes(d.dayOfWeek) }))
                    : formData.weeklySchedule.map((d) => ({ ...d, useShiftDefault: false })),
                });
              }}
            >
              <option value="">No shift — custom timings</option>
              {activeShifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.startTime}–{s.endTime})
                </option>
              ))}
            </select>
          </Field>
          {selectedShift && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 self-end">
              <span className="font-semibold text-slate-800">{selectedShift.name}</span> · {selectedShift.startTime}–{selectedShift.endTime} · break {selectedShift.breakMinutes} min ·
              OFF: {selectedShift.defaultWeeklyOffDays.length ? selectedShift.defaultWeeklyOffDays.join(', ') : 'none'}
            </div>
          )}
        </div>
      </div>
      <div>
        <SectionTitle title="Weekly Timing" note="OFF days are not counted as payable days in payroll" />
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Day</th>
                <th className={TH}>Working</th>
                <th className={TH}>Timing</th>
                <th className={TH}>Start</th>
                <th className={TH}>End</th>
                <th className={TH}>Break (min)</th>
              </tr>
            </thead>
            <tbody>
              {formData.weeklySchedule.map((d) => {
                const custom = !d.useShiftDefault || !selectedShift;
                const err = errors[`day_${d.dayOfWeek}`];
                return (
                  <tr key={d.dayOfWeek} className={`border-t border-slate-100 ${d.isWorking ? '' : 'bg-slate-50 text-slate-400'}`}>
                    <td className={`${TD} font-semibold ${d.isWorking ? 'text-slate-900' : ''}`}>{d.dayOfWeek}</td>
                    <td className={TD}>
                      <button
                        type="button"
                        onClick={() => updateDay(d.dayOfWeek, { isWorking: !d.isWorking })}
                        className={`px-2.5 py-1 rounded-md text-xs font-bold border ${d.isWorking ? 'bg-[#e7f6f1] text-[#08775A] border-[#c2e7db]' : 'bg-white text-slate-500 border-slate-300'}`}
                      >
                        {d.isWorking ? 'Working' : 'OFF'}
                      </button>
                    </td>
                    <td className={TD}>
                      {d.isWorking && (
                        <select
                          className="h-8 px-2 border border-slate-300 rounded-md text-xs bg-white disabled:bg-slate-100"
                          disabled={!selectedShift}
                          value={custom ? 'custom' : 'shift'}
                          onChange={(e) => updateDay(d.dayOfWeek, { useShiftDefault: e.target.value === 'shift' })}
                        >
                          <option value="shift">Shift default</option>
                          <option value="custom">Custom</option>
                        </select>
                      )}
                    </td>
                    <td className={TD}>
                      {d.isWorking &&
                        (custom ? (
                          <input type="time" className={`h-8 px-2 border rounded-md text-xs ${err && !d.startTime ? 'border-rose-400' : 'border-slate-300'}`} value={d.startTime} onChange={(e) => updateDay(d.dayOfWeek, { startTime: e.target.value })} />
                        ) : (
                          <span className="text-slate-500 tabular-nums">{selectedShift?.startTime}</span>
                        ))}
                    </td>
                    <td className={TD}>
                      {d.isWorking &&
                        (custom ? (
                          <input type="time" className={`h-8 px-2 border rounded-md text-xs ${err && !d.endTime ? 'border-rose-400' : 'border-slate-300'}`} value={d.endTime} onChange={(e) => updateDay(d.dayOfWeek, { endTime: e.target.value })} />
                        ) : (
                          <span className="text-slate-500 tabular-nums">{selectedShift?.endTime}</span>
                        ))}
                    </td>
                    <td className={TD}>
                      {d.isWorking && (
                        <input
                          type="number"
                          min={0}
                          onWheel={(e) => e.currentTarget.blur()}
                          className="h-8 w-20 px-2 border border-slate-300 rounded-md text-xs tabular-nums"
                          value={d.breakMinutes}
                          onChange={(e) => updateDay(d.dayOfWeek, { breakMinutes: e.target.value === '' ? '' : Number(e.target.value) })}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(errors.schedule || Object.keys(errors).some((k) => k.startsWith('day_'))) && (
          <p className="text-[11px] text-rose-600 mt-1.5">{errors.schedule || 'Enter start and end time for every custom working day.'}</p>
        )}
      </div>
    </div>
  );

  const renderSalary = () => (
    <div className="space-y-5">
      <div>
        <SectionTitle title="Salary Type" note="Salary is always earned from attendance" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {SALARY_BASIS_OPTIONS.map((o) => {
            const on = formData.salaryBasis === o.value;
            const locked = isCommissionBasis(o.value) && !isDoctor;
            return (
              <button
                key={o.value}
                type="button"
                disabled={locked}
                onClick={() => set({ salaryBasis: o.value })}
                className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  on ? 'bg-[#effaf5] border-[#08775A] ring-1 ring-[#08775A]' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className={`block font-bold ${on ? 'text-[#08775A]' : 'text-slate-800'}`}>{o.label}</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  {isDailyBasis(o.value) ? 'Daily rate × days present' : 'Monthly base, attendance-prorated'}
                  {isCommissionBasis(o.value) ? ' + service commission (separate)' : ''}
                </span>
              </button>
            );
          })}
        </div>
        {!isDoctor && <p className="text-[11px] text-slate-500 mt-2">Commission types need assigned services, so they are available for Doctors only.</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
          <Field label={isDailyBasis(formData.salaryBasis) ? 'Daily Rate (PKR)' : 'Monthly Salary (PKR)'} required error={errors.baseSalary}>
            <NumberInput value={formData.baseSalary} step={500} error={errors.baseSalary} onChange={(v) => set({ baseSalary: v })} />
          </Field>
          <Field label="Effective From" required error={errors.salaryEffectiveFrom}>
            <input type="date" lang="en-GB" className={inputCls(errors.salaryEffectiveFrom)} value={formData.salaryEffectiveFrom} onChange={(e) => set({ salaryEffectiveFrom: e.target.value })} />
          </Field>
          <Field label="Salary Tax">
            <select className={inputCls()} value={formData.salaryTaxMethod} onChange={(e) => set({ salaryTaxMethod: e.target.value as 'PERCENTAGE' | 'FIXED' | '', salaryTaxValue: e.target.value ? formData.salaryTaxValue : '' })}>
              <option value="">No Tax</option>
              <option value="PERCENTAGE">Percentage of Gross</option>
              <option value="FIXED">Fixed Amount</option>
            </select>
          </Field>
          <Field label={`Tax Value ${formData.salaryTaxMethod === 'PERCENTAGE' ? '(%)' : '(PKR)'}`} error={errors.salaryTaxValue}>
            <NumberInput value={formData.salaryTaxValue} disabled={!formData.salaryTaxMethod} error={errors.salaryTaxValue} onChange={(v) => set({ salaryTaxValue: v })} />
          </Field>
          <Field label={`Fixed Allowance (PKR${isDailyBasis(formData.salaryBasis) ? ' / run' : ' / month'})`}>
            <NumberInput value={formData.salaryAllowance} placeholder="0" onChange={(v) => set({ salaryAllowance: v })} />
          </Field>
          <Field label={`Fixed Deduction (PKR${isDailyBasis(formData.salaryBasis) ? ' / run' : ' / month'})`}>
            <NumberInput value={formData.salaryDeduction} placeholder="0" onChange={(v) => set({ salaryDeduction: v })} />
          </Field>
        </div>

        <div className="lg:col-span-2 border border-slate-200 rounded-lg overflow-hidden self-start">
          <div className="bg-gradient-to-r from-[#0a4636] to-[#08775A] text-white px-3 py-2 text-xs font-bold">
            Example — {isDailyBasis(formData.salaryBasis) ? `${salaryExample.days} days present` : 'full month, full attendance'}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {[
                [isDailyBasis(formData.salaryBasis) ? 'Earned (rate × days)' : 'Earned Base', salaryExample.earned, ''],
                ['+ Allowance', salaryExample.allowance, ''],
                ['Gross', salaryExample.gross, 'font-bold'],
                ['− Tax', salaryExample.tax, 'text-amber-700'],
                ['− Deduction', salaryExample.deduction, 'text-rose-700'],
              ].map(([label, value, cls]) => (
                <tr key={label as string} className="border-b border-slate-100">
                  <td className="py-1.5 px-3 text-slate-600">{label}</td>
                  <td className={`py-1.5 px-3 text-right tabular-nums ${cls}`}>{formatPKR(value as number)}</td>
                </tr>
              ))}
              <tr className="bg-[#effaf5]">
                <td className="py-2 px-3 font-bold text-slate-900">Net Salary</td>
                <td className="py-2 px-3 text-right tabular-nums font-bold text-[#08775A]">{formatPKR(salaryExample.net)}</td>
              </tr>
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-slate-500 bg-slate-50">
            Absent days reduce the earned base in payroll.{hasCommission ? ' Commission is paid separately, not in this figure.' : ''}
          </p>
        </div>
      </div>
    </div>
  );

  const renderCommission = () => (
    <div className="space-y-5">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
        <span className="font-bold">{salaryTypeLabel}:</span> commission is earned only from completed services this doctor performs, and is calculated, approved and paid
        separately from salary.
      </div>
      <div>
        <SectionTitle title="Service-wise Commission" note="Percentage of the service amount, or a fixed amount per service" />
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={`${TH} w-10`} />
                <th className={TH}>Service</th>
                <th className={TH}>Commission Type</th>
                <th className={TH}>Value</th>
                <th className={TH}>Calculated On</th>
                <th className={`${TH} text-right`}>Per Service</th>
              </tr>
            </thead>
            <tbody>
              {formData.commissionRules.map((r) => {
                const key = r.serviceRateId ?? 'DEFAULT';
                const err = errors[`rule_${key}`];
                const std = serviceRate(r.serviceRateId);
                const each = r.rate === '' ? 0 : r.ruleType === 'PERCENTAGE' ? (std * Number(r.rate)) / 100 : Number(r.rate);
                return (
                  <tr key={key} className={`border-t border-slate-100 ${r.enabled ? '' : 'bg-slate-50 text-slate-400'}`}>
                    <td className={`${TD} text-center`}>
                      <input type="checkbox" checked={r.enabled} onChange={() => updateRule(r.serviceRateId, { enabled: !r.enabled })} className="rounded text-[#08775A] focus:ring-[#08775A]" />
                    </td>
                    <td className={TD}>
                      <span className={`font-semibold ${r.enabled ? 'text-slate-900' : ''} ${r.serviceRateId ? '' : 'italic'}`}>{serviceName(r.serviceRateId)}</span>
                      {r.serviceRateId && <span className="block text-[11px] text-slate-400">Rate {formatPKR(std)}</span>}
                    </td>
                    <td className={TD}>
                      <select
                        disabled={!r.enabled}
                        className="h-8 px-2 border border-slate-300 rounded-md text-xs bg-white disabled:bg-slate-100"
                        value={r.ruleType}
                        onChange={(e) => updateRule(r.serviceRateId, { ruleType: e.target.value as CommissionRuleForm['ruleType'] })}
                      >
                        <option value="PERCENTAGE">Percentage (%)</option>
                        <option value="FIXED_PER_SERVICE">Fixed per service (PKR)</option>
                      </select>
                    </td>
                    <td className={TD}>
                      <input
                        type="number"
                        min={0}
                        disabled={!r.enabled}
                        onWheel={(e) => e.currentTarget.blur()}
                        className={`h-8 w-24 px-2 border rounded-md text-xs tabular-nums disabled:bg-slate-100 ${err ? 'border-rose-400' : 'border-slate-300'}`}
                        value={r.rate}
                        onChange={(e) => updateRule(r.serviceRateId, { rate: e.target.value === '' ? '' : Number(e.target.value) })}
                      />
                      {err && <span className="block text-[10px] text-rose-600">{err}</span>}
                    </td>
                    <td className={TD}>
                      {r.ruleType === 'PERCENTAGE' ? (
                        <select
                          disabled={!r.enabled}
                          className="h-8 px-2 border border-slate-300 rounded-md text-xs bg-white disabled:bg-slate-100"
                          value={r.basis}
                          onChange={(e) => updateRule(r.serviceRateId, { basis: e.target.value as 'NET' | 'GROSS' })}
                        >
                          <option value="NET">Net (after discount)</option>
                          <option value="GROSS">Gross</option>
                        </select>
                      ) : (
                        <span className="text-xs text-slate-500">Completed quantity</span>
                      )}
                    </td>
                    <td className={`${TD} text-right tabular-nums font-semibold`}>{r.enabled && r.serviceRateId ? formatPKR(each) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {errors.commission && <p className="text-[11px] text-rose-600 mt-1.5">{errors.commission}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Commission Tax" hint="Separate from salary tax">
          <select className={inputCls()} value={formData.commissionTaxMethod} onChange={(e) => set({ commissionTaxMethod: e.target.value as 'PERCENTAGE' | 'FIXED' | '', commissionTaxValue: e.target.value ? formData.commissionTaxValue : '' })}>
            <option value="">No Tax</option>
            <option value="PERCENTAGE">Percentage</option>
            <option value="FIXED">Fixed Amount</option>
          </select>
        </Field>
        <Field label={`Tax Value ${formData.commissionTaxMethod === 'PERCENTAGE' ? '(%)' : '(PKR)'}`} error={errors.commissionTaxValue}>
          <NumberInput value={formData.commissionTaxValue} disabled={!formData.commissionTaxMethod} error={errors.commissionTaxValue} onChange={(v) => set({ commissionTaxValue: v })} />
        </Field>
        <Field label="Effective From" required>
          <input type="date" lang="en-GB" className={inputCls()} value={formData.commissionEffectiveFrom} onChange={(e) => set({ commissionEffectiveFrom: e.target.value })} />
        </Field>
      </div>
    </div>
  );

  const renderBank = () => {
    const b = formData.bank;
    const setBank = (patch: Partial<typeof b>) => set({ bank: { ...b, ...patch } });
    return (
      <div className="space-y-5">
        <div>
          <SectionTitle title="Payment Method" note={hasCommission ? 'Used for salary and commission payments' : 'Used for salary payments'} />
          <div className="grid grid-cols-3 gap-2 max-w-xl">
            {PAYMENT_METHOD_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setBank({ paymentMethod: o.value })}
                className={`px-3 py-2.5 rounded-lg border text-sm font-bold ${b.paymentMethod === o.value ? 'bg-[#effaf5] border-[#08775A] text-[#08775A] ring-1 ring-[#08775A]' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {b.paymentMethod === 'BANK' && (
          <div>
            <SectionTitle title="Bank Account" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Bank Name" required error={errors.bankName}>
                <input className={inputCls(errors.bankName)} value={b.bankName} placeholder="e.g. Meezan Bank" onChange={(e) => setBank({ bankName: e.target.value })} />
              </Field>
              <Field label="Branch">
                <input className={inputCls()} value={b.branchName} onChange={(e) => setBank({ branchName: e.target.value })} />
              </Field>
              <Field label="Account Title" required error={errors.accountTitle}>
                <input className={inputCls(errors.accountTitle)} value={b.accountTitle} onChange={(e) => setBank({ accountTitle: e.target.value })} />
              </Field>
              <Field label="Account Number" required error={errors.accountNumber}>
                <input className={`${inputCls(errors.accountNumber)} tabular-nums`} value={b.accountNumber} onChange={(e) => setBank({ accountNumber: e.target.value })} />
              </Field>
              <Field label="IBAN" className="lg:col-span-2">
                <input className={`${inputCls()} uppercase tabular-nums`} maxLength={34} value={b.iban} placeholder="PK36SCBL0000001123456702" onChange={(e) => setBank({ iban: e.target.value.toUpperCase() })} />
              </Field>
            </div>
          </div>
        )}
        {b.paymentMethod === 'ONLINE' && (
          <div className="max-w-sm">
            <Field label="Wallet / Online Account" required error={errors.walletAccount} hint="e.g. JazzCash / Easypaisa number">
              <input className={inputCls(errors.walletAccount)} value={b.walletAccount} onChange={(e) => setBank({ walletAccount: e.target.value })} />
            </Field>
          </div>
        )}
        <div className="flex flex-wrap gap-5 text-sm text-slate-700">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={b.preferredForSalary} onChange={(e) => setBank({ preferredForSalary: e.target.checked })} className="rounded text-[#08775A] focus:ring-[#08775A]" />
            Preferred salary account
          </label>
          {hasCommission && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={b.preferredForCommission} onChange={(e) => setBank({ preferredForCommission: e.target.checked })} className="rounded text-[#08775A] focus:ring-[#08775A]" />
              Preferred commission account
            </label>
          )}
        </div>
      </div>
    );
  };

  const ReviewTable: React.FC<{ title: string; target: StepKey; rows: [string, React.ReactNode][] }> = ({ title, target, rows }) => (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-700">{title}</span>
        <button type="button" onClick={() => setStep(target)} className="text-xs font-semibold text-[#08775A] hover:underline">
          Edit
        </button>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-slate-100 last:border-b-0">
              <td className="py-1.5 px-3 text-slate-500 w-2/5">{k}</td>
              <td className="py-1.5 px-3 font-semibold text-slate-900">{v || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderReview = () => {
    const working = formData.weeklySchedule.filter((d) => d.isWorking);
    const off = formData.weeklySchedule.filter((d) => !d.isWorking).map((d) => d.dayOfWeek.slice(0, 3));
    const bank = formData.bank;
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReviewTable
          title="Basic Info"
          target="basic"
          rows={[
            ['Name', formData.fullName],
            ['Father / Guardian', formData.fatherGuardianName],
            ['CNIC', formData.cnic],
            ['Mobile', formData.phone],
            ['Category / Designation', [formData.staffCategory, formData.designation].filter(Boolean).join(' · ')],
            ['Joining Date', formData.joiningDate],
          ]}
        />
        <ReviewTable
          title="Shift & Timing"
          target="shift"
          rows={[
            ['Shift', selectedShift ? `${selectedShift.name} (${selectedShift.startTime}–${selectedShift.endTime})` : 'Custom timings'],
            ['Working Days', `${working.length} days / week`],
            ['Weekly OFF', off.join(', ') || 'None'],
            [
              'Custom Timings',
              working
                .filter((d) => !d.useShiftDefault || !selectedShift)
                .map((d) => `${d.dayOfWeek.slice(0, 3)} ${d.startTime}–${d.endTime}`)
                .join(', ') || 'None',
            ],
          ]}
        />
        <ReviewTable
          title="Salary"
          target="salary"
          rows={[
            ['Salary Type', salaryTypeLabel],
            [isDailyBasis(formData.salaryBasis) ? 'Daily Rate' : 'Monthly Salary', formData.baseSalary === '' ? '' : formatPKR(Number(formData.baseSalary))],
            ['Tax', formData.salaryTaxMethod ? `${formData.salaryTaxValue}${formData.salaryTaxMethod === 'PERCENTAGE' ? '% of gross' : ' PKR'}` : 'No tax'],
            ['Allowance / Deduction', `${formatPKR(Number(formData.salaryAllowance || 0))} / ${formatPKR(Number(formData.salaryDeduction || 0))}`],
            ['Effective From', formData.salaryEffectiveFrom],
          ]}
        />
        {hasCommission ? (
          <ReviewTable
            title="Commission"
            target="commission"
            rows={[
              ...formData.commissionRules
                .filter((r) => r.enabled)
                .map((r): [string, React.ReactNode] => [
                  serviceName(r.serviceRateId),
                  r.ruleType === 'PERCENTAGE' ? `${r.rate}% of ${r.basis === 'NET' ? 'net' : 'gross'}` : `${formatPKR(Number(r.rate || 0))} per service`,
                ]),
              ['Commission Tax', formData.commissionTaxMethod ? `${formData.commissionTaxValue}${formData.commissionTaxMethod === 'PERCENTAGE' ? '%' : ' PKR'}` : 'No tax'],
            ]}
          />
        ) : (
          <ReviewTable
            title="Bank / Account"
            target="bank"
            rows={[
              ['Payment Method', methodLabel(bank.paymentMethod)],
              ...(bank.paymentMethod === 'BANK'
                ? ([
                    ['Bank', [bank.bankName, bank.branchName].filter(Boolean).join(' · ')],
                    ['Account', `${bank.accountTitle} — ${bank.accountNumber}`],
                  ] as [string, React.ReactNode][])
                : bank.paymentMethod === 'ONLINE'
                  ? ([['Wallet', bank.walletAccount]] as [string, React.ReactNode][])
                  : []),
            ]}
          />
        )}
        {hasCommission && (
          <ReviewTable
            title="Bank / Account"
            target="bank"
            rows={[
              ['Payment Method', methodLabel(bank.paymentMethod)],
              ...(bank.paymentMethod === 'BANK'
                ? ([
                    ['Bank', [bank.bankName, bank.branchName].filter(Boolean).join(' · ')],
                    ['Account', `${bank.accountTitle} — ${bank.accountNumber}`],
                  ] as [string, React.ReactNode][])
                : bank.paymentMethod === 'ONLINE'
                  ? ([['Wallet', bank.walletAccount]] as [string, React.ReactNode][])
                  : []),
            ]}
          />
        )}
        {isDoctor && (
          <ReviewTable
            title="Departments & Services"
            target="assign"
            rows={[
              ['Departments', formData.departmentIds.map((id) => activeDepartments.find((d) => d.id === id)?.name).filter(Boolean).join(', ')],
              ['Services', formData.serviceIds.map((id) => serviceName(id)).join(', ')],
            ]}
          />
        )}
        {isDoctor && (
          <ReviewTable
            title="Discharge Credentials"
            target="discharge"
            rows={[
              ['Discharge Username', formData.clinicalUsername],
              [
                'Password',
                formData.clinicalPassword ? (formData.clinicalExistingUsername ? 'Will be reset' : 'Set (hidden)') : 'Unchanged',
              ],
            ]}
          />
        )}
      </div>
    );
  };

  const body: Record<StepKey, () => React.ReactNode> = {
    basic: renderBasic,
    assign: renderAssign,
    discharge: renderDischarge,
    shift: renderShift,
    salary: renderSalary,
    commission: renderCommission,
    bank: renderBank,
    review: renderReview,
  };

  const isLast = stepIndex === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs font-montserrat">
      <div className="bg-white rounded-xl w-full max-w-5xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0a4636] to-[#08775A] text-white px-5 py-3 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base">{isEdit ? `Edit Staff — ${editingStaff?.fullName}` : 'Add New Staff'}</h3>
            <p className="text-xs text-emerald-100">
              Step {stepIndex + 1} of {steps.length} · {STEP_META[step].label}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/15 cursor-pointer" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 overflow-x-auto">
          <ol className="flex items-center gap-1 min-w-max">
            {steps.map((key, i) => {
              const Icon = STEP_META[key].icon;
              const done = i < stepIndex;
              const active = key === step;
              return (
                <li key={key} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => goTo(key)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                      active ? 'bg-[#08775A] text-white' : done ? 'text-[#08775A] hover:bg-[#e7f6f1]' : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] ${active ? 'bg-white/20' : done ? 'bg-[#e7f6f1]' : 'bg-slate-200'}`}>
                      {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                    </span>
                    {STEP_META[key].label}
                  </button>
                  {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-slate-300 mx-0.5" />}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {isLoadingProfile ? (
            <div className="flex items-center justify-center py-16 gap-2 text-slate-400 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading staff profile…
            </div>
          ) : (
            body[step]()
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            {Object.keys(errors).length > 0 && (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                <span className="text-rose-600">Fix the highlighted fields to continue.</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer">
              Cancel
            </button>
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => {
                  setErrors({});
                  setStep(steps[stepIndex - 1]);
                }}
                className="inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
            {isLast ? (
              <button
                type="button"
                disabled={isSaving || isLoadingProfile}
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs cursor-pointer disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {isEdit ? 'Save Changes' : 'Create Staff'}
              </button>
            ) : (
              <button
                type="button"
                disabled={isLoadingProfile}
                onClick={() => goTo(steps[stepIndex + 1])}
                className="inline-flex items-center gap-1 px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs cursor-pointer disabled:opacity-60"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
