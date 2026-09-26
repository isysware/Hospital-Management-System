# Staff, Portal Access, Salary & Commission — Implementation Plan

Source of truth: `Staff Portal Access Salary Commission.pdf` (Final Blueprint, prepared by iSysware), cross-checked against the actual codebase on 2026-09-25.

**Scope decision (per instruction, overrides the blueprint's 10-step wizard where they conflict):** the **Add/Edit Staff form stays short**. Only the fields explicitly called mandatory below are required on the form; everything else the blueprint lists (bank details, weekly schedule, professional quals, emergency contact, salary, commission) is real but lives in **Staff 360 / separate screens**, never in the quick Add form. This is a deliberate scope cut agreed with the user, not an oversight against the PDF.

No hardcoded departments/services/portals/categories. Every figure/relation traces to a real Prisma row and the actual logged-in user.

---

## 1. Today's two work items

1. **Rebuild Add/Edit Staff form** — current `StaffUserModal.tsx` is bloated and violates the blueprint's core separation rule (username/password/portal-role and salary/commission are embedded directly in the Staff Master form). Rebuild it to the short spec in §2.
2. **Payroll Salary + Commission** — audit + fix what's real vs missing (§6), execute the realistic slice for today (§7).

---

## 2. Add Staff form — final field list (mandatory vs optional)

| Field | Required? |
|---|---|
| Full Name | **Mandatory** |
| Father / Guardian Name | **Mandatory** |
| Mobile Number | **Mandatory** |
| CNIC | **Mandatory** |
| Date of Birth | **Mandatory** |
| Staff Category | **Mandatory** |
| Employee Code | Auto-generated, read-only |
| Status | Defaults to Active |
| Clinical Department(s) — Doctor only | **Mandatory for Doctor** |
| Assigned Services — Doctor only | **Mandatory for Doctor** |
| Everything else (designation, email, alternate phone, address, bank, shift, salary, commission, clinical discharge auth) | **Optional / deferred to Staff 360** |

Removed entirely from this form: username, password, assigned portal, staff role, salary checkboxes, commission checkbox, clinical discharge credentials. These move to their own workflows (§4, §5).

### Staff Category list (fixed set, still stored as a plain string column — no enum migration)
`Doctor`, `RMO`, `Front Desk / Billing`, `Admission`, `Inventory Management`, `Nurse`, `Technician`, `Other Staff`.
RMO is its own category, never merged into Doctor.

---

## 3. Current state audit

### 3.1 Already real, reusable as-is
- `Staff` model, `StaffDepartment` junction (many-to-many dept assignment) — real, already used for Doctor multi-department.
- `PortalUser` model + `/api/v1/portal-users` (full CRUD, status, reset-password) — **already structurally separate** from `Staff`. The separation the blueprint asks for already exists at the data/API layer; it's only the *frontend* (`StaffUserModal.tsx`) that wrongly conflates them by embedding portal fields inline.
- `DoctorCommissionRule` / `DoctorCommissionAccrual` / `CommissionPayout` / `CommissionReversal` — real. `commission.service.ts`'s `calculateAndAccrueCommission` already auto-accrues commission from a completed, non-voided invoice line at billing time (matches blueprint §14/§15 exactly: service-driven, net-of-discount by default, one accrual per line).
- `StaffSalaryProfile` — real, effective-dated, created via `POST /staff/:id/salary-profile`.
- `SalarySlip` / `SalaryPayment` — schema exists (per-staff calculated result + payment), but **no service/route generates a SalarySlip today**.

### 3.2 Missing / gaps
- **No `dateOfBirth` field on `Staff`** — needed for the new mandatory DOB field. Migration required.
- **`Staff.departmentId` and `Staff.designation` are non-nullable** — today every staff member is forced into a department + designation. Per the short form, only Doctors need a department at creation; designation is optional. Migration required (`departmentId String?`, `designation String?`).
- **No CNIC uniqueness constraint** — `cnic` has no `@unique`, and no service-level duplicate check exists. Needed per validation rule.
- **No Doctor↔Service assignment table** — `DoctorCommissionRule.serviceRateId` conflates "this doctor performs this service" with "this doctor's commission rate for it." The Add form needs a plain assignment fact (no rate) — new `StaffService` join table.
- **Attendance module is a scaffold only** (`attendance.routes.ts` has a single `/_scaffold` stub, no real endpoints, no data ever written to `AttendanceRecord`). This is the actual blocker for blueprint §11's attendance-based salary calculation — there is no attendance to calculate from yet.
- **No Payroll Run engine** (`PayrollRun`/`PayrollLine` don't exist in the schema at all) — `SalarySlip` has no batch/period-run concept, no generate/preview/approve workflow.
- **No standalone "Portal Access" screen** — creating a portal login is currently only possible bundled inside `StaffUserModal.tsx` (Add Staff) or `AdminUserModal.tsx` (Admin/Super Admin tier). Blueprint §5 wants a dedicated "Portal Users / Access Accounts" screen, independent of the Add Staff flow.
- **Bank account details** — no `StaffBankAccount` model, no UI. Fully missing (out of scope for today per the short-form decision; noted for a later phase).
- **Weekly schedule / shift assignment per staff** — `ShiftModal.tsx`/shifts exist at a hospital-wide level (`hms-backend` shift setup), but no per-staff `StaffShiftAssignment`/`StaffWeeklySchedule`. Out of scope for today.

---

## 4. Doctor Department & Service Assignment (new, built today)

- New Prisma model `StaffService` (staffId, serviceRateId, isActive, assignedAt, assignedBy; unique on `[staffId, serviceRateId]`) — pure "doctor performs this service" fact, no rate. Deactivating (not deleting) preserves history when a doctor's services change or when category changes away from Doctor.
- Add Staff form, Doctor category: two mandatory dynamic multi-selects — Clinical Department(s) (existing `StaffDepartment`) and Assigned Services (new `StaffService`), both fetched live from `/departments` and `/setup/services-rates` (active rows only), never hardcoded.
- Commission rate/eligibility per service stays a **separate** step in `DoctorCommissionView.tsx` (existing screen, `DoctorCommissionRule`) — not part of Add Staff. Today's commission work (§7) scopes `DoctorCommissionView`'s service dropdown to only the doctor's *assigned* services from the new table, so a rate can never be set for a service the doctor isn't actually assigned to.

---

## 5. Portal Access eligibility (new, built today)

Categories that commonly need HMS access: `Front Desk / Billing`, `Admission`, `Inventory Management`, `RMO` (when workflow requires it). This is guidance, not an automatic grant — per the blueprint's non-negotiable rule, **category never auto-creates portal access**.

- After a Staff record is saved, the Staff table shows a `Portal Access: Required` / `Portal Access: Granted` / `—` (not applicable) badge, purely informational.
- Actual login creation/linking happens through the **existing separate** `/portal-users` API — reused by a new, dedicated "Portal Access" list screen (search existing Staff, assign one of the existing `PortalRole`s: `FRONT_DESK_BILLING` / `ADMISSION` / `INVENTORY_MANAGEMENT` / `ADMIN` / `SUPER_ADMIN`). **No new RMO portal role** — an RMO who needs access is assigned one of these existing roles by an Admin, same as any other category.
- Staff Master never embeds username/password again.

---

## 6. Payroll Salary + Commission — condensed status

| Piece | Status |
|---|---|
| Salary Profile (rate/basis/tax config per staff) | Real, already built |
| Salary calculation from attendance | **Not possible today** — Attendance module is an unbuilt scaffold |
| Payroll Run (batch generate/preview/approve/pay for a period) | **Missing** — no schema, no service |
| Commission Rule (per-service rate/basis) | Real, already built (`DoctorCommissionView.tsx`) |
| Commission accrual (auto, per completed invoice line) | Real, already built and wired into billing |
| Commission reversal (on refund/void) | Real (`reverseCommissionAccrual`) — verify it's actually called from the refund/void path today |
| Commission Run / batch payment UI | Partial — accrual list exists (`listAccruals`), no payout UI wired to `CommissionPayout` yet |
| Salary/Commission separation into distinct payment ledgers | Schema-level yes (`SalaryPayment` vs `CommissionPayout` are already separate tables) |

## 7. Today's realistic Payroll/Commission slice — Done (2026-09-25)

Building a real attendance-driven Payroll Run engine from zero in the same session as the Staff form rebuild isn't realistic — it needs the Attendance module built first (capture, policy, correction log), which is its own multi-day workstream. Today's slice instead:

1. **Done.** `DoctorCommissionView.tsx`'s service picker now scopes to the selected doctor's real `StaffService` assignments (`doctorAssignedServices`, recomputed per doctor) instead of every active service system-wide — closes the "commission can be set for a service the doctor never performs" gap. Doctor select now clears the service field on change; a hint explains why the list is empty when a doctor has no Assigned Services yet.
2. **Verified, no fix needed.** `reverseCommissionAccrual` is already genuinely called from the real refund path in `invoices.service.ts` (the loop over `invoice.lines` with a `commissionAccrual`, inside the same transaction as the refund receipt/cash-ledger entry). No separate "void invoice line" mutation exists yet in this codebase to wire a second reversal trigger into.
3. **Verified, no fix needed.** `SalaryProfileModal.tsx` (Wallet icon on the Staff Users table row actions) already works for any staff category, independent of the Add/Edit Staff form, and its effective-dated create-closes-previous pattern was untouched by this session's Staff schema changes.
4. Documented (this file) the Payroll Run / Attendance gap explicitly as a separate future phase rather than quietly leaving it half-done — see §6.

---

## 8. Build order for today

1. Prisma migration: `Staff.dateOfBirth` (add), `Staff.departmentId` → nullable, `Staff.designation` → nullable, `Staff.cnic` → `@unique`, new `StaffService` model.
2. Backend: `staff.schemas.ts` / `staff.service.ts` / `staff.controller.ts` / `staff.routes.ts` — short create/update payload, CNIC uniqueness check, DOB validation, Doctor service-assignment endpoints, department-required-only-for-Doctor rule.
3. Frontend: `types/staffUser.ts`, `staffUserService.ts`, full rewrite of `StaffUserModal.tsx` to the short form + Doctor section, `StaffUsersTable.tsx` "Portal Access" badge column.
4. New "Portal Access" screen reusing existing `/portal-users` API.
5. `DoctorCommissionView.tsx` — scope service dropdown to assigned services.
6. Typecheck (frontend `tsc --noEmit`, backend `tsc --noEmit`) both clean before calling it done.

---

## 10. Build status (2026-09-25)

**Step 1 (schema) — Done.** Migration `20260925130000_staff_short_form_and_service_assignment`: `Staff.dateOfBirth` added, `Staff.departmentId`/`designation` made nullable, `Staff.cnic` made unique, new `StaffService` join table. One pre-existing legacy staff row's category (`Front Desk / Reception`) remapped to the new `Front Desk / Billing` value so its Edit form doesn't show a blank category.

**Step 2 (backend) — Done.** `staff.schemas.ts`/`staff.service.ts`/`staff.repository.ts` rebuilt: short mandatory field set, CNIC uniqueness (409 on duplicate), Doctor department/service requirement (400 if missing), active-service validation, category-change-away-from-Doctor soft-deactivates `StaffService` rows (never deletes). `admission.service.ts`'s one `doctor.department.name` read made null-safe. Verified live end-to-end via direct API calls: non-Doctor create, Doctor create (dept+service required, rejects if missing), CNIC duplicate rejection, category change deactivating service assignments, 360 profile returning `departments`/`assignedServices`. Test data cleaned up after.

**Step 3 (frontend) — Done.** `StaffUserModal.tsx` fully rebuilt to the short form (Full Name, Father Name, Mobile, CNIC, DOB, Staff Category mandatory; Employee Code auto; Status defaults Active; Designation/email/alt-phone optional; Doctor section for Department(s)+Services). All username/password/portal-role/salary/commission/clinical-auth fields removed from this form — those already had (or now have) their own separate entry points: Salary Profile modal, Clinical Auth modal, Doctor Commission screen (pre-existing, untouched), and a **new** `PortalAccessModal.tsx` (staff.md §5) for granting/revoking HMS login, wired into `StaffUsersTable.tsx` via a new "Portal Access" row action. `StaffUsersTable.tsx`'s header/row column-count mismatch (12 data cells under 8 headers — a real pre-existing bug) fixed along the way. Bulk Excel import updated to the same mandatory-field contract (added `date_of_birth`, `services` columns) so it isn't left silently broken.

**Regression check — clean.** Backend `tsc --noEmit` and frontend `tsc --noEmit` both clean (same 6 pre-existing unrelated errors as before, none touched by this work). Backend test suite: found and fixed one real regression (`doctorAvailability.test.ts` used the old `departmentId`/no-DOB contract) by updating its fixtures and mocks to match the new schema — after the fix, the suite is at the exact same 21 pre-existing failing tests as the `main`-branch baseline (verified via `git stash`/`git stash pop` before/after comparison), 231 passing.

**Not done yet (explicitly out of today's scope, see §1):**
- Payroll Salary + Commission work (§6/§7) — not started this session; still just the audited status in §6.
- A full standalone "Portal Access" nav page (blueprint's suggested dedicated screen) — today shipped as a modal from the Staff Users table instead, which satisfies the separation rule at lower cost. Upgrade to a dedicated page later if wanted.
- Bank account details, weekly schedule, professional qualifications, emergency contact — still fully out of scope, per §1's deliberate scope cut.

**Post-ship bug fixes (2026-09-25, same day):**
- **Doctor eligibility for OPD/Observation/Emergency consulting-doctor lists** was silently broken by the short-form rebuild: the old manual `availableForOpd`/`Observation`/`Emergency` checkboxes were removed from the Add form (per the deliberate scope cut) but nothing replaced them, so every newly-created Doctor defaulted to ineligible everywhere `doctorsForEncounter()` (`utils/doctorAvailability.ts`) is used (OPD/walk-in intake, appointment booking). Fixed by deriving eligibility from the doctor's **Assigned Services** instead of a separate toggle: `ServiceRate.encounterType` (OPD/OBSERVATION/EMERGENCY/NONE, already a real admin-configurable field on Services & Rates) is now included in `staff.repository.ts`'s `staffServices` select, and `staffUserService.ts`'s `toStaffUser()` derives `availableForOpd`/`Observation`/`Emergency` as `rawFlag OR hasAssignedServiceWithThatEncounterType` — matches the instruction that eligibility should come from what was actually selected at Staff Add, not a manual flag. `StaffUserModal.tsx` now also shows a live "this doctor will appear in the OPD/Emergency consulting list" hint next to the Assigned Services checkboxes, plus an encounter-type badge per service. Verified end-to-end via API (service `encounterType` → doctor's derived `availableForOpd`).

**Attendance module — built (2026-09-25).** staff.md §6 flagged this as the actual blocker for Payroll Run; it's no longer a scaffold.
- Schema: `AttendanceStatus` redesigned to match the payable-equivalent-day table exactly (`PRESENT`/`HALF_DAY`/`ABSENT`/`PAID_LEAVE`/`UNPAID_LEAVE`/`MISSING_PUNCH`) — late/early-out stay modifiers on `lateMinutes`/`earlyExitMinutes`, not separate statuses. New `AttendanceSource` (`MANUAL`/`DEVICE`/`IMPORTED`) and `markedById` actor column added to `AttendanceRecord` so tomorrow's biometric device sync (`BiometricRawPunch`, already modeled) writes into the exact same table/rows with `source = DEVICE`, no redesign needed. Migration `20260925140000_attendance_manual_marking` (table was empty — zero data risk).
- Backend (`hms-backend/src/modules/attendance/`, mounted at `/api/v1/attendance`, replacing the old `_scaffold` stub): `GET /roster` (daily marking grid — every active staff + department/category filter, with any existing mark for that date), `POST /mark` (single upsert-by-day), `POST /bulk-mark` (whole-roster save in one transaction), `GET /` (history, filtered/paginated), `GET /summary` (payable-equivalent-days per staff for a period — the exact input a future Payroll Run consumes), `POST /:id/approve`, `POST /:id/correct` (post-approval edits only, always requires a reason, always writes `AttendanceCorrectionLog` with original→corrected snapshot — D16 p.19/p.33, never a silent overwrite). Marking an already-approved day via `/mark` is rejected (409) — correction is the only path once approved. `authorize.ts`'s policy map got `attendance`/`payroll` module grants for SUPER_ADMIN/ADMIN (the `ModuleKey` type already listed them; the policy object just hadn't been wired). Verified end-to-end via live API: roster → mark → bulk-mark → approve → blocked re-mark → correct-with-reason → summary → correction log, all against real DB rows, test data cleaned up after.
- Frontend: `types/attendance.ts`, `services/attendanceService.ts`, `features/superAdmin/attendance/SuperAdminAttendanceView.tsx` (two tabs — **Mark Attendance**: date/department/category-filtered roster grid, per-row status + check-in/out, "Mark All Present" quick action, bulk save; **History & Approval**: date-range list, Approve action, Correct action with mandatory reason). Wired into `SuperAdminModuleView.tsx`'s existing `attendance` nav item (was falling through to the generic mock-table renderer, same class of gap the Staff/Finance Control screens had before this workstream — now fixed the same way).
- **Not built**: weekly schedule / per-staff shift assignment, and the actual device adapter (only the schema seam exists). See Payroll Run below for how "Scheduled Payable Days" was resolved without it.

**Payroll Run — built (2026-09-25).** The other half of §6/§7's flagged gap.
- Schema: new `PayrollRun` model (period type/dates, department/category filters, status, totals, `skippedStaff` JSON — every staff excluded from a run carries a real reason, never silently dropped), linked to `SalarySlip` via a new nullable `payrollRunId`. Migration `20260925150000_payroll_run` (both tables were empty).
- **"Scheduled Payable Days" resolved without a shift-assignment system**: rather than fabricate a weekly-off assumption with no real data behind it, Scheduled Payable Days = the count of that staff member's **approved** `AttendanceRecord` rows in the period (Attendance Equivalent Days = the same rows' payable-equivalent sum). This is 100% real, HR-driven data — whatever days HR actually marked and approved — with no assumed 5/6-day week baked in anywhere. A staff member with zero approved attendance in the period is skipped with an explicit reason, never divided-by-zero or defaulted.
- Backend (`hms-backend/src/modules/payroll/`, mounted at `/api/v1/payroll`, replacing the old `_scaffold` stub): `POST /preview` (read-only — exactly what Generate would produce), `POST /runs` (generate — persists the run + one `SalarySlip` per eligible staff, snapshotting the full calculation), `GET /runs`, `GET /runs/:id`, `POST /runs/:id/approve` (locks every line in the run at once), `GET /slips`, `POST /slips/:id/pay` (creates a real `SalaryPayment`; rejects paying anything not yet `APPROVED`; rejects overpayment past the remaining balance; auto-transitions `APPROVED → PARTIALLY_PAID → PAID`). Calculation matches the guide's formula exactly (verified live): Monthly Per-Day Rate = baseAmount / scheduledPayableDays, Earned Base = perDayRate × attendanceEquivalentDays, Attendance Deduction = periodBaseAmount − earnedBase, Tax per the Salary Profile's method, Net = earnedBase − tax.
- `authorize.ts` policy map got the `payroll` module grant for SUPER_ADMIN/ADMIN (same fix pattern as `attendance` above).
- Frontend: `types/payroll.ts`, `services/payrollService.ts`, `features/superAdmin/payroll/SuperAdminPayrollView.tsx` (**Generate Run** tab — period type/dates/department/category → live Preview table with per-staff breakdown + a Skipped list with reasons → Generate; **Runs & Payments** tab — run list → detail with every slip, Approve Run, and a Pay modal per slip with remaining-balance tracking). Wired into `SuperAdminModuleView.tsx`'s existing `salary_payroll` nav item (was the generic mock-table fallback before this).
- **Verified fully end-to-end on real DB data**: created a real Salary Profile (Monthly, 60,000) for a real staff member, marked+approved 5 real attendance days (4 Present + 1 Half Day), ran Preview (5 scheduled days, 4.5 equivalent days, 54,000 earned, 6,000 deducted — matches the guide's worked example formula exactly), Generate, confirmed pay-before-approve is blocked (409), Approve, Pay in full → `PAID`. Test data cleaned up after (careful not to touch the user's own real records found in the same tables during cleanup).

**Commission — Approve/Pay added (2026-09-25).** Commission *accrual* was already real and automatic (confirmed in the earlier Payroll/Commission audit); today added the missing Approve → Pay half of the lifecycle so an accrued commission can actually be settled, mirroring Payroll's exact gate pattern.
- Backend: `commission.service.ts` gained `approveAccrual` (ACCRUED → APPROVED) and `payAccrual` (creates a real `CommissionPayout`, respects reversals already posted against the accrual, blocks overpayment, auto-transitions `APPROVED → PARTIALLY_PAID → PAID`); new routes `POST /commission/accruals/:id/approve` and `POST /commission/accruals/:id/pay`.
- Frontend: `commissionService.ts` gained `fetchCommissionAccruals`/`approveCommissionAccrual`/`payCommissionAccrual`; `DoctorCommissionView.tsx` gained a **Commission Accruals & Payments** section below the existing rules table, with Approve/Pay actions and a payment modal.
- **Verified fully end-to-end on a real billed transaction**: created a real commission rule (10% NET), billed a real OPD encounter+service line performed by that doctor (the actual Front Desk billing pipeline, not a mock), confirmed the accrual auto-created correctly (PKR 100 = 10% of the real PKR 1,000 line), then approve → partial pay (60) → full pay (40) → `PAID`, with pay-before-approve correctly blocked. Test data cleaned up after — left the user's own real billing record (a different, earlier invoice found in the same table) untouched.

**Correction (2026-09-25, same day) — Shift + Salary folded back into the Add/Edit Staff form.** The user correctly called out that the blueprint's own Add Wizard (§2) lists Shift (step 5) and Salary Setup (step 7) as steps *inside* the wizard, not entirely separate post-save screens — only Portal Access is explicitly called out as separate ("Portal login is NOT created here"). Removing Salary/Shift from the form entirely (per this file's earlier, over-corrected scope decision) was a mistake against the user's actual intent, not a faithful reading of the blueprint. Fixed:
- Schema: new `Staff.assignedShiftId` (nullable FK to the existing `Shift` master — staff.md's real Shift Master, no new model needed). Migration `20260925160000_staff_assigned_shift`.
- Backend: `createStaffBodySchema`/`updateStaffBodySchema` accept `assignedShiftId`; `staff.service.ts` connects/disconnects it correctly; included in list/360 responses.
- Frontend: `StaffUserModal.tsx` gained an optional **"Shift & Salary Setup"** section — Assigned Shift dropdown (real active shifts from Shift Management) + a Salary Setup sub-section (Basis, Base Amount, Tax, Effective From) that reuses the existing `POST /staff/:id/salary-profile` endpoint, called right after Staff Master saves. Edit mode prefills the current salary profile via the existing Staff 360 fetch. Doctor Commission (service-based, doctors only) correctly stays its own separate screen — that one genuinely doesn't belong in Staff Master per the blueprint's own "Only if eligible" framing, and the user didn't ask for it back. Portal Access also correctly stays separate — that's the one workflow the blueprint explicitly pulls out.
- **Verified end-to-end on real DB data**: created a real Shift ("Morning Shift", 08:00–16:00) via the real Shift Master, created a staff member with that shift assigned at Add time, added a Salary Profile (35,000/month) via the bundled call, confirmed both round-trip correctly through the list and Staff 360 endpoints, confirmed clearing the shift (`assignedShiftId: null`) correctly disconnects it. Test data cleaned up after.

**Critical Payroll fix (2026-09-25, same day) — "Scheduled Payable Days" was actually wrong.** Live-tested on the user's own real staff and it broke immediately: a Monthly-salaried staff member with exactly **1** approved attendance day in September got a payroll preview of the **full month's salary** (PKR 30,000) for that single day, because `scheduledPayableDays` was implemented as "however many attendance rows exist" — which meant `perDayRate = baseAmount / recordCount` collapsed to `baseAmount` itself whenever every marked day happened to be Present. This directly contradicted the guide's own formula (Monthly Per-Day Rate = Base / *Scheduled* Payable Days in the period, not / days-that-happen-to-be-marked) and the user's explicit expectation ("however many days attended, that many days should be paid").
- **Fixed**: `scheduledPayableDays` is now a real calendar calculation — every day in `[periodStart, periodEnd]` minus the staff member's **assigned Shift's** weekly-off days (the `Staff.assignedShiftId` → `Shift.defaultWeeklyOffDays` link added earlier today), falling back to every calendar day when no Shift is assigned. `attendanceEquivalentDays` still comes only from real approved attendance (unmarked days = 0, never assumed present).
- **Re-verified on the same real staff member after the fix**: September (30 days) → earned PKR 1,000 for the 1 attended day (was 30,000) — exactly "1/30th of the month for 1 day attended." Also verified a Sunday-off Shift correctly drops scheduled days from 30 to 26 for the same period. Test shift/assignment removed after verification; the user's real Salary Profile and now-approved attendance were left in place.
- **Salary Type dropdown** also expanded to the guide's exact 4 types (§9): Monthly / Monthly + Commission / Daily / Daily + Commission — available in both the Add/Edit Staff form's Salary Setup section and the standalone Salary Profile modal. The "+ Commission" half is a label only (commission is always calculated separately and automatically via `DoctorCommissionRule` — folding it into this figure would violate the guide's own "Salary and Commission are separate financial structures" rule); `payroll.service.ts`'s Monthly/Daily branch now checks `salaryBasis.startsWith('MONTHLY')` so both Commission variants compute correctly.
- **Attendance-approval friction fixed** as a related, real usability gap the same test exposed: the user's own attendance was marked but never approved, and Payroll only reads approved attendance (by design — matches the guide's Payroll Approval gate). Added a one-click **"Approve All Pending"** action + a visible pending-count banner to the Attendance History tab so this never silently blocks a payroll run again.
- Also fixed two unrelated pre-existing bugs surfaced by this pass while getting the backend back to a clean compile: `admission.service.ts` had a wrong Prisma relation name (`staffUser` → `staff`) in two payment-notification code paths, and one of those paths was missing `selfPayEncounter` in its query include.

**Still not built (honest gap, unchanged from the plan)**: Salary/Commission Adjustment-Reversal (correcting an already-approved/paid slip or accrual without touching history) — both `SalarySlip`/`DoctorCommissionAccrual` can currently only move forward through their status lifecycle, never be corrected post-approval the way Attendance's correction log allows. Flagging for a follow-up rather than leaving it undocumented.

- **OPD/Observation/Emergency billing couldn't find a rate for a doctor's assigned service** (Front Desk → Walk-In Intake, and Appointment Booking): a pre-existing bug, surfaced by real usage today — `servicesForSource()` scopes the encounter-service lookup to the *selected doctor's primary department* once a doctor is picked. A hospital-wide service (`departmentId = NULL`, e.g. a shared "OPD Service") or a service scoped to a different department than the doctor's primary one never matched, so "No default rate configured for OPD" showed even though the doctor was genuinely assigned that exact OPD service. Fixed in both `WalkInIntakeView.tsx` (`encounterServices`) and `BookAppointmentModal.tsx` (`departmentServices`): the department-scoped list is now merged with whatever real, active services the selected doctor is actually assigned to (`StaffUser.assignedServiceIds`) — no hardcoding, purely DB-driven, consistent with the OPD/OBS/ER eligibility fix above. Verified the fix logic against real DB rows (Huzaifa / NICU / department-less "OPD Service").

**Aside, unrelated to this task:** 4 pre-existing guide PDFs at the repo root (`CHSS_HMS_Balance_Sheet_and_Account_Settlement_Guide.pdf`, `CHSS_HMS_Panel_Patient_Complete_Flow_Forms_v7_4.pdf`, `Front_Desk_Admission_Reporting_Complete_Guide_v7_5_Reconstructed.pdf`, `HMS_Backend_Implementation_Prompts.pdf`) were found deleted from disk (but not staged/committed) at the start of this session, before any tool call in this conversation touched them. Flagging this — not something this session did, and not restored or removed further.

---

## 9. Non-negotiable rules carried into this build
1. Staff Master and Portal Access stay structurally separate — no login fields in the Staff form.
2. Staff Category never auto-grants portal access.
3. Doctor may belong to multiple departments and multiple services — no hardcoded lists.
4. CNIC unique; Mobile, DOB, Category always required; Doctor requires ≥1 department and ≥1 service.
5. Changing a staff member away from Doctor deactivates (never silently deletes) their department/service history.
6. No fabricated data anywhere — every dropdown is a live API call.
