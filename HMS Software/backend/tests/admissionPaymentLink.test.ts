import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';

const { tx } = vi.hoisted(() => ({ tx: {
  $executeRaw: vi.fn(),
  admissionRecord: { findUnique: vi.fn() },
  hospitalInvoice: { findMany: vi.fn(), update: vi.fn() },
  admissionPaymentRequest: { findUnique: vi.fn(), update: vi.fn() },
  paymentReceipt: { create: vi.fn() },
  userCashBalance: { create: vi.fn() },
  invoiceLineItem: { findMany: vi.fn() },
  hmsPharmacyCharge: { count: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  dualDischargeClearance: { upsert: vi.fn() },
} }));
vi.mock('@/db/client', () => ({ prisma: { $transaction: (fn: any) => fn(tx) } }));
vi.mock('@/shared/idGenerator', () => ({ generateReceiptNumber: vi.fn(async () => 'RCT-TEST') }));
vi.mock('@/modules/admission/admission.service', () => ({ admissionService: {
  reconcileAdmissionDischarge: vi.fn(async () => ({ isDischarged: false })),
} }));
vi.mock('@/shared/pharmacyBridgeClient', () => ({ pharmacyBridgeClient: { notifyPatientCollected: vi.fn(async () => ({})) } }));
import { admissionBillingService } from '../src/modules/frontdesk/admissionBilling.service';
import { paymentRequestsService } from '../src/modules/frontdesk/paymentRequests.service';
import { pharmacyBridgeClient } from '../src/shared/pharmacyBridgeClient';

const dec = (n: number) => new Decimal(n);
const invoice = (id: string, total: number) => ({ id, invoiceNumber: id, total: dec(total), paidTotal: dec(0), sourceType: 'ADMISSION' });
beforeEach(() => {
  vi.clearAllMocks();
  tx.admissionRecord.findUnique.mockResolvedValue({ id: 'adm', admissionNumber: 'ADM-1', status: 'ACTIVE' });
  tx.hospitalInvoice.findMany.mockResolvedValue([invoice('inv', 100)]);
  tx.invoiceLineItem.findMany.mockResolvedValue([]);
  tx.hmsPharmacyCharge.count.mockResolvedValue(0);
  tx.paymentReceipt.create.mockImplementation(async ({ data }) => ({ id: `receipt-${data.hospitalInvoiceId}`, ...data }));
});

describe('admission payment links', () => {
  it('stores only the remaining 50 as advance when collecting 150 against a 100 bill', async () => {
    const result = await admissionBillingService.collectPayment('adm', { amount: 150, paymentMethod: 'CASH' }, 'cashier');
    expect(result.receipts.map(r => [r.hospitalInvoiceId, Number(r.amount)])).toEqual([['inv', 100], [null, 50]]);
    expect(result.receipts.every(r => r.admissionRecordId === 'adm')).toBe(true);
    expect(tx.userCashBalance.create.mock.calls.reduce((sum, [arg]) => sum + Number(arg.data.amount), 0)).toBe(150);
    expect(Number(tx.hospitalInvoice.update.mock.calls[0][0].data.paidTotal)).toBe(100);
  });
  it('links each department payment without manufacturing an unallocated advance', async () => {
    tx.hospitalInvoice.findMany.mockResolvedValue([invoice('a', 100), invoice('b', 100)]);
    const result = await admissionBillingService.collectPayment('adm', { amount: 100, paymentMethod: 'CARD' }, 'cashier');
    expect(result.receipts.map(r => [r.hospitalInvoiceId, Number(r.amount)])).toEqual([['a', 50], ['b', 50]]);
    expect(tx.userCashBalance.create.mock.calls.every(([arg]) => !arg.data.isPhysicalCash)).toBe(true);
  });
  it('rejects repeated allocations before recording cash', async () => {
    await expect(admissionBillingService.collectPayment('adm', { amount: 100, paymentMethod: 'CASH', allocations: [
      { invoiceId: 'inv', amount: 50 }, { invoiceId: 'inv', amount: 50 },
    ] }, 'cashier')).rejects.toThrow('Duplicate');
    expect(tx.paymentReceipt.create).not.toHaveBeenCalled();
  });
  it.each(['DISCHARGED', 'CANCELLED'])('rejects collection for %s admissions', async status => {
    tx.admissionRecord.findUnique.mockResolvedValue({ id: 'adm', status });
    await expect(admissionBillingService.collectPayment('adm', { amount: 100, paymentMethod: 'CASH' }, 'cashier')).rejects.toThrow('discharge or cancellation');
    expect(tx.paymentReceipt.create).not.toHaveBeenCalled();
  });
  it('request collection updates its admission bill and notifies Pharmacy', async () => {
    tx.admissionPaymentRequest.findUnique.mockResolvedValue({ id: 'req', admissionRecordId: 'adm', status: 'PENDING', requestedAmount: dec(100), paymentReceipts: [] });
    tx.admissionPaymentRequest.update.mockResolvedValue({ id: 'req', status: 'FULFILLED' });
    tx.invoiceLineItem.findMany.mockResolvedValue([{ billingSource: 'PHARMACY', patientShare: dec(100), commissionAccruals: [] }]);
    tx.hmsPharmacyCharge.findFirst.mockResolvedValue({ id: 'charge', pharmacyInvoiceNumber: 'PH-1', totalAmount: dec(100), patientPaid: dec(0), settlementStatus: 'NOT_DUE' });
    const result = await paymentRequestsService.collectPaymentRequest('req', { amount: 100, paymentMethod: 'CASH' }, 'cashier');
    expect(result.receipt).toMatchObject({ hospitalInvoiceId: 'inv', admissionRecordId: 'adm', admissionPaymentRequestId: 'req' });
    expect(Number(tx.hmsPharmacyCharge.update.mock.calls[0][0].data.patientPaid)).toBe(100);
    expect(pharmacyBridgeClient.notifyPatientCollected).toHaveBeenCalledWith(expect.objectContaining({ pharmacyInvoiceNumber: 'PH-1', collectedAmount: 100 }));
    expect(tx.admissionPaymentRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FULFILLED' } }));
  });
});
