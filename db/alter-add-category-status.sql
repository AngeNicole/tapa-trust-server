-- Prod-safe, idempotent addition of a status column to skill_categories
-- (active | archived) for category archive/status management. No DROP, no data
-- loss, safe to re-run. Non-destructive counterpart to `npm run migrate`.

ALTER TABLE skill_categories ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
