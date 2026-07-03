-- Prod-safe, idempotent additions for booking chat + structured price agreement.
-- Pure CREATE TABLE/INDEX IF NOT EXISTS + ADD COLUMN IF NOT EXISTS — no DROP,
-- no data loss, safe to re-run. Non-destructive counterpart to `npm run migrate`.

CREATE TABLE IF NOT EXISTS messages (
  message_id     SERIAL PRIMARY KEY,
  booking_id     INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(user_id)       ON DELETE CASCADE,
  body           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages(booking_id);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS proposed_amount     NUMERIC(12,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS proposed_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_agreed        BOOLEAN NOT NULL DEFAULT false;
