# Pharmacy Income & Expense and vendor accounting

Implemented and verified locally on 2026-11-14.

## Root causes

- Cash summary explicitly combined `EXPENSE_PAYMENT` and `VENDOR_PAYMENT` into `cashExpenses`; the UI and exports repeated this combined label. Existing vendor posting already used the distinct VENDOR_PAYMENT category. Historical ledger rows therefore need no rewrite to correct this classification.
- Period cash sheets reported period movement without opening carry-forward. Accepted settlements and their recorded count variances must be included to reconcile the closing balance.
- Non-cash supplier postings retained only a non-physical flag, with no named bank/account identity. Standalone payment retries and repeated purchase creation had no durable request identity; draft posting checked status outside its transaction.
- The verified recognition engine already excluded supplier payments from profit. Its gross-sales presentation netted returns before the report could show Discounts & Returns separately.

## Delivered

- Income & Expense management report, using the existing financialRecognition engine. Shows all requested metrics, plus supplier refunds and advances separately. Today, Yesterday, This Month and Custom ranges use Pakistan business dates. Excel uses numeric XLSX cells; PDF/Print use an isolated, escaped report document with the same response rows. No export recalculates profit.
- Gross Sales is before returns; Discounts & Returns = Gross Sales - tax-exclusive Net Billing. Full-payment recognition, matched COGS, receipt-date collections and cumulative receivables remain in the canonical engine.
- Vendor payments and supplier refunds post atomic, linked vendor/cash-account movements with the actual logged-in actor. Bank/Online/Card require a named active payment account; Cash does not debit an account. Negative supplier balances remain advances/credits, separate from other vendors' liabilities.
- Durable request identities, transaction locks and payload checks protect supplier payment and purchase retries. Draft posting rechecks status under lock. Purchase returns reject duplicate requests, repeated batch lines, wrong suppliers and quantities above available/purchased stock. Supplier refunds are linked to a payment/return credit and capped by available credit and prior linked refunds.
- Balance sheets and exports show operating expenses separately from net cash vendor payments, POS/HMS cash separately, other cash in/out, opening, accepted settlements, count/variance and closing. Dashboard day boundaries now use Pakistan time.
- Added two additive migrations, applied to the configured local Pharmacy database. Existing financial transactions were not rewritten or deleted. Test fixtures rolled back.

## Formulas

- Recognized Revenue = eligible tax-exclusive sale value recognized by the existing full-clearance event projection, with dated returns/reversals.
- Operating Profit / Loss = Recognized Revenue - Matched Medicine COGS - Operating Expenses.
- Vendor Outstanding = sum of positive per-vendor cumulative ledger balances at cutoff.
- Supplier Advances / Credits = absolute sum of negative per-vendor balances at cutoff.
- Closing Cash = Opening Cash + period physical cash in - period physical cash out - accepted physical handovers + documented accepted settlement variances. Supplier cash payments are cash out, not operating expenses. Bank movements never affect this formula.
- The mandated examples verified: 20,000 + 5,000 - 6,000 - 500 = 18,500 cash; 5,000 - 3,000 - 500 = 1,500 profit.

## Verification

- `npm run test:revenue`: 29 real PostgreSQL checks passed, including partial/full payments, cross-month recognition, tax/discounts, HMS callbacks, refunds/returns, cancellation, duplicate events, methods and collectors.
- `npm run test:income-expense`: 32 real PostgreSQL checks passed, including cash/online/bank supplier payments, partial/full credit settlement, advances, linked refunds, stock returns, duplicate posting, paid/draft purchases, multiple cashiers, opening/closing cash, accepted settlements with variance, historical cutoffs and profit reconciliation.
- Pharmacy backend typecheck and build passed; frontend typecheck and production build passed. Frontend build reports a bundle-size warning.
- Diff whitespace check passed. No fabricated production balances or mocked query responses were used.
- Live read-only recognition result: Gross Sales 12,048; Net Billing/Collections/Recognized Revenue 12,036; COGS 10,030; Operating Expenses 0; Profit 2,006; incomplete-history invoices 0.

## Changed source files

Backend:
- `prisma/schema.prisma`
- `prisma/migrations/20261114180000_vendor_payment_accounts/migration.sql`
- `prisma/migrations/20261114181000_purchase_posting_identity/migration.sql`
- `src/modules/reports/incomeExpense.ts`
- `src/modules/reports/financialRecognition.ts`
- `src/modules/reports/reports.schemas.ts`
- `src/modules/reports/reports.service.ts`
- `src/modules/cash/balanceSheet.util.ts`
- `src/modules/cash/cash.service.ts`
- `src/modules/dashboard/dashboard.service.ts`
- `src/modules/vendors/vendorPayments.ts`
- `src/modules/vendors/vendors.schemas.ts`
- `src/modules/vendors/vendors.routes.ts`
- `src/modules/vendors/vendors.service.ts`
- `scripts/test-income-expense.ts`
- `scripts/test-revenue-recognition.ts`
- `package.json`

Frontend:
- `src/App.tsx`
- `src/layout/navigation.ts`
- `src/components/ReportView.tsx`
- `src/components/PaymentAccountSelect.tsx`
- `src/pages/BalanceSheetPage.tsx`
- `src/pages/StockInPage.tsx`
- `src/pages/VendorsPage.tsx`
- `src/utils/balanceSheetExport.ts`

Existing concurrent Detailed Income / Detailed Expense naming changes were preserved. Existing HMS commission work was not modified by this task.

## Limitations and deployment

- Production deployment was not performed. Deploy migrations and matching frontend/backend together: new purchase/payment/return clients supply request identities. Previously saved paid non-cash drafts lacking an account cannot be posted until account details are reconciled; the backend refuses to guess an account.
- Prisma generation refreshed client types but could not replace the Windows engine DLL because it is held by a running process (EPERM). The same-version existing engine passed all database checks. Clean regeneration and backend restart remain necessary before treating the running application as updated.
- Historical non-cash entries have no reliable bank identity. They remain unassigned; new account displays show recorded net movement, not an invented bank opening balance. No historical account backfill was performed.
- Existing incomplete revenue/cost history exceptions remain explicitly unavailable. Historical manually entered expense vouchers with inaccurate descriptions are not automatically reclassified by name guessing.
- PDF/Print is browser print / Save as PDF. Browser rendering, download dialogs and physical printing were not visually exercised; numerical exports share the backend report rows.
- This is the existing operational cash-custody report, not a new general ledger balance sheet. Supplier returns remain purchase-credit movements; cash refunds are separate linked receipts. A refund does not repeat a stock return.
