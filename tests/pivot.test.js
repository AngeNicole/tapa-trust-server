const {
  request, app, pool, authHeader, registerRequester, registerWorker, createAdmin, closePool,
} = require('./helpers');

afterAll(closePool);

// Drive the real product path far enough to generate notifications: book a
// worker (notifies worker), then the worker accepts + checks in (each notifies
// the requester). Returns the parties + booking id. Uses only product routes.
async function bookAcceptCheckin() {
  const requester = await registerRequester();
  const worker = await registerWorker();
  await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills: 'Plumbing' });
  const created = await request(app).post(`/api/bookings/book/${worker.worker_id}`).set(authHeader(requester.token));
  const bookingId = created.body.booking_id;
  await request(app).post(`/api/bookings/${bookingId}/accept`).set(authHeader(worker.token));
  // agree on a price (gates check-in)
  await request(app).post(`/api/bookings/${bookingId}/propose-price`).set(authHeader(worker.token)).send({ amount: 5000 });
  await request(app).post(`/api/bookings/${bookingId}/accept-price`).set(authHeader(requester.token));
  await request(app).post(`/api/bookings/${bookingId}/checkin`).set(authHeader(worker.token));
  return { requester, worker, bookingId };
}

// Make a worker available and give them a skill so browse/booking are meaningful.
// A complete, available worker: skills + bio set (required by the completeness
// guard), then toggled available.
async function availableWorker(skills = 'Plumbing') {
  const worker = await registerWorker();
  await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills, bio: 'Experienced worker' });
  await request(app).put('/api/workers/me/availability').set(authHeader(worker.token)).send({ is_available: true });
  return worker;
}

describe('worker availability', () => {
  test('PUT /workers/me/availability toggles is_available and returns the profile', async () => {
    const worker = await registerWorker();
    await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills: 'Plumbing', bio: 'Experienced' });
    const me = await request(app).get('/api/workers/me').set(authHeader(worker.token));
    expect(me.body.is_available).toBe(false); // default

    const on = await request(app).put('/api/workers/me/availability').set(authHeader(worker.token)).send({ is_available: true });
    expect(on.status).toBe(200);
    expect(on.body.is_available).toBe(true);

    const off = await request(app).put('/api/workers/me/availability').set(authHeader(worker.token)).send({ is_available: false });
    expect(off.body.is_available).toBe(false);
  });

  test('rejects a non-boolean and requires the worker role', async () => {
    const worker = await registerWorker();
    expect((await request(app).put('/api/workers/me/availability').set(authHeader(worker.token)).send({ is_available: 'yes' })).status).toBe(400);

    const requester = await registerRequester();
    expect((await request(app).put('/api/workers/me/availability').set(authHeader(requester.token)).send({ is_available: true })).status).toBe(403);
  });

  test('completeness guard: cannot go available without both skills and bio', async () => {
    const worker = await registerWorker(); // no skills/bio
    expect((await request(app).put('/api/workers/me/availability').set(authHeader(worker.token)).send({ is_available: true })).status).toBe(400);

    // skills only -> still blocked (bio required too)
    await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills: 'Plumbing' });
    expect((await request(app).put('/api/workers/me/availability').set(authHeader(worker.token)).send({ is_available: true })).status).toBe(400);

    // both filled -> succeeds
    await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ bio: 'Experienced' });
    const ok = await request(app).put('/api/workers/me/availability').set(authHeader(worker.token)).send({ is_available: true });
    expect(ok.status).toBe(200);
    expect(ok.body.is_available).toBe(true);
  });

  test('going unavailable is always allowed, even with an empty profile', async () => {
    const worker = await registerWorker(); // no skills/bio
    const off = await request(app).put('/api/workers/me/availability').set(authHeader(worker.token)).send({ is_available: false });
    expect(off.status).toBe(200);
    expect(off.body.is_available).toBe(false);
  });
});

describe('browse / filter workers', () => {
  test('GET /workers returns only available workers by default', async () => {
    const avail = await availableWorker('Plumbing');
    const hidden = await registerWorker(); // stays unavailable

    const { token } = await registerRequester();
    const res = await request(app).get('/api/workers').set(authHeader(token));
    expect(res.status).toBe(200);
    const ids = res.body.map((w) => w.worker_id);
    expect(ids).toContain(avail.worker_id);
    expect(ids).not.toContain(hidden.worker_id);
    // carries what a requester needs to evaluate
    const row = res.body.find((w) => w.worker_id === avail.worker_id);
    expect(row).toMatchObject({ is_available: true, verification: 'unverified' });
    expect(row).toHaveProperty('completedJobs');
    expect(row).toHaveProperty('rating');
    expect(row).toHaveProperty('skills');
    expect(row).toHaveProperty('photo');
  });

  test('?skill= filters on the skills text', async () => {
    const plumber = await availableWorker('Plumbing, Electrical');
    const { token } = await registerRequester();

    const match = await request(app).get('/api/workers?skill=Plumbing').set(authHeader(token));
    expect(match.body.map((w) => w.worker_id)).toContain(plumber.worker_id);

    const noMatch = await request(app).get('/api/workers?skill=Welding').set(authHeader(token));
    expect(noMatch.body.map((w) => w.worker_id)).not.toContain(plumber.worker_id);
  });

  test('?all=true includes unavailable workers', async () => {
    const hidden = await registerWorker(); // unavailable
    const { token } = await registerRequester();

    const def = await request(app).get('/api/workers').set(authHeader(token));
    expect(def.body.map((w) => w.worker_id)).not.toContain(hidden.worker_id);

    const all = await request(app).get('/api/workers?all=true').set(authHeader(token));
    expect(all.body.map((w) => w.worker_id)).toContain(hidden.worker_id);
  });
});

describe('book from worker profile', () => {
  test('POST /bookings/book/:workerId auto-creates a task and a valid pending booking', async () => {
    const requester = await registerRequester();
    const worker = await availableWorker('Plumbing, Electrical');

    const res = await request(app).post(`/api/bookings/book/${worker.worker_id}`).set(authHeader(requester.token));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'pending', payment: 'pending', checkedIn: false, taskTitle: 'Booking: Plumbing',
    });
    expect(res.body.task_id).toBeGreaterThan(0);

    // the auto-created task exists and is marked assigned (requester never posted it;
    // tasks are internal now, so read the table directly)
    const task = await pool.query('SELECT status FROM tasks WHERE task_id = $1', [res.body.task_id]);
    expect(task.rows[0].status).toBe('assigned');

    // and it's a real loop booking: the worker can accept it
    const accepted = await request(app).post(`/api/bookings/${res.body.booking_id}/accept`).set(authHeader(worker.token));
    expect(accepted.body.status).toBe('accepted');
  });

  test('404 for a missing worker, 403 for a non-requester', async () => {
    const requester = await registerRequester();
    expect((await request(app).post('/api/bookings/book/99999999').set(authHeader(requester.token))).status).toBe(404);

    const worker = await registerWorker();
    expect((await request(app).post(`/api/bookings/book/${worker.worker_id}`).set(authHeader(worker.token))).status).toBe(403);
  });
});

describe('in-app notifications', () => {
  test('a lifecycle transition notifies the other party; owner can list + mark read', async () => {
    const { requester, worker } = await bookAcceptCheckin();

    // worker checked in -> requester has a notification (newest first, unread)
    const reqNotifs = await request(app).get('/api/notifications').set(authHeader(requester.token));
    expect(reqNotifs.status).toBe(200);
    expect(reqNotifs.body.length).toBeGreaterThan(0);
    expect(reqNotifs.body[0].read).toBe(false);
    // ordering: newest first
    if (reqNotifs.body.length > 1) {
      expect(new Date(reqNotifs.body[0].created_at).getTime())
        .toBeGreaterThanOrEqual(new Date(reqNotifs.body[1].created_at).getTime());
    }

    // worker also got the original booking-request notification
    const wrkNotifs = await request(app).get('/api/notifications').set(authHeader(worker.token));
    expect(wrkNotifs.body.some((n) => n.type === 'booking_request')).toBe(true);

    // owner marks one read
    const id = reqNotifs.body[0].notif_id;
    const read = await request(app).post(`/api/notifications/${id}/read`).set(authHeader(requester.token));
    expect(read.status).toBe(200);
    expect(read.body.read).toBe(true);
  });

  test('notifications are scoped to the owner', async () => {
    const { requester, worker } = await bookAcceptCheckin();
    const reqNotifs = await request(app).get('/api/notifications').set(authHeader(requester.token));
    const id = reqNotifs.body[0].notif_id;

    // the worker cannot mark the requester's notification read
    const forbidden = await request(app).post(`/api/notifications/${id}/read`).set(authHeader(worker.token));
    expect(forbidden.status).toBe(403);

    // missing id -> 404
    const missing = await request(app).post('/api/notifications/99999999/read').set(authHeader(requester.token));
    expect(missing.status).toBe(404);

    // no token -> 401
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });
});

describe('simulated digital-ID verification', () => {
  test('fresh worker is unverified', async () => {
    const worker = await registerWorker();
    const { token } = await registerRequester();
    const res = await request(app).get(`/api/workers/${worker.worker_id}`).set(authHeader(token));
    expect(res.body.verification).toBe('unverified');
  });

  test('submitting a mock ID creates a pending request, admin can verify', async () => {
    const worker = await registerWorker();
    const requester = await registerRequester();

    const submit = await request(app).post('/api/workers/me/verification').set(authHeader(worker.token))
      .send({ reference: 'demo-NID-123' });
    expect(submit.status).toBe(201);
    expect(submit.body).toMatchObject({ verification: 'pending', simulated: true });
    expect(submit.body.request.status).toBe('pending');
    expect(submit.body.request.evidence).toMatch(/SIMULATED/);

    // profile now reports pending
    const pending = await request(app).get(`/api/workers/${worker.worker_id}`).set(authHeader(requester.token));
    expect(pending.body.verification).toBe('pending');

    // admin marks verified
    const adminToken = await createAdmin();
    const verify = await request(app).post(`/api/admin/workers/${worker.worker_id}/verify`).set(authHeader(adminToken));
    expect(verify.status).toBe(200);
    expect(verify.body.verification).toBe('verified');

    const verified = await request(app).get(`/api/workers/${worker.worker_id}`).set(authHeader(requester.token));
    expect(verified.body.verification).toBe('verified');
  });

  test('verification submit is worker-only; admin verify is admin-only', async () => {
    const requester = await registerRequester();
    expect((await request(app).post('/api/workers/me/verification').set(authHeader(requester.token)).send({})).status).toBe(403);

    const worker = await registerWorker();
    expect((await request(app).post(`/api/admin/workers/${worker.worker_id}/verify`).set(authHeader(worker.token))).status).toBe(403);
  });

  test('full status path: pending → reject → unverified → resubmit → pending → approve → verified', async () => {
    const worker = await registerWorker();
    const requester = await registerRequester();
    const adminToken = await createAdmin();
    const profileVerification = async () =>
      (await request(app).get(`/api/workers/${worker.worker_id}`).set(authHeader(requester.token))).body.verification;

    // submit -> pending
    await request(app).post('/api/workers/me/verification').set(authHeader(worker.token)).send({ reference: 'demo-1' });
    expect(await profileVerification()).toBe('pending');

    // reject -> unverified (with note)
    const rej = await request(app).post(`/api/admin/workers/${worker.worker_id}/reject`).set(authHeader(adminToken)).send({ note: 'blurry photo' });
    expect(rej.status).toBe(200);
    expect(rej.body.verification).toBe('unverified');
    expect(rej.body.note).toBe('blurry photo');
    expect(await profileVerification()).toBe('unverified');

    // resubmit -> fresh pending (must not error on the existing rejected row)
    const resub = await request(app).post('/api/workers/me/verification').set(authHeader(worker.token)).send({ reference: 'demo-2' });
    expect(resub.status).toBe(201);
    expect(resub.body.verification).toBe('pending');
    expect(await profileVerification()).toBe('pending');

    // approve still works after the resubmit
    const appr = await request(app).post(`/api/admin/workers/${worker.worker_id}/verify`).set(authHeader(adminToken));
    expect(appr.status).toBe(200);
    expect(await profileVerification()).toBe('verified');
  });

  test('reject is admin-only; 404 for a missing worker', async () => {
    const worker = await registerWorker();
    expect((await request(app).post(`/api/admin/workers/${worker.worker_id}/reject`).set(authHeader(worker.token))).status).toBe(403);

    const adminToken = await createAdmin();
    expect((await request(app).post('/api/admin/workers/99999999/reject').set(authHeader(adminToken))).status).toBe(404);
  });
});
