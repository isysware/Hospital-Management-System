import { z } from 'zod';
import { paginationQuerySchema } from '@/shared/pagination';

export const ATTENDANCE_STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT', 'PAID_LEAVE', 'UNPAID_LEAVE'] as const;

const timeOfDay = z.coerce.date().optional();

/** staff.md §8/§11 — a single day's manual mark for one staff member. Upsert by (staffId, attendanceDate). */
export const markAttendanceBodySchema = z.object({
  staffId: z.string().uuid(),
  attendanceDate: z.coerce.date(),
  status: z.enum(ATTENDANCE_STATUSES),
  actualIn: timeOfDay,
  actualOut: timeOfDay,
  notes: z.string().max(500).optional(),
});
export type MarkAttendanceBody = z.infer<typeof markAttendanceBodySchema>;

/** Marking a whole day's roster at once — the real Front Desk/HR workflow. */
export const bulkMarkAttendanceBodySchema = z.object({
  attendanceDate: z.coerce.date(),
  records: z
    .array(
      z.object({
        staffId: z.string().uuid(),
        status: z.enum(ATTENDANCE_STATUSES),
        actualIn: timeOfDay,
        actualOut: timeOfDay,
        notes: z.string().max(500).optional(),
      }),
    )
    .min(1),
});
export type BulkMarkAttendanceBody = z.infer<typeof bulkMarkAttendanceBodySchema>;

export const rosterQuerySchema = z.object({
  date: z.coerce.date(),
  departmentId: z.string().uuid().optional(),
  category: z.string().optional(),
});
export type RosterQuery = z.infer<typeof rosterQuerySchema>;

export const listAttendanceQuerySchema = paginationQuerySchema.extend({
  staffId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  isApproved: z.coerce.boolean().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
export type ListAttendanceQuery = z.infer<typeof listAttendanceQuerySchema>;

export const summaryQuerySchema = z.object({
  staffId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;

export const attendanceIdParamsSchema = z.object({ id: z.string().uuid() });

export const approveAttendanceBodySchema = z
  .object({ reason: z.string().max(500).optional() })
  .optional()
  .default({});
export type ApproveAttendanceBody = z.infer<typeof approveAttendanceBodySchema>;

/** Post-approval edit — always requires a reason, always logged (D16 p.19/p.33, never silent). */
export const correctAttendanceBodySchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  actualIn: timeOfDay,
  actualOut: timeOfDay,
  notes: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
});
export type CorrectAttendanceBody = z.infer<typeof correctAttendanceBodySchema>;
