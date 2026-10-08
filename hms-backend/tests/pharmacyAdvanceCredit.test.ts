import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../src/db/client';
import { pharmacyBridgeService } from '../src/modules/pharmacy-bridge/pharmacy-bridge.service';
import { pharmacyBridgeClient } from '../src/shared/pharmacyBridgeClient';
import { vi } from 'vitest';

vi.mock('@/modules/notifications/notifications.service', () => ({ notificationsService: { createNotification: vi.fn() } }));

/**
 * Reported bug (2026-10-06): a self-pay patient gives an admission advance
 * BEFORE any pharmacy dispense exists. That advance is a pure unallocated
 * `PaymentReceipt` (`hospitalInvoiceId: null`). When the pharmacy dispense
 * later posts its `SRV-PHARMACY` line onto the admission's one consolidated
 * invoice, the advance must fold into `invoice.paidTotal` AND
 * `HmsPharmacyCharge.patientPaid` right then — not stay stuck "Unpaid" until
 * some unrelated future payment happens to trigger `collectPayment`.
 */
describe.skipIf(process.env.RUN_SERVICE_DB_TESTS !== '1')('pharmacy advance credit — folded into a later dispense (rolled back)', () => {
  it('a 1000 advance given before dispense fully covers a 524 pharmacy+ward charge and clears the pharmacy charge', async () => {
    const rollback = new Error('ROLLBACK_ACCEPTANCE_FIXTURES');
    const originalTransaction = prisma.$transaction.bind(prisma);
    const reconcileSpy = vi.spyOn(pharmacyBridgeClient, 'reconcileCollection').mockResolvedValue({} as any);
    try {
      await originalTransaction(async (tx) => {
        const key = randomUUID();
        const actor = await tx.portalUser.create({ data: { username: key, passwordHash: 'test-only-unused', role: 'SUPER_ADMIN' } });
        const dept = await tx.department.create({ data: { code: key, name: 'Test Ward', departmentType: 'CLINICAL' } });
        const room = await tx.room.create({ data: { name: 'Test Room', dailyRoomRate: 224 } });
        const bed = await tx.bed.create({ data: { bedNumber: key, roomId: room.id, status: 'OCCUPIED' } });
        const admission = await tx.admissionRecord.create({
          data: { admissionNumber: key, departmentId: dept.id, status: 'ACTIVE', bedId: bed.id },
        });

        // A ward charge line posted FIRST (chronologically before the
        // pharmacy dispense), self-pay — patientShare == lineNet.
        const invoice = await tx.hospitalInvoice.create({
          data: {
            invoiceNumber: key, sourceType: 'ADMISSION', admissionRecordId: admission.id, departmentId: dept.id,
            subtotal: 224, discountTotal: 0, total: 224, paidTotal: 0, patientShare: 224, panelReceivable: 0, status: 'UNPAID',
          },
        });
        await tx.invoiceLineItem.create({
          data: {
            hospitalInvoiceId: invoice.id, billingSource: 'ROOM_BED', descriptionSnapshot: 'Ward Fixed',
            rateSnapshot: 224, quantity: 1, lineGross: 224, discountAmount: 0, lineNet: 224, patientShare: 224, panelReceivable: 0,
          },
        });

        // The admission-creation advance: PKR 1000, unallocated
        // (hospitalInvoiceId: null) — exactly the "deposit at check-in" case.
        await tx.paymentReceipt.create({
          data: {
            receiptNumber: `RCT-${key}`, amount: 1000, method: 'CASH',
            admissionRecordId: admission.id, collectedById: actor.id,
          },
        });

        const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation((async (fn: any) => fn(tx)) as any);
        try {
          // Pharmacy dispense: PKR 300 of medicine, posted after the ward charge.
          const callback = {
            externalAdmissionRef: admission.id,
            dispenseEventId: key,
            pharmacyInvoiceNumber: key,
            subtotal: 300, taxTotal: 0, discountTotal: 0, totalAmount: 300,
            lines: [{ medicineName: 'Panadol', quantity: 1, rate: 300, lineNet: 300 }],
          };
          const result = await pharmacyBridgeService.handleDispensedCallback(callback);

          // 1. The advance is now linked to the invoice, not floating unallocated.
          const receipt = await tx.paymentReceipt.findFirst({ where: { admissionRecordId: admission.id } });
          expect(receipt?.hospitalInvoiceId).toBe(invoice.id);

          // 2. Invoice paidTotal folds in the full 1000 advance (ward 224 + pharmacy 300 = 524 total; 476 stays as genuine overpayment headroom).
          const updatedInvoice = await tx.hospitalInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
          expect(Number(updatedInvoice.paidTotal)).toBe(1000);
          expect(updatedInvoice.status).toBe('PAID');

          // 3. The pharmacy charge is fully covered (300 of patientShare falls inside [0,1000)) and CLEARED — not stuck "Unpaid".
          const charge = await tx.hmsPharmacyCharge.findFirstOrThrow({ where: { admissionRecordId: admission.id } });
          expect(Number(charge.patientPaid)).toBe(300);
          expect(Number(charge.patientOutstanding)).toBe(0);
          expect(charge.patientPaymentStatus).toBe('CLEARED');

          // 4. Pharmacy was notified of the authoritative collected amount.
          expect(result.advanceFolded).toBe(true);
          expect(reconcileSpy).toHaveBeenCalledWith(expect.objectContaining({
            pharmacyInvoiceNumber: key,
            authoritativeCollectedAmount: 300,
          }));
        } finally {
          transactionSpy.mockRestore();
        }
        throw rollback;
      }, { timeout: 60000 });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      reconcileSpy.mockRestore();
      await prisma.$disconnect();
    }
  }, 65000);
});
