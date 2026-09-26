import { z } from 'zod';

export const admissionIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createPlannedAdmissionSchema = z.object({
  panelPatientId: z.string().uuid().optional(),
  selfPayEncounterId: z.string().uuid().optional(),
  newSelfPayPatient: z
    .object({
      fullName: z.string().min(1).max(150),
      guardianName: z.string().max(150).optional(),
      gender: z.string().optional(),
      dob: z.coerce.date().optional(),
      cnicOrPassport: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  // Optional — Front Desk may admit against a standalone Room/Bed with no
  // department context yet; the service falls back to the ward's department
  // (when a ward/bed resolves one) or the first active department otherwise.
  departmentId: z.string().uuid().optional(),
  // Optional at planning time — Front Desk may not always know the attending doctor yet; the
  // Admission Portal can assign/change one later via `updatePlannedAdmissionSchema`.
  doctorStaffId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
  preferredBedId: z.string().uuid().optional(),
  expectedAt: z.coerce.date().optional(),
  diagnosis: z.string().optional(),
  weightKg: z.coerce.number().positive().max(999).optional(),
  estimatedAmount: z.coerce.number().nonnegative().optional(),
  outsourcedFulfillmentMode: z.enum(['HOSPITAL_MANAGED', 'SELF']).default('HOSPITAL_MANAGED'),
  medicationMode: z.enum(['SELF', 'HOSPITAL_MANAGED']).default('HOSPITAL_MANAGED'),
  notes: z.string().optional(),
  // v7.2 §"Admission from Front Desk" step 6 — optional advance collected
  // at creation time, before any department invoice exists (§2.2). Same
  // shape as `appointments.schemas.ts`'s `bookAppointmentSchema`.
  advanceAmount: z.coerce.number().nonnegative().optional(),
  paymentMethod: z.enum(['CASH', 'CARD', 'BANK', 'ONLINE']).optional().default('CASH'),
  paymentReference: z.string().optional(),
  // Case authorization/guarantee (panel.md §15 backlog item 2) — required
  // up front when the panel company's authorizationRequired policy is on;
  // re-checked against every ward/room/procedure charge posted afterward.
  authorizationNumber: z.string().trim().max(100).optional(),
  authorizationLimit: z.coerce.number().nonnegative().optional(),
  authorizationValidUntil: z.coerce.date().optional(),
}).refine(
  (data) => data.panelPatientId || data.selfPayEncounterId || data.newSelfPayPatient,
  { message: 'Either panelPatientId, selfPayEncounterId, or newSelfPayPatient is required' },
);

export type CreatePlannedAdmissionBody = z.infer<typeof createPlannedAdmissionSchema>;

export const updatePlannedAdmissionSchema = z.object({
  departmentId: z.string().uuid().optional(),
  doctorStaffId: z.string().uuid().optional(),
  expectedAt: z.coerce.date().optional(),
  diagnosis: z.string().optional(),
  estimatedAmount: z.coerce.number().nonnegative().optional(),
  notes: z.string().optional(),
  // Lets Front Desk/Admission capture or renew a case authorization that
  // wasn't available at intake, or extend one before it expires mid-stay.
  authorizationNumber: z.string().trim().max(100).optional(),
  authorizationLimit: z.coerce.number().nonnegative().optional(),
  authorizationValidUntil: z.coerce.date().optional(),
});

export type UpdatePlannedAdmissionBody = z.infer<typeof updatePlannedAdmissionSchema>;

export const checkInAdmissionSchema = z.object({
  transferReason: z.string().trim().min(1).optional(),
  bedId: z.string().uuid(),
  notes: z.string().optional(),
});

export type CheckInAdmissionBody = z.infer<typeof checkInAdmissionSchema>;

export const requestPaymentSchema = z.object({
  requestType: z.enum(['ADVANCE', 'PARTIAL', 'FINAL']).default('ADVANCE'),
  requestedAmount: z.coerce.number().positive('Requested amount must be greater than zero'),
  notes: z.string().optional(),
});

export type RequestPaymentBody = z.infer<typeof requestPaymentSchema>;

export const transferBedSchema = z.object({
  targetBedId: z.string().uuid(),
  reason: z.string().trim().min(1, 'Reason for bed transfer is required'),
});

export type TransferBedBody = z.infer<typeof transferBedSchema>;

export const addAdmissionServiceSchema = z.object({
  serviceRateId: z.string().uuid(),
  quantity: z.coerce.number().positive().default(1),
  notes: z.string().optional(),
  performedByStaffId: z.string().uuid().optional(),
  arrangementMode: z.enum(['HOSPITAL_MANAGED', 'SELF']).default('HOSPITAL_MANAGED').optional(),
});

export type AddAdmissionServiceBody = z.infer<typeof addAdmissionServiceSchema>;

export const changeMedicationModeSchema = z.object({
  mode: z.enum(['SELF', 'HOSPITAL_MANAGED']),
  reason: z.string().min(1, 'Reason for medication mode change is required'),
});

export type ChangeMedicationModeBody = z.infer<typeof changeMedicationModeSchema>;

export const createPharmacyRequestSchema = z.object({
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        medicineId: z.string().uuid(),
        requestedQuantity: z.coerce.number().positive('Quantity must be greater than zero'),
        notes: z.string().optional(),
      }),
    )
    .min(1, 'At least one medicine item must be requested'),
});

export type CreatePharmacyRequestBody = z.infer<typeof createPharmacyRequestSchema>;

export const grantClearanceSchema = z.object({
  clearanceType: z.enum(['CLINICAL', 'HOSPITAL_BILLING', 'PHARMACY']),
  notes: z.string().optional(),
});

export type GrantClearanceBody = z.infer<typeof grantClearanceSchema>;

// v7.2 §2.4 — Doctor Clinical Discharge Authorization + Discharge Summary.
export const clinicalDischargeSchema = z.object({
  doctorUsername: z.string().min(1, 'Doctor username is required'),
  doctorPassword: z.string().min(1, 'Doctor password is required'),
  dischargeSummary: z.object({
    finalDiagnosis: z.string().min(1, 'Final diagnosis is required'),
    treatmentSummary: z.string().min(1, 'Treatment / procedures summary is required'),
    conditionAtDischarge: z.string().min(1, 'Condition at discharge is required'),
    medicinesInstructions: z.string().min(1, 'Medicines / instructions is required'),
    followUpAdvice: z.string().optional(),
    followUpDoctorStaffId: z.string().uuid().optional(),
    followUpDate: z.coerce.date().optional(),
    additionalNotes: z.string().optional(),
  }),
});

export type ClinicalDischargeBody = z.infer<typeof clinicalDischargeSchema>;

/** Discharge popup step 1 — check the doctor credential and show who it belongs to. */
export const verifyDischargeDoctorSchema = z.object({
  doctorUsername: z.string().min(1, 'Doctor username is required'),
  doctorPassword: z.string().min(1, 'Doctor password is required'),
});

// v7.2 §2.6 — High-Cost Medicine Authorization.
export const pharmacyClearanceIdParamsSchema = z.object({
  id: z.string().uuid(),
  clearanceId: z.string().uuid(),
});

export const authorizeHighCostMedicineSchema = z.object({
  attendantName: z.string().optional(),
  attendantRelation: z.string().optional(),
  attendantContact: z.string().optional(),
  attendantConfirmed: z.boolean().optional(),
  managementUsername: z.string().optional(),
  managementPassword: z.string().optional(),
  managementReason: z.string().optional(),
  panelAuthorizationRef: z.string().optional(),
});

export type AuthorizeHighCostMedicineBody = z.infer<typeof authorizeHighCostMedicineSchema>;

export const rejectHighCostMedicineSchema = z.object({
  reason: z.string().min(1, 'A reason is required to reject a high-cost medicine request'),
});

export type RejectHighCostMedicineBody = z.infer<typeof rejectHighCostMedicineSchema>;

export const listAdmissionsQuerySchema = z.object({
  status: z
    .enum(['PLANNED', 'CONFIRMED', 'ACTIVE', 'DISCHARGE_PENDING', 'DISCHARGED', 'CANCELLED'])
    .optional(),
  departmentId: z.string().uuid().optional(),
  doctorStaffId: z.string().uuid().optional(),
  search: z.string().optional(),
});

export type ListAdmissionsQuery = z.infer<typeof listAdmissionsQuerySchema>;

// Super Admin "Close Day" action (Hospital Overview) — posts one room/bed
// accommodation charge per ACTIVE, bed-assigned admission for this date.
// `businessDate` defaults to the server's current date when omitted.
export const closeHospitalDaySchema = z.object({
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'businessDate must be in YYYY-MM-DD format')
    .optional(),
});

export type CloseHospitalDayBody = z.infer<typeof closeHospitalDaySchema>;
