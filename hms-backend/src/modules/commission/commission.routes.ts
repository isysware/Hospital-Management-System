import { Router } from 'express';
import { authorize } from '@/middleware/authorize';
import { validate } from '@/middleware/validate';
import { asyncHandler } from '@/shared/asyncHandler';
import { commissionController as c } from './commission.controller';
import * as s from './commission.schemas';

const router = Router();
const view = authorize('commission', 'view');
const create = authorize('commission', 'create');
const approve = authorize('commission', 'approve');

router.get(
  '/rules',
  view,
  validate({ query: s.listCommissionRulesQuerySchema }),
  asyncHandler(c.listRules),
);

router.post(
  '/rules',
  create,
  validate({ body: s.createCommissionRuleSchema }),
  asyncHandler(c.createRule),
);

router.get(
  '/accruals',
  view,
  validate({ query: s.listAccrualsQuerySchema }),
  asyncHandler(c.listAccruals),
);

router.post(
  '/accruals/:id/approve',
  approve,
  validate({ params: s.accrualIdParamsSchema }),
  asyncHandler(c.approveAccrual),
);

router.post(
  '/accruals/:id/pay',
  create,
  validate({ params: s.accrualIdParamsSchema, body: s.payAccrualBodySchema }),
  asyncHandler(c.payAccrual),
);

export default router;
