import { describe, expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { assertInvoicePanelCredit, assertPanelCreditAvailable, assertPanelCreditLimitChange } from '@/shared/panelCreditLimit';

const d = (value: number) => new Decimal(value);
function fixture(limit: number | null = 1000, billed = 800, paid = 0) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    corporatePanel: { findUnique: vi.fn().mockResolvedValue({ creditLimit: limit == null ? null : d(limit), organizationName: 'Test Company' }) },
    hospitalInvoice: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { panelReceivable: d(billed) } }),
      findUnique: vi.fn().mockResolvedValue({ corporatePanelId: 'original-company', panelReceivable: d(300) }),
    },
    panelRemittanceAllocation: { aggregate: vi.fn().mockResolvedValue({ _sum: { allocatedAmount: d(paid) } }) },
  };
}

describe('company credit limit', () => {
  it('allows the exact limit and rejects even one paisa above it', async () => {
    const tx = fixture();
    await expect(assertPanelCreditAvailable(tx as any, 'company', d(200))).resolves.toBeUndefined();
    await expect(assertPanelCreditAvailable(tx as any, 'company', d(200.01))).rejects.toThrow('available: PKR 200.00');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.hospitalInvoice.aggregate.mock.invocationCallOrder[0]!);
  });

  it('restores credit from company remittance allocations and excludes void invoices', async () => {
    const tx = fixture(1000, 1000, 250);
    await expect(assertPanelCreditAvailable(tx as any, 'company', d(250))).resolves.toBeUndefined();
    expect(tx.hospitalInvoice.aggregate).toHaveBeenCalledWith({ where: { corporatePanelId: 'company', status: { not: 'VOID' } }, _sum: { panelReceivable: true } });
    expect(tx.panelRemittanceAllocation.aggregate).toHaveBeenCalledWith({ where: { hospitalInvoice: { corporatePanelId: 'company', status: { not: 'VOID' } } }, _sum: { allocatedAmount: true } });
  });

  it('treats zero and missing limits as no credit, while allowing patient-only charges', async () => {
    for (const limit of [0, null]) {
      const tx = fixture(limit, 0);
      await expect(assertPanelCreditAvailable(tx as any, 'company', d(1))).rejects.toThrow('credit limit exceeded');
      await expect(assertPanelCreditAvailable(tx as any, 'company', d(0))).resolves.toBeUndefined();
    }
  });

  it('checks only the increase on an existing invoice against its original company', async () => {
    const tx = fixture();
    await expect(assertInvoicePanelCredit(tx as any, 'invoice', d(500))).resolves.toBeUndefined();
    await expect(assertInvoicePanelCredit(tx as any, 'invoice', d(501))).rejects.toThrow('credit limit exceeded');
    expect(tx.corporatePanel.findUnique).toHaveBeenCalledWith({ where: { id: 'original-company' } });
  });

  it('allows unchanged or reduced receivables for historical over-limit accounts', async () => {
    const tx = fixture(100, 800);
    await assertInvoicePanelCredit(tx as any, 'invoice', d(300));
    await assertInvoicePanelCredit(tx as any, 'invoice', d(200));
    expect(tx.corporatePanel.findUnique).not.toHaveBeenCalled();
  });

  it('rejects lowering a limit below outstanding but permits the exact outstanding', async () => {
    const tx = fixture(1000, 800, 100);
    await expect(assertPanelCreditLimitChange(tx as any, 'company', d(699))).rejects.toThrow('700.00');
    await expect(assertPanelCreditLimitChange(tx as any, 'company', d(700))).resolves.toBeUndefined();
  });

  it('fails closed when the invoice company snapshot is missing', async () => {
    const tx = fixture();
    tx.hospitalInvoice.findUnique.mockResolvedValue({ corporatePanelId: null, panelReceivable: d(0) });
    await expect(assertInvoicePanelCredit(tx as any, 'invoice', d(100))).rejects.toThrow('company snapshot');
  });
});
