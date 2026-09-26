import { PortalKey } from './index';

export type StaffAccessType = 'PORTAL_USER' | 'STAFF_RECORD_ONLY';

export type StaffPortalKey = 'front-desk' | 'admission' | 'inventory';

// staff.md §2 — fixed Staff Category list (Final Blueprint). RMO is a
// separate category from Doctor. Kept as a plain string on the backend, but
// the Add Staff form only offers this fixed set — no free text, no hardcoding
// elsewhere in the app.
export type StaffCategory =
  | 'Doctor'
  | 'RMO'
  | 'Front Desk / Billing'
  | 'Admission'
  | 'Inventory Management'
  | 'Nurse'
  | 'Technician'
  | 'Other Staff';

// staff.md §5 — categories that commonly require HMS portal access. This is
// guidance for the "Portal Access Required" badge only; it never
// auto-grants access — that's always a separate, explicit action.
export const PORTAL_ELIGIBLE_CATEGORIES: StaffCategory[] = [
  'RMO',
  'Front Desk / Billing',
  'Admission',
  'Inventory Management',
];

export type StaffRole =
  // Front Desk & Billing
  | 'Front Desk Officer'
  | 'Receptionist'
  | 'Billing Officer'
  | 'Senior Billing Officer / Cashier'
  // Admission
  | 'Admission Officer'
  | 'Admission Coordinator'
  | 'Ward Coordinator'
  // Pharmacy
  | 'Pharmacist'
  | 'Pharmacy Cashier'
  | 'Pharmacy Assistant'
  // Inventory
  | 'Store Manager'
  | 'Inventory Officer'
  | 'Store Keeper';

export type StaffStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

// staff.md §9 — the guide's 4 required Salary Types. "+ Commission" is a
// label only; commission itself is always calculated separately and
// automatically from DoctorCommissionRule, never folded into this figure.
export type SalaryBasis = 'MONTHLY' | 'MONTHLY_COMMISSION' | 'PER_DAY' | 'PER_DAY_COMMISSION';
export const SALARY_BASIS_OPTIONS: { value: SalaryBasis; label: string }[] = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'MONTHLY_COMMISSION', label: 'Monthly + Commission' },
  { value: 'PER_DAY', label: 'Daily' },
  { value: 'PER_DAY_COMMISSION', label: 'Daily + Commission' },
];

export interface StaffUser {
  id: string; // e.g. 'STF-001'
  employeeCode: string; // e.g. 'EMP-FD-01'

  fullName: string;
  fatherGuardianName?: string;

  phone: string;
  alternatePhone?: string;
  email: string;
  cnic?: string; // Pakistan CNIC: xxxxx-xxxxxxx-x
  dateOfBirth?: string; // ISO date

  designation: string; // optional at creation — may be blank until set from Staff 360

  departmentId: string;
  departmentName: string;
  // Multi-department assignment (junction table) — populated for all staff;
  // only meaningful / editable for Doctor-category staff.
  departmentIds: string[];     // all assigned dept IDs including primary
  departmentNames: string[];   // display names in same order

  // Doctor ↔ Service assignment (staff.md §4) — which services this doctor
  // performs; separate from commission eligibility/rate (DoctorCommissionRule).
  assignedServiceIds: string[];
  assignedServiceNames: string[];

  // Real Shift Master assignment (staff.md §8) — optional, any category.
  assignedShiftId?: string | null;
  assignedShiftName?: string | null;

  staffCategory: StaffCategory;

  accessType: StaffAccessType;

  assignedPortal: StaffPortalKey | null;
  staffRole: StaffRole | string | null;

  username: string | null;

  status: StaffStatus;
  requirePasswordChange: boolean;

  lastLoginAt: string | null;

  createdBy: string;
  createdAt: string;

  updatedBy: string;
  updatedAt: string;

  statusChangedBy?: string;
  statusChangedAt?: string;

  passwordResetBy?: string;
  passwordResetAt?: string;

  // v7.2 Doctor Clinical Discharge Authorization (HMS_V7.2_NEW_REQUIREMENTS.md
  // §2.4) — separate from portal login above; only meaningful for doctors,
  // but present on every row (undefined/false when not configured).
  clinicalAuthUsername?: string | null;
  clinicalAuthActive?: boolean;
  clinicalAuthUpdatedAt?: string;
  availableForOpd?: boolean;
  availableForObservation?: boolean;
  availableForEmergency?: boolean;
  doctorSponsoredDiscountTrackingEnabled?: boolean;

  linkedActivityCount: number;
  notes?: string;
  baseSalary?: number;
  commissionEnabled?: boolean;
}

export interface StaffCredential {
  staffUserId: string;
  username: string;
  demoPassword: string; // Isolated credential, never exported in normal directory
  assignedPortal: StaffPortalKey;
  requirePasswordChange: boolean;
  updatedAt: string;
}

/**
 * Add/Edit Staff form values — short form (staff.md §2). Only fullName,
 * fatherGuardianName, cnic, dateOfBirth, phone and staffCategory are
 * mandatory. Shift and Salary are optional wizard steps right here (staff.md
 * §2 Add Wizard steps 5/7) — Portal Access and Doctor Commission stay their
 * own separate workflows (login and per-service rates are a different kind
 * of decision, never bundled into Staff Master).
 */
export interface StaffUserFormValues {
  fullName: string;
  employeeCode: string;
  fatherGuardianName: string;
  cnic: string;
  dateOfBirth: string; // yyyy-mm-dd
  phone: string;
  alternatePhone: string;
  email: string;

  designation: string;
  staffCategory: StaffCategory;
  status: StaffStatus;

  // Doctor-only, mandatory when staffCategory === 'Doctor'
  departmentIds: string[];
  serviceIds: string[];

  // Optional — real Shift Master assignment, any category.
  assignedShiftId: string;

  // Salary Setup (PDF §9/§10). The Add Staff wizard always sends it; bulk
  // import leaves it off (salaryEnabled = false).
  salaryEnabled: boolean;
  salaryBasis: SalaryBasis;
  baseSalary: number | '';
  salaryTaxMethod: 'PERCENTAGE' | 'FIXED' | '';
  salaryTaxValue: number | '';
  salaryEffectiveFrom: string;
  salaryAllowance: number | '';
  salaryDeduction: number | '';

  // Wizard steps added from Staff Portal Access Salary Commission.pdf §2.
  joiningDate: string;
  scheduleEnabled: boolean;
  weeklySchedule: WeeklyDayForm[];
  commissionRules: CommissionRuleForm[];
  commissionTaxMethod: 'PERCENTAGE' | 'FIXED' | '';
  commissionTaxValue: number | '';
  commissionEffectiveFrom: string;
  bankEnabled: boolean;
  bank: BankAccountForm;

  // Doctors only — discharge credential used in the Admission portal's
  // Doctor Discharge Authorization. Password is never read back from the server.
  clinicalUsername: string;
  clinicalPassword: string;
  clinicalPasswordConfirm: string;
  /** Edit mode: username already configured on the server (blank = none yet). */
  clinicalExistingUsername: string;
}

export type PaymentMethod = 'CASH' | 'BANK' | 'ONLINE';
export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK', label: 'Bank Transfer' },
  { value: 'ONLINE', label: 'Online / Wallet' },
];

export const isCommissionBasis = (basis: SalaryBasis) => basis.endsWith('_COMMISSION');
export const isDailyBasis = (basis: SalaryBasis) => basis.startsWith('PER_DAY');

/** PDF §8 — one row per weekday. */
export interface WeeklyDayForm {
  dayOfWeek: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  isWorking: boolean;
  useShiftDefault: boolean;
  startTime: string;
  endTime: string;
  breakMinutes: number | '';
}

/** PDF §7/§14 — one service-wise commission line. `serviceRateId: null` = default for other services. */
export interface CommissionRuleForm {
  serviceRateId: string | null;
  enabled: boolean;
  ruleType: 'PERCENTAGE' | 'FIXED_PER_SERVICE';
  rate: number | '';
  basis: 'NET' | 'GROSS';
}

/** PDF §4 — payment account. */
export interface BankAccountForm {
  paymentMethod: PaymentMethod;
  bankName: string;
  branchName: string;
  accountTitle: string;
  accountNumber: string;
  iban: string;
  walletAccount: string;
  preferredForSalary: boolean;
  preferredForCommission: boolean;
}

const WEEK: WeeklyDayForm['dayOfWeek'][] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Mon–Sat working on the shift's timing, Sunday OFF. */
export const defaultWeeklySchedule = (): WeeklyDayForm[] =>
  WEEK.map((dayOfWeek) => ({
    dayOfWeek,
    isWorking: dayOfWeek !== 'Sunday',
    useShiftDefault: true,
    startTime: '',
    endTime: '',
    breakMinutes: 0,
  }));

export const emptyBankAccount = (): BankAccountForm => ({
  paymentMethod: 'CASH',
  bankName: '',
  branchName: '',
  accountTitle: '',
  accountNumber: '',
  iban: '',
  walletAccount: '',
  preferredForSalary: true,
  preferredForCommission: true,
});

/** Defaults for the wizard-only fields — used by the form and by bulk import (which skips them). */
export const defaultWizardExtras = () => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    salaryAllowance: '' as const,
    salaryDeduction: '' as const,
    joiningDate: today,
    scheduleEnabled: false,
    weeklySchedule: defaultWeeklySchedule(),
    commissionRules: [] as CommissionRuleForm[],
    commissionTaxMethod: '' as const,
    commissionTaxValue: '' as const,
    commissionEffectiveFrom: today,
    bankEnabled: false,
    bank: emptyBankAccount(),
    clinicalUsername: '',
    clinicalPassword: '',
    clinicalPasswordConfirm: '',
    clinicalExistingUsername: '',
  };
};

export interface StaffUserFilterState {
  searchTerm: string;
  departmentId: string; // 'ALL' | string
  staffCategory: string; // 'ALL' | StaffCategory
  accessType: string; // 'ALL' | StaffAccessType
  assignedPortal: string; // 'ALL' | StaffPortalKey
  status: string; // 'ALL' | StaffStatus
  staffRole?: string; // 'ALL' | string
}

export interface StaffAuditLogEntry {
  id: string;
  staffUserId: string;
  staffName: string;
  employeeCode: string;
  action: 'CREATE' | 'UPDATE' | 'STATUS_CHANGE' | 'PASSWORD_RESET' | 'DELETE' | 'IMPORT';
  actorName: string;
  actorRole: string;
  timestamp: string;
  details: string;
}

export interface ImportedStaffRow {
  rowNumber: number;
  employeeCode: string;
  fullName: string;
  fatherGuardianName?: string;
  phone: string;
  alternatePhone?: string;
  email: string;
  cnic?: string;
  dateOfBirth?: string;
  designation: string;
  departmentCode: string;
  departmentName?: string;
  // Doctor-only: comma-separated service codes (staff.md §4 Assigned Services)
  serviceCodes?: string;
  staffCategory: string;
  accessType: string;
  assignedPortal?: string;
  staffRole?: string;
  username?: string;
  status: string;

  isValid: boolean;
  errors: string[];
}

export interface StaffImportValidationResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: ImportedStaffRow[];
}

export const STAFF_PORTAL_ROLES: Record<StaffPortalKey, StaffRole[]> = {
  'front-desk': [
    'Front Desk Officer',
    'Receptionist',
    'Billing Officer',
    'Senior Billing Officer / Cashier',
  ],
  admission: [
    'Admission Officer',
    'Admission Coordinator',
    'Ward Coordinator',
  ],
  inventory: [
    'Store Manager',
    'Inventory Officer',
    'Store Keeper',
  ],
};

export const STAFF_CATEGORIES: StaffCategory[] = [
  'Doctor',
  'RMO',
  'Front Desk / Billing',
  'Admission',
  'Inventory Management',
  'Nurse',
  'Technician',
  'Other Staff',
];

export const STAFF_PORTALS: { key: StaffPortalKey; label: string }[] = [
  { key: 'front-desk', label: 'Front Desk & Billing' },
  { key: 'admission', label: 'Admission' },
  { key: 'inventory', label: 'Inventory' },
];
