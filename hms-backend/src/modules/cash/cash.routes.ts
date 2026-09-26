import { Router } from 'express';
import { authorize } from '@/middleware/authorize';
import { validate } from '@/middleware/validate';
import { asyncHandler } from '@/shared/asyncHandler';
import { cashController as c } from './cash.controller';
import { submitSettlementSchema } from './settlement.schemas';
import {
  listBalanceSheetsQuerySchema,
  listSettlementsQuerySchema,
  myBalanceSheetQuerySchema,
  mySettlementsQuerySchema,
  financeKpisQuerySchema,
  settlementIdParamsSchema,
  reviewSettlementBodySchema,
  reverseSettlementBodySchema,
} from './financeControl.schemas';

const router = Router();
const view = authorize('cash', 'view');
const create = authorize('cash', 'create');
const approve = authorize('cash', 'approve');

// Cashier's own balance sheet (§8.12)
router.get('/balance-sheet', view, validate({ query: myBalanceSheetQuerySchema }), asyncHandler(c.getMyBalanceSheet));
router.get('/balance-sheet/:userId', view, asyncHandler(c.getUserBalanceSheet));

// My Account Settlement (§3.3) — closes out every currently-unsettled
// balance-sheet row into one settlement record.
router.get('/settlements', view, validate({ query: mySettlementsQuerySchema }), asyncHandler(c.listMySettlements));
router.post('/settlements', create, validate({ body: submitSettlementSchema }), asyncHandler(c.submitMySettlement));

// Finance Control — Admin / Super Admin oversight (Balance Sheet & Account
// Settlement Guide §6). `approve` gates review/reversal so only roles with
// full `cash` access (ADMIN, SUPER_ADMIN — see `authorize.ts`) can act on
// another user's settlement; FRONT_DESK_BILLING/INVENTORY_MANAGEMENT only
// hold `view`/`create` and are naturally excluded.
router.get('/finance-control/balance-sheets', view, validate({ query: listBalanceSheetsQuerySchema }), asyncHandler(c.listBalanceSheets));
router.get('/finance-control/settlements', view, validate({ query: listSettlementsQuerySchema }), asyncHandler(c.listAllSettlements));
router.get('/finance-control/kpis', view, validate({ query: financeKpisQuerySchema }), asyncHandler(c.getFinanceKpis));
router.post(
  '/finance-control/settlements/:id/review',
  approve,
  validate({ params: settlementIdParamsSchema, body: reviewSettlementBodySchema }),
  asyncHandler(c.reviewSettlement),
);
router.post(
  '/finance-control/settlements/:id/reverse',
  approve,
  validate({ params: settlementIdParamsSchema, body: reverseSettlementBodySchema }),
  asyncHandler(c.reverseSettlement),
);

export default router;
