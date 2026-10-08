-- Additive classification only. Preserve all legacy IDs, relations and amounts.
CREATE TYPE "BillingSource" AS ENUM ('HOSPITAL_SERVICE','OUTSOURCED_SERVICE','DOCTOR_CHARGE','ROOM_BED','PHARMACY','LAB','OTHER_VALID_SOURCE');
ALTER TABLE service_rates ADD COLUMN billing_source "BillingSource" NOT NULL DEFAULT 'HOSPITAL_SERVICE', ADD COLUMN provider_type "DepartmentFulfillmentOwnership" NOT NULL DEFAULT 'INTERNAL', ADD COLUMN selectable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE invoice_line_items ADD COLUMN billing_source "BillingSource" NOT NULL DEFAULT 'HOSPITAL_SERVICE', ADD COLUMN description_snapshot TEXT, ALTER COLUMN service_rate_id DROP NOT NULL;
-- Names/codes are used ONLY for this one-time legacy backfill, never routing future charges.
UPDATE service_rates SET billing_source='PHARMACY', selectable=false, is_system_generated=true
WHERE upper(code)='SRV-PHARMACY' OR upper(coalesce(category,'')) IN ('PHARMACY','MEDICINE','MEDICATION') OR name ~* '^(pharmacy medication|panadol)( |$)';
UPDATE service_rates SET billing_source='ROOM_BED', selectable=false, is_system_generated=true
WHERE code IN ('ROOM-ACC','WARD-PRICE','WARD-FIXED') OR lower(coalesce(category,'')) IN ('accommodation','room / bed','room','bed') OR name ~* '^(room|bed) (charge|charges)$';
UPDATE service_rates SET billing_source='DOCTOR_CHARGE', selectable=false, is_system_generated=true
WHERE lower(coalesce(category,''))='consultation' OR name ~* '(consultation|doctor (charge|visit)|specialist fee|round fee)';
UPDATE service_rates SET selectable=false WHERE is_system_generated OR is_deleted;
UPDATE service_rates s SET provider_type=d.fulfillment_ownership FROM departments d WHERE d.id=s.department_id;
UPDATE service_rates SET billing_source='OUTSOURCED_SERVICE' WHERE provider_type='OUTSOURCED' AND selectable;
-- Unassigned legacy rows need an explicit department before they can be selected.
UPDATE service_rates SET selectable=false WHERE department_id IS NULL;
UPDATE invoice_line_items l SET billing_source=s.billing_source, description_snapshot=s.name FROM service_rates s WHERE s.id=l.service_rate_id;
CREATE INDEX service_rates_selection_idx ON service_rates(provider_type, department_id, is_active, selectable);
CREATE INDEX invoice_line_items_source_idx ON invoice_line_items(billing_source);

ALTER TABLE staff ADD COLUMN consultation_fee DECIMAL(14,2);

ALTER TABLE appointments ALTER COLUMN service_rate_id DROP NOT NULL;
