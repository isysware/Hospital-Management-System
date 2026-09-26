import { Router } from 'express';
import { authorize } from '@/middleware/authorize';
import { validate } from '@/middleware/validate';
import { asyncHandler } from '@/shared/asyncHandler';
import { payrollController as c } from './payroll.controller';
import * as s from './payroll.schemas';

/**
 * Payroll Run — Daily/Monthly/Custom, attendance-driven (staff.md §19).
 * Mounted at `/api/v1/payroll`. Generation reads only APPROVED attendance
 * and each staff member's current Salary Profile; nothing here ever
 * fabricates a figure that doesn't trace to those two sources.
 */
const router = Router();
const view = authorize('payroll', 'view');
const create = authorize('payroll', 'create');
const approve = authorize('payroll', 'approve');

router.post('/preview', view, validate({ body: s.payrollRunFiltersSchema }), asyncHandler(c.preview));
router.post('/runs', create, validate({ body: s.payrollRunFiltersSchema }), asyncHandler(c.generate));
router.get('/runs', view, validate({ query: s.listPayrollRunsQuerySchema }), asyncHandler(c.list));
router.get('/runs/:id', view, validate({ params: s.payrollRunIdParamsSchema }), asyncHandler(c.getById));
router.post('/runs/:id/approve', approve, validate({ params: s.payrollRunIdParamsSchema }), asyncHandler(c.approve));

router.get('/slips', view, validate({ query: s.listSalarySlipsQuerySchema }), asyncHandler(c.listSlips));
router.post('/slips/:id/pay', create, validate({ params: s.salarySlipIdParamsSchema, body: s.paySalarySlipBodySchema }), asyncHandler(c.paySlip));

export default router;
