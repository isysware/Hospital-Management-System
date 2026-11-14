import { describe, it, expect } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { collectedCommission } from '@/modules/commission/commission.collections';
import { commissionBalance } from '@/modules/commission/commission.calc';
import { computeSalaryAmounts, workingDaySet } from '@/modules/payroll/payroll.calc';
import { createCommissionRuleSchema, commissionRunFiltersSchema, financialAdjustmentSchema } from '@/modules/commission/commission.schemas';
const d = (n: number) => new Decimal(n);
const line = { lineGross: d(10000), lineNet: d(9000), quantity: d(1) };
// Eligibility, receipt persistence, idempotency and paid recovery are exercised
// through real transactions in commissionCollectionsDatabase.test.ts.
describe('collected commission contracts and balances', () => {
  it.each([0, 4500, 9000, 12000])('caps percentage earnings for collected %s', collected => {
    const result = collectedCommission({ ruleType: 'PERCENTAGE', basis: 'NET', rate: 15, commissionTaxMethod: 'PERCENTAGE', commissionTaxValue: 10 }, line, d(collected));
    expect(result.gross.toNumber()).toBe(Math.min(collected, 9000) * .15);
    expect(result.tax.toNumber()).toBe(Math.min(collected, 9000) * .015);
  });
  it('preserves gross-basis discount policy while prorating actual collections', () => {
    expect(collectedCommission({ ruleType: 'PERCENTAGE', basis: 'GROSS', rate: 20 }, line, d(4500)).gross.toNumber()).toBe(1000);
  });
  it('prorates fixed service commissions and fixed withholding once per contract', () => {
    const result = collectedCommission({ ruleType: 'FIXED_PER_SERVICE', rate: 500, commissionTaxMethod: 'FIXED', commissionTaxValue: 100 }, { ...line, quantity: d(12) }, d(4500));
    expect(result.gross.toNumber()).toBe(3000); expect(result.tax.toNumber()).toBe(50);
  });
  it('zero-value and uncollected services cannot generate fixed commissions', () => {
    expect(collectedCommission({ ruleType: 'FIXED_PER_SERVICE', rate: 500 }, { ...line, lineNet: d(0) }, d(100)).gross.toNumber()).toBe(0);
    expect(collectedCommission({ ruleType: 'FIXED_PER_SERVICE', rate: 500 }, line, d(0)).gross.toNumber()).toBe(0);
  });
  it('exposes recovery without rewriting paid statements', () => {
    const b = commissionBalance({ commissionAmount: d(1350), ruleSnapshot: { commissionTaxAmount: 135, commissionTaxMethod: 'PERCENTAGE', commissionTaxValue: 10 },
      reversals: [{ reversalAmount: d(135) }], payouts: [{ amount: d(1215) }], adjustments: [{ amount: d(85) }] });
    expect(b.payable.toNumber()).toBe(1178.5); expect(b.tax.toNumber()).toBe(121.5); expect(b.overpaid.toNumber()).toBe(36.5);
  });
  it('uses frozen per-receipt tax cents and explicit refund withholding', () => {
    const b = commissionBalance({ commissionAmount: d(1), ruleSnapshot: { collectionBased: true, commissionTaxAmount: .03, commissionTaxMethod: 'PERCENTAGE', commissionTaxValue: 2.5 },
      reversals: [{ reversalAmount: d(.5), taxAmount: d(.02), source: 'COLLECTION' }], payouts: [] });
    expect(b.tax.toNumber()).toBe(.01); expect(b.payable.toNumber()).toBe(.49);
  });
});

describe('blueprint salary examples keep service commission separate', () => {
  const baseProfile = { salaryBasis: 'MONTHLY_COMMISSION', baseAmount: d(60000), fixedAllowance: d(2000), fixedDeduction: d(1000), salaryTaxMethod: 'PERCENTAGE', salaryTaxValue: d(5) };
  it('monthly + commission: 27.5 of 30 scheduled days gives 53,150 net salary', () => {
    const statuses = [...Array(26).fill('PRESENT'), 'HALF_DAY', 'PAID_LEAVE', 'ABSENT', 'ABSENT'];
    const records = statuses.map((status, i) => ({ status, attendanceDate: new Date(Date.UTC(2026, 8, i + 1)) }));
    const r = computeSalaryAmounts(baseProfile, workingDaySet([], []), new Date('2026-09-01'), new Date('2026-09-30'), records)!;
    expect(r.attendanceEquivalentDays).toBe(27.5); expect(r.netAmount.toNumber()).toBe(53150);
  });
  it.each(['PER_DAY', 'PER_DAY_COMMISSION'])('%s: 8.5 days × 3,000 minus 500 tax and 300 deduction = 24,700', salaryBasis => {
    const records = [...Array(8).fill('PRESENT'), 'HALF_DAY', 'ABSENT'].map((status, i) => ({ status, attendanceDate: new Date(Date.UTC(2026, 8, i + 1)) }));
    const r = computeSalaryAmounts({ ...baseProfile, salaryBasis, baseAmount: d(3000), fixedAllowance: d(0), fixedDeduction: d(300), salaryTaxMethod: 'FIXED', salaryTaxValue: d(500) }, workingDaySet([], []), new Date('2026-09-01'), new Date('2026-09-10'), records)!;
    expect(r.netAmount.toNumber()).toBe(24700);
  });
  it('monthly + commission prorates a partial period using the fixed 30-day daily rate', () => {
    // 10-day custom period, 1 present of 10 scheduled. Daily rate stays Base/30 =
    // 2,000; period base = 20,000; nine absent days deduct 18,000; earned = 2,000.
    // — same divisor plain MONTHLY uses, whatever the selected period's length.
    const records = [{ status: 'PRESENT', attendanceDate: new Date('2026-09-01') }];
    const r = computeSalaryAmounts({ ...baseProfile, fixedAllowance: d(0), fixedDeduction: d(0), salaryTaxMethod: null, salaryTaxValue: null }, workingDaySet([], []), new Date('2026-09-01'), new Date('2026-09-10'), records)!;
    expect(r.periodBaseAmount.toNumber()).toBe(20000);
    expect(r.attendanceDeductions.toNumber()).toBe(18000);
    expect(r.earnedBase.toNumber()).toBe(2000);
  });
});

it('validates run dates, percentages and audited corrections', () => {
  expect(commissionRunFiltersSchema.safeParse({ periodType: 'DAILY', periodStart: '2026-09-01', periodEnd: '2026-09-02' }).success).toBe(false);
  expect(createCommissionRuleSchema.safeParse({ staffId: '00000000-0000-4000-8000-000000000001', rate: 101, ruleType: 'PERCENTAGE', effectiveFrom: '2026-09-01' }).success).toBe(false);
  expect(financialAdjustmentSchema.safeParse({ amount: 0, reason: '' }).success).toBe(false);
});
