import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { postVendorPayment } from '../src/modules/vendors/vendorPayments';
import { vendorsService } from '../src/modules/vendors/vendors.service';
import { createPurchaseBodySchema, purchaseReturnBodySchema } from '../src/modules/vendors/vendors.schemas';
import { incomeExpenseReport } from '../src/modules/reports/incomeExpense';
import { cashService } from '../src/modules/cash/cash.service';
import { balanceSheetRange } from '../src/modules/cash/balanceSheet.util';
const db = new PrismaClient();
const rollback = new Error('ROLLBACK_ACCEPTANCE');
let checks = 0;
function eq(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); checks++; console.log('PASS', label); }
async function main() {
  try {
    await db.$transaction(async tx => {
      const key = randomUUID();
      const user = await tx.portalUser.create({ data: { username: key, fullName: 'Financial acceptance', passwordHash: 'unused', role: 'SUPER_ADMIN' } });
      const other = await tx.portalUser.create({ data: { username: key + '2', fullName: 'Other cashier', passwordHash: 'unused', role: 'SALES_DISPENSING' } });
      const vendor = await tx.vendor.create({ data: { code: key, name: key, createdById: user.id } });
      const account = await tx.paymentAccount.create({ data: { name: key } });
      const unit = await tx.unit.create({ data: { name: key, shortCode: key.slice(0,8) } });
      const medicine = await tx.medicineMaster.create({ data: { code: key, name: key, unit: 'Tablet', baseUnitId: unit.id, saleRate: 5000, purchaseRate: 1000 } });
      const range = balanceSheetRange({ preset: 'today' })!;
      const historicalRange = { lte: new Date(range.gte!.getTime()-1) };
      const historical = (await incomeExpenseReport(tx,historicalRange)).totals;
      const baseline = (await incomeExpenseReport(tx, range)).totals;
      const purchaseBody = createPurchaseBodySchema.parse({ requestKey: randomUUID(), vendorId: vendor.id, purchaseDate: new Date(), paidNow: 0, lines: [{ medicineId: medicine.id, purchaseUnitId: unit.id, purchaseUnitQuantity: 10, unitCost: 1000, expiryDate: '2099-01-01' }] });
      const purchase = await vendorsService.createPurchase(purchaseBody, user.id, tx);
      eq((await vendorsService.createPurchase(purchaseBody, user.id, tx)).id,purchase.id,'Duplicate purchase callback posts once');
      eq(Number(purchase.total), 10000, 'Credit purchase posts supplier payable');
      const pay = { amount: 6000, method: 'CASH' as const, requestKey: randomUUID() };
      const posted = await postVendorPayment(tx, vendor.id, pay, user.id);
      eq((await postVendorPayment(tx, vendor.id, pay, user.id)).id, posted.id, 'Duplicate payment returns original posting');
      await assert.rejects(postVendorPayment(tx, vendor.id, { ...pay, amount: 6001 }, user.id)); checks++;
      await assert.rejects(postVendorPayment(tx, vendor.id, { ...pay, requestKey: randomUUID(), method: 'ONLINE' }, user.id)); checks++;
      await postVendorPayment(tx, vendor.id, { amount: 4000, method: 'ONLINE', paymentAccountId: account.id, requestKey: randomUUID() }, user.id);
      eq(Number((await tx.vendorLedgerEntry.aggregate({ where: { vendorId: vendor.id }, _sum: { amount: true } }))._sum.amount), 0, 'Partial then full supplier payments clear payable');
      await tx.cashLedgerEntry.createMany({ data: [
        { portalUserId: user.id, amount: 20000, direction: 'IN', category: 'ADJUSTMENT', occurredAt: new Date(range.gte!.getTime() - 1000) },
        { portalUserId: user.id, amount: 5000, direction: 'IN', category: 'POS_COLLECTION' },
        { portalUserId: user.id, amount: 500, direction: 'OUT', category: 'EXPENSE_PAYMENT' },
        { portalUserId: other.id, amount: 1000, direction: 'IN', category: 'POS_COLLECTION' },
      ] });
      await tx.expense.create({ data: { expenseNumber: key, category: 'Utilities', date: new Date(), amount: 500, paymentMethod: 'CASH', description: 'Acceptance', enteredById: user.id } });
      const invoice = await tx.pharmacyInvoice.create({ data: { invoiceNumber: key, channel: 'RETAIL', collectionOwner: 'PHARMACY_RETAIL', subtotal: 5000, total: 5000, paidTotal: 5000, outstanding: 0, dispensedById: user.id,
        lines: { create: { medicineId: medicine.id, quantity: 1, rateSnapshot: 5000, lineNet: 5000, costRateSnapshot: 3000 } },
        payments: { create: { amount: 5000, method: 'CASH', collectedById: user.id } },
      } });
      assert.ok(invoice.id);
      const summary = (await cashService.getBalanceSheet(user.id, { preset: 'today' }, tx)).summary;
      eq(Number(summary.openingCash), 20000, 'Opening cash carries forward');
      eq(Number(summary.vendorPayments), 6000, 'Only cash vendor payments affect drawer');
      eq(Number(summary.cashExpenses), 500, 'Vendor payment excluded from operating expenses');
      eq(Number(summary.closingCash), 18500, '20000 + 5000 - 6000 - 500 = 18500');
      eq(Number((await cashService.getBalanceSheet(other.id, { preset: 'today' }, tx)).summary.closingCash), 1000, 'Cashiers remain separate');
      const income = (await incomeExpenseReport(tx, range)).totals;
      eq(Number(income.recognizedRevenue.minus(baseline.recognizedRevenue)), 5000, 'Recognized revenue reuses canonical engine');
      eq(Number(income.recognizedCogs.minus(baseline.recognizedCogs)), 3000, 'COGS matched once');
      eq(Number(income.operatingExpenses.minus(baseline.operatingExpenses)), 500, 'Only valid operating expense affects profit');
      eq(Number(income.operatingProfit?.minus(baseline.operatingProfit!)), 1500, 'Vendor payment does not reduce profit');
      eq(Number(income.vendorPayments.minus(baseline.vendorPayments)), 10000, 'All methods included in vendor payment report');
      const advance = await postVendorPayment(tx, vendor.id, { amount: 2000, method: 'BANK', paymentAccountId: account.id, requestKey: randomUUID() }, user.id);
      const refund = { amount: 1000, method: 'BANK' as const, paymentAccountId: account.id, requestKey: randomUUID(), refundOf: advance.id };
      await postVendorPayment(tx, vendor.id, refund, user.id);
      await postVendorPayment(tx, vendor.id, refund, user.id);
      eq(Number((await tx.vendorLedgerEntry.aggregate({ where: { vendorId: vendor.id }, _sum: { amount: true } }))._sum.amount), -1000, 'Advance and linked refund preserve remaining supplier credit');
      const retBody = purchaseReturnBodySchema.parse({ vendorId: vendor.id, requestKey: randomUUID(), reason: 'Acceptance return', lines: [{ medicineId: medicine.id, batchId: purchase.lines[0].batchId, returnUnitQuantity: 1 }] });
      const returned = await vendorsService.purchaseReturn(retBody, user.id, tx);
      eq(Number(returned.amount), -1000, 'Purchase return credits vendor at frozen batch cost');
      await assert.rejects(vendorsService.purchaseReturn(retBody, user.id, tx)); checks++;
      await postVendorPayment(tx, vendor.id, { amount: 1000, method: 'BANK', paymentAccountId: account.id, requestKey: randomUUID(), refundOf: returned.id }, user.id);
      eq(Number((await tx.stockLedgerEntry.aggregate({ where: { batchId: purchase.lines[0].batchId }, _sum: { quantityDelta: true } }))._sum.quantityDelta), 9, 'Purchase return moves stock exactly once');
      const bank = await tx.cashLedgerEntry.findMany({ where: { paymentAccountId: account.id } });
      eq(bank.reduce((sum,e) => sum + (e.direction === 'IN' ? Number(e.amount) : -Number(e.amount)),0), -4000, 'Bank payments and refunds reconcile by account');
      eq(Number((await cashService.getBalanceSheet(user.id, { preset: 'today' }, tx)).summary.closingCash), 18500, 'Online supplier movements never change physical cash');
      const final = (await incomeExpenseReport(tx, range)).totals;
      eq(Number(final.operatingProfit?.minus(baseline.operatingProfit!)),1500,'Supplier advance, return and refund never affect operating profit');
      eq(Number(final.supplierAdvances.minus(baseline.supplierAdvances)),1000,'Supplier advances reported separately from vendor liabilities');
      const draft = await vendorsService.createPurchase(createPurchaseBodySchema.parse({ requestKey: randomUUID(), vendorId: vendor.id, purchaseDate: new Date(), post: false, paidNow: 500, paymentType: 'CASH', lines: [{ medicineId: medicine.id, purchaseUnitId: unit.id, purchaseUnitQuantity: 1, unitCost: 1000, expiryDate: '2099-01-01' }] }), other.id, tx);
      eq(await tx.cashLedgerEntry.count({ where: { referenceId: draft.id } }),0,'Draft purchase creates no payment');
      await vendorsService.postPurchase(draft.id,other.id,tx);
      await assert.rejects(vendorsService.postPurchase(draft.id,other.id,tx)); checks++;
      eq(await tx.cashLedgerEntry.count({ where: { referenceId: draft.id } }),1,'Draft posting pays once');
      const onlinePurchase = await vendorsService.createPurchase(createPurchaseBodySchema.parse({ requestKey: randomUUID(), vendorId: vendor.id, purchaseDate: new Date(), paidNow: 1000, paymentType: 'ONLINE', paymentAccountId: account.id, lines: [{ medicineId: medicine.id, purchaseUnitId: unit.id, purchaseUnitQuantity: 1, unitCost: 1000, expiryDate: '2099-01-01' }] }), other.id, tx);
      eq((await tx.cashLedgerEntry.findFirstOrThrow({ where: { referenceId: onlinePurchase.id } })).paymentAccountId,account.id,'Paid purchase debits selected bank account');
      const handoverTime = new Date();
      await tx.accountSettlement.create({ data: { settlementNumber: key, portalUserId: user.id, periodFrom: new Date(), periodTo: new Date(), expectedCash: 18500, physicalCash: 18400, variance: -100, varianceReason: 'Count difference', settlementAmount: 18400, status: 'ACCEPTED', reviewedById: other.id, reviewedAt: handoverTime } });
      await tx.cashLedgerEntry.create({ data: { portalUserId: user.id, amount: 18400, direction: 'OUT', category: 'SETTLEMENT_HANDOVER', isSettled: true, occurredAt: handoverTime } });
      const settled = (await cashService.getBalanceSheet(user.id,{ preset: 'today' },tx)).summary;
      eq(Number(settled.closingCash),0,'Accepted handover and documented variance reconcile remaining cash');
      eq(Number(settled.cashExpenses),500,'Settlement is not an operating expense');
      const tomorrow = new Date(range.lte!.getTime()+1);
      const carried = (await cashService.getBalanceSheet(user.id,{ from: tomorrow, to: new Date(tomorrow.getTime()+86400000-1) },tx)).summary;
      eq(Number(carried.openingCash),0,'Historical carry-forward retains accepted settlement variance');
      eq(JSON.stringify((await incomeExpenseReport(tx,historicalRange)).totals),JSON.stringify(historical),'Later payments never alter historical totals');
      throw rollback;
    }, { timeout: 60000 });
  } catch (error) { if (error !== rollback) throw error; }
  console.log(`${checks} database checks passed; all fixtures rolled back.`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
