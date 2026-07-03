-- Prod-safe, idempotent additions for booking chat + price agreement + chat
-- notifications. Pure CREATE ... IF NOT EXISTS + ADD COLUMN IF NOT EXISTS — no
-- DROP, no data loss, safe to re-run. Non-destructive counterpart to migrate.

CREATE TABLE IF NOT EXISTS messages (
  message_id     SERIAL PRIMARY KEY,
  booking_id     INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(user_id)       ON DELETE CASCADE,
  body           TEXT,
  amount         NUMERIC(12,2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages(booking_id);
-- In case a messages table already exists without amount (create-if-not-exists
-- won't add columns), ensure the offer column is present.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2);

ALTER TABLE bookings      ADD COLUMN IF NOT EXISTS agreed_price NUMERIC(12,2);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS booking_id   INTEGER REFERENCES bookings(booking_id) ON DELETE CASCADE;
