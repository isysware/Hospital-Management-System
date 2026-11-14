import { prisma } from '@/db/client';
import { z } from 'zod';
import { Router } from 'express';
import { authorize } from '@/middleware/authorize';
import { validate } from '@/middleware/validate';
import { asyncHandler } from '@/shared/asyncHandler';
import { vendorsController as c } from './vendors.controller';
import * as s from './vendors.schemas';

const router = Router();
const view = authorize('vendors', 'view');
const create = authorize('vendors', 'create');
const edit = authorize('vendors', 'edit');

router.get('/payment-accounts', view, asyncHandler(async (_req, res) => {
  const accounts = await prisma.paymentAccount.findMany({ include: { entries: { select: { direction: true, amount: true } } }, orderBy: { name: 'asc' } });
  res.json({ data: accounts.map(({ entries, ...account }) => ({ ...account, netMovement: entries.reduce((sum, entry) => sum + (entry.direction === 'IN' ? Number(entry.amount) : -Number(entry.amount)), 0) })) });
}));
router.post('/payment-accounts', create, validate({ body: z.object({ name: z.string().trim().min(2).max(100) }) }), asyncHandler(async (req, res) => {
  const account = await prisma.paymentAccount.create({ data: { name: req.body.name } });
  res.status(201).json({ data: account });
}));
router.post('/', create, validate({ body: s.createVendorBodySchema }), asyncHandler(c.create));
router.get('/', view, asyncHandler(c.list));
router.get('/next-code', create, asyncHandler(c.nextCode));
router.patch('/:id', edit, validate({ params: s.idParamsSchema, body: s.updateVendorBodySchema }), asyncHandler(c.update));
router.get('/:id/ledger', view, validate({ params: s.idParamsSchema }), asyncHandler(c.getLedger));
router.post('/:id/pay', create, validate({ params: s.idParamsSchema, body: s.payVendorBodySchema }), asyncHandler(c.payVendor));
router.get('/purchases/next-code', create, asyncHandler(c.nextPurchaseCode));
router.post('/purchases', create, validate({ body: s.createPurchaseBodySchema }), asyncHandler(c.createPurchase));
router.post('/purchases/:id/post', edit, validate({ params: s.idParamsSchema }), asyncHandler(c.postPurchase));
router.post('/purchase-returns', create, validate({ body: s.purchaseReturnBodySchema }), asyncHandler(c.purchaseReturn));

export default router;
