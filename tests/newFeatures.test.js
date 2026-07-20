// Tests for the trust-stack features added in this iteration:
//   • price-before-accept gate
//   • dispute resolution: freeze → mediation-required → ruling releases
//   • verification tiers (computed)
//   • online verification stores ID + selfie for admin review (admin-only)
//   • safety check-in overdue flag
//   • escrow auto-release after 24h
//   • earnings endpoint shape
const {
  request, app, pool, authHeader, registerRequester, registerWorker, createAdmin, makeBookingAt, approveWorker, closePool,
} = require('./helpers');

afterAll(closePool);

async function completeProfile(worker) {
  await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills: 'Plumbing', bio: 'exp' });
}

describe('price before accept', () => {
  test('a worker cannot accept until a price is agreed', async () => {
    const requester = await registerRequester();
    const worker = await registerWorker();
    await completeProfile(worker);
    await approveWorker(worker.worker_id); // verified-only: must be approved to be booked
    const created = await request(app).post(`/api/bookings/book/${worker.worker_id}`).set(authHeader(requester.token));
    const id = created.body.booking_id;

    const early = await request(app).post(`/api/bookings/${id}/accept`).set(authHeader(worker.token));
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/price/i);

    await request(app).post(`/api/bookings/${id}/agree-price`).set(authHeader(requester.token)).send({ amount: 8000 });
    const ok = await request(app).post(`/api/bookings/${id}/accept`).set(authHeader(worker.token));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('accepted');
  });
});

describe('dispute resolution', () => {
  test('freeze on dispute → mediation required → ruling releases payment', async () => {
    const { bookingId, requester, worker } = await makeBookingAt('checkedOut'); // in_progress, escrow held
    const admin = await createAdmin();

    // either party raises a dispute
    const raised = await request(app).post(`/api/bookings/${bookingId}/dispute`).set(authHeader(requester.token))
      .send({ category: 'work quality', description: 'Tiling uneven' });
    expect(raised.status).toBe(201);
    expect(raised.body.paymentFrozen).toBe(true);

    // frozen: completion is blocked while the dispute is open
    const blocked = await request(app).post(`/api/bookings/${bookingId}/confirm-completion`).set(authHeader(requester.token));
    expect(blocked.status).toBe(409);

    // find the dispute in the admin queue
    const list = await request(app).get('/api/admin/disputes').set(authHeader(admin));
    const d = list.body.find((x) => x.bookingId === bookingId);
    expect(d).toBeTruthy();
    expect(d.stage).toBe('open');

    // cannot rule before a mediation meeting is scheduled (hear both sides first)
    const tooEarly = await request(app).post(`/api/admin/disputes/${d.disputeId}/rule`).set(authHeader(admin)).send({ outcome: 'release' });
    expect(tooEarly.status).toBe(400);

    // schedule a meeting, post in the thread (party + admin), then rule
    await request(app).post(`/api/admin/disputes/${d.disputeId}/meeting`).set(authHeader(admin)).send({ mode: 'in_app' });
    const partyMsg = await request(app).post(`/api/disputes/${d.disputeId}/messages`).set(authHeader(worker.token)).send({ body: 'Client changed the layout' });
    expect(partyMsg.status).toBe(201);

    const ruled = await request(app).post(`/api/admin/disputes/${d.disputeId}/rule`).set(authHeader(admin)).send({ outcome: 'release', note: 'Heard both; work acceptable' });
    expect(ruled.status).toBe(200);
    expect(ruled.body.outcome).toBe('release');

    // payment released, booking completed
    const after = (await request(app).get('/api/bookings').set(authHeader(requester.token))).body.find((b) => b.booking_id === bookingId);
    expect(after.payment).toBe('released');
    expect(after.status).toBe('completed');
  });

  test('an outsider cannot post in a dispute thread (403)', async () => {
    const { bookingId, requester } = await makeBookingAt('checkedOut');
    const admin = await createAdmin();
    await request(app).post(`/api/bookings/${bookingId}/dispute`).set(authHeader(requester.token)).send({ category: 'other' });
    const d = (await request(app).get('/api/admin/disputes').set(authHeader(admin))).body.find((x) => x.bookingId === bookingId);
    const outsider = await registerRequester();
    const res = await request(app).post(`/api/disputes/${d.disputeId}/messages`).set(authHeader(outsider.token)).send({ body: 'hi' });
    expect(res.status).toBe(403);
  });
});

describe('verification tiers', () => {
  test('unverified worker is Unverified; admin approval makes them Admin-Certified', async () => {
    const requester = await registerRequester();
    const worker = await registerWorker();
    await completeProfile(worker);
    const admin = await createAdmin();

    const before = await request(app).get(`/api/workers/${worker.worker_id}`).set(authHeader(requester.token));
    expect(before.body.tier).toBe('Unverified');

    await request(app).post('/api/workers/me/verification').set(authHeader(worker.token)).send({ method: 'physical' });
    await request(app).post(`/api/admin/workers/${worker.worker_id}/verify`).set(authHeader(admin));

    const after = await request(app).get(`/api/workers/${worker.worker_id}`).set(authHeader(requester.token));
    expect(after.body.tier).toBe('Admin-Certified');
    expect(after.body.verification).toBe('verified');
  });
});

describe('online verification stores ID + selfie for admin review', () => {
  test('images are persisted and exposed to admins only', async () => {
    const worker = await registerWorker();
    const admin = await createAdmin();
    const requester = await registerRequester();
    const ID = 'data:image/jpeg;base64,IDDOCDATA';
    const SELFIE = 'data:image/jpeg;base64,SELFIEDATA';
    await request(app).post('/api/workers/me/verification').set(authHeader(worker.token)).send({
      method: 'online',
      faceMatchScore: 82,
      faceMatchPassed: true,
      idImage: ID,
      selfie: SELFIE,
    });

    // The ID + selfie are kept so the admin can confirm the document is genuine.
    const row = (await pool.query(
      `SELECT id_document, selfie, method
       FROM verification_request WHERE worker_id = $1 ORDER BY request_id DESC LIMIT 1`,
      [worker.worker_id]
    )).rows[0];
    expect(row.id_document).toBe(ID);
    expect(row.selfie).toBe(SELFIE);
    expect(row.method).toBe('online');

    // Admin evidence carries the images; a requester never receives them.
    const adminView = await request(app).get(`/api/workers/${worker.worker_id}`).set(authHeader(admin));
    expect(adminView.body.idDocument).toBe(ID);
    expect(adminView.body.selfie).toBe(SELFIE);

    const requesterView = await request(app).get(`/api/workers/${worker.worker_id}`).set(authHeader(requester.token));
    expect(requesterView.body).not.toHaveProperty('idDocument');
    expect(requesterView.body).not.toHaveProperty('selfie');
  });
});

describe('safety check-in', () => {
  test('worker sets an expected finish; overdue is flagged on read', async () => {
    const { bookingId, worker, requester } = await makeBookingAt('in_progress');
    const set = await request(app).post(`/api/bookings/${bookingId}/safety-timer`).set(authHeader(worker.token)).send({ minutes: 120 });
    expect(set.status).toBe(200);
    expect(set.body.safetyExpectedAt).toBeTruthy();
    expect(set.body.safetyOverdue).toBe(false);

    await pool.query(`UPDATE check_in_record SET safety_expected_at = now() - interval '10 minutes' WHERE booking_id = $1`, [bookingId]);
    const after = (await request(app).get('/api/bookings').set(authHeader(requester.token))).body.find((b) => b.booking_id === bookingId);
    expect(after.safetyOverdue).toBe(true);
  });
});

describe('escrow auto-release after 24h', () => {
  test('a checked-out booking unconfirmed for >24h auto-releases on the next read', async () => {
    const { bookingId, requester } = await makeBookingAt('checkedOut'); // in_progress, held, end_ts now
    await pool.query(`UPDATE check_in_record SET end_ts = now() - interval '25 hours' WHERE booking_id = $1`, [bookingId]);
    const list = await request(app).get('/api/bookings').set(authHeader(requester.token)); // triggers the lazy sweep
    const b = list.body.find((x) => x.booking_id === bookingId);
    expect(b.payment).toBe('released');
    expect(b.status).toBe('completed');
  });
});

describe('earnings endpoint', () => {
  test('GET /workers/me/earnings returns the income-summary shape', async () => {
    const worker = await registerWorker();
    const res = await request(app).get('/api/workers/me/earnings').set(authHeader(worker.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('count');
    expect(res.body).toHaveProperty('avgRating');
    expect(Array.isArray(res.body.byCategory)).toBe(true);
    expect(Array.isArray(res.body.records)).toBe(true);
  });
});
