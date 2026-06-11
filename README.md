# TaPa Trust - Server (API)

REST API for TaPa Trust, a trust-centered platform for finding, verifying, and rebooking informal
skilled workers in Kigali. This service handles authentication, role-based access control, worker
profiles, the task lifecycle (mutual check-in/out and completion), simulated payment status, and
rebooking.

Built with Node.js, Express, and PostgreSQL. JWT authentication, bcrypt password hashing.

## Related repository

- Web client (React): **https://github.com/AngeNicole/tapa-trust-client**

## Live API

- Deployed base URL: **[REPLACE WITH DEPLOYED SERVER URL]** (e.g. `https://tapa-trust-server.onrender.com`)
- Health check: `GET /api/health` returns `{ "status": "ok" }`

> Placeholder above. Paste the live Render URL once deployed.

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
npm run migrate             # create all tables (needs a reachable database)
npm run dev                 # start with nodemon (or: npm start)
```

The API listens on `http://localhost:4000`. Verify it:

```bash
curl http://localhost:4000/api/health
# {"status":"ok"}
```

The health check does not require a database. `npm run migrate` does.

## Database migration

`npm run migrate` runs `db/schema.sql`, which creates all tables. The schema is idempotent: it
drops and recreates the tables, so re-running it resets the database.

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
   managed instance, or via a one-off job).

- Deployed base URL: **[REPLACE WITH DEPLOYED SERVER URL]**

## API surface (current)

- `GET  /api/health` - liveness check
- `POST /api/auth/register` - name, email, password, role (`requester` or `worker`), optional phone/location
- `POST /api/auth/login` - email, password; returns a JWT and basic user info
- `GET  /api/auth/me` - current user (requires `Authorization: Bearer <token>`)

Further endpoints (workers, tasks, bookings, reviews, saved workers, categories, admin) are added in
later build steps.
