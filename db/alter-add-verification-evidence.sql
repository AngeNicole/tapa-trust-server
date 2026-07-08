-- Prod-safe, idempotent columns for verification evidence uploads.
-- Workers upload an ID document, a selfie, and certificate scans (base64 data
-- URLs) so an admin can compare the selfie against the ID and preview the
-- certificates. Pure ALTER ... ADD COLUMN IF NOT EXISTS — safe to (re-)run live.

ALTER TABLE verification_request ADD COLUMN IF NOT EXISTS id_document        TEXT;
ALTER TABLE verification_request ADD COLUMN IF NOT EXISTS selfie             TEXT;
ALTER TABLE verification_request ADD COLUMN IF NOT EXISTS certification_files JSONB;
