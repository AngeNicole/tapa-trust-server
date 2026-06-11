# TaPa Trust - Server (Backend) Context

> Backend-focused view of the project brief, distilled from the research proposal.
> The full proposal in `docs/research-proposal.pdf` is the source of truth.
> The frontend-focused counterpart lives in the client repo:
> https://github.com/AngeNicole/tapa-trust-client
>
> Do not expand scope beyond what is defined here.

## 1. What we're building
TaPa Trust: a trust-centered worker profile and rebooking platform for informal
skilled services in Kigali (plumbing, cleaning, moving/lifting, electrical,
furniture assembly, mounting/installation, basic tech setup).

It is a two-sided platform:
- **Requesters** (demand side) evaluate whether a worker is skilled, available,
  and trustworthy before hiring.
- **Skilled workers** (supply side) make skills, reliability, work history, and
  earnings visible so they can be found and re-hired.

## 2. The core idea (do not lose this)
The contribution is the **closed trust-accountability loop** where each step
validates the next:

  verified identity -> recorded time -> mutual completion -> payment status -> rebook

The backend is where this loop is enforced: it coordinates authentication,
mutual confirmation of time and completion, and the advancement of payment
status. Build the loop end-to-end before anything else.

## 3. Stack (backend)
Fixed by the proposal:
- **Node.js + Express** REST API (JSON)
- **PostgreSQL** (raw SQL via `pg`, no ORM)
- **JWT** auth with role-based access control
- **bcrypt** password hashing
- Deploy backend on **Render**, Postgres on Render (managed)
- Payments and identity verification are **SIMULATED** (internal status only).
  Do NOT integrate MTN MoMo, eKash, NIDA, or Smile ID - those are future work.

## 4. Roles (backend enforces RBAC)
- **Requester** - posts tasks, evaluates/selects workers, confirms start,
  confirms completion, reviews, saves/rebooks workers.
- **Worker** - creates profile, lists skills, requests verification, accepts
  tasks, records check-in/out, views earnings.
- **Admin** - oversight only. Reviews verification, manages skill categories,
  resolves disputes, monitors tasks. Admin has NO transactional actions
  (never posts/accepts/pays). Keep the adjudicator separate from transacting
  parties.

## 5. MVP scope - build exactly this (Tier 1)
1. **Auth + role-based profiles** - register/login as requester OR worker; JWT;
   role gating.
2. **Worker profiles** - skills, bio, rating, task history exposed to requesters.
3. **Task posting + worker selection** - requester posts a task in a skill
   category; selects a worker; worker accepts.
4. **Mutual check-in / check-out** - worker records start; requester confirms
   start; worker records end; requester confirms completion. Both sides must
   confirm. This is the project's sharpest original mechanism - it resolves the
   common informal dispute over how long a job took. Do not simplify it away.
5. **Simulated payment status + rebooking** - payment status advances only on
   confirmed completion (pending -> confirmed -> released, simulated); requester
   can save a worker and rebook in one tap.

## 6. Scope boundary - do NOT build these for the MVP (Tier 2/3 / future work)
Verification tiers (Unverified/Peer-Verified/Admin-Certified), dispute reporting +
admin review, worker earnings dashboard/charts, safety check-in (notify-a-contact),
real MoMo/eKash/NIDA/Smile ID integrations, escrow, insurance, multilingual UI
beyond simple labels.
The data model below INCLUDES these tables so the schema is complete, but the
endpoints for them are optional. If time remains, add them in the order listed,
but never block submission on them.

## 7. Data model (build the Tier-1 tables first)
Core:
- **users** (user_id PK, name, email, phone, password_hash, role, location)
- **workers** (worker_id PK, user_id FK, name, skills, bio, rating, tier)
- **skill_categories** (category_id PK, name, description)
- **tasks** (task_id PK, user_id FK, category_id FK, title, status, description, location)
- **bookings** (booking_id PK, task_id FK, worker_id FK, user_id FK, status)
- **saved_worker** (saved_id PK, user_id FK, worker_id FK)
- **notifications** (notif_id PK, user_id FK, message, type)

Trust loop (Tier-1 critical):
- **check_in_record** (checkin_id PK, booking_id FK, start_ts, end_ts,
  start_confirmed, end_confirmed) - mutual timestamps, both-party confirmed
- **payment_status** (payment_id PK, booking_id FK, amount, status[simulated])
- **reviews** (review_id PK, booking_id FK, rating, comment)

Trust loop (Tier-2/3 - schema only unless time allows):
- **admins** (admin_id PK, name, email)
- **skill_verification_tier** (tier_id PK, worker_id FK, tier, basis)
- **verification_request** (request_id PK, worker_id FK, admin_id FK, evidence, status)
- **earnings_record** (earning_id PK, worker_id FK, booking_id FK, amount, date)
- **safety_contact** (contact_id PK, worker_id FK, name, phone)
- **dispute_resolution** (dispute_id PK, booking_id FK, admin_id FK, reason, ruling)

Key cardinalities: user 1-N tasks; user 1-N saved_worker; task N-1 skill_category;
booking links 1 user + 1 task + 1 worker; worker 1-1 tier; worker 1-N
verification_request/earnings/safety_contact; booking 1-N check_in_record;
booking 1-1 payment_status; booking 1-0..1 review; booking 1-0..1 dispute.

The current schema (all tables above) is in `db/schema.sql`; run it with
`npm run migrate`.

## 8. API surface (Tier 1)
- POST /api/auth/register, POST /api/auth/login, GET /api/auth/me
- GET /api/workers, GET /api/workers/:id  (profile, skills, rating, history)
- POST /api/tasks, GET /api/tasks, GET /api/tasks/:id
- POST /api/bookings (select worker), POST /api/bookings/:id/accept (worker)
- POST /api/bookings/:id/checkin, /confirm-start, /checkout, /confirm-completion
- GET /api/bookings/:id/payment-status  (advances on confirmed completion)
- POST /api/reviews
- POST /api/saved-workers, GET /api/saved-workers, POST /api/bookings/rebook/:workerId

## 9. Demo-critical happy path (the backend must support this loop end-to-end)
Register worker -> build profile -> register requester -> post task -> select worker
-> worker accepts -> worker check-in -> requester confirm start -> worker check-out
-> requester confirm completion -> payment status flips to released -> requester
reviews -> requester rebooks the same worker in one tap.

## What lives in the client repo
The user-facing screens, UX principles, and seeded demo-data presentation are the
client's concern. See https://github.com/AngeNicole/tapa-trust-client.
