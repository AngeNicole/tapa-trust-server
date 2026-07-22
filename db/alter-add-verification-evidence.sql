-- Prod-safe, idempotent columns for verification evidence uploads.
-- Certificate scans (certification_files) are stored so an admin can preview a
-- worker's qualifications. The id_document + selfie columns are retained only so
-- the startup scrub can wipe any images stored under the earlier design — under
-- match-then-discard the ID + selfie are compared in memory and never persisted.
-- Pure ALTER ... ADD COLUMN IF NOT EXISTS — safe to (re-)run live.

ALTER TABLE verification_request ADD COLUMN IF NOT EXISTS id_document        TEXT;
ALTER TABLE verification_request ADD COLUMN IF NOT EXISTS selfie             TEXT;
ALTER TABLE verification_request ADD COLUMN IF NOT EXISTS certification_files JSONB;
