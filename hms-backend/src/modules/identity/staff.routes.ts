import { Router } from 'express';
import { authorize } from '@/middleware/authorize';
import { validate } from '@/middleware/validate';
import { asyncHandler } from '@/shared/asyncHandler';
import { staffController } from './staff.controller';
import {
  createStaffBodySchema,
  updateStaffBodySchema,
  listStaffQuerySchema,
  staffIdParamsSchema,
  deactivateStaffBodySchema,
  setClinicalAuthBodySchema,
  resetClinicalAuthPasswordBodySchema,
  createSalaryProfileBodySchema,
  replaceWeeklyScheduleBodySchema,
  createBankAccountBodySchema,
  commissionSetupSchema,
} from './staff.schemas';

/** §4.1, §8.3 — mounted at `/api/v1/staff`. SUPER_ADMIN / ADMIN only. */
const router = Router();

router.get('/', authorize('identity', 'view'), validate({ query: listStaffQuerySchema }), asyncHandler(staffController.list));
router.post('/', authorize('identity', 'create'), validate({ body: createStaffBodySchema }), asyncHandler(staffController.create));
router.get('/:id', authorize('identity', 'view'), validate({ params: staffIdParamsSchema }), asyncHandler(staffController.getById));
router.get(
  '/:id/360',
  authorize('identity', 'view'),
  validate({ params: staffIdParamsSchema }),
  asyncHandler(staffController.getFullProfile),
);
router.patch(
  '/:id',
  authorize('identity', 'edit'),
  validate({ params: staffIdParamsSchema, body: updateStaffBodySchema }),
  asyncHandler(staffController.update),
);
router.post(
  '/:id/deactivate',
  authorize('identity', 'delete'),
  validate({ params: staffIdParamsSchema, body: deactivateStaffBodySchema }),
  asyncHandler(staffController.deactivate),
);
router.delete(
  '/:id',
  authorize('identity', 'delete'),
  validate({ params: staffIdParamsSchema }),
  asyncHandler(staffController.delete),
);

// v7.2 Doctor Clinical Discharge Authorization (HMS_V7.2_NEW_REQUIREMENTS.md §2.4)
router.post(
  '/:id/clinical-auth',
  authorize('identity', 'edit'),
  validate({ params: staffIdParamsSchema, body: setClinicalAuthBodySchema }),
  asyncHandler(staffController.setClinicalAuth),
);
router.post(
  '/:id/clinical-auth/reset-password',
  authorize('identity', 'edit'),
  validate({ params: staffIdParamsSchema, body: resetClinicalAuthPasswordBodySchema }),
  asyncHandler(staffController.resetClinicalAuthPassword),
);
router.post(
  '/:id/clinical-auth/activate',
  authorize('identity', 'edit'),
  validate({ params: staffIdParamsSchema }),
  asyncHandler(staffController.activateClinicalAuth),
);
router.post(
  '/:id/clinical-auth/deactivate',
  authorize('identity', 'edit'),
  validate({ params: staffIdParamsSchema }),
  asyncHandler(staffController.deactivateClinicalAuth),
);

// v7.2 Salary Profile (HMS_V7.2_NEW_REQUIREMENTS.md §2.7)
router.post(
  '/:id/salary-profile',
  authorize('identity', 'edit'),
  validate({ params: staffIdParamsSchema, body: createSalaryProfileBodySchema }),
  asyncHandler(staffController.createSalaryProfile),
);

// Staff Add Wizard steps 6 and 9 when editing an existing staff member.
router.put(
  '/:id/weekly-schedule',
  authorize('identity', 'edit'),
  validate({ params: staffIdParamsSchema, body: replaceWeeklyScheduleBodySchema }),
  asyncHandler(staffController.replaceWeeklySchedule),
);
router.put(
  '/:id/commission',
  authorize('identity', 'edit'),
  validate({ params: staffIdParamsSchema, body: commissionSetupSchema }),
  asyncHandler(staffController.replaceCommissionSetup),
);
router.post(
  '/:id/bank-account',
  authorize('identity', 'edit'),
  validate({ params: staffIdParamsSchema, body: createBankAccountBodySchema }),
  asyncHandler(staffController.createBankAccount),
);

export default router;
