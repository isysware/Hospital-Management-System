import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/db/client', () => ({ prisma: { panelCategory: {
  findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(),
} } }));

import { prisma } from '@/db/client';
import { setupService } from '@/modules/setup/setup.service';
import { createPanelCategorySchema } from '@/modules/setup/setup.schemas';

describe('custom panel categories', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects blank and oversized names and trims valid input', () => {
    for (const name of ['', '   ', 'a'.repeat(101)]) {
      expect(createPanelCategorySchema.safeParse({ name }).success).toBe(false);
    }
    expect(createPanelCategorySchema.parse({ name: '  Custom Panel  ', isActive: false }))
      .toEqual({ name: 'Custom Panel' });
  });

  it('persists an active category that can be listed and used for a panel', async () => {
    const category = { name: 'Custom Panel', isActive: true };
    vi.mocked(prisma.panelCategory.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce(category);
    vi.mocked(prisma.panelCategory.create).mockResolvedValue(category);
    vi.mocked(prisma.panelCategory.findMany).mockResolvedValue([category]);
    expect(await setupService.createPanelCategory({ name: ' Custom Panel ' })).toEqual(category);
    expect(prisma.panelCategory.create).toHaveBeenCalledWith({ data: category });
    expect(await setupService.listPanelCategories()).toContainEqual(category);
    await expect(setupService.validatePanelCategory(category.name)).resolves.toBeUndefined();
  });

  it('rejects existing categories regardless of case and does not reactivate inactive ones', async () => {
    for (const isActive of [true, false]) {
      vi.mocked(prisma.panelCategory.findFirst).mockResolvedValue({ name: 'Insurance', isActive });
      await expect(setupService.createPanelCategory({ name: 'insurance' })).rejects.toThrow(isActive ? 'already exists' : 'inactive');
    }
    expect(prisma.panelCategory.findFirst).toHaveBeenCalledWith({ where: { name: { equals: 'insurance', mode: 'insensitive' } } });
    expect(prisma.panelCategory.create).not.toHaveBeenCalled();
  });

  it('returns a clear conflict when a concurrent insert claims the same name', async () => {
    vi.mocked(prisma.panelCategory.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.panelCategory.create).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5' }));
    await expect(setupService.createPanelCategory({ name: 'Insurance' })).rejects.toThrow('already exists');
  });

  it('rejects an unconfigured category when saving a panel', async () => {
    vi.mocked(prisma.panelCategory.findFirst).mockResolvedValue(null);
    await expect(setupService.validatePanelCategory('Unknown')).rejects.toThrow('active configured');
  });
});
