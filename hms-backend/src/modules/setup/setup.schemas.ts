import { z } from 'zod';

export const idParamsSchema = z.object({ id: z.string().uuid() });

// ── Hospital Profile ──────────────────────────────────────────────────
// Mirrors the full Super Admin "Hospital Overview" screen (frontend
// `types/hospital.ts`). `setup.service.ts` splits this onto the handful of
// first-class `HospitalProfile` columns plus the `billingLegalMetadata` /
// `extendedProfile` JSON blobs and reassembles the same shape on read —
// every field here is genuinely persisted, none are computed/fabricated.
const dayWorkingHoursSchema = z.object({
  day: z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
  isOpen: z.boolean(),
  openTime: z.string(),
  closeTime: z.string(),
});

export const updateHospitalProfileSchema = z.object({
  name: z.string().max(200).optional(),
  shortName: z.string().max(50).optional(),
  logo: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  hospitalType: z.string().max(100).optional(),
  registrationNumber: z.string().max(100).optional(),
  licenseNumber: z.string().max(100).optional(),
  accreditationBody: z.string().max(150).optional(),
  accreditationNumber: z.string().max(100).optional(),
  status: z.enum(['Active', 'Inactive']).optional(),

  primaryPhone: z.string().max(30).optional(),
  alternatePhone: z.string().max(30).optional(),
  emergencyPhone: z.string().max(30).optional(),
  primaryEmail: z.string().email().optional().or(z.literal('')),
  secondaryEmail: z.string().email().optional().or(z.literal('')),
  website: z.string().max(200).optional(),

  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  province: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),

  currency: z.string().max(3).optional(),
  timezone: z.string().optional(),
  weekStartDay: z.string().optional(),
  workingMode: z.string().optional(),
  opdOpenTime: z.string().optional(),
  opdCloseTime: z.string().optional(),
  // Hospital-wide business-day boundary (HH:mm) — informational config that
  // tells Super Admin staff WHEN the day should be closed; the "Close Day"
  // action itself is a manual trigger, never gated by this time.
  dayCloseTime: z.string().optional(),
  emergencyEnabled: z.boolean().optional(),
  emergencyMode: z.enum(['24/7', 'Custom Hours', '']).optional(),
  dateFormat: z.string().optional(),
  timeFormat: z.string().optional(),
  workingHours: z.array(dayWorkingHoursSchema).optional(),

  legalBusinessName: z.string().max(200).optional(),
  taxNumber: z.string().max(100).optional(),
  salesTaxNumber: z.string().max(100).optional(),
  billingAddress: z.string().max(300).optional(),
  invoicePhone: z.string().max(30).optional(),
  invoiceEmail: z.string().email().optional().or(z.literal('')),
  invoicePrefix: z.string().max(20).optional(),
  receiptPrefix: z.string().max(20).optional(),

  printHeaderConfig: z.record(z.string(), z.unknown()).optional(),
  printFooterConfig: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateHospitalProfileBody = z.infer<typeof updateHospitalProfileSchema>;

// ── Departments ──────────────────────────────────────────────────────
export const createDepartmentSchema = z.object({
  // Optional: left blank, the backend auto-generates a unique code
  // (see `generateUniqueCode` in setup.service.ts). A manually entered
  // code is still accepted and normalized (trimmed + uppercased).
  code: z.string().max(20).optional(),
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  headStaffId: z.string().uuid().optional().nullable(),
  departmentType: z.enum([
    'CLINICAL',
    'SURGICAL',
    'DIAGNOSTIC',
    'EMERGENCY',
    'PHARMACY',
    'ADMINISTRATIVE',
    'SUPPORT_SERVICE',
    'OTHER',
  ]),
  contactExtension: z.string().max(20).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  floor: z.string().max(100).optional().nullable(),
  fixedPrice: z.coerce.number().nonnegative().optional().nullable(),
  supportsOpd: z.boolean().optional(),
  supportsObservation: z.boolean().optional(),
  supportsEmergency: z.boolean().optional(),
  supportsAdmission: z.boolean().optional(),
  pharmacyRelated: z.boolean().optional(),
  // v7.2 department billing config (HMS_V7.2_NEW_REQUIREMENTS.md §2.1) —
  // whether this department is fulfilled in-house or by a linked Outsourced
  // Provider. `outsourcedProviderId` is required when OUTSOURCED at the
  // service layer (not here, so the two fields can still be set in either order).
  fulfillmentOwnership: z.enum(['INTERNAL', 'OUTSOURCED']).optional(),
  outsourcedProviderId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});
export type CreateDepartmentBody = z.infer<typeof createDepartmentSchema>;
export const updateDepartmentSchema = createDepartmentSchema.partial();
export type UpdateDepartmentBody = z.infer<typeof updateDepartmentSchema>;

// ── Hospital Floors ───────────────────────────────────────────────────
export const createFloorSchema = z.object({
  floorNumber: z.coerce.number().int(),
  name: z.string().min(1).max(100),
  building: z.string().max(100).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});
export type CreateFloorBody = z.infer<typeof createFloorSchema>;
export const updateFloorSchema = createFloorSchema.partial();
export type UpdateFloorBody = z.infer<typeof updateFloorSchema>;

// ── Service Rates ────────────────────────────────────────────────────
export const listServiceRatesSchema = z.object({
  providerType: z.enum(['INTERNAL', 'OUTSOURCED']).default('INTERNAL'),
  departmentId: z.string().uuid().optional(),
  outsourcedProviderId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  activeOnly: z.enum(['true', 'false']).optional(),
  selectable: z.literal('true').optional(),
});
export const createServiceRateSchema = z.object({
  // Optional: auto-generated when left blank (see Departments note above).
  code: z.string().max(20).optional(),
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  category: z.string().optional(),
  billingUnit: z.string().min(1).max(30),
  standardRate: z.coerce.number().nonnegative(),
  panelEligible: z.boolean().optional(),
  discountAllowed: z.boolean().optional(),
  manualRateOverrideAllowed: z.boolean().optional(),
  isActive: z.boolean().optional(),
  encounterType: z.enum(['NONE', 'OPD', 'OBSERVATION', 'EMERGENCY']).optional(),
  isDefaultEncounterService: z.boolean().optional(),
  providerType: z.enum(['INTERNAL', 'OUTSOURCED']).optional(),
  serviceStream: z.enum(['HOSPITAL', 'LAB']).optional(),
});
export type CreateServiceRateBody = z.infer<typeof createServiceRateSchema>;
export const updateServiceRateSchema = createServiceRateSchema.partial();
export type UpdateServiceRateBody = z.infer<typeof updateServiceRateSchema>;

// ── Wards / Rooms / Beds ─────────────────────────────────────────────
export const createWardSchema = z.object({
  code: z.string().max(20).optional(),
  departmentId: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  wardType: z.string().optional(),
  genderPolicy: z.string().optional(),
  floor: z.string().max(50).optional(),
  location: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  headStaffId: z.string().uuid().optional().nullable(),
  fixedPrice: z.coerce.number().nonnegative().optional().nullable(),
  isActive: z.boolean().optional(),
});
export type CreateWardBody = z.infer<typeof createWardSchema>;
export const updateWardSchema = createWardSchema.partial();
export type UpdateWardBody = z.infer<typeof updateWardSchema>;

// Ward is optional on a Room — a Room may stand alone (Room -> Bed structure)
// or belong to a Ward (Ward -> Room -> Bed structure).
export const createRoomSchema = z.object({
  code: z.string().max(20).optional(),
  wardId: z.string().uuid().optional().nullable(),
  roomNumber: z.string().max(20).optional(),
  name: z.string().min(1).max(100),
  roomType: z.string().optional(),
  floor: z.string().max(50).optional(),
  capacity: z.coerce.number().int().nonnegative().optional(),
  dailyRoomRate: z.coerce.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
});
export type CreateRoomBody = z.infer<typeof createRoomSchema>;
export const updateRoomSchema = createRoomSchema.partial();
export type UpdateRoomBody = z.infer<typeof updateRoomSchema>;

// A Bed may be attached directly to a Ward (no Room), to a Room (which may or
// may not itself belong to a Ward), or to both — but never to neither.
export const createBedSchema = z
  .object({
    code: z.string().max(20).optional(),
    roomId: z.string().uuid().optional().nullable(),
    wardId: z.string().uuid().optional().nullable(),
    bedNumber: z.string().min(1).max(20),
    bedType: z.string().optional(),
    operationalStatus: z
      .enum(['ACTIVE', 'CLEANING', 'MAINTENANCE', 'OUT_OF_SERVICE', 'DECOMMISSIONED'])
      .optional(),
  })
  .refine((data) => Boolean(data.roomId) || Boolean(data.wardId), {
    message: 'A bed must be assigned to a Ward, a Room, or both — it cannot be left unassigned.',
    path: ['wardId'],
  });
export type CreateBedBody = z.infer<typeof createBedSchema>;
export const updateBedSchema = z.object({
  code: z.string().max(20).optional(),
  bedNumber: z.string().min(1).max(20).optional(),
  bedType: z.string().optional(),
  // AVAILABLE / RESERVED / OCCUPIED / OUT_OF_SERVICE ("Under Maintenance") — occupancy, owned by Admission workflow.
  status: z.enum(['AVAILABLE', 'RESERVED', 'OCCUPIED', 'OUT_OF_SERVICE']).optional(),
  // Orthogonal: whether the bed itself is fit for use right now.
  operationalStatus: z
    .enum(['ACTIVE', 'CLEANING', 'MAINTENANCE', 'OUT_OF_SERVICE', 'DECOMMISSIONED'])
    .optional(),
});
export type UpdateBedBody = z.infer<typeof updateBedSchema>;

// ── Corporate Panels ─────────────────────────────────────────────────
export const createCorporatePanelSchema = z.object({
  code: z.string().max(20).optional(),
  organizationName: z.string().min(1).max(200),
  category: z.string().trim().min(1).max(100).optional(),
  legalBillingName: z.string().trim().max(200).nullable().optional(),
  contactPhone: z.string().trim().max(50).nullable().optional(),
  contactEmail: z.string().email().or(z.literal('')).nullable().optional(),
  billingTerms: z.string().trim().max(1000).nullable().optional(),
  memberIdLabel: z.string().trim().max(100).nullable().optional(),
  memberIdRequired: z.boolean().optional(),
  membershipValidityRequired: z.boolean().optional(),
  authorizationRequired: z.boolean().optional(),
  discountAgreement: z.string().max(300).optional(),
  contact: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  creditLimit: z.coerce.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
});
export type CreateCorporatePanelBody = z.infer<typeof createCorporatePanelSchema>;
export const updateCorporatePanelSchema = createCorporatePanelSchema.partial();
export type UpdateCorporatePanelBody = z.infer<typeof updateCorporatePanelSchema>;

export const discountRuleSchema = z
  .object({
    scope: z.enum(['SERVICE', 'DEPARTMENT', 'GLOBAL']).default('SERVICE'),
    serviceRateId: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    coverageType: z
      .enum(['PERCENTAGE', 'FIXED_PATIENT_SHARE', 'FULL', 'NOT_COVERED', 'LEGACY_DISCOUNT'])
      .optional(),
    discountPercent: z.coerce.number().min(0).max(100).default(0),
    coveragePercent: z.coerce.number().min(0).max(100).multipleOf(0.01).nullable().optional(),
    fixedPatientShare: z.coerce.number().nonnegative().multipleOf(0.01).nullable().optional(),
    contractRate: z.coerce.number().nonnegative().multipleOf(0.01).nullable().optional(),
    capAmount: z.coerce.number().nonnegative().multipleOf(0.01).nullable().optional(),
    effectiveFrom: z.coerce.date().transform((d) => new Date(d.toISOString().slice(0, 10))),
    effectiveTo: z.coerce
      .date()
      .transform((d) => new Date(d.toISOString().slice(0, 10)))
      .nullable()
      .optional(),
    preauthorizationRequired: z.boolean().default(false),
    isActive: z.boolean().default(true),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((r, ctx) => {
    const error = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (r.scope === 'SERVICE' && (!r.serviceRateId || r.departmentId))
      error('serviceRateId', 'Service scope requires only a service');
    if (r.scope === 'DEPARTMENT' && (!r.departmentId || r.serviceRateId))
      error('departmentId', 'Department scope requires only a department');
    if (r.scope === 'GLOBAL' && (r.serviceRateId || r.departmentId))
      error('scope', 'Global scope cannot target a service or department');
    if (r.effectiveTo && r.effectiveTo < r.effectiveFrom)
      error('effectiveTo', 'End date must be on or after start date');
    const type = r.coverageType ?? (r.coveragePercent != null ? 'PERCENTAGE' : 'LEGACY_DISCOUNT');
    if (type === 'PERCENTAGE' && r.coveragePercent == null)
      error('coveragePercent', 'Coverage percentage is required');
    if (type === 'FIXED_PATIENT_SHARE' && r.fixedPatientShare == null)
      error('fixedPatientShare', 'Fixed patient share is required');
    if (type === 'LEGACY_DISCOUNT' && r.contractRate != null)
      error('contractRate', 'Legacy discount cannot also set a contract tariff');
    if (type !== 'LEGACY_DISCOUNT' && r.discountPercent !== 0)
      error('discountPercent', 'Use contract tariff for coverage adjustments, not legacy discount');
    if (r.contractRate != null && r.scope !== 'SERVICE')
      error('contractRate', 'A unit tariff must target a specific service');
  });
export const replaceDiscountRulesSchema = z
  .object({ rules: z.array(discountRuleSchema).max(500) })
  .superRefine(({ rules }, ctx) => {
    rules.forEach((r, i) => {
      if (!r.isActive) return;
      const overlapping = rules
        .slice(0, i)
        .some(
          (other) =>
            other.isActive &&
            other.scope === r.scope &&
            (other.serviceRateId ?? null) === (r.serviceRateId ?? null) &&
            (other.departmentId ?? null) === (r.departmentId ?? null) &&
            (!other.effectiveTo || r.effectiveFrom <= other.effectiveTo) &&
            (!r.effectiveTo || other.effectiveFrom <= r.effectiveTo),
        );
      if (overlapping)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules', i, 'effectiveFrom'],
          message: 'Active rules for the same target cannot have overlapping dates',
        });
    });
  });
export type ReplaceDiscountRulesBody = z.infer<typeof replaceDiscountRulesSchema>;

// ── Shifts (Shift Master) ────────────────────────────────────────────
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeSchema = z.string().regex(TIME_REGEX, 'Time must be in HH:mm 24-hour format');
export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

// ── Outsourced Providers (HMS_V7.2_NEW_REQUIREMENTS.md §2.1) ────────────
export const createOutsourcedProviderSchema = z.object({
  code: z.string().max(20).optional(),
  name: z.string().min(1).max(200),
  representativeName: z.string().max(150).optional(),
  representativeDesignation: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().max(300).optional(),
  paymentTermsNotes: z.string().max(1000).optional(),
  settlementCycle: z.string().max(50).optional(),
  allowedPaymentMethods: z.array(z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE'])).optional(),
  bankName: z.string().max(150).optional(),
  bankAccountTitle: z.string().max(150).optional(),
  bankAccountNumber: z.string().max(50).optional(),
  chequePayeeName: z.string().max(150).optional(),
  withholdingTaxPercent: z.coerce.number().min(0).max(100).optional(),
  withholdingEffectiveFrom: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
});
export type CreateOutsourcedProviderBody = z.infer<typeof createOutsourcedProviderSchema>;
export const updateOutsourcedProviderSchema = createOutsourcedProviderSchema.partial();
export type UpdateOutsourcedProviderBody = z.infer<typeof updateOutsourcedProviderSchema>;

// ── High-Cost Medicine Policy (HMS_V7.2_NEW_REQUIREMENTS.md §2.6) ───────
// Singleton config, same pattern as Hospital Profile — GET auto-creates
// defaults, PUT patches whichever fields are supplied.
export const updateHighCostMedicinePolicySchema = z.object({
  enabled: z.boolean().optional(),
  thresholdAmount: z.coerce.number().nonnegative().optional(),
  thresholdBasis: z.enum(['LINE_TOTAL', 'PER_UNIT']).optional(),
  attendantConfirmationRequired: z.boolean().optional(),
  managementApprovalRequired: z.boolean().optional(),
  combinedLogic: z.enum(['ATTENDANT_ONLY', 'MANAGEMENT_ONLY', 'EITHER', 'BOTH']).optional(),
  panelPreauthRequired: z.boolean().optional(),
});
export type UpdateHighCostMedicinePolicyBody = z.infer<typeof updateHighCostMedicinePolicySchema>;

// ── Provider Settlements (HMS_V7.2_NEW_REQUIREMENTS.md §2.8) ────────────
// `eligibleRealizedAmount` is recorded by the settling user for now — the
// Front Desk department sub-invoice split (§2.2) that would compute it
// automatically from realized collections is future/out-of-phase work; see
// the doc's Phase A/B split and this schema's service-layer validation.
export const createProviderSettlementSchema = z.object({
  outsourcedProviderId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  periodLabel: z.string().max(100).optional(),
  eligibleRealizedAmount: z.coerce.number().positive(),
  settlementAmount: z.coerce.number().positive(),
  status: z.enum(['FULL', 'PARTIAL']),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE']),
  paymentReference: z.string().max(100).optional(),
  representativeName: z.string().max(150).optional(),
  representativeDesignation: z.string().max(100).optional(),
  remarks: z.string().max(1000).optional(),
});
export type CreateProviderSettlementBody = z.infer<typeof createProviderSettlementSchema>;

export const listProviderSettlementsQuerySchema = z.object({
  outsourcedProviderId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});
export type ListProviderSettlementsQuery = z.infer<typeof listProviderSettlementsQuerySchema>;

export const createShiftSchema = z.object({
  // Optional: auto-generated when left blank (see Departments note above).
  code: z.string().max(20).optional(),
  name: z.string().min(1).max(100),
  departmentId: z.string().uuid().nullable().optional(),
  shiftType: z.enum(['MORNING', 'EVENING', 'NIGHT', 'CUSTOM']).default('CUSTOM'),
  startTime: timeSchema,
  endTime: timeSchema,
  breakMinutes: z.coerce.number().int().min(0).default(0),
  defaultArrivalGraceMinutes: z.coerce.number().int().min(0).default(0),
  defaultEarlyExitToleranceMinutes: z.coerce.number().int().min(0).default(0),
  defaultWeeklyOffDays: z.array(z.enum(WEEKDAYS)).default([]),
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
});
export type CreateShiftBody = z.infer<typeof createShiftSchema>;
export const updateShiftSchema = createShiftSchema.partial();
export type UpdateShiftBody = z.infer<typeof updateShiftSchema>;
