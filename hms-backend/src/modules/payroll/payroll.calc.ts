import { Decimal } from '@prisma/client/runtime/library';
import { PAYABLE_EQUIVALENT } from '../attendance/attendance.service';

/**
 * Pure salary maths for payroll (PDF §11). Shared by Preview and Generate via
 * payroll.service `computeEligibility`, so both always produce identical figures.
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86_400_000;

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());


/**
 * A staff member's working weekdays (PDF §8): their own Weekly Timing when set
 * (OFF days excluded), otherwise their Shift's weekly-off days, otherwise every day.
 */
export function workingDaySet(schedule: { dayOfWeek: string; isWorking: boolean }[], shiftOffDays: string[]): Set<string> {
  if (schedule.length > 0) return new Set(schedule.filter((d) => d.isWorking).map((d) => d.dayOfWeek));
  const off = new Set(shiftOffDays);
  return new Set(WEEKDAY_NAMES.filter((d) => !off.has(d)));
}

/** Scheduled working days in [from, to] (UTC day timestamps, inclusive). */
function countWorkingDays(from: number, to: number, working: Set<string>): number {
  let n = 0;
  for (let t = from; t <= to; t += DAY_MS) {
    if (working.has(WEEKDAY_NAMES[new Date(t).getUTCDay()] as string)) n += 1;
  }
  return n;
}

/**
 * Monthly Scheduled Days: this employee's own scheduled working days across
 * the *complete* calendar month that `anchor` falls in — their real weekly
 * schedule/shift, never a flat constant — the true denominator for a per-day
 * rate (PDF §11, "Monthly Scheduled Working Days").
 */
function countMonthlyScheduledDays(anchor: Date, working: Set<string>): number {
  const monthStart = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1);
  const monthEnd = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0);
  return countWorkingDays(monthStart, monthEnd, working);
}

export interface SalaryProfileLike {
  salaryBasis: string;
  baseAmount: Decimal;
  fixedAllowance: Decimal;
  fixedDeduction: Decimal;
  salaryTaxMethod: string | null;
  salaryTaxValue: Decimal | null;
  // Staff-level Late-In / Early-Out cutting policy (StaffSalaryProfile.deductionRules,
  // shape {late:{mode,amount}, early_exit:{mode,amount}}) — read as-configured, never hardcoded.
  deductionRules?: unknown;
}

export interface SalaryAmounts {
  monthlyScheduledDays: number;
  dailyRate: Decimal;
  scheduledPayableDays: number;
  attendanceEquivalentDays: number;
  periodBaseAmount: Decimal;
  earnedBase: Decimal;
  attendanceDeductions: Decimal;
  allowances: Decimal;
  grossAmount: Decimal;
  tax: Decimal;
  otherDeductions: Decimal;
  lateDeduction: Decimal;
  earlyExitDeduction: Decimal;
  lateMinutes: number;
  earlyExitMinutes: number;
  netAmount: Decimal;
}

interface DeductionRule {
  mode: 'NONE' | 'PER_MINUTE' | 'FIXED_PER_OCCURRENCE';
  amount: Decimal;
}

const NO_DEDUCTION: DeductionRule = { mode: 'NONE', amount: new Decimal(0) };

function readDeductionRule(rules: unknown, key: 'late' | 'early_exit'): DeductionRule {
  if (!rules || typeof rules !== 'object') return NO_DEDUCTION;
  const rule = (rules as Record<string, unknown>)[key];
  if (!rule || typeof rule !== 'object') return NO_DEDUCTION;
  const mode = (rule as Record<string, unknown>).mode;
  const amount = (rule as Record<string, unknown>).amount;
  if (mode !== 'PER_MINUTE' && mode !== 'FIXED_PER_OCCURRENCE') return NO_DEDUCTION;
  return { mode, amount: new Decimal((amount as number | string | undefined) ?? 0) };
}

/** Late-In / Early-Out cut for the period — minutes-based or a flat amount per late/early day, as the staff member's own profile configures (never a fixed hardcoded rate). */
function computeTimingDeduction(rule: DeductionRule, totalMinutes: number, occurrences: number): Decimal {
  if (rule.mode === 'PER_MINUTE') return rule.amount.mul(totalMinutes);
  if (rule.mode === 'FIXED_PER_OCCURRENCE') return rule.amount.mul(occurrences);
  return new Decimal(0);
}

/**
 * Attendance-based salary for one staff member over the period.
 *
 *   Attendance Equivalent = Present + Half×0.5 + Paid Leave
 *
 *   MONTHLY and MONTHLY_COMMISSION (identical basis — Doctor commission is
 *   always a fully separate ledger, never blended into this figure):
 *     Monthly Scheduled Days = employee's scheduled working days across the
 *                              *complete* calendar month the period falls in
 *     Daily Rate          = Monthly Base / Monthly Scheduled Days
 *     Period Scheduled Days = scheduled working days inside the selected From/To
 *     Period Base          = Daily Rate × Period Scheduled Days
 *     Attendance Deduction = Daily Rate × (Period Scheduled Days − Attendance Equivalent)  — weekly OFFs stay paid
 *     Earned Base          = Period Base − Attendance Deduction
 *   PER_DAY(_COMMISSION): Earned = Daily Rate × equivalent
 *
 *   Gross = Earned Base + Allowance;  Tax% = Gross × %;  Net = Gross − Tax − Deduction
 *
 * A selected period is NEVER credited the full monthly salary regardless of
 * its length — Period Base always scales to however many of the month's
 * scheduled days actually fall inside the selected range. Fixed allowance /
 * deduction / fixed tax retain their configured amounts, unprorated. Daily
 * types retain their existing per-run fixed components.
 *
 * Returns null when the period has no scheduled working days.
 */
export function computeSalaryAmounts(
  profile: SalaryProfileLike,
  working: Set<string>,
  periodStart: Date,
  periodEnd: Date,
  records: { status: string; attendanceDate: Date; lateMinutes?: number; earlyExitMinutes?: number }[],
): SalaryAmounts | null {
  const zero = new Decimal(0);
  const scheduledPayableDays = countWorkingDays(utcDay(periodStart), utcDay(periodEnd), working);
  if (scheduledPayableDays === 0) return null;

  const base = profile.baseAmount;
  const isMonthly = profile.salaryBasis.startsWith('MONTHLY');

  // Only approved attendance supplied by eligibility contributes to earnings.
  let attendanceEquivalentDays = 0;
  let lateMinutes = 0;
  let lateOccurrences = 0;
  let earlyExitMinutes = 0;
  let earlyExitOccurrences = 0;
  for (const r of records) {
    const eq = PAYABLE_EQUIVALENT[r.status] ?? 0;
    attendanceEquivalentDays += eq;
    if (r.lateMinutes) {
      lateMinutes += r.lateMinutes;
      lateOccurrences += 1;
    }
    if (r.earlyExitMinutes) {
      earlyExitMinutes += r.earlyExitMinutes;
      earlyExitOccurrences += 1;
    }
  }

  let monthlyScheduledDays = scheduledPayableDays;
  let dailyRate = zero;
  let periodBaseAmount = zero;
  let earnedBase = zero;
  let attendanceDeductions = zero;
  if (isMonthly) {
    // MONTHLY and MONTHLY_COMMISSION share this exact formula — Doctor
    // commission (DoctorCommissionRule) is always computed and accrued
    // completely separately, never blended into this figure.
    monthlyScheduledDays = countMonthlyScheduledDays(periodStart, working);
    dailyRate = monthlyScheduledDays > 0 ? base.div(monthlyScheduledDays) : zero;
    const unpaidEquivalent = Decimal.max(new Decimal(scheduledPayableDays).minus(attendanceEquivalentDays), zero);
    periodBaseAmount = dailyRate.mul(scheduledPayableDays);
    attendanceDeductions = dailyRate.mul(unpaidEquivalent);
    earnedBase = periodBaseAmount.minus(attendanceDeductions);
  } else {
    dailyRate = base;
    periodBaseAmount = base.mul(scheduledPayableDays);
    earnedBase = base.mul(attendanceEquivalentDays);
    attendanceDeductions = Decimal.max(periodBaseAmount.minus(earnedBase), zero);
  }

  // Fixed allowance / deduction / fixed tax are paid at their configured
  // amount per payroll run — never prorated by period length.
  const allowances = profile.fixedAllowance;
  const otherDeductions = profile.fixedDeduction;
  const grossAmount = earnedBase.plus(allowances);

  let tax = zero;
  if (profile.salaryTaxMethod === 'PERCENTAGE' && profile.salaryTaxValue) {
    tax = grossAmount.mul(profile.salaryTaxValue).div(100);
  } else if (profile.salaryTaxMethod === 'FIXED' && profile.salaryTaxValue) {
    tax = profile.salaryTaxValue;
  }

  // Late-In / Early-Out cutting — dynamically read from this staff member's
  // own Salary Profile (`deductionRules`), never a hardcoded platform rate.
  const lateDeduction = computeTimingDeduction(readDeductionRule(profile.deductionRules, 'late'), lateMinutes, lateOccurrences);
  const earlyExitDeduction = computeTimingDeduction(readDeductionRule(profile.deductionRules, 'early_exit'), earlyExitMinutes, earlyExitOccurrences);

  const netAmount = Decimal.max(grossAmount.minus(tax).minus(otherDeductions).minus(lateDeduction).minus(earlyExitDeduction), zero);

  // SalarySlip currency columns have two decimal places. Round Monthly
  // results at this shared boundary so Preview and persisted Generate agree.
  const money = (amount: Decimal) => isMonthly ? amount.toDecimalPlaces(2) : amount;
  return {
    monthlyScheduledDays,
    dailyRate: money(dailyRate),
    scheduledPayableDays,
    attendanceEquivalentDays,
    periodBaseAmount: money(periodBaseAmount),
    earnedBase: money(earnedBase),
    attendanceDeductions: money(attendanceDeductions),
    allowances: money(allowances),
    grossAmount: money(grossAmount),
    tax: money(tax),
    otherDeductions: money(otherDeductions),
    lateDeduction: money(lateDeduction),
    earlyExitDeduction: money(earlyExitDeduction),
    lateMinutes,
    earlyExitMinutes,
    netAmount: money(netAmount),
  };
}
