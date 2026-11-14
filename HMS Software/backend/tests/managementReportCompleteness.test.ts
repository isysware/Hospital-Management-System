import { expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';

const db = vi.hoisted(() => ({ hospitalInvoice: { findMany: vi.fn() } }));
vi.mock('@/db/client', () => ({ prisma: db }));
import { managementReportsService } from '@/modules/reports/managementReports.service';

const d = (n: number) => new Decimal(n);
const invoices = Array.from({ length: 1005 }, (_, n) => ({
  id: `invoice-${n}`, invoiceNumber: `INV-${n}`, createdAt: new Date(),
  subtotal: d(100), discountTotal: d(0), total: d(100),
  paidTotal: d(n < 1000 ? 100 : 0), panelReceivable: d(0),
  panelRemittanceAllocations: [], paymentReceipts: n < 1000 ? [{ amount: d(100) }] : [], lines: [],
  departmentId: null, department: null, corporatePanel: null, corporatePanelId: null,
  status: n < 1000 ? 'PAID' : 'UNPAID',
}));

function useDataset() {
  // Emulate a database row limit so this regression fails with the old take:1000.
  db.hospitalInvoice.findMany.mockImplementation(async ({ take }) =>
    take === undefined ? invoices : invoices.slice(0, take));
}

it('includes invoices beyond 1,000 in the billing report and its export rows', async () => {
  useDataset();
  const report = await managementReportsService.getBillingCollection({ preset: 'today' });
  expect(report.rows).toHaveLength(1005);
  expect(report.rows.at(-1)?.invoiceNumber).toBe('INV-1004');
  expect(report.rows.reduce((sum, r) => sum.plus(r.net), d(0)).toNumber()).toBe(100500);
});

it('finds unpaid invoices even after 1,000 settled invoices', async () => {
  useDataset();
  const report = await managementReportsService.getOutstandingPanel({ preset: 'today' });
  expect(report.rows).toHaveLength(5);
  expect(report.rows.map(r => r.id)).toEqual(invoices.slice(1000).map(i => i.id));
  expect(report.rows.reduce((sum, r) => sum.plus(r.due), d(0)).toNumber()).toBe(500);
});
