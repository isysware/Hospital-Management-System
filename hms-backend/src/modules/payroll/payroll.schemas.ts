import { z } from 'zod';
import { paginationQuerySchema } from '@/shared/pagination';

export const PAYROLL_PERIOD_TYPES = ['DAILY', 'MONTHLY', 'CUSTOM'] as const;

export const payrollRunFiltersSchema = z.object({
  periodType: z.enum(PAYROLL_PERIOD_TYPES),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  departmentId: z.string().uuid().optional(),
  category: z.string().optional(),
}).refine((v) => v.periodEnd >= v.periodStart, { message: 'periodEnd must be on or after periodStart', path: ['periodEnd'] });
export type PayrollRunFilters = z.infer<typeof payrollRunFiltersSchema>;

export const listPayrollRunsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['GENERATED', 'APPROVED']).optional(),
});
export type ListPayrollRunsQuery = z.infer<typeof listPayrollRunsQuerySchema>;

export const payrollRunIdParamsSchema = z.object({ id: z.string().uuid() });
export const salarySlipIdParamsSchema = z.object({ id: z.string().uuid() });

export const paySalarySlipBodySchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(['CASH', 'CARD', 'BANK', 'ONLINE']),
  reference: z.string().max(200).optional(),
});
export type PaySalarySlipBody = z.infer<typeof paySalarySlipBodySchema>;

export const listSalarySlipsQuerySchema = paginationQuerySchema.extend({
  staffId: z.string().uuid().optional(),
  status: z.string().optional(),
  payrollRunId: z.string().uuid().optional(),
});
export type ListSalarySlipsQuery = z.infer<typeof listSalarySlipsQuerySchema>;
