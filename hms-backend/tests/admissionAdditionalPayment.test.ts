import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';

const { tx } = vi.hoisted(() => ({ tx: {
  hospitalInvoice: { findUnique: vi.fn(), update: vi.fn() },
  paymentReceipt: { create: vi.fn() },
  userCashBalance: { create: vi.fn() },
  // These invoices have no pharmacy lines.
  invoiceLineItem: { findMany: vi.fn() },
} }));
vi.mock('@/db/client', () => ({ prisma: { $transaction: (fn: any) => fn(tx) } }));
vi.mock('@/shared/idGenerator', () => ({ generateReceiptNumber: () => 'RECEIPT-TEST' }));
import { invoicesService } from '../src/modules/frontdesk/invoices.service';

beforeEach(() => {
  vi.resetAllMocks();
  tx.invoiceLineItem.findMany.mockResolvedValue([]);
  tx.paymentReceipt.create.mockImplementation(async ({ data }) => ({ id: 'receipt', ...data }));
  tx.hospitalInvoice.update.mockImplementation(async ({ data }) => ({ id: 'invoice', ...data }));
});

describe('additional admission payments and advance', () => {
  it.each([
    [5000, 10000, 2000, 'PAID', 7000],
    [5000, 5000, 1000, 'PAID', 1000],
    [0, 0, 10000, 'PAID', 10000],
    [5000, 0, 10000, 'PAID', 5000],
    [5000, 1000, 1000, 'PARTIALLY_PAID', 0],
  ])('collects against charges %s and existing payments %s', async (total, paid, amount, status, credit) => {
    tx.hospitalInvoice.findUnique.mockResolvedValue({
      id: 'invoice', invoiceNumber: 'INV-TEST', sourceType: 'ADMISSION',
      total: new Decimal(total), paidTotal: new Decimal(paid), status: paid >= total ? 'PAID' : 'UNPAID',
    });
    const result = await invoicesService.collectPayment('invoice', { amount, paymentMethod: 'CASH' }, 'actor');
    expect(result.invoice.status).toBe(status);
    expect(result.invoice.paidTotal.toNumber()).toBe(paid + amount);
    expect(Math.max(0, result.invoice.paidTotal.toNumber() - total)).toBe(credit);
    expect(result.receipt.amount.toNumber()).toBe(amount);
    expect(tx.paymentReceipt.create.mock.calls[0][0].data.hospitalInvoiceId).toBe('invoice');
    expect(tx.userCashBalance.create.mock.calls[0][0].data).toMatchObject({ paymentReceiptId: 'receipt', direction: 'IN' });
    expect(tx.hospitalInvoice.update.mock.calls[0][0].data).not.toHaveProperty('total');
  });
  it.each(['ADMISSION', 'WALK_IN'])('rejects payments on VOID %s invoices', async (sourceType) => {
    tx.hospitalInvoice.findUnique.mockResolvedValue({ id: 'invoice', sourceType, total: new Decimal(5000), paidTotal: new Decimal(0), status: 'VOID' });
    await expect(invoicesService.collectPayment('invoice', { amount: 1000, paymentMethod: 'CASH' }, 'actor')).rejects.toThrow('void');
    expect(tx.paymentReceipt.create).not.toHaveBeenCalled();
  });
  it('retains the existing overpayment restriction for non-admission invoices', async () => {
    tx.hospitalInvoice.findUnique.mockResolvedValue({ id: 'invoice', sourceType: 'WALK_IN', total: new Decimal(5000), paidTotal: new Decimal(0), status: 'UNPAID' });
    await expect(invoicesService.collectPayment('invoice', { amount: 10000, paymentMethod: 'CASH' }, 'actor')).rejects.toThrow('exceeds remaining balance');
  });
});
