import { doctorCharges, doctorChargeSchema } from '@/shared/doctorCharges';
import { Router } from 'express';
import { authorize } from '@/middleware/authorize';
import { validate } from '@/middleware/validate';
import { asyncHandler } from '@/shared/asyncHandler';
import { invoicesController as c } from './invoices.controller';
import * as s from './invoices.schemas';

// Encounter Router (§8.7)
export const encountersRouter = Router();
const encView = authorize('frontdesk', 'view');
const encCreate = authorize('frontdesk', 'create');
const encWrite = authorize('frontdesk', 'edit');

encountersRouter.post(
  '/',
  encCreate,
  validate({ body: s.createEncounterSchema }),
  asyncHandler(c.createEncounter),
);

encountersRouter.post(
  '/:id/services',
  encWrite,
  validate({ params: s.encounterIdParamsSchema, body: s.addServiceLineSchema }),
  asyncHandler(c.addServiceLine),
);

encountersRouter.get(
  '/:id/invoice',
  encView,
  validate({ params: s.encounterIdParamsSchema }),
  asyncHandler(c.getInvoice),
);

// Hospital Invoices Router (§8.7)
export const invoicesRouter = Router();
const invView = authorize('frontdesk', 'view');
const invCreate = authorize('frontdesk', 'create');
const invWrite = authorize('frontdesk', 'edit');
const invRefund = authorize('frontdesk', 'refund');
invoicesRouter.post('/:id/doctor-charges', invWrite, validate({ body: doctorChargeSchema }), asyncHandler(async (req, res) => { res.status(201).json({ data: await doctorCharges.post(req.params.id!, 'INVOICE', req.body, req.user!.sub) }); }));


invoicesRouter.get(
  '/',
  invView,
  validate({ query: s.listInvoicesQuerySchema }),
  asyncHandler(c.listInvoices),
);

invoicesRouter.get(
  '/:id',
  invView,
  validate({ params: s.invoiceIdParamsSchema }),
  asyncHandler(c.getInvoice),
);

invoicesRouter.post(
  '/:id/lines',
  invWrite,
  validate({ params: s.invoiceIdParamsSchema, body: s.addServiceLineSchema }),
  asyncHandler(c.addServiceLine),
);

invoicesRouter.post(
  '/:id/authorization',
  invWrite,
  validate({ params: s.invoiceIdParamsSchema, body: s.setInvoiceAuthorizationSchema }),
  asyncHandler(c.setAuthorization),
);

invoicesRouter.post(
  '/:id/discounts',
  invWrite,
  validate({ params: s.invoiceIdParamsSchema, body: s.applyDiscountSchema }),
  asyncHandler(c.applyDiscount),
);

invoicesRouter.post(
  '/:id/payments',
  invCreate,
  validate({ params: s.invoiceIdParamsSchema, body: s.collectPaymentSchema }),
  asyncHandler(c.collectPayment),
);

invoicesRouter.post(
  '/:id/refund',
  invRefund,
  validate({ params: s.invoiceIdParamsSchema, body: s.refundPaymentSchema }),
  asyncHandler(c.refundPayment),
);

invoicesRouter.get(
  '/:id/receipt',
  invView,
  validate({ params: s.invoiceIdParamsSchema }),
  asyncHandler(c.getReceipt),
);
