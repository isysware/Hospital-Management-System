import * as XLSX from 'xlsx';
import apiClient from './apiClient';
import { User } from '../types';
import {
  StaffUser,
  StaffUserFormValues,
  StaffUserFilterState,
  StaffAuditLogEntry,
  ImportedStaffRow,
  StaffImportValidationResult,
  StaffAccessType,
  StaffPortalKey,
  StaffRole,
  StaffStatus,
  StaffCategory,
  STAFF_PORTAL_ROLES,
  STAFF_CATEGORIES,
  PORTAL_ELIGIBLE_CATEGORIES,
  SalaryBasis,
  isCommissionBasis,
  defaultWizardExtras,
} from '../types/staffUser';
import { DepartmentService } from './departmentService';
import { ServiceRatesService } from './serviceRatesService';
import { formatDisplayDate } from '../utils/dateConstants';

// ── Add Staff wizard → backend payload mappers ─────────────────────────────

/** Which wizard sections the user edited — only those are re-saved on Edit. */
export interface StaffWizardChanges {
  schedule: boolean;
  salary: boolean;
  commission: boolean;
  bank: boolean;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const num = (v: number | '') => (v === '' ? 0 : Number(v));
const apiError = (err: any, fallback: string): string => {
  const e = err?.response?.data?.error;
  // errorHandler maps Zod issues to { field, issue }.
  const detail = Array.isArray(e?.details) && e.details.length > 0 ? `: ${e.details.map((d: any) => d.issue ?? d.message).filter(Boolean).join('; ')}` : '';
  return e?.message ? `${e.message}${detail}` : err?.message || fallback;
};

const hasSalary = (v: StaffUserFormValues) => v.salaryEnabled && v.baseSalary !== '' && Number(v.baseSalary) > 0;

function toSchedulePayload(v: StaffUserFormValues) {
  return v.weeklySchedule.map((d) => ({
    dayOfWeek: d.dayOfWeek,
    isWorking: d.isWorking,
    useShiftDefault: d.useShiftDefault,
    startTime: d.isWorking && !d.useShiftDefault ? d.startTime : null,
    endTime: d.isWorking && !d.useShiftDefault ? d.endTime : null,
    breakMinutes: num(d.breakMinutes),
  }));
}

function toSalaryPayload(v: StaffUserFormValues) {
  return {
    salaryBasis: v.salaryBasis,
    baseAmount: Number(v.baseSalary),
    salaryTaxMethod: v.salaryTaxMethod || null,
    salaryTaxValue: v.salaryTaxMethod ? num(v.salaryTaxValue) : null,
    fixedAllowance: num(v.salaryAllowance),
    fixedDeduction: num(v.salaryDeduction),
    paymentMethod: v.bankEnabled ? v.bank.paymentMethod : null,
    effectiveFrom: v.salaryEffectiveFrom || todayISO(),
  };
}

function toCommissionPayload(v: StaffUserFormValues) {
  return {
    rules: v.commissionRules
      .filter((r) => r.enabled)
      .map((r) => ({ serviceRateId: r.serviceRateId, ruleType: r.ruleType, rate: num(r.rate), basis: r.basis })),
    commissionTaxMethod: v.commissionTaxMethod || null,
    commissionTaxValue: v.commissionTaxMethod ? num(v.commissionTaxValue) : null,
    effectiveFrom: v.commissionEffectiveFrom || todayISO(),
  };
}

function toBankPayload(v: StaffUserFormValues, effectiveFrom: string) {
  const b = v.bank;
  return {
    paymentMethod: b.paymentMethod,
    bankName: b.bankName.trim() || null,
    branchName: b.branchName.trim() || null,
    accountTitle: b.accountTitle.trim() || null,
    accountNumber: b.accountNumber.trim() || null,
    iban: b.iban.trim() || null,
    walletAccount: b.walletAccount.trim() || null,
    preferredForSalary: b.preferredForSalary,
    preferredForCommission: b.preferredForCommission,
    effectiveFrom: effectiveFrom || todayISO(),
  };
}

/**
 * Live Staff Users service — combines two real backend resources into one
 * flattened `StaffUser` row per the frontend's existing contract:
 *   - the HR record: `/api/v1/staff*` (Prisma `Staff`)
 *   - the optional login/portal account linked to it: `/api/v1/portal-users*`
 *     (Prisma `PortalUser`, `staffId` FK) — its absence IS the
 *     'STAFF_RECORD_ONLY' access type, a valid, deliberate state.
 * Same in-memory-cache pattern as the other rewired services — never
 * localStorage, no fake credential store, no fabricated audit log.
 */

const PORTAL_ROLE_TO_KEY: Record<string, StaffPortalKey> = {
  FRONT_DESK_BILLING: 'front-desk',
  ADMISSION: 'admission',
  INVENTORY_MANAGEMENT: 'inventory',
};
const KEY_TO_PORTAL_ROLE: Record<StaffPortalKey, string> = {
  'front-desk': 'FRONT_DESK_BILLING',
  admission: 'ADMISSION',
  inventory: 'INVENTORY_MANAGEMENT',
};
// Staff-tier portal roles this page manages (Admin/Super Admin accounts live on the Admin Users page).
const STAFF_PORTAL_ROLES_QUERY = 'FRONT_DESK_BILLING,ADMISSION,INVENTORY_MANAGEMENT';

function formatTimestamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dateStr = formatDisplayDate(d);
  const timeStr = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${timeStr}`;
}

/** Maps a backend Staff row (with its `portalUser` relation included) onto the frontend `StaffUser` shape. */
function toStaffUser(raw: Record<string, any>): StaffUser {
  const pu = raw.portalUser;
  const assignedPortal = pu ? PORTAL_ROLE_TO_KEY[pu.role] ?? null : null;
  const isSuspended = pu?.status === 'SUSPENDED' || (raw.notes && String(raw.notes).startsWith('[SUSPENDED]'));
  const status: StaffStatus = isSuspended ? 'SUSPENDED' : !raw.isActive ? 'INACTIVE' : 'ACTIVE';

  // Multi-department assignment: use junction table data if present, else fall back to primary dept
  const staffDepts: Array<{ departmentId: string; department: { id: string; name: string } }> =
    raw.staffDepartments ?? [];
  const departmentIds: string[] =
    staffDepts.length > 0 ? staffDepts.map((sd: any) => sd.departmentId) : raw.departmentId ? [raw.departmentId] : [];
  const departmentNames: string[] =
    staffDepts.length > 0 ? staffDepts.map((sd: any) => sd.department?.name ?? '') : raw.department?.name ? [raw.department.name] : [];

  const staffServices: Array<{ serviceRateId: string; serviceRate?: { id: string; name: string; encounterType?: string | null } }> =
    raw.staffServices ?? [];
  const assignedServiceIds = staffServices.map((s) => s.serviceRateId);
  const assignedServiceNames = staffServices.map((s) => s.serviceRate?.name ?? '');
  // staff.md §4/§7 — a doctor's OPD/Observation/Emergency eligibility comes
  // from the encounterType of the services actually assigned to them at
  // Staff Add, not a separate manual toggle. OR'd with the raw flag so any
  // legacy manually-set value keeps working too.
  const assignedEncounterTypes = new Set(staffServices.map((s) => s.serviceRate?.encounterType).filter(Boolean));

  return {
    id: raw.id,
    employeeCode: raw.employeeId,
    fullName: raw.fullName,
    fatherGuardianName: raw.fatherGuardianName || undefined,
    phone: raw.phone,
    alternatePhone: raw.alternatePhone || undefined,
    email: raw.email || '',
    cnic: raw.cnic || undefined,
    dateOfBirth: raw.dateOfBirth || undefined,
    designation: raw.designation || '',
    departmentId: raw.departmentId || '',
    departmentName: raw.department?.name || '',
    departmentIds,
    departmentNames,
    assignedServiceIds,
    assignedServiceNames,
    assignedShiftId: raw.assignedShiftId ?? raw.assignedShift?.id ?? null,
    assignedShiftName: raw.assignedShift?.name ?? null,
    staffCategory: raw.category as StaffCategory,
    accessType: pu ? 'PORTAL_USER' : 'STAFF_RECORD_ONLY',
    assignedPortal,
    staffRole: pu ? raw.designation : null,
    username: pu?.username || null,
    status,
    requirePasswordChange: pu?.mustResetPassword ?? false,
    lastLoginAt: pu?.lastLoginAt ? formatTimestamp(pu.lastLoginAt) : null,
    createdBy: raw.createdBy || 'System',
    createdAt: formatTimestamp(raw.createdAt),
    updatedBy: raw.updatedBy || 'System',
    updatedAt: formatTimestamp(raw.updatedAt),
    passwordResetBy: pu?.passwordResetBy || undefined,
    passwordResetAt: pu?.passwordResetAt ? formatTimestamp(pu.passwordResetAt) : undefined,
    clinicalAuthUsername: raw.clinicalAuthUsername ?? null,
    clinicalAuthActive: !!raw.clinicalAuthActive,
    clinicalAuthUpdatedAt: raw.clinicalAuthUpdatedAt ? formatTimestamp(raw.clinicalAuthUpdatedAt) : undefined,
    availableForOpd: !!raw.availableForOpd || assignedEncounterTypes.has('OPD'),
    availableForObservation: !!raw.availableForObservation || assignedEncounterTypes.has('OBSERVATION'),
    availableForEmergency: !!raw.availableForEmergency || assignedEncounterTypes.has('EMERGENCY'),
    doctorSponsoredDiscountTrackingEnabled: !!raw.doctorSponsoredDiscountTrackingEnabled,
    linkedActivityCount: 0,
    notes: raw.notes || undefined,
    // Internal, not part of the public StaffUser type but read back by this module below.
    // @ts-expect-error - stash the linked portal user id for update/status/reset calls.
    __portalUserId: pu?.id,
  };
}

function getPortalUserId(u: StaffUser): string | undefined {
  return (u as any).__portalUserId;
}

let cachedStaffUsers: StaffUser[] = [];

export async function fetchStaffUsers(): Promise<StaffUser[]> {
  const rows: Record<string, any>[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await apiClient.get<{ data: Record<string, any>[]; meta?: { pagination?: { totalPages: number } } }>(
      '/staff', { params: { pageSize: 100, page } }
    );
    rows.push(...res.data.data);
    totalPages = res.data.meta?.pagination?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);
  cachedStaffUsers = rows.map(toStaffUser);
  return cachedStaffUsers;
}

export async function primeStaffUsersCache(): Promise<void> {
  try {
    await fetchStaffUsers();
  } catch {
    // Leave cache empty; the Staff Users page itself will surface the real error on its own fetch.
  }
}

export class StaffUserService {
  static getStaffUsers(): StaffUser[] {
    return cachedStaffUsers;
  }

  static getStaffUserById(id: string): StaffUser | undefined {
    return cachedStaffUsers.find((u) => u.id === id);
  }

  static getStaffUserByUsername(username: string): StaffUser | undefined {
    const clean = username.trim().toLowerCase();
    return cachedStaffUsers.find((u) => u.username && u.username.toLowerCase() === clean);
  }

  /**
   * The offline/backend-unreachable fallback login path in `AuthContext.tsx`
   * calls these — there is no more local plaintext-credential store (real
   * passwords only ever live, hashed, on the backend), so they always
   * report "no local credential", correctly failing that fallback closed.
   */
  static getCredentialByUserId(_staffUserId: string): undefined {
    return undefined;
  }
  static getCredentialByUsername(_username: string): undefined {
    return undefined;
  }
  static recordLogin(_id: string): void {
    // No-op — real last-login tracking happens server-side (`PortalUser.lastLoginAt`).
  }

  static getAuditLogs(): StaffAuditLogEntry[] {
    // The backend's real `AuditLog` table (populated automatically per
    // request) is the actual audit trail now; there is no client-facing
    // read endpoint for it yet (tracked in the completion plan), so this
    // returns empty rather than fabricated entries.
    return [];
  }

  static isValidCNIC(cnic?: string | null): boolean {
    if (!cnic || !cnic.trim()) return true;
    return /^\d{5}-\d{7}-\d{1}$/.test(cnic.trim());
  }

  static isValidPhone(phone?: string | null): boolean {
    if (!phone || !phone.trim()) return false;
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('92') && digits.length === 12) digits = `0${digits.slice(2)}`;
    else if (digits.length === 10 && digits.startsWith('3')) digits = `0${digits}`;
    return digits.length === 11 && digits.startsWith('03');
  }

  static isValidPassword(password: string): { valid: boolean; message?: string } {
    if (password.length < 8) return { valid: false, message: 'Password must be at least 8 characters long.' };
    if (!/[A-Za-z]/.test(password)) return { valid: false, message: 'Password must contain at least one letter.' };
    if (!/[0-9]/.test(password)) return { valid: false, message: 'Password must contain at least one number.' };
    return { valid: true };
  }

  static getNextNumericEmployeeCode(): string {
    let maxNum = 1000;
    for (const s of cachedStaffUsers) {
      const num = parseInt(s.employeeCode, 10);
      if (!Number.isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
    return String(maxNum + 1);
  }

  static isEmployeeCodeDuplicate(code: string, currentId?: string): boolean {
    const clean = code.trim().toLowerCase();
    return cachedStaffUsers.some((u) => u.employeeCode.toLowerCase() === clean && u.id !== currentId);
  }

  static isUsernameDuplicate(username: string, currentId?: string): boolean {
    const clean = username.trim().toLowerCase();
    if (!clean) return false;
    return cachedStaffUsers.some((u) => u.username && u.username.toLowerCase() === clean && u.id !== currentId);
  }

  /** staff.md §5 — guidance only; never auto-grants access. */
  static isPortalEligible(category: StaffCategory): boolean {
    return PORTAL_ELIGIBLE_CATEGORIES.includes(category);
  }

  static isValidDateOfBirth(dob: string): boolean {
    if (!dob) return false;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return false;
    return d.getTime() < Date.now();
  }

  /**
   * `POST /staff` — the full Add Staff wizard (Staff Portal Access Salary
   * Commission.pdf §2) in ONE request: Staff Master, Weekly Timing, Salary
   * Profile, Commission Setup and Bank Account are saved in a single backend
   * transaction, so a failure never leaves a half-created staff member.
   * Portal access stays a separate workflow.
   */
  static async createStaffUser(values: StaffUserFormValues, currentUser: User | null): Promise<{ success: boolean; user?: StaffUser; error?: string }> {
    const invalid = this.validateCoreValues(values);
    if (invalid) return { success: false, error: invalid };

    try {
      const staffRes = await apiClient.post<{ data: Record<string, any> }>('/staff', {
        ...this.toStaffMasterPayload(values),
        assignedShiftId: values.assignedShiftId || undefined,
        joiningDate: values.joiningDate || undefined,
        ...(values.scheduleEnabled ? { weeklySchedule: toSchedulePayload(values) } : {}),
        ...(hasSalary(values) ? { salaryProfile: toSalaryPayload(values) } : {}),
        ...(hasSalary(values) && isCommissionBasis(values.salaryBasis) ? { commission: toCommissionPayload(values) } : {}),
        ...(values.bankEnabled ? { bankAccount: toBankPayload(values, values.joiningDate) } : {}),
        ...(values.staffCategory === 'Doctor' && values.clinicalUsername.trim() && values.clinicalPassword
          ? { clinicalAuth: { username: values.clinicalUsername.trim(), password: values.clinicalPassword } }
          : {}),
      });
      const staffId = staffRes.data.data.id;

      if (values.status === 'INACTIVE') {
        await apiClient.post(`/staff/${staffId}/deactivate`);
      }

      await fetchStaffUsers();
      const created = this.getStaffUserById(staffId);
      return { success: true, user: created };
    } catch (err: any) {
      return { success: false, error: apiError(err, 'Failed to create staff user.') };
    }
  }

  /**
   * `PATCH /staff/:id` for the Staff Master, then only the wizard sections the
   * user actually changed — each is effective-dated server-side (history kept).
   * Salary is saved before commission because commission is only allowed on a
   * "+ Commission" salary type.
   */
  static async updateStaffUser(
    id: string,
    values: StaffUserFormValues,
    currentUser: User | null,
    changed: StaffWizardChanges = { schedule: false, salary: false, commission: false, bank: false },
  ): Promise<{ success: boolean; user?: StaffUser; error?: string }> {
    const existing = this.getStaffUserById(id);
    if (!existing) return { success: false, error: 'Staff user not found.' };
    const invalid = this.validateCoreValues(values);
    if (invalid) return { success: false, error: invalid };

    try {
      await apiClient.patch(`/staff/${id}`, {
        ...this.toStaffMasterPayload(values),
        isActive: values.status !== 'INACTIVE',
        assignedShiftId: values.assignedShiftId || null,
        joiningDate: values.joiningDate || undefined,
      });

      const wantsSuspended = values.status === 'SUSPENDED';
      const portalUserId = getPortalUserId(existing);
      if (portalUserId && wantsSuspended !== (existing.status === 'SUSPENDED')) {
        await apiClient.post(`/portal-users/${portalUserId}/status`, { status: wantsSuspended ? 'SUSPENDED' : 'ACTIVE' });
      }

      const steps: [boolean, string, () => Promise<unknown>][] = [
        [changed.schedule && values.scheduleEnabled, 'weekly timing', () =>
          apiClient.put(`/staff/${id}/weekly-schedule`, { effectiveFrom: todayISO(), days: toSchedulePayload(values) })],
        [changed.salary && hasSalary(values), 'salary profile', () => apiClient.post(`/staff/${id}/salary-profile`, toSalaryPayload(values))],
        [(changed.salary || changed.commission) && hasSalary(values) && isCommissionBasis(values.salaryBasis), 'commission setup', () =>
          apiClient.put(`/staff/${id}/commission`, toCommissionPayload(values))],
        [changed.bank && values.bankEnabled, 'bank account', () => apiClient.post(`/staff/${id}/bank-account`, toBankPayload(values, todayISO()))],
        // A new password (re)sets the discharge credential; blank keeps the current one.
        [values.staffCategory === 'Doctor' && !!values.clinicalUsername.trim() && !!values.clinicalPassword, 'discharge credentials', () =>
          apiClient.post(`/staff/${id}/clinical-auth`, { username: values.clinicalUsername.trim(), password: values.clinicalPassword })],
      ];
      for (const [run, label, call] of steps) {
        if (!run) continue;
        try {
          await call();
        } catch (err: any) {
          await fetchStaffUsers();
          return { success: false, error: `Staff record updated, but ${label} failed — ${apiError(err, 'unknown error')}` };
        }
      }

      await fetchStaffUsers();
      const updated = this.getStaffUserById(id);
      return { success: true, user: updated };
    } catch (err: any) {
      return { success: false, error: apiError(err, 'Failed to update staff user.') };
    }
  }

  private static validateCoreValues(values: StaffUserFormValues): string | null {
    if (!values.fullName.trim()) return 'Full Name is required.';
    if (!values.fatherGuardianName.trim()) return 'Father / Guardian Name is required.';
    if (!values.phone.trim()) return 'Primary phone number is required.';
    if (!values.cnic.trim() || !this.isValidCNIC(values.cnic)) return 'A valid CNIC (xxxxx-xxxxxxx-x) is required.';
    if (!this.isValidDateOfBirth(values.dateOfBirth)) return 'A valid Date of Birth is required.';
    if (values.staffCategory === 'Doctor') {
      if (!values.departmentIds || values.departmentIds.length === 0) return 'Doctor requires at least one Clinical Department.';
      if (!values.serviceIds || values.serviceIds.length === 0) return 'Doctor requires at least one Assigned Service.';
    }
    return null;
  }

  private static toStaffMasterPayload(values: StaffUserFormValues) {
    return {
      fullName: values.fullName.trim(),
      fatherGuardianName: values.fatherGuardianName.trim(),
      cnic: values.cnic.trim(),
      dateOfBirth: values.dateOfBirth,
      category: values.staffCategory,
      phone: values.phone.trim(),
      alternatePhone: values.alternatePhone?.trim() || undefined,
      email: values.email?.trim() || undefined,
      designation: values.designation?.trim() || undefined,
      // Only sync department/service assignments when this is a Doctor —
      // never wipe an existing (Staff 360-set) department for other categories.
      ...(values.staffCategory === 'Doctor' ? { departmentIds: values.departmentIds, serviceIds: values.serviceIds } : {}),
    };
  }

  /**
   * Separate Portal Access workflow (staff.md §5) — grants an existing
   * STAFF_RECORD_ONLY staff member a login on one of the existing HMS
   * portals. Never called from the Add/Edit Staff form.
   */
  static async grantPortalAccess(
    staffId: string,
    values: { assignedPortal: StaffPortalKey; username: string; password: string },
  ): Promise<{ success: boolean; error?: string }> {
    const staff = this.getStaffUserById(staffId);
    if (!staff) return { success: false, error: 'Staff user not found.' };
    if (!values.assignedPortal) return { success: false, error: 'Portal selection is required.' };
    if (!values.username.trim()) return { success: false, error: 'Username is required.' };
    const passValidation = this.isValidPassword(values.password);
    if (!passValidation.valid) return { success: false, error: passValidation.message };

    try {
      await apiClient.post('/portal-users', {
        staffId,
        fullName: staff.fullName,
        username: values.username.trim().toLowerCase(),
        email: staff.email || undefined,
        phone: staff.phone,
        password: values.password,
        role: KEY_TO_PORTAL_ROLE[values.assignedPortal],
      });
      await fetchStaffUsers();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.error?.message || err?.message || 'Failed to grant portal access.' };
    }
  }

  /** Revokes an existing portal login, converting the staff member back to STAFF_RECORD_ONLY. */
  static async revokePortalAccess(staffId: string): Promise<{ success: boolean; error?: string }> {
    const staff = this.getStaffUserById(staffId);
    if (!staff) return { success: false, error: 'Staff user not found.' };
    const portalUserId = getPortalUserId(staff);
    if (!portalUserId) return { success: true };

    try {
      await apiClient.delete(`/portal-users/${portalUserId}`);
      await fetchStaffUsers();
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.error?.message || err?.message || 'This account has linked activity and its portal access cannot be removed. Suspend it instead.',
      };
    }
  }

  /** `POST /staff/:id/deactivate` or `PATCH /staff/:id` (reactivate), plus `/portal-users/:id/status` when applicable */
  static async updateStaffStatus(
    id: string,
    newStatus: StaffStatus,
    _currentUser: User | null,
    reason?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const existing = this.getStaffUserById(id);
    if (!existing) return { success: false, error: 'Staff user not found.' };

    try {
      const portalUserId = getPortalUserId(existing);

      if (newStatus === 'INACTIVE') {
        await apiClient.post(`/staff/${id}/deactivate`, { reason: reason || 'Administrative deactivation' });
      } else if (newStatus === 'SUSPENDED') {
        if (portalUserId) {
          await apiClient.post(`/portal-users/${portalUserId}/status`, {
            status: 'SUSPENDED',
            reason: reason || 'Administrative suspension',
          });
        }
        const existingNotes = existing.notes || '';
        const cleanNotes = existingNotes.replace(/^\[SUSPENDED\]\s*/, '');
        const newNotes = `[SUSPENDED] ${reason || 'Suspended by administrator'}${cleanNotes ? ' | ' + cleanNotes : ''}`;
        await apiClient.patch(`/staff/${id}`, { notes: newNotes });
      } else if (newStatus === 'ACTIVE') {
        const existingNotes = existing.notes || '';
        const cleanNotes = existingNotes.replace(/^\[SUSPENDED\]\s*/, '');
        await apiClient.patch(`/staff/${id}`, {
          isActive: true,
          employmentStatus: 'ACTIVE',
          notes: cleanNotes || undefined,
        });

        if (portalUserId) {
          await apiClient.post(`/portal-users/${portalUserId}/status`, {
            status: 'ACTIVE',
            reason: reason || 'Reactivated by administrator',
          });
        }
      }

      await fetchStaffUsers();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update status.' };
    }
  }

  /** `POST /portal-users/:id/reset-password` */
  static async resetStaffPassword(id: string, newPassword: string, _requirePasswordChange: boolean, _currentUser: User | null): Promise<{ success: boolean; error?: string }> {
    const existing = this.getStaffUserById(id);
    if (!existing) return { success: false, error: 'Staff user not found.' };
    if (existing.accessType !== 'PORTAL_USER') return { success: false, error: 'Cannot reset password for a Staff Record Only entry.' };

    const validation = this.isValidPassword(newPassword);
    if (!validation.valid) return { success: false, error: validation.message };

    try {
      const portalUserId = getPortalUserId(existing);
      await apiClient.post(`/portal-users/${portalUserId}/reset-password`, { newPassword });
      await fetchStaffUsers();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to reset password.' };
    }
  }

  // ── v7.2 Salary Profile (HMS_V7.2_NEW_REQUIREMENTS.md §2.7) ─────────────
  // Creating a new profile server-side closes out whichever row was
  // previously current — this is a "set current profile" action, not a
  // patch, matching StaffEmploymentHistory/DoctorCommissionRule's
  // effective-dated-history pattern.
  static async saveSalaryProfile(
    id: string,
    values: {
      salaryBasis: SalaryBasis;
      baseAmount: number;
      payrollDivisor?: number;
      salaryTaxMethod?: 'PERCENTAGE' | 'FIXED' | '';
      salaryTaxValue?: number | '';
      fixedAllowance?: number;
      fixedDeduction?: number;
      effectiveFrom: string;
    },
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await apiClient.post(`/staff/${id}/salary-profile`, {
        salaryBasis: values.salaryBasis,
        baseAmount: values.baseAmount,
        payrollDivisor: values.payrollDivisor,
        salaryTaxMethod: values.salaryTaxMethod || undefined,
        salaryTaxValue: values.salaryTaxValue === '' ? undefined : values.salaryTaxValue,
        fixedAllowance: values.fixedAllowance,
        fixedDeduction: values.fixedDeduction,
        effectiveFrom: values.effectiveFrom,
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.error?.message || err?.message || 'Failed to save salary profile.' };
    }
  }

  /** Staff 360° read — current salary profile + commission rules, used by the Salary Profile modal to prefill. */
  static async fetchFullProfile(id: string): Promise<Record<string, any>> {
    const res = await apiClient.get<{ data: Record<string, any> }>(`/staff/${id}/360`);
    return res.data.data;
  }

  // ── v7.2 Doctor Clinical Discharge Authorization (HMS_V7.2_NEW_REQUIREMENTS.md
  // §2.4) — a credential separate from the portal login above; usable even
  // for a Staff Record Only doctor. Consumed later by the Admission
  // Portal's discharge re-authentication popup (not built in this phase).

  /** Creates or replaces a doctor's clinical discharge credential (also (re)activates it). */
  static async setClinicalAuth(id: string, username: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      await apiClient.post(`/staff/${id}/clinical-auth`, { username, password });
      await fetchStaffUsers();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.error?.message || err?.message || 'Failed to set clinical discharge credential.' };
    }
  }

  /** Rotates the password on an existing clinical discharge credential without changing the username. */
  static async resetClinicalAuthPassword(id: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      await apiClient.post(`/staff/${id}/clinical-auth/reset-password`, { password });
      await fetchStaffUsers();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.error?.message || err?.message || 'Failed to reset clinical discharge password.' };
    }
  }

  static async setClinicalAuthActive(id: string, active: boolean): Promise<{ success: boolean; error?: string }> {
    try {
      await apiClient.post(`/staff/${id}/clinical-auth/${active ? 'activate' : 'deactivate'}`);
      await fetchStaffUsers();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.error?.message || err?.message || 'Failed to update clinical discharge authorization status.' };
    }
  }

  /** Permanently delete staff user (or guides to deactivation if hospital activity is recorded). */
  static async deleteStaffUser(id: string, _currentUser: User | null): Promise<{ success: boolean; error?: string }> {
    try {
      await apiClient.delete(`/staff/${id}`);
      await fetchStaffUsers();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to delete staff account.' };
    }
  }

  static filterStaffUsers(users: StaffUser[], filters: StaffUserFilterState): StaffUser[] {
    const search = (filters.searchTerm || '').trim().toLowerCase();
    return users.filter((u) => {
      if (search) {
        const matches =
          u.employeeCode.toLowerCase().includes(search) ||
          u.fullName.toLowerCase().includes(search) ||
          u.phone.toLowerCase().includes(search) ||
          u.email.toLowerCase().includes(search) ||
          (u.cnic && u.cnic.toLowerCase().includes(search)) ||
          u.designation.toLowerCase().includes(search) ||
          u.departmentName.toLowerCase().includes(search) ||
          (u.username && u.username.toLowerCase().includes(search));
        if (!matches) return false;
      }
      if (filters.departmentId && filters.departmentId !== 'ALL' && u.departmentId !== filters.departmentId) return false;
      if (filters.staffCategory && filters.staffCategory !== 'ALL' && u.staffCategory !== filters.staffCategory) return false;
      if (filters.accessType && filters.accessType !== 'ALL' && u.accessType !== filters.accessType) return false;
      if (filters.assignedPortal && filters.assignedPortal !== 'ALL' && u.assignedPortal !== filters.assignedPortal) return false;
      if (filters.status && filters.status !== 'ALL' && u.status !== filters.status) return false;
      if (filters.staffRole && filters.staffRole !== 'ALL' && u.staffRole !== filters.staffRole) return false;
      return true;
    });
  }

  static generateImportTemplate(): void {
    const templateData = [
      {
        employee_code: 'EMP-FD-10',
        full_name: 'Bilal Khan',
        father_guardian_name: 'Muhammad Khan',
        cnic: '35201-1122334-1',
        date_of_birth: '1995-04-12',
        phone: '+92 300 1234567',
        alternate_phone: '',
        email: 'bilal.khan@sharif-saeed.hospital',
        designation: 'Reception Officer',
        department_code: '',
        services: '',
        staff_category: 'Front Desk / Billing',
        access_type: 'PORTAL_USER',
        assigned_portal: 'front-desk',
        staff_role: 'Front Desk Officer',
        status: 'ACTIVE',
        username: 'bilal.reception',
      },
      {
        employee_code: 'EMP-DOC-15',
        full_name: 'Dr. Shahzad Ali',
        father_guardian_name: 'Ali Nawaz',
        cnic: '35202-2233445-2',
        date_of_birth: '1980-08-01',
        phone: '+92 300 7654321',
        alternate_phone: '',
        email: 'shahzad.ali@sharif-saeed.hospital',
        designation: 'Consultant Pediatrician',
        department_code: 'DEP-04',
        services: 'CONS-OPD, LAB-CBC',
        staff_category: 'Doctor',
        access_type: 'STAFF_RECORD_ONLY',
        assigned_portal: '',
        staff_role: '',
        status: 'ACTIVE',
        username: '',
      },
    ];

    const instructionsData = [
      { Instruction: 'Allowed staff_category values:', ValidOptions: STAFF_CATEGORIES.join(', ') },
      { Instruction: 'Mandatory fields (all rows):', ValidOptions: 'full_name, father_guardian_name, cnic (xxxxx-xxxxxxx-x), date_of_birth (YYYY-MM-DD), phone, staff_category' },
      { Instruction: 'Doctor rows only:', ValidOptions: 'department_code (Clinical Department) and services (comma-separated active service codes) are required' },
      { Instruction: 'Allowed access_type values:', ValidOptions: 'PORTAL_USER, STAFF_RECORD_ONLY' },
      { Instruction: 'Allowed assigned_portal values:', ValidOptions: 'front-desk, admission, inventory (Leave blank for STAFF_RECORD_ONLY)' },
      { Instruction: 'Allowed status values:', ValidOptions: 'ACTIVE, INACTIVE, SUSPENDED' },
      { Instruction: 'Role mapping:', ValidOptions: 'Must match valid roles for the selected portal (e.g. Front Desk Officer, Billing Officer, Admission Officer, Inventory Manager)' },
      { Instruction: 'Automatic Passwords:', ValidOptions: 'For PORTAL_USER rows, secure temporary credentials will be auto-generated and available for download upon import confirmation.' },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wsInfo = XLSX.utils.json_to_sheet(instructionsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Staff Import Template');
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Field Instructions');
    XLSX.writeFile(wb, 'staff_users_import_template.xlsx');
  }

  static async parseAndValidateImport(file: File): Promise<StaffImportValidationResult> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet);

          const existingUsers = this.getStaffUsers();
          const existingCodes = new Set(existingUsers.map((u) => u.employeeCode.toLowerCase()));
          const existingUsernames = new Set(existingUsers.filter((u) => u.username).map((u) => u.username!.toLowerCase()));
          const existingCnics = new Set(existingUsers.filter((u) => u.cnic).map((u) => u.cnic!.toLowerCase()));

          const departments = DepartmentService.getDepartments();
          const deptMap = new Map<string, { id: string; name: string }>();
          departments.forEach((d) => {
            deptMap.set(d.code.toLowerCase(), { id: d.id, name: d.name });
            deptMap.set(d.id.toLowerCase(), { id: d.id, name: d.name });
            deptMap.set(d.name.toLowerCase(), { id: d.id, name: d.name });
          });

          const activeServices = ServiceRatesService.getServices().filter((s) => s.status === 'Active');
          const serviceMap = new Map<string, { id: string; name: string }>();
          activeServices.forEach((s) => {
            serviceMap.set(s.code.toLowerCase(), { id: s.id, name: s.name });
            serviceMap.set(s.id.toLowerCase(), { id: s.id, name: s.name });
          });

          const seenBatchCodes = new Set<string>();
          const seenBatchUsernames = new Set<string>();
          const rows: ImportedStaffRow[] = [];

          rawRows.forEach((row, idx) => {
            const rowNumber = idx + 2;
            const errors: string[] = [];

            const employeeCode = String(row.employee_code || row.EmployeeCode || '').trim();
            const fullName = String(row.full_name || row.FullName || row.Name || '').trim();
            const fatherGuardianName = String(row.father_guardian_name || row.FatherName || '').trim();
            const phone = String(row.phone || row.Phone || row.Contact || '').trim();
            const alternatePhone = String(row.alternate_phone || '').trim();
            const email = String(row.email || row.Email || '').trim().toLowerCase();
            const cnic = String(row.cnic || row.CNIC || '').trim();
            const dateOfBirth = String(row.date_of_birth || row.DateOfBirth || row.dob || '').trim();
            const designation = String(row.designation || row.Designation || '').trim();
            const departmentCode = String(row.department_code || row.DepartmentCode || row.department || '').trim();
            const serviceCodesRaw = String(row.services || row.Services || '').trim();
            const staffCategory = String(row.staff_category || row.StaffCategory || row.category || '').trim();
            const accessType = String(row.access_type || row.AccessType || 'PORTAL_USER').trim().toUpperCase();
            const assignedPortal = String(row.assigned_portal || row.AssignedPortal || row.portal || '').trim().toLowerCase();
            const staffRole = String(row.staff_role || row.StaffRole || row.role || '').trim();
            const rawUsername = String(row.username || row.Username || '').trim();
            const status = String(row.status || row.Status || 'ACTIVE').trim().toUpperCase();

            if (!employeeCode) {
              errors.push('Employee Code is required.');
            } else if (existingCodes.has(employeeCode.toLowerCase())) {
              errors.push(`Employee Code "${employeeCode}" already exists in system.`);
            } else if (seenBatchCodes.has(employeeCode.toLowerCase())) {
              errors.push(`Duplicate Employee Code "${employeeCode}" within uploaded spreadsheet.`);
            } else {
              seenBatchCodes.add(employeeCode.toLowerCase());
            }

            if (!fullName) errors.push('Staff Full Name is required.');
            if (!fatherGuardianName) errors.push('Father / Guardian Name is required.');
            if (!phone) errors.push('Phone number is required.');
            if (!dateOfBirth || Number.isNaN(new Date(dateOfBirth).getTime())) {
              errors.push('A valid Date of Birth is required.');
            }

            if (!staffCategory || !STAFF_CATEGORIES.includes(staffCategory as StaffCategory)) {
              errors.push(`Invalid staff category "${staffCategory}". Allowed: ${STAFF_CATEGORIES.join(', ')}.`);
            }

            const isDoctor = staffCategory === 'Doctor';
            let resolvedDept: { id: string; name: string } | undefined;
            if (isDoctor) {
              if (!departmentCode) {
                errors.push('Doctor requires at least one Clinical Department (department_code).');
              } else {
                resolvedDept = deptMap.get(departmentCode.toLowerCase());
                if (!resolvedDept) errors.push(`Unknown department code "${departmentCode}".`);
              }

              if (!serviceCodesRaw) {
                errors.push('Doctor requires at least one Assigned Service (services).');
              } else {
                const unknown = serviceCodesRaw
                  .split(',')
                  .map((c) => c.trim())
                  .filter(Boolean)
                  .filter((c) => !serviceMap.has(c.toLowerCase()));
                if (unknown.length > 0) errors.push(`Unknown/inactive service code(s): ${unknown.join(', ')}.`);
              }
            } else if (departmentCode) {
              resolvedDept = deptMap.get(departmentCode.toLowerCase());
              if (!resolvedDept) errors.push(`Unknown department code "${departmentCode}".`);
            }

            if (accessType !== 'PORTAL_USER' && accessType !== 'STAFF_RECORD_ONLY') {
              errors.push('Access Type must be either PORTAL_USER or STAFF_RECORD_ONLY.');
            }

            let validatedUsername: string | undefined;
            if (accessType === 'PORTAL_USER') {
              const validPortals: StaffPortalKey[] = ['front-desk', 'admission', 'inventory'];
              if (!assignedPortal || !validPortals.includes(assignedPortal as StaffPortalKey)) {
                errors.push('Assigned portal must be one of: front-desk, admission, inventory.');
              } else {
                const allowedRoles = STAFF_PORTAL_ROLES[assignedPortal as StaffPortalKey];
                if (!staffRole) {
                  errors.push(`Staff role is required for portal "${assignedPortal}".`);
                } else if (!allowedRoles.includes(staffRole as StaffRole)) {
                  errors.push(`Role "${staffRole}" is invalid for portal "${assignedPortal}". Allowed: ${allowedRoles.join(', ')}`);
                }
              }

              if (rawUsername) {
                if (existingUsernames.has(rawUsername.toLowerCase())) {
                  errors.push(`Username "${rawUsername}" is already in use.`);
                } else if (seenBatchUsernames.has(rawUsername.toLowerCase())) {
                  errors.push(`Duplicate username "${rawUsername}" in uploaded file.`);
                } else {
                  validatedUsername = rawUsername.toLowerCase();
                  seenBatchUsernames.add(validatedUsername);
                }
              } else {
                const parts = fullName.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
                const base = parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] || 'staff';
                let candidate = base;
                let counter = 1;
                while (existingUsernames.has(candidate) || seenBatchUsernames.has(candidate)) {
                  candidate = `${base}${counter}`;
                  counter++;
                }
                validatedUsername = candidate;
                seenBatchUsernames.add(candidate);
              }
            }

            if (!cnic) {
              errors.push('CNIC is required.');
            } else if (!this.isValidCNIC(cnic)) {
              errors.push('CNIC must follow format xxxxx-xxxxxxx-x.');
            } else if (existingCnics.has(cnic.toLowerCase())) {
              errors.push(`CNIC "${cnic}" already registered to another staff user.`);
            }

            if (status !== 'ACTIVE' && status !== 'INACTIVE' && status !== 'SUSPENDED') {
              errors.push('Status must be ACTIVE, INACTIVE, or SUSPENDED.');
            }

            rows.push({
              rowNumber,
              employeeCode,
              fullName,
              fatherGuardianName,
              phone,
              alternatePhone,
              email,
              cnic,
              dateOfBirth,
              designation,
              departmentCode,
              departmentName: resolvedDept?.name,
              serviceCodes: isDoctor ? serviceCodesRaw : undefined,
              staffCategory,
              accessType,
              assignedPortal: accessType === 'PORTAL_USER' ? assignedPortal : undefined,
              staffRole: accessType === 'PORTAL_USER' ? staffRole : undefined,
              username: validatedUsername,
              status,
              isValid: errors.length === 0,
              errors,
            });
          });

          const validRows = rows.filter((r) => r.isValid).length;
          resolve({ totalRows: rows.length, validRows, invalidRows: rows.length - validRows, rows });
        } catch (err: any) {
          reject(new Error(err?.message || 'Failed to parse Excel file. Please ensure it is a valid .xlsx file.'));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file from disk.'));
      reader.readAsArrayBuffer(file);
    });
  }

  /** Persists each validated row via real `POST /staff` (+ `/portal-users`) calls, one row at a time. */
  static async commitImport(
    validRows: ImportedStaffRow[],
    currentUser: User | null
  ): Promise<{
    success: boolean;
    importedCount: number;
    failures: string[];
    generatedCredentials: { employeeCode: string; fullName: string; portal: string; role: string; username: string; temporaryPassword: string }[];
  }> {
    const departments = DepartmentService.getDepartments();
    const deptMap = new Map<string, { id: string; name: string }>();
    departments.forEach((d) => {
      deptMap.set(d.code.toLowerCase(), { id: d.id, name: d.name });
      deptMap.set(d.id.toLowerCase(), { id: d.id, name: d.name });
      deptMap.set(d.name.toLowerCase(), { id: d.id, name: d.name });
    });

    const generatedCredentials: { employeeCode: string; fullName: string; portal: string; role: string; username: string; temporaryPassword: string }[] = [];
    const failures: string[] = [];
    let importedCount = 0;

    const activeServices = ServiceRatesService.getServices().filter((s) => s.status === 'Active');
    const serviceMap = new Map<string, string>(); // code/id (lowercase) -> serviceRateId
    activeServices.forEach((s) => {
      serviceMap.set(s.code.toLowerCase(), s.id);
      serviceMap.set(s.id.toLowerCase(), s.id);
    });

    for (const row of validRows) {
      const isDoctor = row.staffCategory === 'Doctor';
      const dept = row.departmentCode ? deptMap.get(row.departmentCode.toLowerCase()) : undefined;
      if (isDoctor && !dept) {
        failures.push(`${row.employeeCode}: department "${row.departmentCode}" not found`);
        continue;
      }
      const serviceIds = isDoctor
        ? Array.from(
            new Set(
              (row.serviceCodes || '')
                .split(',')
                .map((c) => c.trim().toLowerCase())
                .filter(Boolean)
                .map((c) => serviceMap.get(c))
                .filter((id): id is string => !!id),
            ),
          )
        : [];
      if (isDoctor && serviceIds.length === 0) {
        failures.push(`${row.employeeCode}: no valid active services resolved from "${row.serviceCodes}"`);
        continue;
      }
      const tempPassword = `Staff#${Math.floor(1000 + Math.random() * 9000)}`;
      try {
        const result = await this.createStaffUser(
          {
            fullName: row.fullName,
            employeeCode: row.employeeCode,
            fatherGuardianName: row.fatherGuardianName || '',
            cnic: row.cnic || '',
            dateOfBirth: row.dateOfBirth || '',
            phone: row.phone,
            alternatePhone: row.alternatePhone || '',
            email: row.email,
            designation: row.designation,
            staffCategory: row.staffCategory as StaffCategory,
            status: (row.status as StaffStatus) || 'ACTIVE',
            departmentIds: dept ? [dept.id] : [],
            serviceIds,
            assignedShiftId: '',
            salaryEnabled: false,
            salaryBasis: 'MONTHLY',
            baseSalary: '',
            salaryTaxMethod: '',
            salaryTaxValue: '',
            salaryEffectiveFrom: new Date().toISOString().slice(0, 10),
            ...defaultWizardExtras(),
          },
          currentUser
        );
        if (!result.success || !result.user) {
          failures.push(`${row.employeeCode}: ${result.error}`);
          continue;
        }
        importedCount += 1;

        if (row.accessType === 'PORTAL_USER' && row.username && row.assignedPortal) {
          const portalResult = await this.grantPortalAccess(result.user.id, {
            assignedPortal: row.assignedPortal as StaffPortalKey,
            username: row.username,
            password: tempPassword,
          });
          if (!portalResult.success) {
            failures.push(`${row.employeeCode}: staff record created, but portal access failed — ${portalResult.error}`);
          } else {
            generatedCredentials.push({
              employeeCode: row.employeeCode,
              fullName: row.fullName,
              portal: row.assignedPortal || '',
              role: row.staffRole || 'Staff',
              username: row.username,
              temporaryPassword: tempPassword,
            });
          }
        }
      } catch (err: any) {
        failures.push(`${row.employeeCode}: ${err?.message || 'Failed to import'}`);
      }
    }

    return { success: true, importedCount, failures, generatedCredentials };
  }

  static downloadTemporaryCredentials(
    creds: { employeeCode: string; fullName: string; portal: string; role: string; username: string; temporaryPassword: string }[]
  ): void {
    const wb = XLSX.utils.book_new();
    const formatted = creds.map((c) => ({
      'Employee Code': c.employeeCode,
      'Full Name': c.fullName,
      'Assigned Portal': c.portal,
      'Staff Role': c.role,
      Username: c.username,
      'Temporary Password': c.temporaryPassword,
      Note: 'Must change password on first login.',
    }));
    const ws = XLSX.utils.json_to_sheet(formatted);
    XLSX.utils.book_append_sheet(wb, ws, 'Staff Credentials');
    XLSX.writeFile(wb, `staff_temporary_credentials_${Date.now()}.xlsx`);
  }
}
