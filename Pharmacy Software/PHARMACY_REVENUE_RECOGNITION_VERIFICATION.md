# Pharmacy full-payment revenue recognition — implementation and verification

Date: 2026-11-14

## Root cause

The management dashboard summed invoice `total` by invoice creation date as revenue, including tax and unpaid/partially paid sales. Profit subtracted purchases rather than consumed/sold medicine cost and used `Math.max(0, ...)`, hiding losses. The frontend independently repeated this incorrect profit formula.

Sales/Collection reporting selected only period-created invoices, summed their current `paidTotal`, and subtracted refund ledger amounts again even though returns already reduced `paidTotal`. This missed old-invoice receipts and historical debt and could double-subtract refunds. Reports were also limited to 500 invoices.

HMS collection callbacks changed current invoice balances without retaining the receipt's effective date; retries could add the same collection twice. Returns changed invoice totals without retaining dated tax/revenue/cost reversal evidence. Sale lines lacked a frozen cost snapshot.

## Implementation

- Added one canonical chronological financial projection, shared by Sales/Collection reporting and Management Dashboard trends. It reads actual database invoice lines, payment rows, financial events, return cash entries and expense vouchers.
- Added append-only PharmacyFinancialEvent evidence and nullable per-line costRateSnapshot. New retail and HMS dispensing saves the allocated batch/base-unit cost. The additive migration was applied to the configured local pharmacy_db. No historical balances or invoices were backfilled or rewritten.
- Retail payments use paidAt; HMS events use the supplied actual collectedAt. Duplicate HMS receipt identities are checked under a transaction lock. HMS reconciliation without historical dates remains operationally supported but is flagged as insufficient reporting evidence.
- Collection filters apply to receipt/refund method and collector, not to invoice billing or full-clearance eligibility.
- Returns record dated sale/tax/discount/cost and collection deltas, reverse COGS only for restocked units, preserve invoice-level discounts and prevent duplicate request posting. A return cannot refund more cash than was collected. Fully unpaid cancellation is a zero-cash credit/return.
- HMS receipt/refund bridge payloads now include actual receipt timestamps, methods and collector IDs. These two HMS changes are metadata-only: hospital calculations, stock, cash and supplier ledgers were not changed.
- Approved-credit status is preserved during partial reconciliation; credit authorization is not treated as a received payment.
- Management/Sales dashboards use the same collection calculation, including refunds. Losses remain negative.
- Frontend separates Gross Sales, Net Billing excluding tax, Tax Liability, Collections, Outstanding, Recognized Revenue, Recognized COGS and profit. It displays incomplete-history exceptions rather than inventing a profit.
- Excel/CSV contain the same backend report rows and financial summary. Existing PDF/Print uses the report's browser print view, including the summary.

## Formulas and timing

- Net Billing = valid sale charges less discounts/returns, excluding tax; independent of payment status.
- Collections = dated signed retail payments + dated HMS patient collection deltas − actual refund cash amounts, counted once. HMS cash custody remains at HMS; intercompany releases are not sales or new revenue.
- Outstanding = cumulative charge balance through cutoff minus cumulative eligible payments through cutoff, floored at zero.
- Recognized Revenue = change in eligible tax-exclusive net sales when the invoice becomes fully paid. Partial/unpaid invoices initially contribute zero. Later receipts clear the invoice in their own period, not its creation period.
- Returns adjust previously recognized revenue in the return period. A payment-only reversal that reopens an invoice reverses recognition eligibility; later repayment restores only the cumulative recognition difference, avoiding duplicate lifetime income.
- Operating Profit/Loss = recognized revenue − matched recognized medicine cost − posted operating expense vouchers. Inventory purchases, supplier payments, settlement transfers and tax liabilities are excluded. Stock purchases remain informational in the dashboard.

## Verification

28 real PostgreSQL checks passed using `npx.cmd tsx scripts/test-revenue-recognition.ts` (also available as `npm run test:revenue`). Fixtures were created inside one transaction and rolled back. No mocked report values or existing financial-record updates were used.

Coverage:
- 10,000 invoice: day 1 collections 4,000/outstanding 6,000/revenue 0; day 2 collections 3,000/outstanding 3,000/revenue 0; day 3 collections 3,000/outstanding 0/revenue 10,000.
- Cross-month clearing and no repeated recognition next day.
- Unpaid sales, invoice discounts, tax exclusion, actual COGS, expenses and negative profit.
- CASH/ONLINE/CARD filters and collector attribution.
- HMS full clearance, duplicate callback, signed refund, dated authoritative refund retry, undated reconciliation and approved-credit preservation.
- Retail returns preserve the original recognition period and reverse refund/revenue/restocked COGS once.
- Duplicate return request rejection and full unpaid cancellation without a phantom cash refund.
- HMS callbacks do not create Pharmacy drawer cash; all fixtures roll back.

Related HMS tests: 17 passed, 2 existing opt-in database tests skipped.
Typechecks: Pharmacy backend, Pharmacy frontend, and HMS backend passed.
Diff whitespace check passed.

Latest live read-only database result (2 invoices):
- Gross / Net Billing: PKR 12,036
- Collections: PKR 12,036
- Outstanding: PKR 0
- Recognized Revenue: PKR 12,036
- Recognized COGS: PKR 10,030
- Operating Expenses: PKR 0
- Operating Profit: PKR 2,006
- Incomplete-history invoices: 0

## Changed files

Pharmacy backend:
- prisma/schema.prisma
- prisma/migrations/20261114120000_full_payment_reporting/migration.sql
- src/modules/reports/financialRecognition.ts (new canonical projection)
- src/modules/reports/reports.service.ts
- src/modules/reports/reports.schemas.ts
- src/modules/dashboard/dashboard.service.ts
- src/modules/pharmacy/pharmacy.service.ts
- src/modules/pharmacy/pharmacy.schemas.ts
- src/modules/hms-requests/hms-requests.service.ts
- src/modules/hms-requests/hms-requests.schemas.ts
- scripts/test-revenue-recognition.ts
- package.json

Pharmacy frontend:
- src/components/ReportView.tsx
- src/components/PharmacyInvoiceModal.tsx
- src/pages/ManagementDashboardPage.tsx
- src/services/pharmacyApi.ts

Related HMS bridge metadata only:
- HMS Software/backend/src/shared/pharmacyBridgeClient.ts
- HMS Software/backend/src/modules/frontdesk/invoices.service.ts

## Remaining limitations

- Historical HMS totals without receipt dates cannot reliably establish a recognition period. Legacy returns without dated line/tax evidence and historical unbatched sales without cost evidence are explicitly flagged. Known receipt/refund cash still reports; uncertain revenue is excluded and profit is unavailable. Evidence must be reconciled separately; no historical record was guessed or rewritten.
- Historical batched sales use the stored batch cost when no sale-time snapshot exists. New sales freeze cost on the invoice line.
- Pharmacy-counter returns for HMS-linked invoices are rejected to avoid issuing a Pharmacy cash refund for money collected by HMS. HMS payment refunds/reversals are supported via dated bridge callbacks; a coordinated HMS medicine-return/credit-note workflow is not implemented here. The schema has no separate generic credit-note or void-invoice document; supported cancellation is a controlled sales return.
- An undated HMS advance/resync payload cannot reconstruct old collection method, collector or date. Missing methods remain UNKNOWN, not guessed as Cash.
- Reporting currently loads financial history into memory; no new database pagination/materialized projection was introduced.
- Export calculations and frontend types were checked; PDF layout, browser download dialogs and physical printing were not visually exercised.
- No production deployment was performed. Apply the migration and regenerate/restart both relevant backends when deploying. Local Prisma generation encountered a locked Windows engine replacement, but the refreshed generated client passed all database acceptance checks using the existing same-version engine.
