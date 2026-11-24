# Pharmacy settlement P1 correction — 22 November 2026

## Root cause and implementation

The old release handler used an ordinary MEDICAL_SUPPLIES Expense as its payment history. Expense aggregation therefore deducted Pharmacy principal from Hospital profit. The parent settlement retained only cumulative amounts and the latest method/reference/date, and a partial-payment retry could pay twice.

The new `HmsPharmacySettlementRelease` is a narrowly scoped, append-only record of a completed payment. Each row preserves settlement, amount, method, reference, idempotency key, timestamp, actual actor, optional cash custody entry, remarks and bridge acknowledgement state. PostgreSQL protects financial fields against update/delete. The parent remains a cumulative summary; the requested obligation is still supplied by the existing Pharmacy request workflow.

The posting transaction locks the request identity, the Pharmacy charge and settlement, checks durable releases against the parent, and posts the release, parent/charge updates and applicable custody debit atomically. Global key uniqueness and settlement/reference uniqueness supplement the locks. Reusing a key or reference with different payment data is rejected. A repeated Pharmacy request preserves partial-payment balances rather than resetting the parent to REQUESTED.

For CASH, the authenticated releasing Admin/Super Admin is the payer. The handler uses the existing UserCashBalance ledger, shift/carry-forward calculation, Account Settlement advisory lock and payer row lock. It rejects insufficient recorded custody. The new PHARMACY_SETTLEMENT category is an outgoing transfer, not an expense. No Main Fund debit is invented in addition to this custody debit.

For BANK/ONLINE, the release itself records the outgoing payment. **There is no canonical bank-account ledger, bank-account reconciliation, or bank transfer execution here.** This records a payment in the existing settlement workflow; it does not initiate a payment at a bank.

## Financial reconciliation

Isolated PostgreSQL fixtures exercised the actual reporting services:

| Metric | Before correction, illustrative | Corrected fixture |
|---|---:|---:|
| Hospital earned revenue | 1,000 | 1,000 |
| Pharmacy medicine collections | 700 | 700, retained in patient collection history |
| Pharmacy release principal | 700 classified as Expense | 700 separate settlement outflow |
| Hospital expense from principal | 700 | 0 |
| Hospital operating profit | 300 | 1,000 |

M01, M03, Management Summary and M04 agree. A legitimate MEDICAL_SUPPLIES expense of 125 remains recognized and reduces profit to 875. No category-wide or payee-name exclusion is used.

M01 shows release rows as SETTLEMENT with zero revenue/recognized expense, includes their cash portion in non-operating cash outflows, and deducts all payment methods once from total funds movement. Existing patient invoices, Received/Outstanding projection and prior-period collections remain unchanged by P1. M04 consumes the corrected existing source calculations; its calculation engine was not modified.

The 1,000 obligation / 300 CASH / 400 BANK fixture produces two releases, 700 paid, 300 remaining, 300 custody outflow and zero operating expense. Retrying the bank payment leaves these amounts unchanged. The cashier sheet and management custody overview classify the cash release as a transfer, not an expense.

## API and client compatibility

Clients should supply `idempotencyKey` for each business payment and retain it and its payload across retries. The HMS form persists the pending payload/key in localStorage until a successful response, including across reloads. It does not create a fresh key for a network retry. Definitive pre-post validation errors carry `details.paymentNotPosted` so an unposted draft can be corrected safely.

For older clients, a nonempty payment reference derives a stable fallback key. Without either a key or reference, release is rejected. A supplied reference is unique within a settlement, so it must identify one actual payment, not a reused generic note. Same-key requests with a different amount, method, reference, actor or remarks are rejected.

The settlement list returns individual releases and `reconciliationRequired`; the existing screen displays the reconciliation flag. The release response includes the immutable release and replay indicator.

## Pharmacy bridge limitation

Inspection confirmed the standalone Pharmacy callback adds the incoming amount and is not idempotent. HMS therefore sends a new completed release only once to the configured primary endpoint, with a 15-second timeout; it does not fall through to alternative hosts or resend on client retry. Successful acknowledgement marks the release DELIVERED. A timeout, failed acknowledgement, local acknowledgement-write failure, or crash after local commit leaves RECONCILIATION_REQUIRED. The local payment stays committed and must not be repeated.

**Exactly-once delivery across both systems is not claimed.** Reconcile a flagged release with Pharmacy's records before any manual callback action. Automated retry would require narrowly scoped idempotency support on the remote receiver; that receiver was not changed. The release list, M01 details and response expose the outstanding reconciliation requirement.

## Migration and historical records

Migration: `prisma/migrations/202611220001_pharmacy_settlement_releases/migration.sql`.

It adds one table, indexes/foreign keys/check constraints, one cash category and an immutability trigger. It does not delete/update/backfill existing financial rows. Apply the migration and regenerate Prisma Client **before starting the updated application**. After the user reported the missing-table error and explicitly requested migration, this exact migration was also applied atomically to local `localhost:5432/chss_hms` and recorded in Prisma migration history. No other pending migration was applied. No production migration was executed. The pre/post local counts remained zero Expenses and zero Pharmacy settlements; no financial records were created or rewritten. Enforced read-only calls to M01, M03, Summary and M04 now succeed against that local database (current Today revenue/cost/profit totals are zero).

The migration was also tested against a separate isolated database with a pre-existing Expense and partial settlement. Every pre-existing ORM field stayed unchanged and no release was guessed or backfilled. `audt.md` currently contains only a backslash; it was not overwritten or treated as a valid audit.

Historical reconciliation procedure:

1. Inventory nonzero parent released amounts and original vouchers before rollout. Preserve an export/backup of the evidence.
2. Use independent payment evidence (bank confirmation/cash acknowledgement, settlement request and original voucher) to confirm each amount, method, date and actor. Payee/description text alone is insufficient.
3. Review the mapping before inserting any historical release. Record the unique original `legacyExpenseId` and a nonempty `reconciliationEvidence` reference. Do not create a new payment, re-notify Pharmacy or deduct custody again. Historical releases preserve their original timestamp, amount and actor.
4. Confirm release sums match the existing parent released total and the existing remaining obligation. A parent with unmatched historical releases is flagged and new payment is blocked. The migration does not manufacture an opening balance.
5. Explicitly linked vouchers remain stored unchanged, but M01/M03/Summary exclude them from operating expenses; the release is their single settlement-report source. Unlinked vouchers remain visible and recognized under existing rules until reviewed. **Historical profit may therefore remain misstated where evidence is missing; do not silently hide those vouchers.**

No automatic historical importer, reconciliation UI, reversal policy or general ledger was introduced. Historical import must be reviewed and performed separately; this task performed none in operational data.

## Verification

The targeted suite passed 86 tests, including 18 real PostgreSQL tests, using the temporary server at 127.0.0.1:55439. Bridge transport was mocked; no operational Pharmacy database was contacted.

Covered full CASH/BANK/ONLINE payments; partial/mixed releases; same-key concurrent retries; competing requests and overpayment; same-key payload conflicts; duplicate references; shared custody; insufficient cash; actual actor attribution; rollback after an injected database failure; immutable history; uncertain bridge delivery; retried incoming requests; historical evidence/classification; M01/M03/Summary/M04 and legitimate expenses. Existing Pharmacy revenue, Department Payables, invoice collection and account-settlement regressions passed.

Command from `HMS Software/backend` (only after provisioning the isolated cluster):

```powershell
$env:P1_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/postgres'
node node_modules/vitest/vitest.mjs run tests/pharmacySettlementPosting.test.ts tests/financialIsolation.test.ts tests/m01IncomeExpenseLedger.test.ts tests/pharmacyRequestBilling.test.ts tests/departmentPayables.test.ts tests/cashRefundBalance.test.ts tests/settlementAcceptanceCashIn.test.ts --no-file-parallelism --maxWorkers=1 --minWorkers=1 --no-cache
```

The integration test refuses other hosts/ports and checks PostgreSQL's data directory for the temporary-cluster marker before writing. Without explicit opt-in it is skipped. No integration test uses the operational DATABASE_URL.

Backend and frontend typechecks passed; Prisma schema validation passed.

Backend/frontend check command: `node node_modules/typescript/bin/tsc --noEmit --incremental false` from each project. Schema check: `node node_modules/prisma/build/index.js validate` from backend.

## P1 files

- `prisma/schema.prisma`
- `prisma/migrations/202611220001_pharmacy_settlement_releases/migration.sql`
- `src/modules/pharmacy-bridge/settlementRelease.ts`
- `src/modules/pharmacy-bridge/pharmacy-bridge.service.ts`
- `src/modules/pharmacy-bridge/pharmacy-bridge.schemas.ts`
- `src/shared/pharmacyBridgeClient.ts`
- `src/modules/cash/cash.service.ts`
- `src/modules/expenses/expenses.service.ts`
- `src/modules/reports/managementReports.service.ts`
- `tests/pharmacySettlementPosting.test.ts`
- `tests/financialIsolation.test.ts` (new report source mock)
- `tests/m01IncomeExpenseLedger.test.ts` (new report source mock; prior collection tests retained)
- `../frontend/src/services/pharmacySettlementService.ts`
- `../frontend/src/features/superAdmin/pharmacySettlements/PharmacySettlementsView.tsx`
- This report.

The existing uncommitted `m01InvoiceProjection.ts` changes and earlier M01 collection changes were preserved; they are not P1 changes. No commits, pushes or deployment were performed.
