ALTER TABLE departments ADD COLUMN is_default_pharmacy BOOLEAN NOT NULL DEFAULT false;
DO $$
DECLARE selected_id TEXT;
BEGIN
  SELECT id INTO selected_id FROM departments WHERE department_type='PHARMACY'
    ORDER BY is_active DESC, created_at, id LIMIT 1;
  IF selected_id IS NULL THEN
    selected_id := gen_random_uuid()::text;
    INSERT INTO departments(id,code,name,department_type,created_at,updated_at)
      VALUES(selected_id,'PHARM-' || substr(replace(selected_id,'-',''),1,8),'Pharmacy','PHARMACY',NOW(),NOW());
  END IF;
  UPDATE departments SET is_default_pharmacy=true, is_active=true, pharmacy_related=true,
    fulfillment_ownership='INTERNAL', outsourced_provider_id=NULL, updated_at=NOW() WHERE id=selected_id;
END $$;
CREATE UNIQUE INDEX departments_default_pharmacy_unique ON departments(is_default_pharmacy) WHERE is_default_pharmacy;
