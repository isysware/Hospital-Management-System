import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';

// Mock prisma client
vi.mock('@/db/client', () => {
  const mockTx: any = {};
  const mockPrisma: any = {
    $transaction: vi.fn(async (cb: any) => cb(mockTx)),
    // recordRemittance row-locks the company (SELECT ... FOR UPDATE).
    $queryRaw: vi.fn().mockResolvedValue([]),
    corporatePanel: {
      findUnique: vi.fn(),
    },
    panelPatient: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    serviceRate: {
      findUnique: vi.fn(),
    },
    hospitalInvoice: {
      findMany: vi.fn(),
    },
    panelRemittance: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    panelRemittanceAllocation: {
      groupBy: vi.fn(),
    },
  };

  Object.keys(mockPrisma).forEach((key) => {
    if (key !== '$transaction') {
      mockTx[key] = mockPrisma[key];
    }
  });

  return { prisma: mockPrisma };
});

import { prisma } from '@/db/client';
import { panelBillingService } from '@/modules/frontdesk/panelBilling.service';

const actorId = 'staff-user-1';

describe('Phase 8: Panel Billing (Verification, Contract Resolution, Interim Statement, Remittance)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.panelRemittanceAllocation.groupBy as any).mockResolvedValue([]);
  });

  describe('Panel Verification', () => {
    it('reports active membership when both the patient and the panel are active', async () => {
      (prisma.panelPatient.findUnique as any).mockResolvedValue({
        id: 'pp-1',
        mrNumber: 'MR-1',
        fullName: 'Ayesha Khan',
        panelMemberId: 'MEM-1',
        status: 'ACTIVE',
        isActive: true,
        corporatePanel: { id: 'panel-1', code: 'PNL-1', organizationName: 'Acme Insurance', isActive: true },
      });

      const result = await panelBillingService.verifyPanelPatient('pp-1');

      expect(result.membershipActive).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('flags an inactive panel patient with a reason', async () => {
      (prisma.panelPatient.findUnique as any).mockResolvedValue({
        id: 'pp-2',
        mrNumber: 'MR-2',
        fullName: 'Bilal Ahmed',
        panelMemberId: 'MEM-2',
        status: 'ACTIVE',
        isActive: false,
        corporatePanel: { id: 'panel-1', code: 'PNL-1', organizationName: 'Acme Insurance', isActive: true },
      });

      const result = await panelBillingService.verifyPanelPatient('pp-2');

      expect(result.membershipActive).toBe(false);
      expect(result.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/inactive/i)]));
    });

    it('flags an inactive corporate panel even when the patient record is active', async () => {
      (prisma.panelPatient.findUnique as any).mockResolvedValue({
        id: 'pp-3',
        mrNumber: 'MR-3',
        fullName: 'Sara Malik',
        panelMemberId: 'MEM-3',
        status: 'ACTIVE',
        isActive: true,
        corporatePanel: { id: 'panel-2', code: 'PNL-2', organizationName: 'Suspended Panel', isActive: false },
      });

      const result = await panelBillingService.verifyPanelPatient('pp-3');

      expect(result.membershipActive).toBe(false);
      expect(result.reasons).toEqual(expect.arrayContaining(['Corporate panel is inactive']));
    });

    it('rejects a panel patient that does not exist', async () => {
      (prisma.panelPatient.findUnique as any).mockResolvedValue(null);

      await expect(panelBillingService.verifyPanelPatient('missing')).rejects.toThrow(/not found/i);
    });
  });

  describe('Contract Resolution', () => {
    it('splits Contract Amount into Patient Share + Panel Receivable on a coverage-percent rule', async () => {
      (prisma.panelPatient.findUnique as any).mockResolvedValue({
        id: 'pp-1',
        corporatePanel: {
          discountRules: [
            {
              serviceRateId: 'svc-lab',
              discountPercent: new Decimal(0),
              coveragePercent: new Decimal(80),
              capAmount: new Decimal(25000), // above the 24,000 computed receivable — doesn't bind
              effectiveFrom: new Date('2020-01-01'),
              effectiveTo: null,
            },
          ],
        },
      });
      (prisma.serviceRate.findUnique as any).mockResolvedValue({
        id: 'svc-lab',
        code: 'LAB-01',
        name: 'Lab Panel',
        standardRate: new Decimal(30000),
      });

      const result = await panelBillingService.resolveContract({ panelPatientId: 'pp-1', serviceRateId: 'svc-lab', quantity: 1 });

      // Worked Example 7: Lab contract 30,000, panel covers 80% = 24,000, patient co-pay = 6,000
      expect(result.contractAmount).toEqual(new Decimal(30000));
      expect(result.panelReceivable).toEqual(new Decimal(24000));
      expect(result.patientShare).toEqual(new Decimal(6000));
      expect(result.source).toBe('COVERAGE');
    });

    it('caps Panel Receivable at capAmount when the coverage-percent computation exceeds it', async () => {
      (prisma.panelPatient.findUnique as any).mockResolvedValue({
        id: 'pp-1',
        corporatePanel: {
          discountRules: [
            {
              serviceRateId: 'svc-lab',
              discountPercent: new Decimal(0),
              coveragePercent: new Decimal(80),
              capAmount: new Decimal(20000), // below the 24,000 uncapped receivable — binds
              effectiveFrom: new Date('2020-01-01'),
              effectiveTo: null,
            },
          ],
        },
      });
      (prisma.serviceRate.findUnique as any).mockResolvedValue({
        id: 'svc-lab',
        code: 'LAB-01',
        name: 'Lab Panel',
        standardRate: new Decimal(30000),
      });

      const result = await panelBillingService.resolveContract({ panelPatientId: 'pp-1', serviceRateId: 'svc-lab', quantity: 1 });

      expect(result.panelReceivable).toEqual(new Decimal(20000)); // capped, not 24,000
      expect(result.patientShare).toEqual(new Decimal(10000)); // absorbs the difference
    });

    it('falls back to NOT_COVERED (full patient share) when no discount rule matches', async () => {
      (prisma.panelPatient.findUnique as any).mockResolvedValue({ id: 'pp-1', corporatePanel: { discountRules: [] } });
      (prisma.serviceRate.findUnique as any).mockResolvedValue({
        id: 'svc-xray',
        code: 'XRAY-01',
        name: 'X-Ray',
        standardRate: new Decimal(5000),
      });

      const result = await panelBillingService.resolveContract({ panelPatientId: 'pp-1', serviceRateId: 'svc-xray', quantity: 1 });

      expect(result.panelReceivable).toEqual(new Decimal(0));
      expect(result.patientShare).toEqual(new Decimal(5000));
      expect(result.source).toBe('NOT_COVERED');
    });
  });

  describe('Panel Interim Statement', () => {
    it('reports Patient Share and Panel Receivable separately, with realized amounts from remittance allocations', async () => {
      (prisma.corporatePanel.findUnique as any).mockResolvedValue({ id: 'panel-1', organizationName: 'Acme Insurance' });
      (prisma.panelPatient.findMany as any).mockResolvedValue([{ id: 'pp-1', fullName: 'Ayesha Khan', mrNumber: 'MR-1', panelMemberId: 'MEM-1' }]);
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        {
          id: 'inv-lab',
          invoiceNumber: 'INV-LAB-1',
          department: { id: 'dept-lab', name: 'Laboratory', code: 'LAB' },
          panelPatient: { id: 'pp-1', fullName: 'Ayesha Khan', mrNumber: 'MR-1' },
          total: new Decimal(30000),
          paidTotal: new Decimal(6000), // patient co-pay collected in full
          patientShare: new Decimal(6000),
          panelReceivable: new Decimal(24000),
        },
      ]);
      (prisma.panelRemittanceAllocation.groupBy as any).mockResolvedValue([
        { hospitalInvoiceId: 'inv-lab', _sum: { allocatedAmount: new Decimal(10000) } },
      ]);

      const statement = await panelBillingService.getPanelStatement('panel-1');

      const row = statement.invoices[0];
      expect(row.patientShareCollected).toEqual(new Decimal(6000));
      expect(row.patientShareOutstanding).toEqual(new Decimal(0));
      expect(row.panelReceivableRealized).toEqual(new Decimal(10000));
      expect(row.panelReceivableOutstanding).toEqual(new Decimal(14000));
      expect(statement.consolidated.panelReceivable).toEqual(new Decimal(24000));
      expect(statement.consolidated.panelReceivableOutstanding).toEqual(new Decimal(14000));
    });
  });

  describe('Panel Remittance', () => {
    it('locks the company row, and rejects the same invoice listed twice in one allocation', async () => {
      (prisma.corporatePanel.findUnique as any).mockResolvedValue({ id: 'panel-1' });
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        { id: 'inv-a', invoiceNumber: 'INV-A', panelReceivable: new Decimal(1000) },
      ]);

      // 600 + 600 are each within the 1,000 outstanding but together over-realize it.
      await expect(
        panelBillingService.recordRemittance(
          'panel-1',
          { amount: 1200, method: 'BANK_TRANSFER', allocations: [{ hospitalInvoiceId: 'inv-a', amount: 600 }, { hospitalInvoiceId: 'inv-a', amount: 600 }] } as any,
          actorId,
        ),
      ).rejects.toThrow(/only once/);
      expect((prisma as any).$queryRaw).toHaveBeenCalled();
      expect(prisma.panelRemittance.create).not.toHaveBeenCalled();
    });

    it('auto-allocation never puts more on an invoice than it owes, even when paisas round', async () => {
      (prisma.corporatePanel.findUnique as any).mockResolvedValue({ id: 'panel-1' });
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        { id: 'inv-a', invoiceNumber: 'INV-A', panelReceivable: new Decimal('0.03') },
        { id: 'inv-b', invoiceNumber: 'INV-B', panelReceivable: new Decimal('0.03') },
        { id: 'inv-c', invoiceNumber: 'INV-C', panelReceivable: new Decimal('0.03') },
      ]);
      (prisma.panelRemittance.create as any).mockImplementation((args: any) => ({ id: 'rem-r', ...args.data }));

      await panelBillingService.recordRemittance('panel-1', { amount: 0.08, method: 'CASH' } as any, actorId);

      const allocations = (prisma.panelRemittance.create as any).mock.calls[0][0].data.allocations.create as { allocatedAmount: Decimal }[];
      const sum = allocations.reduce((acc, a) => acc.plus(a.allocatedAmount), new Decimal(0));
      expect(sum).toEqual(new Decimal('0.08'));
      for (const a of allocations) expect(a.allocatedAmount.lessThanOrEqualTo(new Decimal('0.03'))).toBe(true);
    });

    it('auto-allocates one remittance proportionally across outstanding panel receivables', async () => {
      (prisma.corporatePanel.findUnique as any).mockResolvedValue({ id: 'panel-1' });
      (prisma.panelPatient.findMany as any).mockResolvedValue([{ id: 'pp-1' }, { id: 'pp-2' }]);
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        { id: 'inv-a', invoiceNumber: 'INV-A', panelReceivable: new Decimal(24000) },
        { id: 'inv-b', invoiceNumber: 'INV-B', panelReceivable: new Decimal(16000) },
      ]);
      (prisma.panelRemittance.create as any).mockImplementation((args: any) => ({ id: 'rem-1', ...args.data }));

      const result = await panelBillingService.recordRemittance(
        'panel-1',
        { amount: 20000, method: 'BANK_TRANSFER' } as any,
        actorId,
      );

      const created = (prisma.panelRemittance.create as any).mock.calls[0][0];
      const allocations = created.data.allocations.create as { hospitalInvoiceId: string; allocatedAmount: Decimal }[];
      const sum = allocations.reduce((s, a) => s.plus(a.allocatedAmount), new Decimal(0));
      expect(sum).toEqual(new Decimal(20000)); // always sums exactly to the remittance amount
      expect(allocations).toHaveLength(2);
      expect(result.id).toBe('rem-1');
    });

    it('honors explicit allocations and rejects a mismatched sum', async () => {
      (prisma.corporatePanel.findUnique as any).mockResolvedValue({ id: 'panel-1' });
      (prisma.panelPatient.findMany as any).mockResolvedValue([{ id: 'pp-1' }]);
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        { id: 'inv-a', invoiceNumber: 'INV-A', panelReceivable: new Decimal(24000) },
      ]);

      await expect(
        panelBillingService.recordRemittance(
          'panel-1',
          { amount: 20000, method: 'BANK_TRANSFER', allocations: [{ hospitalInvoiceId: 'inv-a', amount: 19999 }] } as any,
          actorId,
        ),
      ).rejects.toThrow(/must sum to exactly/);
    });

    it('rejects an explicit allocation that exceeds that invoice\'s outstanding panel receivable', async () => {
      (prisma.corporatePanel.findUnique as any).mockResolvedValue({ id: 'panel-1' });
      (prisma.panelPatient.findMany as any).mockResolvedValue([{ id: 'pp-1' }]);
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        { id: 'inv-a', invoiceNumber: 'INV-A', panelReceivable: new Decimal(5000) },
      ]);
      (prisma.panelRemittanceAllocation.groupBy as any).mockResolvedValue([
        { hospitalInvoiceId: 'inv-a', _sum: { allocatedAmount: new Decimal(4000) } }, // 1,000 outstanding
      ]);

      await expect(
        panelBillingService.recordRemittance(
          'panel-1',
          { amount: 2000, method: 'BANK_TRANSFER', allocations: [{ hospitalInvoiceId: 'inv-a', amount: 2000 }] } as any,
          actorId,
        ),
      ).rejects.toThrow(/exceeds its outstanding panel receivable/);
    });

    it('rejects an auto-allocation that exceeds the total outstanding panel receivable', async () => {
      (prisma.corporatePanel.findUnique as any).mockResolvedValue({ id: 'panel-1' });
      (prisma.panelPatient.findMany as any).mockResolvedValue([{ id: 'pp-1' }]);
      (prisma.hospitalInvoice.findMany as any).mockResolvedValue([
        { id: 'inv-a', invoiceNumber: 'INV-A', panelReceivable: new Decimal(1000) },
      ]);

      await expect(
        panelBillingService.recordRemittance('panel-1', { amount: 5000, method: 'BANK_TRANSFER' } as any, actorId),
      ).rejects.toThrow(/exceeds total outstanding/);
    });
  });
});
