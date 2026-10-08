import { z } from 'zod';

export const appointmentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const bookAppointmentSchema = z.object({
  panelPatientId: z.string().uuid().optional(),
  selfPayEncounterId: z.string().uuid().optional(),
  // Inline self-pay creation helper if ID not yet known
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
  departmentId: z.string().uuid(),
  doctorStaffId: z.string().uuid().optional(),
  serviceRateId: z.string().uuid().optional(),
  slotAt: z.coerce.date(),
  estimatedAmount: z.coerce.number().nonnegative().optional(),
  advanceAmount: z.coerce.number().nonnegative().optional(),
  paymentMethod: z.enum(['CASH', 'CARD', 'BANK', 'ONLINE']).optional().default('CASH'),
  paymentReference: z.string().optional(),
  notes: z.string().optional(),
}).refine(
  (data) => data.panelPatientId || data.selfPayEncounterId || data.newSelfPayPatient,
  { message: 'Either panelPatientId, selfPayEncounterId, or newSelfPayPatient is required' },
);

export type BookAppointmentBody = z.infer<typeof bookAppointmentSchema>;

export const listAppointmentsQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
  doctorStaffId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  status: z
    .enum(['DRAFT', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'RESCHEDULED', 'CANCELLED', 'NO_SHOW'])
    .optional(),
  search: z.string().optional(),
});

export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

export const updateAppointmentSchema = z.object({
  slotAt: z.coerce.date().optional(),
  doctorStaffId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().optional(),
  serviceRateId: z.string().uuid().optional(),
  estimatedAmount: z.coerce.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export type UpdateAppointmentBody = z.infer<typeof updateAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
  reason: z.string().min(1, 'Cancellation reason is required'),
});

export type CancelAppointmentBody = z.infer<typeof cancelAppointmentSchema>;

export const collectAdvanceSchema = z.object({
  amount: z.coerce.number().positive('Advance amount must be greater than zero'),
  paymentMethod: z.enum(['CASH', 'CARD', 'BANK', 'ONLINE']).default('CASH'),
  reference: z.string().optional(),
});

export type CollectAdvanceBody = z.infer<typeof collectAdvanceSchema>;

export const checkInAppointmentSchema = z.object({
  encounterType: z.enum(['OPD', 'OBSERVATION', 'EMERGENCY']).optional().default('OPD'),
  notes: z.string().optional(),
});

export type CheckInAppointmentBody = z.infer<typeof checkInAppointmentSchema>;
