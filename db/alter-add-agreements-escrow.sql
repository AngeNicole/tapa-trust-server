-- Prod-safe, idempotent: chat IDs, digital agreement, escrow columns, cancel
-- reason. Pure CREATE/ALTER ... IF NOT EXISTS + guarded backfill — no DROP, no
-- data loss, safe to re-run. Non-destructive counterpart to `npm run migrate`.
-- NOTE: the chat-messages table is `messages` (not `booking_message`).

CREATE TABLE IF NOT EXISTS chat (
  chat_id    SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(booking_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS chat_id INTEGER REFERENCES chat(chat_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);

CREATE TABLE IF NOT EXISTS agreement (
  agreement_id        SERIAL PRIMARY KEY,
  chat_id             INTEGER NOT NULL REFERENCES chat(chat_id)              ON DELETE CASCADE,
  booking_id          INTEGER NOT NULL UNIQUE REFERENCES bookings(booking_id) ON DELETE CASCADE,
  worker_id           INTEGER NOT NULL REFERENCES workers(worker_id)         ON DELETE CASCADE,
  requester_id        INTEGER NOT NULL REFERENCES users(user_id)             ON DELETE CASCADE,
  agreed_price        NUMERIC(12,2) NOT NULL,
  requester_signature TEXT,
  worker_signature    TEXT,
  requester_signed_at TIMESTAMPTZ,
  worker_signed_at    TIMESTAMPTZ,
  status              VARCHAR(20) NOT NULL DEFAULT 'proposed',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payment_status ADD COLUMN IF NOT EXISTS deposited_at TIMESTAMPTZ;
ALTER TABLE payment_status ADD COLUMN IF NOT EXISTS released_at  TIMESTAMPTZ;
ALTER TABLE bookings       ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- Backfill: one chat per existing booking, then link existing messages to it.
INSERT INTO chat (booking_id)
  SELECT b.booking_id FROM bookings b
  WHERE NOT EXISTS (SELECT 1 FROM chat c WHERE c.booking_id = b.booking_id);
UPDATE messages m SET chat_id = c.chat_id
  FROM chat c WHERE c.booking_id = m.booking_id AND m.chat_id IS NULL;
