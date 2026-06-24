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

- `GET  /categories` — list skill categories (any authenticated user)

### Workers

- `GET  /workers` — list all worker profiles
- `GET  /workers/:id` — a worker profile, including `taskHistory` (completed jobs only) and `activeJobsCount`
- `GET  /workers/:id/history` — a worker's completed-only track record as a standalone list
- `GET  /workers/me` _(worker)_ — the caller's own profile (created lazily if missing)
- `PUT  /workers/me` _(worker)_ — update `skills` and `bio`

### Tasks

- `POST /tasks` _(requester)_ — create an open task (`title`, optional `category_id`/`description`/`location`)
- `GET  /tasks` _(requester)_ — the caller's own tasks
- `GET  /tasks/:id` — a single task

### Bookings — the trust loop

- `POST /bookings` _(requester)_ — create a pending booking (`task_id`, `worker_id`); also creates its payment + check-in records and marks the task assigned
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

### Admin (oversight only — no transactional actions)

- `GET  /admin/users` _(admin)_ — list all users
- `POST /admin/categories` _(admin)_ — create a skill category (`name`, optional `description`)
