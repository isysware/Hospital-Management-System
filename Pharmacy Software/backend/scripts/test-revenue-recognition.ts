/** Real PostgreSQL acceptance tests. All fixtures roll back; no existing records are edited. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  financialReport,
  loadFinancialData,
} from "../src/modules/reports/financialRecognition";
import { recordHmsCollection } from "../src/modules/hms-requests/hms-requests.service";
import { pharmacyService } from "../src/modules/pharmacy/pharmacy.service";
const db = new PrismaClient();
const rollback = new Error("ROLLBACK_FINANCIAL_ACCEPTANCE");
let checks = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label);
  checks++;
  console.log("PASS", label);
}
const day = (s: string) => ({
  gte: new Date(s + "T00:00:00Z"),
  lte: new Date(s + "T23:59:59.999Z"),
});
async function main() {
  try {
    await db.$transaction(
      async (tx) => {
        const key = randomUUID();
        const user = await tx.portalUser.create({
          data: {
            username: key,
            fullName: "Reporting acceptance",
            passwordHash: "unused-test-only",
            role: "SUPER_ADMIN",
          },
        });
        const unit = await tx.unit.create({
          data: { name: key, shortCode: key.slice(0, 8) },
        });
        const med = await tx.medicineMaster.create({
          data: {
            code: key,
            name: "Reporting acceptance",
            unit: "Tablet",
            baseUnitId: unit.id,
            saleRate: 1000,
            purchaseRate: 600,
          },
        });
        const ids: string[] = [];
        async function invoice(
          total = 10000,
          tax = 0,
          channel: "RETAIL" | "HMS_LINKED" = "RETAIL",
        ) {
          const i = await tx.pharmacyInvoice.create({
            data: {
              invoiceNumber: randomUUID(),
              channel,
              collectionOwner:
                channel === "RETAIL" ? "PHARMACY_RETAIL" : "HMS_FRONT_DESK",
              createdAt: new Date("2090-01-30T10:00:00Z"),
              subtotal: total - tax,
              total,
              taxTotal: tax,
              outstanding: total,
              dispensedById: user.id,
              lines: {
                create: {
                  medicineId: med.id,
                  quantity: 10,
                  rateSnapshot: (total - tax) / 10,
                  lineNet: total,
                  taxAmount: tax,
                  costRateSnapshot: 600,
                  dispensedAt: new Date("2090-01-30T10:00:00Z"),
                },
              },
            },
            include: { lines: true },
          });
          ids.push(i.id);
          return i;
        }
        async function pay(
          id: string,
          amount: number,
          date: string,
          method: "CASH" | "ONLINE" | "CARD" = "CASH",
        ) {
          await tx.pharmacyPayment.create({
            data: {
              invoiceId: id,
              amount,
              method,
              collectedById: user.id,
              paidAt: new Date(date + "T12:00:00Z"),
            },
          });
          const sum = await tx.pharmacyPayment.aggregate({
            where: { invoiceId: id },
            _sum: { amount: true },
          });
          const i = await tx.pharmacyInvoice.findUniqueOrThrow({
            where: { id },
          });
          const paid = sum._sum.amount!;
          await tx.pharmacyInvoice.update({
            where: { id },
            data: {
              paidTotal: paid,
              outstanding: Prisma.Decimal.max(0, i.total.minus(paid)),
              status: paid.gte(i.total) ? "PAID" : "PARTIALLY_PAID",
            },
          });
        }
        async function report(id: string, range = {}, filters = {}) {
          const data = await loadFinancialData(tx);
          return financialReport(
            {
              ...data,
              invoices: data.invoices.filter((i) => i.id === id),
              expenses: [],
            },
            range,
            filters,
          );
        }
        const i = await invoice();
        await pay(i.id, 4000, "2090-01-30");
        await pay(i.id, 3000, "2090-01-31", "ONLINE");
        await pay(i.id, 3000, "2090-02-01", "CARD");
        for (const [date, collection, outstanding, revenue] of [
          ["2090-01-30", 4000, 6000, 0],
          ["2090-01-31", 3000, 3000, 0],
          ["2090-02-01", 3000, 0, 10000],
        ] as const) {
          const r = await report(i.id, day(date));
          eq(
            [
              Number(r.totals.collections),
              Number(r.totals.outstanding),
              Number(r.totals.recognizedRevenue),
            ],
            [collection, outstanding, revenue],
            "mandatory example " + date,
          );
        }
        const feb = await report(i.id, day("2090-02-01"));
        eq(
          Number(feb.totals.operatingProfit),
          4000,
          "matched COGS 6000, not purchases",
        );
        eq(
          Number(
            (await report(i.id, day("2090-02-02"))).totals.recognizedRevenue,
          ),
          0,
          "no repeated recognition",
        );
        for (const method of ["CASH", "ONLINE", "CARD"])
          eq(
            Number((await report(i.id, {}, { method })).totals.collections),
            method === "CASH" ? 4000 : 3000,
            "payment method " + method,
          );
        eq(
          Number(
            (await report(i.id, {}, { cashierId: randomUUID() })).totals
              .collections,
          ),
          0,
          "cashier attribution",
        );
        const loss = await invoice(1000);
        await pay(loss.id, 1000, "2090-01-31");
        eq(
          Number((await report(loss.id)).totals.operatingProfit),
          -5000,
          "losses are not clamped to zero",
        );
        const discounted = await invoice(9000);
        await tx.pharmacyInvoice.update({
          where: { id: discounted.id },
          data: { subtotal: 10000, discountTotal: 1000 },
        });
        await tx.pharmacyInvoiceLine.update({
          where: { id: discounted.lines[0]!.id },
          data: { lineNet: 10000, rateSnapshot: 1000 },
        });
        await pay(discounted.id, 9000, "2090-02-01");
        eq(
          Number((await report(discounted.id)).totals.recognizedRevenue),
          9000,
          "invoice-level discount excluded",
        );
        const unpaid = await invoice();
        eq(
          Number((await report(unpaid.id)).totals.recognizedRevenue),
          0,
          "unpaid invoice",
        );
        const taxed = await invoice(11000, 1000);
        await pay(taxed.id, 11000, "2090-01-31");
        eq(
          Number((await report(taxed.id)).totals.recognizedRevenue),
          10000,
          "tax excluded",
        );
        const credit = await invoice(10000, 0, "HMS_LINKED");
        await tx.pharmacyInvoice.update({
          where: { id: credit.id },
          data: { clearanceStatus: "APPROVED_CREDIT" },
        });
        eq(
          Number((await report(credit.id)).totals.recognizedRevenue),
          0,
          "approved credit is not payment",
        );
        const hms = await invoice(10000, 0, "HMS_LINKED");
        await recordHmsCollection(
          hms.invoiceNumber,
          new Prisma.Decimal(4000),
          false,
          "HMS-1",
          new Date("2090-01-30T12:00:00Z"),
          "CASH",
          "HMS Cashier",
          tx,
        );
        await recordHmsCollection(
          hms.invoiceNumber,
          new Prisma.Decimal(4000),
          false,
          "HMS-1",
          new Date("2090-01-30T12:00:00Z"),
          "CASH",
          "HMS Cashier",
          tx,
        );
        eq(
          Number(
            (
              await tx.pharmacyInvoice.findUniqueOrThrow({
                where: { id: hms.id },
              })
            ).paidTotal,
          ),
          4000,
          "duplicate HMS callback posts once",
        );
        await recordHmsCollection(
          hms.invoiceNumber,
          new Prisma.Decimal(6000),
          false,
          "HMS-2",
          new Date("2090-02-01T12:00:00Z"),
          "BANK",
          "HMS Cashier",
          tx,
        );
        eq(
          Number(
            (await report(hms.id, day("2090-02-01"))).totals.recognizedRevenue,
          ),
          10000,
          "HMS full-payment month",
        );
        await recordHmsCollection(
          hms.invoiceNumber,
          new Prisma.Decimal(-2000),
          false,
          "HMS-REFUND",
          new Date("2090-02-02T12:00:00Z"),
          "BANK",
          "HMS Cashier",
          tx,
        );
        const reversed = await report(hms.id, day("2090-02-02"));
        eq(
          [
            Number(reversed.totals.collections),
            Number(reversed.totals.recognizedRevenue),
          ],
          [-2000, -10000],
          "HMS refund revokes full-clearance eligibility once",
        );
        await recordHmsCollection(hms.invoiceNumber,new Prisma.Decimal(6000),true,'HMS-REFUND-2',new Date('2090-02-03T12:00:00Z'),'BANK','HMS Cashier',tx);
      await recordHmsCollection(hms.invoiceNumber,new Prisma.Decimal(6000),true,'HMS-REFUND-2',new Date('2090-02-03T12:00:00Z'),'BANK','HMS Cashier',tx);
      eq(Number((await report(hms.id,day('2090-02-03'))).totals.collections),-2000,'dated authoritative refund reconciles once');
      await recordHmsCollection(credit.invoiceNumber,new Prisma.Decimal(1000),true,undefined,undefined,undefined,undefined,tx);
      eq((await report(credit.id)).totals.operatingProfit,null,'undated historical reconciliation cannot invent a revenue period');
      eq((await tx.pharmacyInvoice.findUniqueOrThrow({where:{id:credit.id}})).clearanceStatus,'APPROVED_CREDIT','partial reconciliation preserves authorized credit clearance');
      const retail = await invoice(11000, 1000);
        await pay(retail.id, 11000, "2090-01-31");
        const returnKey = randomUUID();
        const result = await pharmacyService.salesReturn(
          {
            invoiceId: retail.id,
            requestKey: returnKey,
            lines: [
              {
                invoiceLineId: retail.lines[0]!.id,
                quantity: 2,
                restock: true,
              },
            ],
            reason: "Acceptance return",
            refundMethod: "CASH",
          },
          user.id,
          tx,
        );
        // Use the actual posted timestamp: original sales precede it for the historical projection test.
        const returned = await tx.pharmacyFinancialEvent.findUniqueOrThrow({
          where: { eventKey: "return:" + returnKey },
        });
        await tx.pharmacyFinancialEvent.update({
          where: { id: returned.id },
          data: { occurredAt: new Date("2090-02-02T12:00:00Z") },
        }); // fixture only
        await tx.cashLedgerEntry.update({
          where: { id: result.cashLedgerEntryId },
          data: { occurredAt: new Date("2090-02-02T12:00:00Z") },
        });
        eq(
          Number(
            (await report(retail.id, day("2090-01-31"))).totals
              .recognizedRevenue,
          ),
          10000,
          "later return preserves original recognition",
        );
        const ret = await report(retail.id, day("2090-02-02"));
        eq(
          [
            Number(ret.totals.collections),
            Number(ret.totals.recognizedRevenue),
            Number(ret.totals.recognizedCogs),
          ],
          [-2200, -2000, -1200],
          "return reverses revenue/tax/restocked COGS once",
        );
        await assert.rejects(() =>
          pharmacyService.salesReturn(
            {
              invoiceId: retail.id,
              requestKey: returnKey,
              lines: [
                {
                  invoiceLineId: retail.lines[0]!.id,
                  quantity: 2,
                  restock: true,
                },
              ],
              reason: "retry",
              refundMethod: "CASH",
            },
            user.id,
            tx,
          ),
        );
        checks++;
        const cancelled = await invoice();
        const cancel = await pharmacyService.salesReturn(
          {
            invoiceId: cancelled.id,
            lines: [
              {
                invoiceLineId: cancelled.lines[0]!.id,
                quantity: 10,
                restock: true,
              },
            ],
            reason: "Cancel unpaid sale",
            refundMethod: "CASH",
          },
          user.id,
          tx,
        );
        eq(Number(cancel.newTotal), 0, "full cancellation leaves zero sale");
        eq(
          Number(
            (
              await tx.cashLedgerEntry.findUniqueOrThrow({
                where: { id: cancel.cashLedgerEntryId },
              })
            ).amount,
          ),
          0,
          "unpaid cancellation cannot refund cash never collected",
        );
        const expenses = await tx.expense.create({
          data: {
            expenseNumber: randomUUID(),
            category: "Utilities",
            date: new Date("2090-02-01"),
            amount: 500,
            paymentMethod: "CASH",
            description: "Acceptance expense",
            enteredById: user.id,
          },
        });
        const dataset = await loadFinancialData(tx);
        const costReport = financialReport(
          {
            ...dataset,
            invoices: dataset.invoices.filter((x) => x.id === i.id),
            expenses: [expenses],
          },
          day("2090-02-01"),
        );
        eq(
          Number(costReport.totals.operatingProfit),
          3500,
          "operating profit subtracts actual expense once",
        );
        eq(
          await tx.cashLedgerEntry.count({ where: { referenceId: hms.id } }),
          0,
          "HMS callbacks never post pharmacy cash",
        );
        throw rollback;
      },
      { timeout: 60000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
  eq(
    await db.portalUser.count({ where: { fullName: "Reporting acceptance" } }),
    0,
    "all test records rolled back",
  );
  const live = financialReport(await loadFinancialData(), { lte: new Date() });
  console.log(
    "LIVE READ-ONLY",
    JSON.stringify({ invoices: live.rows.length, totals: live.totals }),
  );
  console.log("PASSED", checks, "database checks");
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
