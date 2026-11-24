import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/AppError';
import { pharmacyBridgeClient } from '@/shared/pharmacyBridgeClient';
import { resolveCashModuleScope } from '@/modules/cash/moduleScope.util';
import type { ReleaseSettlementBody } from './pharmacy-bridge.schemas';

const notPosted = (message: string) => new ValidationError(message, { paymentNotPosted: true });

export async function releasePharmacySettlement(settlementId: string, body: ReleaseSettlementBody, actorId: string, actorRole: string) {
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actorRole)) throw new AuthorizationError('Only Super Admin or Admin can release a settlement payment to Pharmacy.');
  const amount = new Decimal(body.releasedAmount);
  if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 2) throw new ValidationError('Release amount must be positive with at most two decimal places.');
  const reference = body.paymentReference?.trim() || null;
  // Older clients with a payment reference retain safe retry compatibility.
  const key = body.idempotencyKey?.trim() || (reference ? `reference:${settlementId}:${reference}` : null);
  if (!key) throw new ValidationError('An idempotency key is required. Reuse it when retrying this payment.');
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pharmacy-release:${key}`}))`;
    const initial = await tx.hmsPharmacySettlement.findUnique({ where: { id: settlementId } });
    if (!initial) throw new NotFoundError('Settlement not found');
    // Charge first serializes different settlements against the same connected invoice.
    await tx.$queryRaw`SELECT id FROM hms_pharmacy_charges WHERE id = ${initial.pharmacyChargeId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM hms_pharmacy_settlements WHERE id = ${settlementId} FOR UPDATE`;
    const settlement = await tx.hmsPharmacySettlement.findUniqueOrThrow({ where: { id: settlementId }, include: { pharmacyCharge: true } });
    const previous = await tx.hmsPharmacySettlementRelease.findUnique({ where: { idempotencyKey: key } })
      ?? (reference ? await tx.hmsPharmacySettlementRelease.findUnique({ where: { settlementId_paymentReference: { settlementId, paymentReference: reference } } }) : null);
    if (previous) {
      if (previous.settlementId !== settlementId || !previous.amount.equals(amount) || previous.paymentMethod !== body.paymentMethod
        || previous.paymentReference !== reference || previous.releasedById !== actorId || previous.remarks !== (body.remarks?.trim() || null)) {
        throw new ValidationError('Payment identity already used with different payment data.');
      }
      return { settlement, release: previous, replayed: true };
    }
    if (!['REQUESTED', 'APPROVED', 'PARTIALLY_RELEASED'].includes(settlement.status)) throw notPosted('Settlement is not eligible for release.');
    const releases = await tx.hmsPharmacySettlementRelease.aggregate({ where: { settlementId }, _sum: { amount: true } });
    const completed = releases._sum.amount ?? new Decimal(0);
    if (!completed.equals(settlement.releasedAmount)) throw notPosted('Historical settlement releases require manual reconciliation before another payment.');
    const remaining = settlement.requestedAmount.minus(completed);
    if (!remaining.equals(settlement.remainingAmount)) throw notPosted('Settlement balance requires reconciliation before another payment.');
    if (amount.gt(remaining)) throw notPosted('Release amount cannot exceed remaining amount.');
    const actor = await tx.portalUser.findUniqueOrThrow({ where: { id: actorId }, select: { role: true, displayName: true, username: true } });
    if (!['SUPER_ADMIN', 'ADMIN'].includes(actor.role)) throw new AuthorizationError('Cash payer must be an Admin or Super Admin.');
    const now = new Date();
    let cashEntryId: string | null = null;
    if (body.paymentMethod === 'CASH') {
      // Same shift lock as Account Settlement, and same payer lock as staff cash payments.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settlement:${actorId}`}))`;
      await tx.$queryRaw`SELECT id FROM portal_users WHERE id = ${actorId} FOR UPDATE`;
      const entries = await tx.userCashBalance.findMany({ where: { portalUserId: actorId, isSettled: false, isPhysicalCash: true } });
      const prior = await tx.accountSettlement.findFirst({ where: { portalUserId: actorId, status: { not: 'REVERSED' } }, orderBy: { createdAt: 'desc' }, select: { carryForwardAmount: true } });
      const available = entries.reduce((sum, entry) => entry.direction === 'IN' ? sum.plus(entry.amount) : sum.minus(entry.amount), prior?.carryForwardAmount ?? new Decimal(0));
      if (available.lt(amount)) throw notPosted('Insufficient cash in the releasing user’s custody.');
      const cash = await tx.userCashBalance.create({ data: {
        portalUserId: actorId, issuedById: actorId, moduleScope: resolveCashModuleScope(actor.role),
        direction: 'OUT', amount, category: 'PHARMACY_SETTLEMENT', isPhysicalCash: true, occurredAt: now,
        note: `Pharmacy settlement ${settlement.settlementNumber}${reference ? ` / ${reference}` : ''}`,
      } });
      cashEntryId = cash.id;
    }
    const release = await tx.hmsPharmacySettlementRelease.create({ data: {
      settlementId, amount, paymentMethod: body.paymentMethod, paymentReference: reference, idempotencyKey: key,
      releasedAt: now, releasedById: actorId, cashEntryId, remarks: body.remarks?.trim() || null,
    } });
    const releasedTotal = completed.plus(amount);
    const remainingAmount = settlement.requestedAmount.minus(releasedTotal);
    const status = remainingAmount.isZero() ? 'SETTLED' : 'PARTIALLY_RELEASED';
    const updated = await tx.hmsPharmacySettlement.update({ where: { id: settlementId }, data: {
      releasedAmount: releasedTotal, remainingAmount, status, releasedAt: now, releasedById: actorId,
      paymentMethod: body.paymentMethod, paymentReference: reference, remarks: body.remarks,
    } });
    await tx.hmsPharmacyCharge.update({ where: { id: settlement.pharmacyChargeId }, data: {
      settledAmount: { increment: amount }, settlementStatus: status,
    } });
    return { settlement: updated, release, replayed: false };
  }, { timeout: 15000 });

  // The remote endpoint applies additive deltas and is not idempotent. Never resend
  // after an ambiguous outcome or on an API retry. The durable row exposes this gap.
  if (!result.replayed) {
    try {
      await pharmacyBridgeClient.releaseSettlement({
        settlementNumber: result.settlement.settlementNumber, pharmacyInvoiceNumber: result.settlement.pharmacyInvoiceNumber,
        releasedAmount: Number(result.release.amount), remainingPayable: Number(result.settlement.remainingAmount),
        paymentMethod: result.release.paymentMethod, paymentReference: result.release.paymentReference ?? undefined,
        releasedBy: actorId, releasedAt: result.release.releasedAt.toISOString(), remarks: result.release.remarks ?? undefined,
      });
      result.release = await prisma.hmsPharmacySettlementRelease.update({ where: { id: result.release.id },
        data: { bridgeStatus: 'DELIVERED', bridgeDeliveredAt: new Date() } });
    } catch {
      // Local payment is committed; do not misrepresent this as a failed payment.
    }
  }
  return { ...result.settlement, release: result.release, replayed: result.replayed };
}
