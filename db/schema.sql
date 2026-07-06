-- TaPa Trust — database schema
-- Tier-1 tables are the active MVP. Tier-2/3 tables are created here so the
-- schema is complete and defensible, but have no endpoints/UI yet (see
-- PROPOSAL_CONTEXT.md §6, §7). Run with:  npm run migrate  (from server/)

-- Idempotent: drop dependents first, then re-create everything.
DROP TABLE IF EXISTS
  dispute_resolution,
  safety_contact,
  earnings_record,
  verification_request,
  skill_verification_tier,
  reviews,
  payment_status,
  check_in_record,
  notifications,
  saved_worker,
  messages,
  bookings,
  tasks,
  skill_categories,
  workers,
  admins,
  users
CASCADE;

-- =====================================================================
-- Core entities (Tier 1)
-- =====================================================================

-- users: requesters, workers, and admins all authenticate as a user.
CREATE TABLE users (
  user_id       SERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  phone         VARCHAR(40),
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('requester', 'worker', 'admin')),
  location      VARCHAR(160),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- workers: supply-side profile attached to a user.
CREATE TABLE workers (
  worker_id  SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name       VARCHAR(120) NOT NULL,
  skills     TEXT,                                    -- comma-separated / free text for Tier 1
  bio        TEXT,
  rating       NUMERIC(2,1) NOT NULL DEFAULT 0,       -- 0.0 .. 5.0
  tier         VARCHAR(30)  NOT NULL DEFAULT 'Unverified',
  is_available BOOLEAN      NOT NULL DEFAULT false,   -- shown in browse only when true
  photo        TEXT,                                  -- optional profile photo URL/ref
  education      TEXT,                                -- optional, free text
  certifications TEXT,                                -- optional, free text
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- skill_categories: the service categories a task can belong to.
CREATE TABLE skill_categories (
  category_id SERIAL PRIMARY KEY,
  name        VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'active'   -- active | archived
);

-- tasks: a job posted by a requester (user) in a skill category.
CREATE TABLE tasks (
  task_id     SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES skill_categories(category_id) ON DELETE SET NULL,
  title       VARCHAR(160) NOT NULL,
  description TEXT,
  status      VARCHAR(20)  NOT NULL DEFAULT 'open',   -- open | assigned | in_progress | completed | cancelled
  location    VARCHAR(160),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- bookings: the central accountability record linking user + task + worker.
CREATE TABLE bookings (
  booking_id SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(task_id)    ON DELETE CASCADE,
  worker_id  INTEGER NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(user_id)     ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | accepted | in_progress | completed | cancelled
  cancel_reason TEXT,                                  -- reason when a worker rejects/cancels (status 'cancelled')
  agreed_price NUMERIC(12,2),                          -- agreed price (null until agree-price); gates check-in
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- messages: per-booking chat between the requester and the booked worker.
-- A message carries a text body and/or a price offer (amount).
CREATE TABLE messages (
  message_id     SERIAL PRIMARY KEY,
  booking_id     INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(user_id)       ON DELETE CASCADE,
  body           TEXT,
  amount         NUMERIC(12,2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_booking ON messages(booking_id);

-- saved_worker: a requester's preferred workers (one-tap rebooking).
CREATE TABLE saved_worker (
  saved_id  SERIAL PRIMARY KEY,
  user_id   INTEGER NOT NULL REFERENCES users(user_id)     ON DELETE CASCADE,
  worker_id INTEGER NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, worker_id)
);

-- notifications: simple per-user messages.
CREATE TABLE notifications (
  notif_id   SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  type       VARCHAR(40),
  booking_id INTEGER REFERENCES bookings(booking_id) ON DELETE CASCADE,  -- related booking (opens its chat); null for non-booking notifications
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- Trust loop (Tier 1 critical)
-- =====================================================================

-- check_in_record: mutual start/finish timestamps, each confirmed by both parties.
CREATE TABLE check_in_record (
  checkin_id      SERIAL PRIMARY KEY,
  booking_id      INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  start_ts        TIMESTAMPTZ,
  end_ts          TIMESTAMPTZ,
  start_confirmed BOOLEAN NOT NULL DEFAULT false,
  end_confirmed   BOOLEAN NOT NULL DEFAULT false
);

-- payment_status: simulated; advances only on confirmed completion.
CREATE TABLE payment_status (
  payment_id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(booking_id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  status     VARCHAR(20)   NOT NULL DEFAULT 'pending'  -- pending | confirmed | released (simulated)
);

-- reviews: optional, one per booking.
CREATE TABLE reviews (
  review_id  SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(booking_id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- Trust loop (Tier 2/3) — schema only, no endpoints/UI yet
-- =====================================================================

-- admins: platform administrators referenced by admin_id FKs below.
CREATE TABLE admins (
  admin_id SERIAL PRIMARY KEY,
  name     VARCHAR(120) NOT NULL,
  email    VARCHAR(160) NOT NULL UNIQUE
);

-- skill_verification_tier: a worker's trust tier and its basis.
CREATE TABLE skill_verification_tier (
  tier_id   SERIAL PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
  tier      VARCHAR(30) NOT NULL,   -- Unverified | Peer-Verified | Admin-Certified
  basis     TEXT
);

-- verification_request: submitted evidence awaiting admin review.
CREATE TABLE verification_request (
  request_id SERIAL PRIMARY KEY,
  worker_id  INTEGER NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
  admin_id   INTEGER REFERENCES admins(admin_id) ON DELETE SET NULL,
  evidence   TEXT,
  status     VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  note       TEXT,                                    -- optional admin note (e.g. on reject)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- earnings_record: per-task / aggregated worker earnings.
CREATE TABLE earnings_record (
  earning_id SERIAL PRIMARY KEY,
  worker_id  INTEGER NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
  booking_id INTEGER REFERENCES bookings(booking_id) ON DELETE SET NULL,
  amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  date       DATE NOT NULL DEFAULT CURRENT_DATE
);

-- safety_contact: a trusted contact a worker can notify.
CREATE TABLE safety_contact (
  contact_id SERIAL PRIMARY KEY,
  worker_id  INTEGER NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
  name       VARCHAR(120) NOT NULL,
  phone      VARCHAR(40)
);

-- dispute_resolution: a dispute on a booking, resolved by an admin.
CREATE TABLE dispute_resolution (
  dispute_id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  admin_id   INTEGER REFERENCES admins(admin_id) ON DELETE SET NULL,
  reason     TEXT,
  ruling     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- Helpful indexes
-- =====================================================================
CREATE INDEX idx_tasks_user        ON tasks(user_id);
CREATE INDEX idx_tasks_category    ON tasks(category_id);
CREATE INDEX idx_bookings_worker   ON bookings(worker_id);
CREATE INDEX idx_bookings_user     ON bookings(user_id);
CREATE INDEX idx_bookings_task     ON bookings(task_id);
CREATE INDEX idx_workers_user      ON workers(user_id);
CREATE INDEX idx_checkin_booking   ON check_in_record(booking_id);
CREATE INDEX idx_saved_user        ON saved_worker(user_id);
