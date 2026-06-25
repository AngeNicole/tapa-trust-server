-- Prod-safe, idempotent additions for the optional-profile-fields + admin-reject
-- delta. Pure ALTER ... ADD COLUMN IF NOT EXISTS — no DROP/CREATE/TRUNCATE, no
-- data loss, safe to re-run. Non-destructive counterpart to `npm run migrate`.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS education TEXT;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS certifications TEXT;

-- Optional admin note stored on a verification_request (e.g. the reason on reject).
ALTER TABLE verification_request ADD COLUMN IF NOT EXISTS note TEXT;
