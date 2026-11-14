# Collection-based doctor commission verification

Verified on 2026-11-14. Scope: HMS doctor commission; no salary calculation, pharmacy accounting, stock, supplier ledger or provider-settlement implementation changed.

## Root cause

The old `calculateAndAccrueCommission` calculated the full service contract on service posting without reading receipts. A unique invoice-line constraint allowed only one statement, so subsequent collections could not enter independent runs. Draft recalculation deleted the original accrual. Refunds used an invoice-value fraction, and Management Summary recognized commission on approval dates. Run department filters used staff membership instead of the service department.

## Corrected formulas and posting

- Eligible collection is the service line's allocation of actual signed patient receipts and actual panel remittances. A panel authorization/receivable alone earns no commission.
- Department allocation and service-line allocation share the canonical cent-apportionment routine. Patient and panel coverage weights remain separate; non-panel discounts use current line net weights. Collections allocated to noncommissionable lines do not become another doctor's commission.
- `Collected fraction = clamp(eligible collected service amount / net service amount, 0, 1)`; zero-net services earn zero.
- `Full contract = quantity × fixed rate`, or `contractual Gross/Net base × percentage / 100`.
- `Earned gross commission = round(full contract × collected fraction, 2)`.
- `New accrual/reversal = target earned commission − previously accrued gross commission net of reversals`.
- Withholding uses the same cumulative fraction. Explicit linked withholding corrections reconcile rounding cents and fixed tax across multiple receipts.
- `Commission Generated = earned commission − withholding + approved adjustments`.
- `Commission Paid = signed posted commission payouts`, independently dated.
- `Commission Outstanding = max(payable − paid, 0)`; `Recoverable Overpayment = max(paid − payable, 0)`.

Completed service eligibility, active assigned-service checks, effective-dated commission salary eligibility, service-specific/default contracts and frozen rule snapshots are retained. Pharmacy and room/bed lines cannot generate doctor commission. Salary tax and salary payments remain separate.

The append-only `CommissionCollectionEvent` journal freezes the contract and records source receipt/remittance keys, timestamps, allocated collection targets and commission deltas. Each positive increment has its own accrual and can enter a later run. Source-key uniqueness and service-line transaction locks make callback replay idempotent. Negative changes append reversals against existing statements, including paid statements; no accrual, approval or payout is deleted or rewritten. Legacy corrections are linked current-period entries rather than historical statement rewrites.

Receipt `collectedAt` / remittance `receivedAt` determines earning dates. Advances cannot earn before their completed service exists, so their recognition date is the later of receipt date and the existing service-posting date. The current HMS service model marks completion with `isCompleted`; it does not have a separate completion timestamp.

## Changed files

Backend:

- `backend/prisma/schema.prisma` and `backend/prisma/migrations/20261114090000_collection_based_commission/migration.sql`: additive journal, source links and withholding corrections; replace one-accrual-per-line uniqueness with an index. Existing records are retained.
- `backend/src/modules/commission/commission.collections.ts`: canonical collection-based formula, journal, incremental accruals, refunds, contract caps and recovery.
- `backend/src/modules/commission/commission.calc.ts`: shared statement/period balances and service department attribution.
- `backend/src/modules/commission/commission.service.ts`: contract resolution and receipt synchronization; remove draft deletion and invoice-value refund calculation.
- `backend/src/modules/commission/commissionRun.service.ts`: service department filtering and exclude fully reversed/zero-payable candidates.
- `backend/src/shared/departmentCollections.ts`: shared cent allocator and line-level allocation.
- `backend/src/modules/admission/admission.service.ts`: reconcile existing doctor collection allocation when service or room charges change the admission invoice.
- `backend/src/modules/frontdesk/{invoices,admissionBilling,appointments,panelBilling}.service.ts`: commission hooks after actual collections, linked advances, refunds and remittances. Existing billing/payment/stock calculations are preserved.
- `backend/src/modules/reports/{staffFinanceSummary,managementReports.service}.ts`: receipt-dated commission expense, period reversals, period payouts and carried balances.
- `backend/src/modules/identity/staff.service.ts`: Staff 360 commission balances from the shared statement engine.
- `backend/src/modules/setup/dataReset.service.ts`: include the new journal in existing reset dependency order. No reset was executed.
- `backend/scripts/reconcile-commission-collections.ts`: rollback-only historical audit by default; explicit apply mode appends entries using a named Super Admin actor.

Frontend:

- `frontend/src/features/superAdmin/doctorCommission/{DoctorCommissionView,CommissionRunsPanel}.tsx`: collection policy, collection-period statements and Generated/Paid/Outstanding labels.
- `frontend/src/features/superAdmin/staffUsers/StaffUserDetailModal.tsx`: fetch canonical Staff 360 commission balances and recoverable overpayment, with loading/error handling.
- `frontend/src/features/superAdmin/reports/ManagementReports.tsx` and `frontend/src/services/commissionService.ts`: matching report labels and collected-to-date display. Exported report columns use the same backend result.

Tests:

- Added `backend/tests/commissionCollectionsDatabase.test.ts`.
- Updated `commissionPayrollDatabase.test.ts`, `commissionBlueprint.test.ts`, `rmoCommissionSalary.test.ts`, `phase4_frontdesk.test.ts`, `phase8_panelBilling.test.ts`, `staffFinanceSummary.test.ts`, and `admissionPaymentLink.test.ts`.
- Invoice-only mock accrual expectations were replaced by collection-calculator tests and real database eligibility/accrual/refund tests. Existing salary examples remain tested.

## Verification results

**182 relevant tests passed across 16 suites**, including two real PostgreSQL/HTTP integration scenarios. All database fixtures were enclosed in transactions that rolled back; the rollback was checked afterward.

Verified cases:

| Case | Result |
|---|---|
| 1,000 service, 500 received, 20% | Commission 100 |
| Remaining 500 next month | Separate next-month accrual 100; total 200 |
| Unpaid service | No earning accrual |
| Fully collected service | Full eligible contract, capped |
| Multiple doctors/departments | Percentage 100 and proportional fixed commission 150 on a half-paid mixed invoice |
| Old invoice / later receipt | Collection-period preview and Management Summary recognition |
| Refund after payout | Linked reversals and recoverable overpayment; original amount, status and payout retained |
| Duplicate synchronization/refund request | No extra earning or reversal |
| Panel receivable without remittance | No panel-funded commission |
| Actual partial panel remittance | Correct panel-line commission |
| Void/uncompleted/unassigned/pharmacy/room/salary-only/no-rule | No commission accrual |
| Default rule and later rule change | Original service contract retained |
| Discount correction / repeated service state | Collected base remains capped; returning to an earlier state is not confused with replay |
| Preview → run → approval → payout → statement/report | Same canonical balances |
| Salary and department payables | Existing relevant regression suites pass |

Commands from `HMS Software/backend`:

```powershell
$env:HMS_COMMISSION_DB_TEST='1'
$env:HMS_PAYROLL_DB_TEST='1'
npx.cmd vitest run tests/commissionCollectionsDatabase.test.ts tests/commissionPayrollDatabase.test.ts tests/commissionBlueprint.test.ts tests/staffFinanceSummary.test.ts tests/managementCollectionProfit.test.ts tests/superAdminRefundReports.test.ts tests/departmentPayables.test.ts tests/phase4_frontdesk.test.ts tests/phase8_panelBilling.test.ts tests/rmoCommissionSalary.test.ts tests/payrollSalary.test.ts tests/payrollPreviewGenerate.test.ts tests/admissionRoomFulfillment.test.ts tests/dailyIpdRoomBilling.test.ts tests/admissionFulfillmentDefaults.test.ts tests/admissionPaymentLink.test.ts
npm.cmd run typecheck -- --incremental false
npx.cmd prisma validate
npx.cmd prisma migrate status
npx.cmd tsx scripts/reconcile-commission-collections.ts
```

Backend typecheck, frontend `npm.cmd run lint` (TypeScript check), Prisma schema validation and migration status passed. The new migration is applied to local `chss_hms`.

Full-suite run with database verification enabled: **471 passed, 12 failed, 4 skipped**. All 12 failures were reproduced against isolated pre-change HEAD source: two existing panel-outstanding audit fixture failures, three inventory safety timeouts, four admission/pharmacy fixture failures and three inventory fixture failures. These unrelated implementations were not changed. Temporary baseline copies were removed.

Read-only local audit: **0 existing commission accruals, 0 approved/paid accruals, 0 completed doctor-attributed service lines, 0 journal rows**. Historical audit returned `invoicesReviewed: 0, applied: false`. Financial examples above therefore demonstrate real persisted, rollback-only transactions, not verification against an existing populated doctor ledger.

## Remaining limitations and rollout

- A newly posted receipt/remittance dated before an already journaled commission receipt is rejected atomically with a historical-correction message. Ordinary late payment collected today and cross-month payments work. Arbitrarily backdated insertion into an existing commission chronology needs reviewed historical correction; the implementation does not silently redistribute paid history.
- For a populated deployment, review the rollback-only reconciliation output before running `npx.cmd tsx scripts/reconcile-commission-collections.ts --apply --actor=<super-admin-portal-user-id>`. This appends legacy correction/recovery entries, never rewrites approvals or payouts. Local data required no reconciliation.
- Run migration/client generation during deployment and restart the HMS backend. Local `prisma generate` reported Windows EPERM on the engine DLL held by a running process; generated client types and real database access were validated, but a clean full regeneration should be run after releasing that process's DLL lock.
- Report exports consume the corrected backend data and labels. PDF/Excel/print rendering was not separately exercised in this commission task.
