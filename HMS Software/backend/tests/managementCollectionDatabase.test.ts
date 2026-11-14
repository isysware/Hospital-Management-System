import 'dotenv/config';
import { afterAll, expect, it } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/db/client';
import { managementReportsService } from '@/modules/reports/managementReports.service';
import { resolveDateRange } from '@/modules/reports/dashboard.service';
import { signedReceiptWhere } from '@/shared/departmentCollections';
afterAll(async () => { await prisma.$disconnect(); });
it.skipIf(process.env.RUN_REPORT_DB_TESTS !== '1')('reconciles existing database transactions with summary, methods and department totals (read-only)', async () => {
  const query = { preset: 'this_month' as const };
  const { start, end } = resolveDateRange(query);
  const report = await managementReportsService.getSummary(query);
  const receipts = await prisma.paymentReceipt.aggregate({ where: { ...signedReceiptWhere, collectedAt: { gte: start, lte: end } }, _sum: { amount: true }, _count: true });
  const panel = await prisma.panelRemittanceAllocation.aggregate({ where: { panelRemittance: { receivedAt: { gte: start, lte: end } } }, _sum: { allocatedAmount: true } });
  const expected = new Decimal(receipts._sum.amount ?? 0).plus(panel._sum.allocatedAmount ?? 0);
  expect(report.summary.collectedIncome.equals(expected)).toBe(true);
  expect(report.summary.operatingResult.equals(expected.minus(report.summary.totalOperatingCosts))).toBe(true);
  expect(report.rows.reduce((s,r)=>s.plus(r.collected),new Decimal(0)).equals(expected)).toBe(true);
  for(const method of ['CASH','CARD','ONLINE','BANK'] as const) {
    const filtered = await managementReportsService.getSummary({...query,method});
    expect(filtered.summary.totalBilling.equals(report.summary.totalBilling)).toBe(true);
    expect(filtered.summary.outstanding.equals(report.summary.outstanding)).toBe(true);
    const methodReceipts=await prisma.paymentReceipt.aggregate({where:{...signedReceiptWhere,collectedAt:{gte:start,lte:end},method},_sum:{amount:true}});
    if (!panel._sum.allocatedAmount?.gt(0)) expect(filtered.summary.collections.equals(methodReceipts._sum.amount ?? 0)).toBe(true);
  }
  console.log(JSON.stringify({ receiptCount:receipts._count, gross:report.summary.grossBilling, net:report.summary.totalBilling, collectedIncome:report.summary.collectedIncome, outstanding:report.summary.outstanding, applicableCosts:report.summary.totalOperatingCosts, profit:report.summary.operatingResult, departments:report.rows.map(r=>({department:r.department,collected:r.collected,outstanding:r.outstanding})) }));
},30000);
