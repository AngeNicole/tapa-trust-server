-- Prod-safe, idempotent addition of a cancel/reject reason on bookings.
-- Pure ADD COLUMN IF NOT EXISTS — no DROP, no data loss, safe to re-run.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
