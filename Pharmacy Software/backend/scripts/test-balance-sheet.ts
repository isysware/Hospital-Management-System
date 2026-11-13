import assert from 'node:assert/strict';
import { Decimal } from '@prisma/client/runtime/library';
import { summarizeCashEntries, balanceSheetRange } from '../src/modules/cash/balanceSheet.util';
import { balanceSheetQuerySchema } from '../src/modules/cash/cash.schemas';

const row = (category: string, amount: number, direction = 'IN', isPhysicalCash = true, isSettled = false) => ({ category, amount: new Decimal(amount), direction, isPhysicalCash, isSettled });
const mixed = summarizeCashEntries([
  row('PETTY_CASH_RECEIVED', 100), row('PETTY_CASH_ISSUED', 20, 'OUT'), row('POS_COLLECTION', 1000),
  row('HMS_COLLECTION', 200), row('POS_COLLECTION', 500, 'IN', false), row('REFUND', 50, 'OUT'),
  row('REFUND', 30, 'OUT', false), row('EXPENSE_PAYMENT', 40, 'OUT'), row('VENDOR_PAYMENT', 70, 'OUT'),
  row('VENDOR_PAYMENT', 100, 'OUT', false), row('ADJUSTMENT', 10, 'OUT'),
]);
assert.equal(mixed.expectedPhysicalCash.toString(), '1110');
assert.equal(mixed.remainingAmount.toString(), '1110');
assert.equal(mixed.nonPhysicalTotal.toString(), '370');
assert.equal(mixed.pettyCash.toString(), '80');
assert.equal(mixed.cashExpenses.toString(), '110');
assert.equal(mixed.totalCollections.toString(), '1700');
assert.equal(mixed.totalRefunds.toString(), '80');
assert.equal(mixed.pettyCash.plus(mixed.cashCollections).minus(mixed.cashExpenses).minus(mixed.cashRefunds).plus(mixed.adjustments).toString(), mixed.expectedPhysicalCash.toString());

const settled = summarizeCashEntries([row('POS_COLLECTION', 1000, 'IN', true, true), row('SETTLEMENT_HANDOVER', 1000, 'OUT', true, true), row('POS_COLLECTION', 200)]);
assert.equal(settled.expectedPhysicalCash.toString(), '1200'); // handover is not an expense
assert.equal(settled.remainingAmount.toString(), '200');
assert.equal(settled.unsettledCount, 1);
assert.equal(summarizeCashEntries([]).expectedPhysicalCash.toString(), '0');
assert.equal(summarizeCashEntries([row('POS_COLLECTION', 0.1), row('POS_COLLECTION', 0.2)]).expectedPhysicalCash.toString(), '0.3');
assert.equal(summarizeCashEntries([row('REFUND', 40, 'OUT')]).expectedPhysicalCash.toString(), '-40');

const now = new Date('2026-11-12T20:00:00Z'); // already Nov 13 in Pakistan
assert.equal(balanceSheetRange({ preset: 'today' }, now)?.gte?.toISOString(), '2026-11-12T19:00:00.000Z');
assert.equal(balanceSheetRange({ preset: 'today' }, now)?.lte?.toISOString(), '2026-11-13T18:59:59.999Z');
assert.equal(balanceSheetRange({ preset: 'yesterday' }, now)?.gte?.toISOString(), '2026-11-11T19:00:00.000Z');
assert.equal(balanceSheetRange({ preset: 'this_week' }, now)?.gte?.toISOString(), '2026-11-08T19:00:00.000Z');
assert.equal(balanceSheetRange({ preset: 'this_month' }, now)?.gte?.toISOString(), '2026-10-31T19:00:00.000Z');
assert.equal(balanceSheetRange({}), null);
assert.equal(balanceSheetQuerySchema.safeParse({ preset: 'custom', fromDate: '2026-11-14', toDate: '2026-11-13' }).success, false);
assert.equal(balanceSheetQuerySchema.safeParse({ preset: 'custom' }).success, false);
assert.equal(balanceSheetQuerySchema.safeParse({ preset: 'custom', fromDate: '2026-11-13', toDate: '2026-11-13' }).success, true);
console.log('Balance sheet: cash/non-cash, refunds, expenses, handovers, decimals, period boundaries and date validation passed.');
