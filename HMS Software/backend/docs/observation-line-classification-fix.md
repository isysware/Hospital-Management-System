# Internal Observation / outsourced invoice classification correction

Verified locally on 22 November 2026. No schema, operational records, payment posting or UI changes were made for this correction.

## Actual source records

- Invoice `INV-26-0001`, ID `8485e6fb-f4af-471e-9e3a-72cc0077055c`: total and paid amount PKR 2,500; status PAID; parent department is outsourced LAB.
- Internal line `0ce42198-2b6c-4934-a875-08032512f227`: completed Observation, PKR 1,500, `billingSource=HOSPITAL_SERVICE`. Service rate `0a6e0dc9-55d8-496a-bebc-c691fec88e11` has `providerType=INTERNAL` and **no department**.
- Outsourced line `45ae100f-e1b8-43e6-bb67-40e46923b1d4`: completed outsourced service, PKR 1,000, `billingSource=OUTSOURCED_SERVICE`; its rate belongs to outsourced department `58fedf33-c186-4c4b-b83e-212c9895c6f4`, provider `fd194cf0-eba4-43e9-8ed5-82fff9cd59f5`.
- Receipt `REC-26-0001`, ID `b042ae45-8d64-4e77-81bd-37d664bcf481`: PKR 2,500, not reversed. No provider settlements were present.

## Root cause and correction

The shared revenue classifier used `serviceRate.department ?? invoice.department`. Because Observation's rate has no department, it inherited the unrelated outsourced header. Department collection allocation and Department Payables billing classification independently made the same fallback.

All affected paths now use the same service-line department resolver. A service's own department remains authoritative. A department-less internal line cannot inherit an outsourced header; a compatible internal encounter department may be used if one exists. Otherwise its department remains unassigned while its completed internal earnings remain Hospital revenue. No department is invented and no service/department name is hardcoded.

Collection allocation retains every line's weight in the denominator and preserves signed, cent-rounded allocation. The internal portion remains separate rather than being redistributed to a provider. Pharmacy's existing billing visibility and exclusion from provider-eligible collections remain intact.

## Actual before / after

Same Today / Asia-Karachi period, same local source records:

| Metric | Before PKR | After PKR |
|---|---:|---:|
| Original patient invoice | 2,500 | 2,500 |
| Patient collections | 2,500 | 2,500 |
| Patient outstanding | 0 | 0 |
| M01 Hospital earned revenue / profit | 0 / 0 | 1,500 / 1,500 |
| Management Summary Hospital revenue / profit | 0 / 0 | 1,500 / 1,500 |
| M04 Hospital revenue / profit | 0 / 0 | 1,500 / 1,500 |
| Outsourced LAB billing | 2,500 | 1,000 |
| LAB eligible collections / payable | 2,500 / 2,500 | 1,000 / 1,000 |
| LAB billed service count | 2 | 1 |
| Provider settlements paid | 0 | 0 |

M04 recognized Hospital costs were zero. Before/after read-only snapshots of the invoice, all its line items, receipts, panel allocations and provider settlements compared equal. No invoices, receipts, settlements, rates or departments were created or updated.

## Files changed for this correction

- `src/shared/hospitalRevenueRecognition.ts`: compatible service-line ownership/department resolution.
- `src/shared/departmentCollections.ts`: select ownership/provider metadata and use the shared resolver for receipt, panel and service-line allocations.
- `src/modules/setup/setup.service.ts`: Department Payables billing uses the same resolver and actual line metadata.
- `src/modules/reports/m01InvoiceProjection.ts`: department-scoped billing and displayed line departments use the shared resolver.
- `src/modules/reports/managementReports.service.ts`: summary billing breakdown uses the same line classification.
- `tests/financialIsolation.test.ts`: mixed-header, partial-payment, refund/date, multiple-provider and direct internal-charge regressions. Existing appointment/admission outsourcing fixtures now explicitly identify their lines as outsourced instead of relying on the faulty header inference.
- This report.

M04 already consumes the shared recognition helper and Department Payables; its statement engine required no separate change. Earlier Pharmacy settlement and prior-period collection changes, plus other pre-existing worktree changes, were preserved.

## Verification

94 tests passed across the targeted reporting, allocation, provider payable, commission payment, refund, Pharmacy billing and Pharmacy settlement checks. This includes 18 actual PostgreSQL Pharmacy settlement tests against the previously created isolated test instance, with no operational database writes.

One pre-existing test failed: `managementSummaryRows.test.ts` expects three Financial Summary rows, while the current frontend produces five. Both that test and `frontend/src/services/managementReportsService.ts` were verified unchanged from HEAD. It was not changed under this task's scope.

Backend and frontend typechecks passed (`tsc --noEmit --incremental false`). `git diff --check` passed. No schema migration, commit, push or deployment was performed for this correction.

Targeted command from backend:

```powershell
$env:P1_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/postgres'
node node_modules/vitest/vitest.mjs run tests/financialIsolation.test.ts tests/departmentPayables.test.ts tests/m01IncomeExpenseLedger.test.ts tests/pharmacySettlementPosting.test.ts tests/pharmacyRequestBilling.test.ts tests/commissionTotalPayment.test.ts tests/collectionReportRefund.test.ts tests/managementCollectionProfit.test.ts tests/managementSummaryRows.test.ts tests/managementSummaryExports.test.ts --no-file-parallelism --maxWorkers=1 --minWorkers=1 --no-cache
```

The PostgreSQL fixture suite is explicitly gated and checks that it is using the isolated temporary cluster. The operational before/after report checks used enforced read-only database transactions.
