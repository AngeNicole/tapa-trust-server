-- Prod-safe, idempotent column additions for the browse-and-book delta.
-- Pure ALTER ... ADD COLUMN IF NOT EXISTS — no DROP/CREATE/TRUNCATE, no data loss.
-- Safe to run against the live database (and to re-run); existing rows get the
-- column defaults. This is the non-destructive counterpart to the destructive
-- `npm run migrate`, applied the same way the category seed was.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS photo TEXT;
