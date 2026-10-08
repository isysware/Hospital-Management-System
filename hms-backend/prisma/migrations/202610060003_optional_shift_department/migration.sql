-- NULL denotes an HMS-wide shift. Keep all existing department assignments.
ALTER TABLE shifts ALTER COLUMN department_id DROP NOT NULL;
