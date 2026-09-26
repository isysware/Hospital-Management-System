import { z } from 'zod';
import { normalizePhone } from '@/shared/validators';
import { paginationQuerySchema } from '@/shared/pagination';

const phoneSchema = z.string().transform((val, ctx) => {
  const normalized = normalizePhone(val);
  if (!normalized) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Phone must be a valid Pakistani mobile number (e.g. 0300-1234567)',
    });
    return z.NEVER;
  }
  return normalized;
});

const cnicSchema = z
  .string()
  .trim()
  .regex(/^\d{5}-\d{7}-\d{1}$/, 'CNIC must follow format xxxxx-xxxxxxx-x');

/** staff.md §2 — the fixed Staff Category list. Still a plain string column, not a DB enum. */
export const STAFF_CATEGORIES = [
  'Doctor',
  'RMO',
  'Front Desk / Billing',
  'Admission',
  'Inventory Management',
  'Nurse',
  'Technician',
  'Other Staff',
] as const;

const uniqueUuidArray = (label: string) =>
  z
    .array(z.string().uuid())
    .refine((arr) => new Set(arr).size === arr.length, { message: `Duplicate ${label} in the same request` });

// ── Staff Add Wizard pieces (Staff Portal Access Salary Commission.pdf §2) ──
// Shared by the one-shot `POST /staff` wizard payload and the per-section
// endpoints used when editing an existing staff member.

// PDF §9 — the 4 required Salary Types. Salary is attendance-based; the
// "+ Commission" types additionally earn service commission, which is always
// calculated, approved and paid separately — never folded into the salary.
export const SALARY_BASIS_VALUES = ['MONTHLY', 'MONTHLY_COMMISSION', 'PER_DAY', 'PER_DAY_COMMISSION'] as const;
export const isCommissionBasis = (basis: string) => basis.endsWith('_COMMISSION');

export const PAYMENT_METHODS = ['CASH', 'BANK', 'ONLINE'] as const;
export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm (24h)');

/** PDF §10 Salary Profile fields. `baseAmount` is the Monthly Base or the Daily Rate depending on the type. */
export const salaryProfileFieldsSchema = z.object({
  salaryTemplateId: z.string().uuid().optional().nullable(),
  salaryBasis: z.enum(SALARY_BASIS_VALUES),
  baseAmount: z.coerce.number().positive('Salary amount must be greater than zero'),
  payrollDivisor: z.coerce.number().int().positive().optional(),
  // Independent of Commission Tax on DoctorCommissionRule — see §2.7.
  salaryTaxMethod: z.enum(['PERCENTAGE', 'FIXED']).optional().nullable(),
  salaryTaxValue: z.coerce.number().nonnegative().optional().nullable(),
  fixedAllowance: z.coerce.number().nonnegative().optional(),
  fixedDeduction: z.coerce.number().nonnegative().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional().nullable(),
  effectiveFrom: z.coerce.date(),
});

/** PDF §8 — Monday–Sunday timing. Exactly one entry per weekday. */
export const weeklyScheduleSchema = z
  .array(
    z
      .object({
        dayOfWeek: z.enum(WEEK_DAYS),
        isWorking: z.boolean(),
        useShiftDefault: z.boolean().default(true),
        startTime: timeOfDay.optional().nullable(),
        endTime: timeOfDay.optional().nullable(),
        breakMinutes: z.coerce.number().int().min(0).max(600).default(0),
      })
      .superRefine((d, ctx) => {
        if (d.isWorking && !d.useShiftDefault && (!d.startTime || !d.endTime)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${d.dayOfWeek}: start and end time are required for a custom timing`, path: ['startTime'] });
        }
      }),
  )
  .length(7, 'Weekly schedule must list all 7 days')
  .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === 7, { message: 'Each weekday must appear exactly once' });

/** PDF §4 — payment account. Bank title/number are required for bank transfers. */
export const bankAccountSchema = z
  .object({
    paymentMethod: z.enum(PAYMENT_METHODS),
    bankName: z.string().trim().max(120).optional().nullable(),
    branchName: z.string().trim().max(120).optional().nullable(),
    accountTitle: z.string().trim().max(150).optional().nullable(),
    accountNumber: z.string().trim().max(50).optional().nullable(),
    iban: z.string().trim().max(34).optional().nullable(),
    walletAccount: z.string().trim().max(50).optional().nullable(),
    preferredForSalary: z.boolean().default(true),
    preferredForCommission: z.boolean().default(true),
    effectiveFrom: z.coerce.date(),
  })
  .superRefine((b, ctx) => {
    if (b.paymentMethod === 'BANK') {
      if (!b.bankName) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bank name is required for bank transfer', path: ['bankName'] });
      if (!b.accountTitle) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Account title is required for bank transfer', path: ['accountTitle'] });
      if (!b.accountNumber) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Account number is required for bank transfer', path: ['accountNumber'] });
    }
    if (b.paymentMethod === 'ONLINE' && !b.walletAccount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Wallet / online account is required for online payment', path: ['walletAccount'] });
    }
  });

/** PDF §7/§14 — one service-wise commission rule set up in the wizard (only for "+ Commission" salary types). */
export const wizardCommissionRuleSchema = z.object({
  serviceRateId: z.string().uuid().nullable(), // null = default rule for any other assigned service
  ruleType: z.enum(['FIXED_PER_SERVICE', 'PERCENTAGE']),
  rate: z.coerce.number().positive('Commission value must be greater than zero'),
  basis: z.enum(['GROSS', 'NET']).default('NET'),
});

export const commissionSetupSchema = z
  .object({
    rules: z.array(wizardCommissionRuleSchema).min(1, 'Add at least one commission rule'),
    commissionTaxMethod: z.enum(['PERCENTAGE', 'FIXED']).optional().nullable(),
    commissionTaxValue: z.coerce.number().nonnegative().optional().nullable(),
    effectiveFrom: z.coerce.date(),
  })
  .superRefine((c, ctx) => {
    const keys = c.rules.map((r) => r.serviceRateId ?? 'DEFAULT');
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only one commission rule per service', path: ['rules'] });
    }
    c.rules.forEach((r, i) => {
      if (r.ruleType === 'PERCENTAGE' && r.rate > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Commission percentage cannot exceed 100', path: ['rules', i, 'rate'] });
      }
    });
  });
export type CommissionSetup = z.infer<typeof commissionSetupSchema>;

/** v7.2 §2.4 — the doctor's own discharge credential (separate from any portal login). */
export const clinicalAuthCredentialSchema = z.object({
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Username may only contain letters, numbers, dots, hyphens and underscores'),
  password: z.string().min(8, 'Discharge password must be at least 8 characters').max(100),
});
export type WeeklyScheduleInput = z.infer<typeof weeklyScheduleSchema>;
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

/**
 * §4.1 Staff Master fields, rebuilt to the short-form contract (staff.md §2).
 * `employeeId` is intentionally absent — always system-generated.
 * Only fullName / fatherGuardianName / cnic / dateOfBirth / category / phone
 * are mandatory; everything else is optional and deferred to Staff 360.
 */
export const createStaffBodySchema = z
  .object({
    fullName: z.string().min(1).max(150),
    fatherGuardianName: z.string().min(1).max(150),
    cnic: cnicSchema,
    dateOfBirth: z.coerce.date(),
    category: z.enum(STAFF_CATEGORIES),
    phone: phoneSchema,

    // Doctor-only, mandatory when category === 'Doctor' (enforced below).
    departmentIds: uniqueUuidArray('department').optional(),
    serviceIds: uniqueUuidArray('service').optional(),

    // Everything below is optional / deferred to Staff 360.
    designation: z.string().max(100).optional(),
    alternatePhone: z.string().max(30).optional(),
    email: z.string().email().optional(),
    joiningDate: z.coerce.date().optional(),
    notes: z.string().optional(),
    assignedShiftId: z.string().uuid().optional(),
    doctorSponsoredDiscountTrackingEnabled: z.boolean().optional(),
    availableForOpd: z.boolean().optional(),
    availableForObservation: z.boolean().optional(),
    availableForEmergency: z.boolean().optional(),

    // Staff Add Wizard steps 6–9. Optional so bulk import / older callers keep
    // working; the Add Staff wizard always sends them. Saved in the same
    // transaction as the Staff row — never a half-created staff member.
    weeklySchedule: weeklyScheduleSchema.optional(),
    salaryProfile: salaryProfileFieldsSchema.optional(),
    commission: commissionSetupSchema.optional(),
    bankAccount: bankAccountSchema.optional(),
    // Doctors only — lets them authorize clinical discharge from the Admission portal.
    clinicalAuth: clinicalAuthCredentialSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.clinicalAuth && body.category !== 'Doctor') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Discharge credentials can only be set for Doctors', path: ['clinicalAuth'] });
    }
    if (body.category === 'Doctor') {
      if (!body.departmentIds || body.departmentIds.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Doctor requires at least one Clinical Department', path: ['departmentIds'] });
      }
      if (!body.serviceIds || body.serviceIds.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Doctor requires at least one Assigned Service', path: ['serviceIds'] });
      }
    }
    // PDF §9 — commission exists only for the "+ Commission" salary types, and
    // those types must have their commission set up separately.
    const commissionType = body.salaryProfile ? isCommissionBasis(body.salaryProfile.salaryBasis) : false;
    if (body.commission && !commissionType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Commission can only be set for Monthly + Commission or Daily + Commission salary types', path: ['commission'] });
    }
    if (commissionType && !body.commission) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'This salary type includes commission — set up the commission rules', path: ['commission'] });
    }
    if (body.commission) {
      const assigned = new Set(body.serviceIds ?? []);
      body.commission.rules.forEach((r, i) => {
        if (r.serviceRateId && !assigned.has(r.serviceRateId)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Commission can only be set on a service assigned to this staff member', path: ['commission', 'rules', i, 'serviceRateId'] });
        }
      });
    }
  });
export type CreateStaffBody = z.infer<typeof createStaffBodySchema>;

const updateStaffBaseSchema = z.object({
  fullName: z.string().min(1).max(150).optional(),
  fatherGuardianName: z.string().min(1).max(150).optional(),
  cnic: cnicSchema.optional(),
  dateOfBirth: z.coerce.date().optional(),
  category: z.enum(STAFF_CATEGORIES).optional(),
  phone: phoneSchema.optional(),
  departmentIds: uniqueUuidArray('department').optional(),
  serviceIds: uniqueUuidArray('service').optional(),
  designation: z.string().max(100).optional(),
  alternatePhone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  joiningDate: z.coerce.date().optional(),
  notes: z.string().optional(),
  assignedShiftId: z.string().uuid().nullable().optional(),
  doctorSponsoredDiscountTrackingEnabled: z.boolean().optional(),
  availableForOpd: z.boolean().optional(),
  availableForObservation: z.boolean().optional(),
  availableForEmergency: z.boolean().optional(),
  isActive: z.boolean().optional(),
  employmentStatus: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']).optional(),
});
export const updateStaffBodySchema = updateStaffBaseSchema.superRefine((body, ctx) => {
  if (body.category === 'Doctor') {
    if (body.departmentIds && body.departmentIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Doctor requires at least one Clinical Department', path: ['departmentIds'] });
    }
    if (body.serviceIds && body.serviceIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Doctor requires at least one Assigned Service', path: ['serviceIds'] });
    }
  }
});
export type UpdateStaffBody = z.infer<typeof updateStaffBodySchema>;

export const listStaffQuerySchema = paginationQuerySchema.extend({
  departmentId: z.string().uuid().optional(),
  category: z.string().optional(),
  employmentStatus: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']).optional(),
  search: z.string().optional(), // matches fullName / employeeId
});
export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;

export const staffIdParamsSchema = z.object({ id: z.string().uuid() });

export const deactivateStaffBodySchema = z
  .object({
    reason: z.string().optional(),
  })
  .optional()
  .default({});
export type DeactivateStaffBody = z.infer<typeof deactivateStaffBodySchema>;

// ── v7.2 Doctor Clinical Discharge Authorization (HMS_V7.2_NEW_REQUIREMENTS.md
// §2.4) — deliberately separate credential from portal login; a doctor may
// be "Staff Record Only" and still hold discharge authorization.
export const setClinicalAuthBodySchema = clinicalAuthCredentialSchema;
export type SetClinicalAuthBody = z.infer<typeof setClinicalAuthBodySchema>;

export const resetClinicalAuthPasswordBodySchema = z.object({
  password: z.string().min(8).max(100),
});
export type ResetClinicalAuthPasswordBody = z.infer<typeof resetClinicalAuthPasswordBodySchema>;

// ── Salary Profile (Doctor financial setup, HMS_V7.2_NEW_REQUIREMENTS.md §2.7) ──
// Creating a new profile automatically closes out the previous current one
// (effectiveTo = new effectiveFrom) — same effective-dated-history pattern
// as `StaffEmploymentHistory`/`DoctorCommissionRule`.
// SALARY_BASIS_VALUES and the field shape live with the wizard schemas above.
export const createSalaryProfileBodySchema = salaryProfileFieldsSchema;
export type CreateSalaryProfileBody = z.infer<typeof createSalaryProfileBodySchema>;

export const replaceWeeklyScheduleBodySchema = z.object({
  effectiveFrom: z.coerce.date(),
  days: weeklyScheduleSchema,
});
export type ReplaceWeeklyScheduleBody = z.infer<typeof replaceWeeklyScheduleBodySchema>;

export const createBankAccountBodySchema = bankAccountSchema;
export type CreateBankAccountBody = z.infer<typeof createBankAccountBodySchema>;
