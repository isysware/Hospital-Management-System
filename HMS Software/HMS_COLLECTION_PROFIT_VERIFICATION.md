# Collection-Based Management Reporting — Verification

Date: 2026-11-14

## Root causes and changes

- Management profit subtracted expenses from net billing, recognizing unpaid invoices as income. It now subtracts applicable costs from signed actual collections. `collectedIncome` is returned explicitly by the backend.
- Billing used a payment-method receipt-existence filter. Billing and outstanding now remain independent of the collection method.
- The summary mixed invoice-date billing and outstanding in one period-limited dataset. It now reads cumulative invoices through the cutoff, recognizes billing only in the selected invoice period, and reconstructs paid amounts from eligible receipts and panel allocations through the cutoff. The Management Outstanding/Panel register uses the same cutoff policy.
- Department allocation already supported line-level patient/panel weights and exact cent rounding. Summary fallback labels differed between billing and allocation, splitting General Hospital Services into an Unassigned row. The summary now consistently presents the same fallback without editing invoices or altering shared provider allocation rules.
- Operating costs included drawer EXPENSE/PURCHASE outflows. They now include hospital Expense vouchers, InventoryExpense vouchers and approved salary/commission recognition once. Cash-ledger mirrors, stock purchase postings, petty cash transfers and settlements are excluded.
- Department-filtered commission costs now follow the invoice line service department, falling back to the invoice department for lines without a service rate.
- Frontend labels and shared export rows display Actual Collections, Collected Income, Total Applicable Operating Costs and Collection-Based Operating Profit / Loss.
- Executive dashboard inspection confirmed its response already uses net receipt collections for `billingSummary.paidAmount`; no dashboard changes were needed.

## Formulas

- Net Billing = valid gross billing minus line discounts/adjustments, using existing invoice calculations.
- Collected Income = eligible signed patient receipts by collectedAt plus allocated panel remittances by receivedAt. Negative refund receipts are included once; positive reversed receipts are excluded.
- Outstanding = cumulative valid invoice patient/panel debt less respective eligible payments through report end, clamped per responsibility.
- Collection-Based Operating Profit / Loss = Collected Income minus hospital/inventory operating vouchers minus approved salary and commission recognition. Salary/commission payments are informational and are not subtracted again.

## Files

Production:
- backend/src/modules/reports/managementReports.service.ts
- backend/src/modules/reports/staffFinanceSummary.ts
- frontend/src/services/managementReportsService.ts
- frontend/src/features/superAdmin/reports/ManagementReports.tsx

New tests:
- backend/tests/managementCollectionProfit.test.ts
- backend/tests/managementCollectionDatabase.test.ts
- backend/tests/managementSummaryExports.test.ts

Updated existing tests:
- backend/tests/managementReportCompleteness.test.ts
- backend/tests/managementSummaryRows.test.ts
- backend/tests/staffFinanceSummary.test.ts
- backend/tests/superAdminRefundReports.test.ts

## Results

- Relevant backend regression run: 70 passed; 1 existing opt-in staff payment integration test skipped.
- New database integration check: 1 passed, run explicitly with RUN_REPORT_DB_TESTS=1. Read-only queries against existing transaction data; no fixtures or writes.
- Actual database: 2 receipts; gross/net billing 2,000; collected income 1,500; outstanding 500; costs 0; profit 1,500. General Hospital Services has collected 1,500 and outstanding 500.
- Backend: npm.cmd run typecheck -- --incremental false — passed.
- Frontend: npm.cmd run lint (tsc --noEmit) — passed.
- PDF, Excel, CSV and Print adapter inputs agree with report rows. Browser download/print dialogs and rendered export layout were not visually tested.
- Existing Department Payables/provider settlements, refund cash ledger, panel responsibility and payment safety regression tests passed.
- Coverage includes later-month payment, unpaid-only invoice, 10,000 income less 3,000 costs, mixed-department partial payment/refund with cent rounding, Cash/Online/Bank filters, and historical payment cutoff.

## Remaining limits

- The existing schema does not version invoice amounts, void status or service-department assignments. Receipt/remittance cutoff balances are reconstructed, but reports cannot fully recreate an invoice's earlier state after subsequent edits/voids using these tables alone. No historical records were rewritten.
- Inventory expense vouchers have no department field, so they apply to hospital-wide profit only. No department is inferred for them.
- Independent hospital/inventory vouchers have no shared source identifier. The fix eliminates ledger/source double counting; it cannot safely deduplicate separately entered manual vouchers for the same real-world bill.
- Null department assignments remain a General Hospital Services reporting bucket; the change does not invent a department ID or migrate historical invoices.
- No deployment was performed. The existing full-audit document was not modified.
