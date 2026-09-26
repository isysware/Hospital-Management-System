# Reporting — Simple Structure (v2, supersedes the old v7.5 25-report catalog)

Source of truth: `Front Desk Billing Reporting.pdf`, `Admission Reporting.pdf`, `Super Admin_Admin Reporting.pdf` (all "iSysware — Simple Reporting Structure", 2026-09-25), cross-checked against the actual codebase the same day.

**This replaces the older, much larger plan.** The previous `reporting.md` (v7.5, 25-report catalog across Front Desk/Admission/Super Admin) is what got built — and per direct user feedback, it turned out too complex, hard to read, and inconsistent. This file is the new, deliberately smaller spec. It does not throw away the real backend/data work already done (see §5) — it consolidates the *menu* and unifies the *UI pattern* on top of it.

---

## 1. Design goal (all 3 portals, verbatim from the guides)

> School Management System style: simple report menu on the left, proper filters on top, export buttons on the right, and one clean table below. Keep the reporting easy to read and easy to manage.

Universal screen anatomy for every report, no exceptions:
1. **Report Title Bar** — report name + one-line description.
2. **Top Filter Row** — date range + 3–5 relevant dropdowns, one horizontal row where width allows.
3. **Action Buttons** — Filter/Refresh + Reset + Excel + PDF + Print.
4. **Optional KPI Strip** — 3–5 totals, **summary reports only**. Never put a KPI card row on every report — that's exactly the "overloaded" look being removed.
5. **Main Data Table** — clean grid, sortable, searchable, paginated, totals row at the bottom.
6. **Row Action** — View only, where drill-down is actually useful. No action-button clutter per row.

**Visual/component design itself is not in scope for this pass** — the current card/table visual language (built earlier, referred to as the "Antigravity" pattern) stays as-is. What's broken/missing per the user: real, working **filtering** on the reports, and the sheer **number of report menu items** across all three portals, which is what makes the whole thing feel complex and hard to use.

---

## 2. Front Desk / Billing — 9 reports (down from 12+ built today)

Portal rule: Front Desk/Billing collects Hospital cash and owns cashier Balance Sheet + Account Settlement.

| # | Report | Main columns | Top filters |
|---|---|---|---|
| 1 | Daily Billing Summary | Invoices, gross billed, discounts, net billed, collections, outstanding (period totals) | Period/From/To, Cashier, Department |
| 2 | Encounter Register | Encounter No, patient, OPD/Emergency/Observation, department, doctor, date/time, status, Created By | From/To, Encounter Service, Department, Doctor, Status |
| 3 | Invoice Register | Invoice No, patient, department, gross, discount, net, paid, balance, status | From/To, Department, Payment Status, Panel/Self-Pay |
| 4 | Collection & Receipt Report | Receipt No, invoice/admission no, patient, amount, method, date/time, Collected By | From/To, Payment Method, Receipt Status, Cashier |
| 5 | Outstanding / Partial Invoices | Invoice No, patient, net, paid, outstanding, last payment, status | From/To, Department, Status, Panel/Self-Pay |
| 6 | Admission Payment Collections | Admission No, patient, Hospital due, amount collected, receipt, method, remaining Hospital due | From/To, Admission No, Department, Payment Method, Status |
| 7 | Discounts / Refunds / Voids | **One combined** exception report, `Type` filter (discount / refund / void / reversal); amount, reason, performer, approver | From/To, Type, Status, Approved By |
| 8 | My Balance Sheet | Opening/Petty Cash, Cash Collections, Cash Expenses, Cash Refunds, Expected Cash, Physical Cash, Variance, Settled, Remaining | Shift / Day / Custom Period |
| 9 | My Account Settlement | Settlement Ref, period, expected/physical cash, variance, submitted/accepted amount, remaining cash, status | From/To, Settlement Status |

Non-negotiable: Card/POS and Online/Bank amounts show in collection reports but are **never** counted as physical cash in the Balance Sheet.

---

## 3. Admission — 7 reports (down from 15 built today)

Portal rule: Admission manages the inpatient lifecycle but **never** collects Hospital cash — no Balance Sheet, no Account Settlement here, ever.

| # | Report | Main columns | Top filters |
|---|---|---|---|
| 1 | Admission Summary | Admissions, discharges, active patients, occupied/available beds, pending discharge, Hospital outstanding (period totals) | From/To, Department, Ward, Doctor, Status |
| 2 | Admission Register | Admission No, patient, Panel/Self-Pay, department, doctor, ward/room/bed, admit/discharge date-time, status | From/To, Department, Doctor, Ward, Panel/Self-Pay, Status |
| 3 | Inpatient Census / Bed Report | Current admitted patients + ward/room/bed + occupied/available bed info (tabs or one combined screen) | As-of Date, Department, Ward, Room/Bed, Bed Status |
| 4 | Transfer / Length of Stay | Transfer history + LOS: from/to ward/room/bed, transfer time, reason, admit/discharge times, LOS | From/To, Admission No, Department, Ward, Doctor |
| 5 | Running Hospital Bill / Payment Status | Hospital charges, Billing-collected payments, Hospital outstanding, latest receipt/payment status — **read-only** | From/To, Admission No, Department, Payment/Clearance Status |
| 6 | Pharmacy Request & Fulfillment | Medicine, requested qty, urgency, request status, dispensed qty, Pharmacy invoice/clearance, high-cost approval status | From/To, Admission No, Medicine, Request Status, Approval Status |
| 7 | Discharge Clearance Report | Clinical Ready, Hospital Clearance, Pharmacy Clearance, outstanding/credit status, discharge date/time, completed by | From/To, Department, Doctor, Clinical Status, Hospital Clearance, Pharmacy Clearance |

Non-negotiable: Hospital Bill and Pharmacy Bill stay separate everywhere, including inside the Discharge Clearance report (two distinct clearance states, never merged).

---

## 4. Super Admin / Admin — 8 reports (down from reusing the *entire* Front Desk + Admission catalogs)

Portal rule: management oversight, not a duplicate operational menu. Admin and Super Admin get the identical normal report set (Super Admin's extra restrictions are a security concern, not a separate reporting menu).

| # | Report | Main columns | Top filters |
|---|---|---|---|
| 1 | Management Summary | Total billing, collections, outstanding, expenses, active admissions, occupied beds, pending settlements — summary only | From/To, Department, Portal/User |
| 2 | Billing & Collection Report | Invoice No, patient/payer, department, gross, discount, net, collected, outstanding, payment method, Collected By | From/To, Department, User/Cashier, Payment Method, Payment Status, Panel |
| 3 | Outstanding / Panel Report | Self-Pay + Panel outstanding, partial/unpaid invoices, panel/company, due amount, status | From/To, Payer Type, Panel, Department, Status |
| 4 | Admission & Bed Summary | Admissions, discharges, active patients, department/ward, occupied/available beds, Hospital due, discharge status | From/To, Department, Doctor, Ward, Admission/Discharge Status |
| 5 | Expense Report | Date, category, amount, method, details/reference, Entered By | From/To, Category, Payment Method, Entered By |
| 6 | Balance Sheet & Account Settlements | User-wise opening/petty cash, cash collections, expenses/refunds, expected/physical cash, variance, submitted/accepted/remaining — **consolidated oversight view**, not the same screen as a cashier's own | From/To, Portal, User, Settlement Status |
| 7 | Staff / Payroll / Doctor Commission | Staff/doctor, attendance days, salary basis, payroll amount, doctor commission amount, status | Payroll Period, Department, Staff/Doctor, Status |
| 8 | Inventory / Pharmacy Summary | Purchases/stock movement, low stock/expiry, Pharmacy request/clearance — **summary only**, detailed ledgers stay in their own modules | From/To, Category/Department, Status |

Non-negotiable: don't duplicate every Front Desk/Admission operational report as a separate Super Admin menu item. Use drill-down from a summary row instead of a parallel full menu.

---

## 5. What this means for the existing build (audit, 2026-09-25)

The prior session already built real, live, tested backend endpoints for the old 25-report catalog (`/api/v1/reports/frontdesk/*`, `/api/v1/reports/admission/*`) plus real Finance Control (Balance Sheet/Settlement) screens. **None of that real data plumbing needs to be thrown away.** The gap this new guide is calling out is entirely at the IA/menu and UI-consistency layer:

- **Too many menu items.** Front Desk currently exposes ~12 report entries where the new spec wants 9 (mainly by merging Discount/Refund/Void/Reversal into one report with a `Type` filter instead of separate menu items — v7.5's §4.1 had these as 3 separate catalog rows). Admission currently exposes far more than 7. Super Admin currently reuses the *entire* Front Desk and Admission report hubs verbatim instead of its own smaller 8-report management set.
- **Filtering isn't reliably wired.** Per the user, several existing reports don't actually filter — this needs a pass report-by-report to confirm each Top Filter Row in §2–4 actually re-queries the backend, not just updates local UI state.
- **KPI card overload.** The guide is explicit: KPI strips belong only on summary reports (#1 in each portal's list), not on every single report screen.
- **Visual pattern stays.** The card/table look-and-feel already built (the "Antigravity" pattern) is not being redesigned — only which reports exist, their filters, and the KPI-strip discipline.

## 6. Recommendation: consolidate/refactor, not rebuild from scratch

Rebuilding from zero would throw away real, working, already-tested backend endpoints and data wiring — pure waste, and a regression risk for zero benefit, since the actual problem is menu sprawl and inconsistent filtering, not broken data. The right-sized fix:

1. **Trim each portal's report menu down to the exact list in §2/§3/§4** — hide or merge the extra entries (Discount/Refund/Void/Reversal → one report + Type filter is the biggest single consolidation).
2. **Give Super Admin its own 8-report set** instead of embedding the full Front Desk/Admission hubs — reuse the underlying data services, but present them through Super Admin's own summary-first screens with drill-down, per §4.
3. **Audit every kept report's Top Filter Row** against the exact filter list per report above, and fix any filter that doesn't actually re-query.
4. **Strip KPI strips off every non-summary report** — keep the strip only on the 3 "Summary" reports (Daily Billing Summary, Admission Summary, Management Summary) and My Balance Sheet/Settlement (which are inherently KPI-shaped).
5. Re-verify the cross-portal reconciliation rule (same figures, same filters, both sides) still holds after the menu consolidation.

## 7. Build order

1. Front Desk/Billing menu consolidation + filter audit (9 reports).
2. Admission menu consolidation + filter audit (7 reports).
3. Super Admin/Admin — replace the reused hubs with its own 8-report set + drill-down.
4. Full filter pass across all 24 reports (re-verify each Top Filter Row actually re-queries).
5. KPI-strip cleanup (summary reports only).

---

## 8. Progress log (2026-09-25)

### 8.1 Front Desk / Billing — ✅ DONE (all 9 reports)

Browser-tested as the `frontdesk` user (Playwright, every sidebar report opened, every filter set → Filter → confirmed the query params reach the API → Reset). Backend + frontend `tsc` clean (only the 4 pre-existing unrelated frontend errors remain).

| # | Report (menu id) | Top filters (all re-query the backend) |
|---|---|---|
| 1 | Daily Billing Summary (`front_desk_billing_reports`) | Period, Cashier, Department |
| 2 | Encounter Register (`fd_encounter_register`) | Period, Encounter Service, Department, Doctor, Status |
| 3 | Invoice Register (`fd_invoice_register`) | Period, Department, Payment Status, Panel/Self-Pay |
| 4 | Collection & Receipt (`fd_collection_report`) | Period, Payment Method, Receipt Status (Active/Reversed), Cashier |
| 5 | Outstanding / Partial (`fd_outstanding_invoices`) | Period, Department, Status, Panel/Self-Pay (+ Last Payment, Payer columns) |
| 6 | Admission Payment Collections (`fd_admission_payment_collections`) | Period, Admission No (text), Department, Payment Method, Status (+ Department, Remaining Due columns) |
| 7 | Discounts / Refunds / Voids (`fd_discount_report`, also `fd_refund_void_report`) | Period, Type (Discount/Refund/Void-Reversal), Performed By — ONE combined report, new endpoint `/reports/frontdesk/exceptions` |
| 8 | My Balance Sheet (`my_balance_sheet`) | Period: Current Shift / Today / Yesterday / Week / Month / Custom. Lines: Opening/Petty Cash, Cash Collections, Cash Expenses, Cash Refunds, Non-cash (never physical), Expected Cash, Physical Counted, Variance, Settled, Remaining. Settle button only on Current Shift. |
| 9 | My Account Settlement (`my_account_settlement`) | History filter: Period (All Time … Custom From/To), Settlement Status |

Shared `GenericReportView` (used by every register report, all portals): Filter + Reset buttons, in-table search, click-to-sort columns, 50-row pagination, Totals row at the bottom (money columns; `noTotalColumns` opt-out), KPI strip only when `showKpis` (summary reports only). Dropdown sources come from one endpoint: `/reports/frontdesk/filter-options` (departments, doctors, cashiers, panels).

Known limits (by design, not bugs):
- No "Approved By" filter on Discounts — the schema stores no discount approver. "Performed By" is used instead (invoice creator for discounts, cashier for refunds/voids).
- "Void" = reversed receipts. There is no separate invoice-void flow in the schema.
- Invoice Register rows keep both **View** and **Ledger** buttons (spec says View only) — remove Ledger if unwanted.

### 8.2 Admission — ✅ DONE (all 7 reports from `Admission Reporting.pdf`; details in §8.4)

Decision (user, 2026-09-25): Admission gets the full **7** PDF reports, not the earlier trimmed 4.

| # | Report | Filters required | Status |
|---|---|---|---|
| 1 | Admission Summary | From/To, Department, Ward, Doctor, Status | ✅ |
| 2 | Admission Register | From/To, Department, Doctor, Ward, Panel/Self-Pay, Admission Status | ✅ |
| 3 | Inpatient Census / Bed Report (one combined screen) | As-of Date, Department, Ward, Room/Bed, Bed Status | ✅ |
| 4 | Transfer / Length of Stay (one combined screen) | From/To, Admission No, Department, Ward, Doctor | ✅ |
| 5 | Running Hospital Bill / Payment Status (read-only) | From/To, Admission No, Department, Payment/Clearance Status | ✅ |
| 6 | Pharmacy Request & Fulfillment | From/To, Admission No, Medicine, Request Status, Approval Status | ✅ |
| 7 | Discharge Clearance Report (Hospital + Pharmacy clearance kept separate) | From/To, Department, Doctor, Clinical Status, Hospital Clearance, Pharmacy Clearance | ✅ |

Rules: Admission never collects cash — no Balance Sheet / Account Settlement in this portal. Hospital Bill and Pharmacy Bill stay separate.

### 8.3 Super Admin / Admin — ⏳ TOMORROW (not started)

User instruction: **do not show Front Desk and Admission report groups separately on Super Admin.** Replace the `hm_fd_reports`, `hm_adm_reports` and `hm_reporting` ("OTHER REPORTS") nav groups in `CANONICAL_HOSPITAL_MANAGEMENT_NAV_GROUPS` with ONE `REPORTS` group of 8 management reports (Admin and Super Admin share it), each with proper filters, drill-down from summary rows instead of duplicate menus.

| # | Report | Filters | Data source / plan |
|---|---|---|---|
| 1 | Management Summary (KPIs: billing, collections, outstanding, expenses, active admissions, occupied beds, pending settlements) | From/To, Department, Portal/User | new endpoint; table by department |
| 2 | Billing & Collection | From/To, Department, User/Cashier, Payment Method, Payment Status, Panel | invoice-level: gross, discount, net, collected, outstanding, method(s), Collected By |
| 3 | Outstanding / Panel | From/To, Payer Type, Panel, Department, Status | reuse `/reports/frontdesk/outstanding` + add `corporatePanelId` filter + panel name column |
| 4 | Admission & Bed Summary | From/To, Department, Doctor, Ward, Admission/Discharge Status | reuse Admission Summary endpoint (§8.2 #1) |
| 5 | Expense Report | From/To, Category, Payment Method, Entered By | **no Expense table exists** — build from `PurchaseOrder` (inventory purchases: amount, paymentMethod, invoiceReference, createdBy) + `UserCashBalance` rows with category EXPENSE/PURCHASE |
| 6 | Balance Sheet & Account Settlements (consolidated, user-wise) | From/To, Portal, User, Settlement Status | `UserCashBalance` + `AccountSettlement` grouped per user: opening/petty, cash collections, expenses/refunds, expected, physical, variance, submitted/accepted/remaining |
| 7 | Staff / Payroll / Doctor Commission | Payroll Period, Department, Staff/Doctor, Status | `SalarySlip` (+ `AttendanceRecord` days) and `DoctorCommissionAccrual` |
| 8 | Inventory / Pharmacy Summary (summary only) | From/To, Category/Department, Status | `PurchaseOrder`/`StockLedger` movement, low stock (`reorderLevel`), expiry (`MedicineBatch.expiryDate`), `PharmacyClearance` status counts |

After it's built: browser-test as `superadmin` and `admin` the same way Front Desk was tested.

### 8.4 Admission — what was built (2026-09-25)

Browser-tested as the `admission` user (Playwright): all 7 sidebar reports open, every filter set → Filter → params confirmed in the API request → Reset clears and reloads. Backend + frontend `tsc` clean.

| # | Menu id | Screen / endpoint | Filters | Notes |
|---|---|---|---|---|
| 1 | `admission_reports` | `AdmissionSummaryView` → `GET /reports/admission/summary` | Period, Department, Ward, Doctor, Status | The only Admission report with a KPI strip (admissions, discharges, active, pending discharge, beds occupied/available, Hospital outstanding); table = per-department breakdown |
| 2 | `adm_register_report` | `AdmissionRegisterReportView` → `/admission/register` | Period, Department, Doctor, Ward, Panel/Self-Pay, Admission Status | Row **View** → running Hospital bill modal |
| 3 | `adm_census` | `CensusBedReportView` → `/admission/census-beds` | As-of Date, Department, Ward, Room/Bed (text), Bed Status | One combined screen: one row per bed + occupant. Past As-of dates use admit/discharge times against the admission's current bed (earlier beds are in #4) |
| 4 | `adm_transfer_los` | `TransferLosReportView` → `/admission/transfer-los` | Period, Admission No, Department, Ward, Doctor | One row per transfer; never-transferred admissions show one row. LOS in days |
| 5 | `adm_outstanding_balance` | `HospitalBillStatusReportView` → `/admission/hospital-bill-status` | Period, Admission No, Department, Payment Status, Hospital Clearance | Read-only. Charges, payments collected by Billing, outstanding (negative = credit), latest receipt, latest payment-request status. Pharmacy bill never included. Row **View** → running bill |
| 6 | `adm_pharmacy_requests` | `PharmacyRequestFulfillmentView` → `/admission/pharmacy-request-fulfillment` | Period, Admission No, Medicine (text), Request Status, Approval Status | One row per requested medicine: requested vs dispensed, Pharmacy invoice, clearance, high-cost approval |
| 7 | `adm_discharge_clearance_report` | `DischargeClearanceReportView` → `/admission/discharge-clearance` | Period, Department, Doctor, Clinical Status, Hospital Clearance, Pharmacy Clearance | Hospital and Pharmacy clearance always separate columns; Balance = Settled / Credit / Outstanding |

- "Stay overlaps the period" is the date rule for Summary, Transfer/LOS and Bill Status, so **Today** still shows every patient currently admitted (not only today's new admissions).
- Dropdown sources: `GET /reports/admission/filter-options` (departments, doctors, wards).
- Old v7.5 report ids (`adm_daily_summary`, `adm_bed_occupancy`, `adm_bed_transfers`, `adm_length_of_stay`, `adm_service_consumption`, `adm_payment_request_status`, `adm_medicine_fulfillment`, `adm_high_value_approvals`, `adm_pharmacy_clearance_status`) now route to the report that absorbed them. Old component files are untouched (Super Admin still imports some — clean up tomorrow).
- Shared helpers moved to `components/reports/reportFilters.tsx` (`useReportFilters`, `useFilterOptions`, `FilterSelect`, `opts`) — Front Desk and Admission both use them; Super Admin should too.
- `GenericReportView`: point-in-time reports (`noDateFilter`) now still show the filter bar when they pass `extraFilters`.

Known limits:
- **No "urgency" field** exists on Pharmacy requests in the schema — the column shows the request's notes ("Notes / Urgency") instead.
- Admission Summary's "Hospital Outstanding" sums only positive dues (patients in credit count as 0).

### 8.5 Tomorrow — start here

1. Super Admin / Admin reporting per §8.3 (8 reports, ONE `REPORTS` nav group, no separate Front Desk / Admission groups). Reuse: Front Desk outstanding endpoint (#3), Admission Summary endpoint + `AdmissionSummaryView` with `title` prop (#4), `reportFilters.tsx` helpers.
2. Remove `SuperAdminModuleView`'s imports of the retired v7.5 views once the new SA menu replaces them.
3. Browser-test as `superadmin` and `admin`.
