# HMS service classification audit — 2026-10-06

## Findings
Legacy billing treated pharmacy, accommodation and consultation charges as ServiceRate records, while generic service lists did not consistently enforce ownership and selectability. LAB stream was also being used as a proxy for outsourced ownership.

The local database contained five real ServiceRate rows: SRV-0001, SRV-0002, SRV-EMRG, ROOM-ACC and SRV-PHARMACY. The first two lacked departments; the other three represented consultation/accommodation/pharmacy. All five had zero invoice, appointment, staff, panel-rule and commission references in the local audit. There were no invoice lines locally. These observations apply only to this local database.

## Implementation
ServiceRate now stores billingSource, providerType and selectable. Invoice lines store explicit billingSource and descriptionSnapshot, with an optional serviceRate reference. Staff consultationFee supports doctor charges independently of service rates; appointment service selection is optional when a configured doctor fee is used.

Service API and mutation guards enforce active/selectable services, department, provider ownership and outsourced provider. Generic lists default to active INTERNAL services. Admission, billing and intake share provider-first service selection. Generic service deletion archives records. Existing system rows remain hidden; no historical rows were hard-deleted.

Pharmacy callbacks, doctor charge posting and accommodation billing create source-classified invoice lines without requiring fake selectable services. Optional legacy lookups preserve existing panel-rule compatibility. Consolidated ledgers and reports display source and description even when serviceRateId is null.

## Migration and data safety
Additive migration: prisma/migrations/202610060001_service_sources/migration.sql. Applied and recorded on the local database. Local row counts and financial sums were unchanged. Three legacy source rows and two unassigned rows are non-selectable, so the current local Services list is empty until genuine department-assigned procedures are configured.

Other deployments must apply this migration and regenerate Prisma Client before starting the updated application. Do not blindly run all historical migrations against an existing unbaselined database. On Windows stop the backend before Prisma generation if its engine DLL is locked.

## Verification
- Backend typecheck/build: passed.
- Frontend typecheck/build: passed; bundle-size warning remains.
- Focused service classification/API/admission selection/accommodation tests: 69 passed.
- Real PostgreSQL transactional acceptance test: passed; fixtures rolled back. Covered internal/outsourced scopes, native doctor/room/pharmacy lines, pharmacy callback idempotency, totals and preservation of hidden legacy rows.
- Full suite: 318 passed, 22 failed, 2 skipped. Comparison against committed baseline found the same 22 failures and no additional failed tests. Baseline itself had 296 passed, 22 failed, 1 skipped. Full suite is therefore not green.
- Live local service APIs returned HTTP 200 after the migration, resolving the missing billing_source error.

## Changed files
- ch-sharif-and-saeed-hospital---hms/src/features/admission/AdmissionDetailModal.tsx
- ch-sharif-and-saeed-hospital---hms/src/features/frontDesk/appointments/BookAppointmentModal.tsx
- ch-sharif-and-saeed-hospital---hms/src/features/frontDesk/billing/InvoiceDetailModal.tsx
- ch-sharif-and-saeed-hospital---hms/src/features/frontDesk/encounterIntake/WalkInIntakeView.tsx
- ch-sharif-and-saeed-hospital---hms/src/features/superAdmin/servicesRates/ServiceModal.tsx
- ch-sharif-and-saeed-hospital---hms/src/features/superAdmin/servicesRates/ServicesFilterBar.tsx
- ch-sharif-and-saeed-hospital---hms/src/features/superAdmin/servicesRates/SuperAdminServicesRatesView.tsx
- ch-sharif-and-saeed-hospital---hms/src/services/admissionBillingService.ts
- ch-sharif-and-saeed-hospital---hms/src/services/admissionService.ts
- ch-sharif-and-saeed-hospital---hms/src/services/frontdeskApiService.ts
- ch-sharif-and-saeed-hospital---hms/src/services/invoiceService.ts
- ch-sharif-and-saeed-hospital---hms/src/services/serviceRatesService.ts
- ch-sharif-and-saeed-hospital---hms/src/services/staffUserService.ts
- ch-sharif-and-saeed-hospital---hms/src/types/serviceRates.ts
- ch-sharif-and-saeed-hospital---hms/src/types/staffUser.ts
- ch-sharif-and-saeed-hospital---hms/src/utils/serviceSelection.ts
- hms-backend/prisma/schema.prisma
- hms-backend/src/modules/admission/admission.routes.ts
- hms-backend/src/modules/admission/admission.schemas.ts
- hms-backend/src/modules/admission/admission.service.ts
- hms-backend/src/modules/commission/commission.service.ts
- hms-backend/src/modules/frontdesk/admissionBilling.service.ts
- hms-backend/src/modules/frontdesk/appointments.schemas.ts
- hms-backend/src/modules/frontdesk/appointments.service.ts
- hms-backend/src/modules/frontdesk/invoices.routes.ts
- hms-backend/src/modules/frontdesk/invoices.schemas.ts
- hms-backend/src/modules/frontdesk/invoices.service.ts
- hms-backend/src/modules/identity/staff.service.ts
- hms-backend/src/modules/pharmacy-bridge/pharmacy-bridge.service.ts
- hms-backend/src/modules/reports/admissionReports.service.ts
- hms-backend/src/modules/reports/frontdeskReports.service.ts
- hms-backend/src/modules/setup/setup.controller.ts
- hms-backend/src/modules/setup/setup.routes.ts
- hms-backend/src/modules/setup/setup.schemas.ts
- hms-backend/src/modules/setup/setup.service.ts
- hms-backend/src/shared/discountEligibility.ts
- hms-backend/tests/admissionAdditionalPayment.test.ts
- hms-backend/tests/admissionFulfillmentDefaults.test.ts
- hms-backend/tests/doctorAvailability.test.ts
- hms-backend/tests/phase4_frontdesk.test.ts
- hms-backend/tests/phase5_admission.test.ts
- hms-backend/tests/serviceSelection.test.ts
- ch-sharif-and-saeed-hospital---hms/src/components/forms/DoctorChargeForm.tsx
- ch-sharif-and-saeed-hospital---hms/src/components/forms/ServiceSourcePicker.tsx
- hms-backend/prisma/migrations/202610060001_service_sources/migration.sql
- hms-backend/src/shared/doctorCharges.ts
- hms-backend/src/shared/serviceClassification.ts
- hms-backend/tests/serviceArchitecture.test.ts
- hms-backend/tests/serviceSourcesDatabase.test.ts

## Requested default encounter exception
OPD, OBS and ER are now built-in, active internal encounter services without departments. Migration 202610060002_default_encounter_services restores the existing IDs and rates, protects uniqueness and leaves historical invoice lines unchanged. Their rate and billing settings can be edited; creation of another default, changing ownership/department/type, deactivation and deletion are blocked. General services still require a department. Department-scoped and outsourced selectors exclude these global defaults; walk-in intake can use the defaults independently of its clinical department. Live API verified all three with null department IDs. Regression tests: 52 passed.
