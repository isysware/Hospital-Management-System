import { Prisma, PaymentMethod } from '@prisma/client';
import { ConflictError, ValidationError } from '@/shared/errors/AppError';
import { nextCode, SEQUENCE } from '@/shared/sequence';

export async function validatePaymentAccount(tx: Prisma.TransactionClient, method?: PaymentMethod | null, accountId?: string | null) {
  if (!method) throw new ValidationError('A payment method is required for a paid purchase');
  if (method === 'CASH') {
    if (accountId) throw new ValidationError('Cash payments cannot debit a bank account');
    return;
  }
  if (!accountId || !await tx.paymentAccount.findFirst({ where: { id: accountId, isActive: true } })) {
    throw new ValidationError('Select an active payment account for a non-cash payment');
  }
}

export async function postVendorPayment(tx: Prisma.TransactionClient, vendorId: string, body: {
  amount: number; method: PaymentMethod; requestKey: string; paymentAccountId?: string; reference?: string; refundOf?: string;
}, actorId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${body.requestKey}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${vendorId}))`;
  const signedAmount = body.refundOf ? body.amount : -body.amount;
  const existing = await tx.vendorLedgerEntry.findUnique({ where: { requestKey: body.requestKey } });
  if (existing) {
    const movement = await tx.cashLedgerEntry.findFirst({ where: { referenceTable: 'vendor_ledger_entries', referenceId: existing.id } });
    if (existing.vendorId !== vendorId || existing.actorId !== actorId || !existing.amount.equals(signedAmount) || (body.refundOf ? existing.referenceId !== body.refundOf : existing.referenceTable !== 'vendor_payments') || movement?.paymentMethod !== body.method || (movement?.paymentAccountId ?? null) !== (body.paymentAccountId ?? null)) throw new ConflictError('Payment request identity was already used with different details');
    return existing;
  }
  await validatePaymentAccount(tx, body.method, body.paymentAccountId);
  if (body.refundOf) {
    const source = await tx.vendorLedgerEntry.findUnique({ where: { id: body.refundOf } });
    if (!source || source.vendorId !== vendorId || !source.amount.isNegative() || !['PAYMENT','RETURN_CREDIT'].includes(source.entryType)) throw new ValidationError('Select the supplier payment or return credit being refunded');
    const balance = await tx.vendorLedgerEntry.aggregate({ where: { vendorId }, _sum: { amount: true } });
    const refunded = await tx.vendorLedgerEntry.aggregate({ where: { referenceTable: 'vendor_refunds', referenceId: body.refundOf }, _sum: { amount: true } });
    if (new Prisma.Decimal(body.amount).greaterThan((balance._sum.amount ?? new Prisma.Decimal(0)).negated()) || new Prisma.Decimal(body.amount).plus(refunded._sum.amount ?? 0).greaterThan(source.amount.negated())) throw new ValidationError('Refund exceeds available supplier advance / credit');
  }
  const referenceNo = await nextCode(tx, SEQUENCE.VENDOR_PAYMENT);
  const entry = await tx.vendorLedgerEntry.create({ data: {
    vendorId, entryType: 'PAYMENT', amount: new Prisma.Decimal(signedAmount), referenceNo,
    requestKey: body.requestKey, description: `Vendor ${body.refundOf ? 'refund' : 'payment'} (${body.method})${body.reference ? ': ' + body.reference : ''}`,
    referenceTable: body.refundOf ? 'vendor_refunds' : 'vendor_payments', referenceId: body.refundOf || vendorId, actorId,
  } });
  await tx.cashLedgerEntry.create({ data: {
    portalUserId: actorId, direction: body.refundOf ? 'IN' : 'OUT', amount: body.amount, category: 'VENDOR_PAYMENT',
    isPhysicalCash: body.method === 'CASH', paymentMethod: body.method, paymentAccountId: body.paymentAccountId,
    referenceTable: 'vendor_ledger_entries', referenceId: entry.id,
  } });
  return entry;
}
