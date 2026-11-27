import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { NotFoundError, ValidationError } from './errors/AppError';

// Use the invoice's company snapshot, not the patient's current membership.
// All callers must use the same transaction for this check and the invoice write.
export async function panelOutstanding(tx: Prisma.TransactionClient, corporatePanelId: string) {
  const where = { corporatePanelId, status: { not: 'VOID' as const } };
  const billed = await tx.hospitalInvoice.aggregate({ where, _sum: { panelReceivable: true } });
  const paid = await tx.panelRemittanceAllocation.aggregate({
    where: { hospitalInvoice: where }, _sum: { allocatedAmount: true },
  });
  return Decimal.max(0, new Decimal(billed._sum.panelReceivable ?? 0).minus(paid._sum.allocatedAmount ?? 0));
}

export async function assertPanelCreditAvailable(
  tx: Prisma.TransactionClient, corporatePanelId: string, additionalReceivable: Decimal,
) {
  if (additionalReceivable.lte(0)) return;
  // Shared with remittance posting and limit edits: concurrent bills cannot
  // both consume the same remaining company credit.
  await tx.$queryRaw`SELECT id FROM corporate_panels WHERE id = ${corporatePanelId} FOR UPDATE`;
  const company = await tx.corporatePanel.findUnique({ where: { id: corporatePanelId } });
  if (!company) throw new NotFoundError('Corporate panel not found');
  const limit = new Decimal(company.creditLimit ?? 0);
  const outstanding = await panelOutstanding(tx, corporatePanelId);
  if (outstanding.plus(additionalReceivable).gt(limit)) {
    throw new ValidationError(`Panel credit limit exceeded for "${company.organizationName}". Limit: PKR ${limit.toFixed(2)}; outstanding: PKR ${outstanding.toFixed(2)}; available: PKR ${Decimal.max(0, limit.minus(outstanding)).toFixed(2)}; new panel charge: PKR ${additionalReceivable.toFixed(2)}. Record company payment or increase its credit limit.`);
  }
}

export async function assertInvoicePanelCredit(
  tx: Prisma.TransactionClient, invoiceId: string, nextReceivable: Decimal,
) {
  if (nextReceivable.lte(0)) return;
  await tx.$queryRaw`SELECT id FROM hospital_invoices WHERE id = ${invoiceId} FOR UPDATE`;
  const invoice = await tx.hospitalInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new NotFoundError('Invoice not found');
  const additional = nextReceivable.minus(invoice.panelReceivable);
  if (additional.lte(0)) return;
  if (!invoice.corporatePanelId) throw new ValidationError('Panel invoice needs a company snapshot before adding panel charges');
  await assertPanelCreditAvailable(tx, invoice.corporatePanelId, additional);
}

export async function assertPanelCreditLimitChange(
  tx: Prisma.TransactionClient, corporatePanelId: string, limit: Decimal,
) {
  await tx.$queryRaw`SELECT id FROM corporate_panels WHERE id = ${corporatePanelId} FOR UPDATE`;
  const outstanding = await panelOutstanding(tx, corporatePanelId);
  if (limit.lt(outstanding)) {
    throw new ValidationError(`Credit limit cannot be below the current outstanding balance of PKR ${outstanding.toFixed(2)}.`);
  }
}
