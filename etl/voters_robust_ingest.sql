-- Preserve arbitrary source columns that don't fit the canonical schema.
-- Lets users upload files from any jurisdiction with custom fields
-- (household_id, donor_amount, registration_status, etc.) without losing them.
alter table voters add column if not exists extra jsonb;
