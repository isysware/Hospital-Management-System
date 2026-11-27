import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db/client', () => {
  const tx = {
    $queryRaw: vi.fn(),
    corporatePanel: { findUnique: vi.fn(), delete: vi.fn() },
    panelPatient: { count: vi.fn() },
    hospitalInvoice: { count: vi.fn() },
    panelRemittance: { count: vi.fn() },
    panelDiscountRule: { deleteMany: vi.fn() },
  };
  return { prisma: { ...tx, $transaction: vi.fn(async (fn: any) => fn(tx)) } };
});
import { prisma } from '@/db/client';
import { setupService } from '@/modules/setup/setup.service';

describe('panel deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.corporatePanel.findUnique).mockResolvedValue({ id: 'panel', organizationName: 'Unused Panel' } as any);
    vi.mocked(prisma.panelPatient.count).mockResolvedValue(0);
    vi.mocked(prisma.hospitalInvoice.count).mockResolvedValue(0);
    vi.mocked(prisma.panelRemittance.count).mockResolvedValue(0);
  });
  it('deletes configured and archived rules before deleting an unused panel', async () => {
    await setupService.deleteCorporatePanel('panel');
    expect(prisma.panelDiscountRule.deleteMany).toHaveBeenCalledWith({ where: { corporatePanelId: 'panel' } });
    expect(prisma.corporatePanel.delete).toHaveBeenCalledWith({ where: { id: 'panel' } });
    expect(vi.mocked(prisma.panelDiscountRule.deleteMany).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(prisma.corporatePanel.delete).mock.invocationCallOrder[0]!);
  });
  it.each(['panelPatient', 'hospitalInvoice', 'panelRemittance'] as const)('protects linked %s records', async (model) => {
    vi.mocked(prisma[model].count).mockResolvedValue(1);
    await expect(setupService.deleteCorporatePanel('panel')).rejects.toThrow('Cannot permanently delete');
    expect(prisma.panelDiscountRule.deleteMany).not.toHaveBeenCalled();
    expect(prisma.corporatePanel.delete).not.toHaveBeenCalled();
  });
  it('reports a missing panel', async () => {
    vi.mocked(prisma.corporatePanel.findUnique).mockResolvedValue(null);
    await expect(setupService.deleteCorporatePanel('missing')).rejects.toThrow('not found');
  });
});
