import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
vi.mock('@/db/client', () => ({ prisma: {} }));
import { createStaffBodySchema } from '@/modules/identity/staff.schemas';
import { collectedCommission } from '@/modules/commission/commission.collections';
import { commissionBalance } from '@/modules/commission/commission.calc';

const d = (n: number) => new Decimal(n);
const line = { id: 'line-1', serviceRateId: 'service-uuid-1', quantity: d(1), lineGross: d(5000), discountAmount: d(500), lineNet: d(4500) };
const now = new Date('2026-10-20T10:00:00Z');

describe('RMO staff Monthly + Commission and Daily + Commission', () => {
  it('validates RMO creation with Monthly + Commission and assigned service', () => {
    const validRmo = {
      fullName: 'Dr. RMO Hamza',
      fatherGuardianName: 'Ali',
      cnic: '35201-1234567-1',
      dateOfBirth: '1995-05-15',
      phone: '0300-1234567',
      category: 'RMO' as const,
      departmentIds: ['11111111-1111-1111-1111-111111111111'],
      serviceIds: ['22222222-2222-2222-2222-222222222222'],
      salaryProfile: {
        salaryBasis: 'MONTHLY_COMMISSION' as const,
        baseAmount: 80000,
        effectiveFrom: '2026-10-01',
      },
      commission: {
        rules: [
          {
            serviceRateId: '22222222-2222-2222-2222-222222222222',
            ruleType: 'PERCENTAGE' as const,
            rate: 20,
            basis: 'NET' as const,
          },
        ],
        effectiveFrom: '2026-10-01',
      },
    };

    const parsed = createStaffBodySchema.safeParse(validRmo);
    expect(parsed.success).toBe(true);
  });

  it('validates RMO creation with Daily + Commission and assigned service', () => {
    const validRmo = {
      fullName: 'Dr. RMO Usman',
      fatherGuardianName: 'Tariq',
      cnic: '35201-7654321-1',
      dateOfBirth: '1996-08-20',
      phone: '0321-9876543',
      category: 'RMO' as const,
      departmentIds: ['11111111-1111-1111-1111-111111111111'],
      serviceIds: ['22222222-2222-2222-2222-222222222222'],
      salaryProfile: {
        salaryBasis: 'PER_DAY_COMMISSION' as const,
        baseAmount: 3500,
        effectiveFrom: '2026-10-01',
      },
      commission: {
        rules: [
          {
            serviceRateId: '22222222-2222-2222-2222-222222222222',
            ruleType: 'FIXED_PER_SERVICE' as const,
            rate: 500,
            basis: 'NET' as const,
          },
        ],
        effectiveFrom: '2026-10-01',
      },
    };

    const parsed = createStaffBodySchema.safeParse(validRmo);
    expect(parsed.success).toBe(true);
  });

  it('rejects RMO with commission if no assigned services provided', () => {
    const invalidRmo = {
      fullName: 'Dr. RMO Test',
      fatherGuardianName: 'Test',
      cnic: '35201-1111111-1',
      dateOfBirth: '1996-08-20',
      phone: '0321-9876543',
      category: 'RMO' as const,
      departmentIds: ['11111111-1111-1111-1111-111111111111'],
      serviceIds: [],
      salaryProfile: {
        salaryBasis: 'MONTHLY_COMMISSION' as const,
        baseAmount: 60000,
        effectiveFrom: '2026-10-01',
      },
      commission: {
        rules: [],
        effectiveFrom: '2026-10-01',
      },
    };

    const parsed = createStaffBodySchema.safeParse(invalidRmo);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some(i => i.message.includes('Assigned Service'))).toBe(true);
  });

  it('RMO partial collections earn proportional net commission with separate commission tax', () => {
    const result = collectedCommission({ ruleType: 'PERCENTAGE', rate: 20, basis: 'NET', commissionTaxMethod: 'PERCENTAGE', commissionTaxValue: 5 }, line, d(2250));
    expect(result.gross.toNumber()).toBe(450); expect(result.tax.toNumber()).toBe(22.5);
  });
});
