-- Keep existing IDs, prices and every financial reference. Only catalog defaults change.
DO $$
DECLARE kind TEXT; label TEXT; selected_id TEXT;
BEGIN
  FOREACH kind IN ARRAY ARRAY['OPD','OBSERVATION','EMERGENCY'] LOOP
    label := CASE kind WHEN 'OBSERVATION' THEN 'OBS' WHEN 'EMERGENCY' THEN 'ER' ELSE 'OPD' END;
    SELECT id INTO selected_id FROM service_rates
      WHERE encounter_type=kind AND is_default_encounter_service AND NOT is_deleted
      ORDER BY created_at, id LIMIT 1;
    IF selected_id IS NULL THEN
      selected_id := gen_random_uuid()::text;
      INSERT INTO service_rates(id,code,name,billing_unit,standard_rate,created_at,updated_at,encounter_type,is_default_encounter_service)
      VALUES(selected_id,'DEFAULT-' || kind,label,'Per Visit',0,NOW(),NOW(),kind,true);
    END IF;
    UPDATE service_rates SET is_default_encounter_service=false
      WHERE encounter_type=kind AND id<>selected_id AND is_default_encounter_service;
    UPDATE service_rates SET name=label, category='Encounter Service', department_id=NULL,
      provider_type='INTERNAL', billing_source='HOSPITAL_SERVICE', service_stream='HOSPITAL',
      selectable=true, is_active=true, is_system_generated=false, updated_at=NOW()
      WHERE id=selected_id;
  END LOOP;
END $$;
CREATE UNIQUE INDEX service_rates_core_encounter_unique ON service_rates(encounter_type)
  WHERE is_default_encounter_service AND NOT is_deleted AND encounter_type IN ('OPD','OBSERVATION','EMERGENCY');
