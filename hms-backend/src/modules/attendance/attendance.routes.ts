import { Router } from 'express';
import { authorize } from '@/middleware/authorize';
import { validate } from '@/middleware/validate';
import { asyncHandler } from '@/shared/asyncHandler';
import { attendanceController as c } from './attendance.controller';
import * as s from './attendance.schemas';

/**
 * Attendance — manual marking today (staff.md §11); the same table/routes
 * take tomorrow's biometric device sync without a redesign (`source =
 * DEVICE`, `BiometricRawPunch` already modeled). Mounted at `/api/v1/attendance`.
 */
const router = Router();
const view = authorize('attendance', 'view');
const create = authorize('attendance', 'create');
const edit = authorize('attendance', 'edit');
const approve = authorize('attendance', 'approve');

router.get('/roster', view, validate({ query: s.rosterQuerySchema }), asyncHandler(c.getRoster));
router.get('/summary', view, validate({ query: s.summaryQuerySchema }), asyncHandler(c.getSummary));
router.get('/', view, validate({ query: s.listAttendanceQuerySchema }), asyncHandler(c.list));
router.post('/mark', create, validate({ body: s.markAttendanceBodySchema }), asyncHandler(c.mark));
router.post('/bulk-mark', create, validate({ body: s.bulkMarkAttendanceBodySchema }), asyncHandler(c.bulkMark));
router.get('/:id', view, validate({ params: s.attendanceIdParamsSchema }), asyncHandler(c.getById));
router.post('/:id/approve', approve, validate({ params: s.attendanceIdParamsSchema, body: s.approveAttendanceBodySchema }), asyncHandler(c.approve));
router.post('/:id/correct', edit, validate({ params: s.attendanceIdParamsSchema, body: s.correctAttendanceBodySchema }), asyncHandler(c.correct));

export default router;
