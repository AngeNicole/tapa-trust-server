# TaPa Trust - Server (API)

REST API for TaPa Trust, a trust-centered platform for finding, verifying, and rebooking informal
skilled workers in Kigali. This service handles authentication, role-based access control, worker
profiles, the task lifecycle (mutual check-in/out and completion), simulated payment status, and
rebooking.

Built with Node.js, Express, and PostgreSQL. JWT authentication, bcrypt password hashing.

## Related repository

- Web client (React): **https://github.com/AngeNicole/tapa-trust-client**

## Live API

- Deployed base URL: **https://tapa-trust-server.onrender.com**
- Health check: `GET /api/health` returns `{ "status": "ok" }`

> Hosted on Render's free tier, which sleeps after inactivity — the first request
> after idle may take ~30s to wake the service.

## Tech stack

- Node.js + Express (REST, JSON)
- PostgreSQL (managed on Render or Railway)
- JWT for auth, bcrypt for password hashing

## Prerequisites

- Node.js 18+ and npm
- A PostgreSQL database (local for development, managed on Render/Railway for deployment)

## Environment setup

Copy the example file and fill in values:

```bash
cp .env.example .env
```

Variables:

| Variable        | Required | Description                                                                 |
| --------------- | -------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`  | yes      | PostgreSQL connection string.                                               |
| `DATABASE_SSL`  | no       | `true`/`false` to force SSL. Unset auto-detects (off for localhost, on otherwise). |
| `JWT_SECRET`    | yes      | Long random string used to sign JWTs.                                       |
| `PORT`          | no       | Port to listen on. Defaults to 4000. Render sets this automatically.        |
| `CLIENT_ORIGIN` | no       | Deployed client URL for CORS. Unset allows all origins (local convenience). |

## Run locally

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL and JWT_SECRET
npm run migrate             # create all tables + seed categories (needs a reachable database)
npm run dev                 # start with nodemon (or: npm start)
```

The API listens on `http://localhost:4000`. Verify it:

```bash
curl http://localhost:4000/api/health
# {"status":"ok"}
```

The health check does not require a database. `npm run migrate` does.

## Database migration

`npm run migrate` runs `db/schema.sql`, which creates all tables and then seeds the seven Tier-1
skill categories (only when `skill_categories` is empty). **The schema is destructive: it drops and
recreates every table, so re-running `migrate` resets the database.** Use it for first-time setup or
a deliberate reset — never to "top up" data on a database that already has rows.

## Seeding categories (non-destructive)

`npm run seed` runs `db/seed-categories.sql`, which contains only idempotent
`INSERT ... ON CONFLICT (name) DO NOTHING` statements for the seven skill categories — no DDL. It is
safe to run against a populated database (including production): it adds any missing categories and
leaves everything else untouched. This is how the live database was seeded without wiping data:

```bash
# from your machine, pointed at the managed database's EXTERNAL connection string
DATABASE_URL="postgres://USER:PASSWORD@HOST.oregon-postgres.render.com/DBNAME" npm run seed
# -> Seed complete — 7 categories present.
```

## Deployment (Render)

This service is intended to deploy as a Render Web Service, with managed Postgres on Render or
Railway.

High-level steps (full click-by-click guidance is provided separately during setup):

1. Create a managed PostgreSQL instance (Render or Railway) and copy its connection string.
2. Create a Render Web Service from this repository.
   - Build command: `npm install`
   - Start command: `npm start`
3. Set environment variables on the service: `DATABASE_URL`, `JWT_SECRET`, `DATABASE_SSL=true`,
   and `CLIENT_ORIGIN` (the deployed client URL).
4. Run the migration once against the managed database (locally with `DATABASE_URL` pointed at the
   managed instance, or via a one-off job). To (re)seed categories later without resetting data,
   run `npm run seed` instead of `migrate` (see "Seeding categories" above).

Pushing to `main` triggers an automatic redeploy of the code on Render. Data steps (`migrate`,
`seed`) are never run by the deploy — run them deliberately against the managed database.

- Deployed base URL: **https://tapa-trust-server.onrender.com**

## API surface

All routes are under `/api`. Every route except `health`, `register`, and `login` requires an
`Authorization: Bearer <token>` header. Role requirements are noted where they apply; mismatches
return `403`, missing resources `404`, and bad/missing fields `400`.

### Auth

- `GET  /health` — liveness check (no auth, no DB)
- `POST /auth/register` — name, email, password, role (`requester` or `worker`), optional phone/location; returns a JWT
- `POST /auth/login` — email, password; returns a JWT and basic user info
- `GET  /auth/me` — current user
- `PUT  /auth/me` — update own account profile (`name`, `phone`, `location`; partial updates allowed; email/role not editable)
- `PUT  /auth/password` — change password (`currentPassword`, `newPassword`); verifies the current password

### Categories

- `GET  /categories` — list skill categories (any authenticated user). `?status=active` (default) | `archived` | `all` for the admin status tabs. Each item: `category_id`, `name`, `description`, `status`.

Category management (admin) lives under `/admin` — see the Admin section.

### Workers

- `GET  /workers` — browse workers. Returns only `is_available = true` by default; `?skill=<text>` filters on skills; `?all=true` returns everyone (admin/testing). Each row carries name, photo, skills, rating, `completedJobs`, `is_available`, and `verification`.
- `GET  /workers/:id` — a worker profile, including `taskHistory` (completed jobs only), `activeJobsCount`, and `verification`
- `GET  /workers/:id/history` — a worker's completed-only track record as a standalone list
- `GET  /workers/me` _(worker)_ — the caller's own profile (created lazily if missing)
- `PUT  /workers/me` _(worker)_ — partial update of `skills`, `bio`, `photo`, and the optional free-text `education` / `certifications` (trimmed, empty→null, capped 1000 chars)
- `PUT  /workers/me/availability` _(worker)_ — set `is_available` (boolean)
- `POST /workers/me/verification` _(worker)_ — submit a **simulated** digital ID (mock reference / document placeholder); creates a pending verification request

A worker can only set `is_available = true` once `skills` and `bio` are both non-empty (completeness guard); going unavailable is always allowed.

### Public workers (no auth)

Unauthenticated browse for the marketing/landing surface. A dedicated narrow
projection — never the authed worker object — so no account fields leak.

- `GET /public/workers?skill=` — available workers only, optional skill filter
- `GET /public/workers/:id` — one worker's public profile
- `GET /public/workers/:id/history` — that worker's completed-job history

Public worker fields: `worker_id`, `name`, `skills`, `bio`, `photo`, `rating`,
`completedJobs`, `education`, `certifications`, `verification`. History items:
`taskTitle`, `date`, `rating`, `comment`. Excludes email, phone, location,
`user_id`, verification evidence, and all account fields.

### Tasks

There is **no requester-facing task API**. In the browse-and-book model requesters
never post tasks: a booking auto-creates its task server-side (see
`POST /bookings/book/:workerId`). The `tasks` table is internal — read via the
booking views and worker history, written only by booking creation/completion.

### Bookings — the trust loop

- `POST /bookings/book/:workerId` _(requester)_ — **book from a worker profile** (the requester entry point): auto-creates the task server-side, then a pending booking + payment + check-in. Requesters never post a task.
- `GET  /bookings` — bookings scoped to the caller (requester sees their own; worker sees theirs)
- `POST /bookings/:id/accept` _(worker)_ — `pending` → `accepted`
- `POST /bookings/:id/checkin` _(worker)_ — record start time
- `POST /bookings/:id/confirm-start` _(requester)_ — `accepted` → `in_progress`, payment → `confirmed`
- `POST /bookings/:id/checkout` _(worker)_ — record end time
- `POST /bookings/:id/confirm-completion` _(requester)_ — `in_progress` → `completed`, payment → `released`, task → `completed`
- `GET  /bookings/:id/payment-status` — `{ status, amount }` (readable only by the booking's parties)
- `POST /bookings/rebook/:workerId` _(requester)_ — one-tap rebook: fresh task + new pending booking

Completion requires **mutual** confirmation: the worker's check-in/out only advances the booking
once the requester confirms each step.

### Reviews

- `POST /reviews` _(requester, owns a completed booking)_ — `booking_id`, `rating` (1–5), optional `comment`; one per booking, updates the worker's average rating

### Saved workers

- `GET    /saved-workers` _(requester)_ — the caller's saved workers
- `POST   /saved-workers` _(requester)_ — save a worker (`worker_id`); idempotent
- `DELETE /saved-workers/:workerId` _(requester)_ — remove a saved worker

### Notifications (in-app only — no web push)

- `GET  /notifications` — the caller's notifications, newest first
- `POST /notifications/:id/read` — mark one read (owner only)

Lifecycle transitions insert an in-app notification for the other party (booking
request → worker; check-in → requester; confirm-start → worker; check-out →
requester; confirm-completion → worker).

### Admin (oversight only — no transactional actions)

- `GET  /admin/users` _(admin)_ — list all users
- `POST   /admin/categories` _(admin)_ — create a skill category (`name`, optional `description`)
- `PUT    /admin/categories/:id` _(admin)_ — edit `name` and/or `description`
- `PATCH  /admin/categories/:id/status` _(admin)_ — archive/restore (`status: 'active' | 'archived'`)
- `DELETE /admin/categories/:id` _(admin)_ — delete a category (tasks that referenced it keep their row)
- `POST /admin/workers/:workerId/verify` _(admin)_ — mark a worker verified (simulated workflow)
- `POST /admin/workers/:workerId/reject` _(admin)_ — reject verification (optional `note`); status returns to unverified, worker may resubmit
