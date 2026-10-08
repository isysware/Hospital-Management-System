import { describe, expect, it } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { computeSalaryAmounts, workingDaySet, SalaryProfileLike } from '@/modules/payroll/payroll.calc';

const d = (n: number) => new Decimal(n);
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const profile = (patch: Partial<SalaryProfileLike> = {}): SalaryProfileLike => ({
  salaryBasis: 'MONTHLY',
  baseAmount: d(30000),
  fixedAllowance: d(0),
  fixedDeduction: d(0),
  salaryTaxMethod: null,
  salaryTaxValue: null,
  ...patch,
});

// Sunday weekly OFF → September 2026 has 26 scheduled days (Sundays 6, 13, 20, 27).
const sundayOff = workingDaySet([], ['Sunday']);

/** One record per scheduled day in [from, to]; the first `absent` scheduled days are ABSENT, the next `half` HALF_DAY. */
function records(from: string, to: string, working: Set<string>, absent = 0, half = 0) {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const out: { status: string; attendanceDate: Date }[] = [];
  for (let t = date(from).getTime(); t <= date(to).getTime(); t += 86_400_000) {
    const day = new Date(t);
    if (!working.has(names[day.getUTCDay()] as string)) continue;
    const status = out.length < absent ? 'ABSENT' : out.length < absent + half ? 'HALF_DAY' : 'PRESENT';
    out.push({ status, attendanceDate: day });
  }
  return out;
}

const run = (p: SalaryProfileLike, from: string, to: string, recs = records(from, to, sundayOff)) =>
  computeSalaryAmounts(p, sundayOff, date(from), date(to), recs)!;

describe('payroll salary — MONTHLY uses the employee\'s actual Monthly Scheduled Days as divisor', () => {
  it('pays the full monthly base for full attendance, whatever the scheduled day count', () => {
    const r = run(profile(), '2026-09-01', '2026-09-30');
    expect(r.monthlyScheduledDays).toBe(26);
    expect(r.scheduledPayableDays).toBe(26);
    expect(r.attendanceEquivalentDays).toBe(26);
    expect(r.periodBaseAmount.toNumber()).toBe(30000);
    expect(r.attendanceDeductions.toNumber()).toBe(0);
    expect(r.earnedBase.toNumber()).toBe(30000);
    expect(r.netAmount.toNumber()).toBe(30000);
  });

  it('deducts Base/26 per unpaid scheduled day — the employee\'s real Monthly Scheduled Days, never a flat 30', () => {
    const r = run(profile(), '2026-09-01', '2026-09-30', records('2026-09-01', '2026-09-30', sundayOff, 2));
    expect(r.monthlyScheduledDays).toBe(26);
    expect(r.dailyRate.toNumber()).toBeCloseTo(30000 / 26, 2);
    expect(r.scheduledPayableDays).toBe(26);
    expect(r.attendanceEquivalentDays).toBe(24);
    expect(r.attendanceDeductions.toNumber()).toBeCloseTo(2 * (30000 / 26), 2); // 2 × 30000/26, not 2 × 30000/30
    expect(r.earnedBase.toNumber()).toBeCloseTo(30000 - 2 * (30000 / 26), 2);
  });

  it('counts a half day as half an unpaid day', () => {
    const r = run(profile(), '2026-09-01', '2026-09-30', records('2026-09-01', '2026-09-30', sundayOff, 0, 1));
    expect(r.attendanceDeductions.toNumber()).toBeCloseTo(0.5 * (30000 / 26), 2);
    expect(r.earnedBase.toNumber()).toBeCloseTo(30000 - 0.5 * (30000 / 26), 2);
  });

  it('builds Gross, Tax and Net on the real earned base', () => {
    const p = profile({ fixedAllowance: d(3000), fixedDeduction: d(500), salaryTaxMethod: 'PERCENTAGE', salaryTaxValue: d(10) });
    const r = run(p, '2026-09-01', '2026-09-30', records('2026-09-01', '2026-09-30', sundayOff, 2));
    const earned = 30000 - 2 * (30000 / 26);
    expect(r.allowances.toNumber()).toBe(3000);
    expect(r.grossAmount.toNumber()).toBeCloseTo(earned + 3000, 2);
    expect(r.tax.toNumber()).toBeCloseTo((earned + 3000) * 0.1, 2);
    expect(r.otherDeductions.toNumber()).toBe(500);
    expect(r.netAmount.toNumber()).toBeCloseTo(earned + 3000 - (earned + 3000) * 0.1 - 500, 2);
  });

  it('pays exactly one monthly base for a whole 31-day or 28-day month', () => {
    expect(run(profile(), '2026-10-01', '2026-10-31').earnedBase.toNumber()).toBe(30000);
    expect(run(profile(), '2026-02-01', '2026-02-28').earnedBase.toNumber()).toBe(30000);
  });

  it('prorates Period Base to the period\'s own scheduled days — never the full monthly base for a partial period', () => {
    // Dr Huzaifa reported bug: a short selected range must not be credited the
    // full monthly salary. Sep 1-10 2026 (Sunday OFF) has 9 of September's 26
    // scheduled days — Period Base must be 9/26 of the monthly base, not 30,000.
    const r = run(profile({ fixedAllowance: d(3000) }), '2026-09-01', '2026-09-10');
    expect(r.monthlyScheduledDays).toBe(26);
    expect(r.scheduledPayableDays).toBe(9);
    expect(r.periodBaseAmount.toNumber()).toBeCloseTo(9 * (30000 / 26), 2);
    expect(r.earnedBase.toNumber()).toBeCloseTo(9 * (30000 / 26), 2); // full attendance for the 9 scheduled days
    expect(r.allowances.toNumber()).toBe(3000); // fixed allowance stays unprorated
  });

  it('keeps weekly OFF days paid when every scheduled day is absent, floored by the period\'s own Period Base', () => {
    const r = run(profile(), '2026-09-01', '2026-09-30', records('2026-09-01', '2026-09-30', sundayOff, 26));
    expect(r.periodBaseAmount.toNumber()).toBe(30000);
    expect(r.attendanceDeductions.toNumber()).toBeCloseTo(30000, 2); // 26 unpaid × 30000/26 == the full Period Base
    expect(r.earnedBase.toNumber()).toBeCloseTo(0, 2);
  });

  it('cannot go negative for a full-month period — the deduction can never exceed that period\'s own Period Base', () => {
    const everyDay = workingDaySet([], []);
    const r = computeSalaryAmounts(profile(), everyDay, date('2026-10-01'), date('2026-10-31'),
      records('2026-10-01', '2026-10-31', everyDay, 31))!;
    expect(r.scheduledPayableDays).toBe(31);
    expect(r.attendanceDeductions.toNumber()).toBeCloseTo(30000, 2);
    expect(r.earnedBase.toNumber()).toBeCloseTo(0, 2);
    expect(r.netAmount.toNumber()).toBe(0);
  });

  it('returns null when the period has no scheduled days', () => {
    expect(computeSalaryAmounts(profile(), sundayOff, date('2026-09-06'), date('2026-09-06'), [])).toBeNull();
  });
});

describe('payroll salary — exact acceptance scenario (Dr Huzaifa, Monthly + Commission, PKR 30,000)', () => {
  // October 2026 with Saturday as the only weekly OFF has exactly 26 scheduled
  // working days (5 Saturdays in a 31-day October) — the "26 scheduled days"
  // assumption from the reported bug. Oct 5 (Mon) / 6 (Tue) are both scheduled.
  const saturdayOff = workingDaySet([], ['Saturday']);
  const huzaifa = profile({ salaryBasis: 'MONTHLY_COMMISSION', baseAmount: d(30000) });

  it('TEST A — 05/10/2026 → 06/10/2026, 2 scheduled, 1 present/1 absent: Daily Rate 1,153.85, Period Base 2,307.69, Deduction 1,153.85, Earned 1,153.85 (never Period Base 30,000 / Deduction 1,000)', () => {
    const r = computeSalaryAmounts(huzaifa, saturdayOff, date('2026-10-05'), date('2026-10-06'), [
      { status: 'PRESENT', attendanceDate: date('2026-10-05') },
      { status: 'ABSENT', attendanceDate: date('2026-10-06') },
    ])!;
    expect(r.monthlyScheduledDays).toBe(26);
    expect(r.dailyRate.toNumber()).toBeCloseTo(1153.85, 2);
    expect(r.scheduledPayableDays).toBe(2);
    expect(r.attendanceEquivalentDays).toBe(1);
    expect(r.periodBaseAmount.toNumber()).toBeCloseTo(2307.69, 2);
    expect(r.attendanceDeductions.toNumber()).toBeCloseTo(1153.85, 2);
    expect(r.earnedBase.toNumber()).toBeCloseTo(1153.85, 2);
    expect(r.grossAmount.toNumber()).toBeCloseTo(1153.85, 2);
    expect(r.netAmount.toNumber()).toBeCloseTo(1153.85, 2);
  });

  it('TEST B — full October, 26 scheduled, 26 present: Period Base 30,000, Deduction 0, Earned 30,000', () => {
    const r = computeSalaryAmounts(huzaifa, saturdayOff, date('2026-10-01'), date('2026-10-31'),
      records('2026-10-01', '2026-10-31', saturdayOff))!;
    expect(r.monthlyScheduledDays).toBe(26);
    expect(r.scheduledPayableDays).toBe(26);
    expect(r.periodBaseAmount.toNumber()).toBe(30000);
    expect(r.attendanceDeductions.toNumber()).toBe(0);
    expect(r.earnedBase.toNumber()).toBe(30000);
  });

  it('TEST C — full October, 26 scheduled, 25 present/1 absent: Deduction ≈ 1,153.85, Earned ≈ 28,846.15', () => {
    const r = computeSalaryAmounts(huzaifa, saturdayOff, date('2026-10-01'), date('2026-10-31'),
      records('2026-10-01', '2026-10-31', saturdayOff, 1))!;
    expect(r.attendanceDeductions.toNumber()).toBeCloseTo(1153.85, 2);
    expect(r.earnedBase.toNumber()).toBeCloseTo(28846.15, 2);
  });

  it('TEST D — a weekly OFF day (Saturday) never creates an absence deduction', () => {
    // Oct 3 2026 is a Saturday (OFF). A period spanning Oct 2 (Fri, scheduled)
    // through Oct 4 (Sun, scheduled) has 2 scheduled days, not 3 — the OFF day
    // contributes no scheduled day and so cannot be deducted as absent.
    const r = computeSalaryAmounts(huzaifa, saturdayOff, date('2026-10-02'), date('2026-10-04'), [
      { status: 'PRESENT', attendanceDate: date('2026-10-02') },
      { status: 'PRESENT', attendanceDate: date('2026-10-04') },
    ])!;
    expect(r.scheduledPayableDays).toBe(2);
    expect(r.attendanceDeductions.toNumber()).toBe(0);
  });
});

describe('payroll salary — MONTHLY across 24 / 28 / 30 / 31 scheduled days', () => {
  const everyDay = workingDaySet([], []);
  // [label, schedule, whole-month period, expected scheduled days]
  const scenarios: [string, Set<string>, string, string, number][] = [
    ['24 scheduled (Feb, Sunday OFF)', sundayOff, '2026-02-01', '2026-02-28', 24],
    ['28 scheduled (Feb, no OFF)', everyDay, '2026-02-01', '2026-02-28', 28],
    ['29 scheduled (leap February, no OFF)', everyDay, '2028-02-01', '2028-02-29', 29],
    ['30 scheduled (Sep, no OFF)', everyDay, '2026-09-01', '2026-09-30', 30],
    ['31 scheduled (Oct, no OFF)', everyDay, '2026-10-01', '2026-10-31', 31],
  ];
  const full = profile({ fixedAllowance: d(3000), fixedDeduction: d(600), salaryTaxMethod: 'PERCENTAGE', salaryTaxValue: d(10) });

  for (const [label, working, from, to, scheduled] of scenarios) {
    it(`${label}: full attendance earns the full base`, () => {
      const r = computeSalaryAmounts(full, working, date(from), date(to), records(from, to, working))!;
      expect(r.scheduledPayableDays).toBe(scheduled);
      expect(r.attendanceEquivalentDays).toBe(scheduled);
      expect(r.periodBaseAmount.toNumber()).toBe(30000);
      expect(r.attendanceDeductions.toNumber()).toBe(0);
      expect(r.earnedBase.toNumber()).toBe(30000);
      expect(r.allowances.toNumber()).toBe(3000);
      expect(r.grossAmount.toNumber()).toBe(33000);
      expect(r.tax.toNumber()).toBe(3300);
      expect(r.otherDeductions.toNumber()).toBe(600);
      expect(r.netAmount.toNumber()).toBe(29100);
    });

    it(`${label}: 2 absent days deduct 2 × Base/${scheduled} (this period's own Monthly Scheduled Days), never a flat Base/30`, () => {
      const r = computeSalaryAmounts(full, working, date(from), date(to), records(from, to, working, 2))!;
      const dailyRate = 30000 / scheduled;
      const earned = 30000 - 2 * dailyRate;
      expect(r.monthlyScheduledDays).toBe(scheduled);
      expect(r.scheduledPayableDays).toBe(scheduled);
      expect(r.attendanceEquivalentDays).toBe(scheduled - 2);
      expect(r.attendanceDeductions.toNumber()).toBeCloseTo(2 * dailyRate, 2);
      expect(r.earnedBase.toNumber()).toBeCloseTo(earned, 2);
      expect(r.grossAmount.toNumber()).toBeCloseTo(earned + 3000, 2);
      expect(r.tax.toNumber()).toBeCloseTo((earned + 3000) * 0.1, 2);
      expect(r.netAmount.toNumber()).toBeCloseTo(earned + 3000 - (earned + 3000) * 0.1 - 600, 2);
    });
  }
});

describe('payroll salary — MONTHLY_COMMISSION uses the exact same Monthly-Scheduled-Days basis as MONTHLY', () => {
  it('divides by this employee\'s actual Monthly Scheduled Days — Base/26 per day here, never a flat Base/30', () => {
    // Reported bug case: PKR 30,000 base, 26 scheduled, 1 present, 25 absent.
    // Daily rate = 30,000/26 ≈ 1,153.85. Deduction = 25 × 1,153.85 ≈ 28,846.15. Earned ≈ 1,153.85.
    const r = run(
      profile({ salaryBasis: 'MONTHLY_COMMISSION', baseAmount: d(30000) }),
      '2026-09-01', '2026-09-30',
      records('2026-09-01', '2026-09-30', sundayOff, 25),
    );
    expect(r.monthlyScheduledDays).toBe(26);
    expect(r.dailyRate.toNumber()).toBeCloseTo(30000 / 26, 2);
    expect(r.scheduledPayableDays).toBe(26);
    expect(r.attendanceEquivalentDays).toBe(1);
    expect(r.periodBaseAmount.toNumber()).toBe(30000);
    expect(r.attendanceDeductions.toNumber()).toBeCloseTo(25 * (30000 / 26), 2);
    expect(r.earnedBase.toNumber()).toBeCloseTo(30000 - 25 * (30000 / 26), 2);
  });

  it('produces identical earnedBase/attendanceDeductions to plain MONTHLY for the same inputs', () => {
    const recs = records('2026-09-01', '2026-09-30', sundayOff, 2);
    const monthly = run(profile({ salaryBasis: 'MONTHLY', baseAmount: d(30000) }), '2026-09-01', '2026-09-30', recs);
    const monthlyCommission = run(profile({ salaryBasis: 'MONTHLY_COMMISSION', baseAmount: d(30000) }), '2026-09-01', '2026-09-30', recs);
    expect(monthlyCommission.earnedBase.toNumber()).toBe(monthly.earnedBase.toNumber());
    expect(monthlyCommission.attendanceDeductions.toNumber()).toBe(monthly.attendanceDeductions.toNumber());
    expect(monthlyCommission.periodBaseAmount.toNumber()).toBe(monthly.periodBaseAmount.toNumber());
  });

  it('full attendance still pays the full monthly base, whatever the scheduled day count', () => {
    const r = run(profile({ salaryBasis: 'MONTHLY_COMMISSION', baseAmount: d(30000) }), '2026-09-01', '2026-09-30');
    expect(r.attendanceDeductions.toNumber()).toBe(0);
    expect(r.earnedBase.toNumber()).toBe(30000);
    expect(r.netAmount.toNumber()).toBe(30000);
  });
});

describe('payroll salary — other bases are unchanged', () => {
  it('PER_DAY pays the daily rate × attendance equivalent', () => {
    const r = run(profile({ salaryBasis: 'PER_DAY', baseAmount: d(1000), fixedAllowance: d(500) }), '2026-09-01', '2026-09-30',
      records('2026-09-01', '2026-09-30', sundayOff, 2));
    expect(r.periodBaseAmount.toNumber()).toBe(26000);
    expect(r.earnedBase.toNumber()).toBe(24000);
    expect(r.allowances.toNumber()).toBe(500);
  });
});

describe('payroll salary — Late-In / Early-Out cutting (deductionRules, staff.md §11)', () => {
  it('cuts nothing when no deductionRules are configured on the profile', () => {
    const r = run(profile(), '2026-09-01', '2026-09-30');
    expect(r.lateMinutes).toBe(0);
    expect(r.earlyExitMinutes).toBe(0);
    expect(r.lateDeduction.toNumber()).toBe(0);
    expect(r.earlyExitDeduction.toNumber()).toBe(0);
    expect(r.netAmount.toNumber()).toBe(30000);
  });

  it('cuts PKR per late minute — dynamically from the staff profile, never a hardcoded rate', () => {
    const recs = records('2026-09-01', '2026-09-30', sundayOff).map((r, i) => (i < 3 ? { ...r, lateMinutes: 10 } : r));
    const p = profile({ deductionRules: { late: { mode: 'PER_MINUTE', amount: 20 } } });
    const r = run(p, '2026-09-01', '2026-09-30', recs);
    expect(r.lateMinutes).toBe(30);
    expect(r.lateDeduction.toNumber()).toBe(600); // 30 min × PKR 20
    expect(r.netAmount.toNumber()).toBe(30000 - 600);
  });

  it('cuts a flat amount per late occurrence when the mode is FIXED_PER_OCCURRENCE, not per minute', () => {
    const recs = records('2026-09-01', '2026-09-30', sundayOff).map((r, i) => (i < 3 ? { ...r, lateMinutes: 45 } : r));
    const p = profile({ deductionRules: { late: { mode: 'FIXED_PER_OCCURRENCE', amount: 100 } } });
    const r = run(p, '2026-09-01', '2026-09-30', recs);
    expect(r.lateDeduction.toNumber()).toBe(300); // 3 late days × PKR 100
  });

  it('cuts Early-Out independently of Late-In, using its own configured rate', () => {
    const recs = records('2026-09-01', '2026-09-30', sundayOff).map((r, i) => (i < 2 ? { ...r, earlyExitMinutes: 15 } : r));
    const p = profile({ deductionRules: { early_exit: { mode: 'PER_MINUTE', amount: 10 } } });
    const r = run(p, '2026-09-01', '2026-09-30', recs);
    expect(r.earlyExitMinutes).toBe(30);
    expect(r.earlyExitDeduction.toNumber()).toBe(300);
    expect(r.lateDeduction.toNumber()).toBe(0);
  });

  it('ignores a malformed/unknown deductionRules shape instead of throwing', () => {
    const p = profile({ deductionRules: { late: { mode: 'SOMETHING_ELSE', amount: 999 } } });
    const r = run(p, '2026-09-01', '2026-09-30');
    expect(r.lateDeduction.toNumber()).toBe(0);
  });
});
