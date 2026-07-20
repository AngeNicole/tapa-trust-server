const {
  request, app, pool, authHeader, registerRequester, registerWorker, makeBookingAt, approveWorker, closePool,
} = require('./helpers');

afterAll(closePool);

// Book a worker (with a complete, available profile) and accept it.
async function bookedAndAccepted() {
  const requester = await registerRequester();
  const worker = await registerWorker();
  await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills: 'Plumbing', bio: 'exp' });
  await request(app).put('/api/workers/me/availability').set(authHeader(worker.token)).send({ is_available: true });
  await approveWorker(worker.worker_id); // verified-only: must be approved to be booked
  const created = await request(app).post(`/api/bookings/book/${worker.worker_id}`).set(authHeader(requester.token));
  const bookingId = created.body.booking_id;
  // A price must be agreed before the worker can accept.
  await request(app).post(`/api/bookings/${bookingId}/agree-price`).set(authHeader(requester.token)).send({ amount: 5000 });
  await request(app).post(`/api/bookings/${bookingId}/accept`).set(authHeader(worker.token));
  return { requester, worker, bookingId, created };
}

describe('chat IDs', () => {
  test('booking creates a chat; chatId appears in BookingView and messages', async () => {
    const { requester, bookingId, created } = await bookedAndAccepted();
    expect(created.body.chatId).toBeGreaterThan(0);

    const view = await request(app).get(`/api/bookings/${bookingId}`).set(authHeader(requester.token));
    expect(view.body.chatId).toBe(created.body.chatId);

    const msgs = await request(app).get(`/api/bookings/${bookingId}/messages`).set(authHeader(requester.token));
    expect(msgs.body.chatId).toBe(created.body.chatId);
  });
});

describe('digital agreement (finalize + sign)', () => {
  test('requester proposes+signs → worker signs → status signed', async () => {
    const { requester, worker, bookingId } = await bookedAndAccepted();

    const prop = await request(app).post(`/api/bookings/${bookingId}/agreement`)
      .set(authHeader(requester.token)).send({ amount: 15000, signature: 'Aline Uwase' });
    expect(prop.status).toBe(200);
    expect(prop.body.agreement).toMatchObject({ status: 'proposed', requesterSigned: true, workerSigned: false, requesterSignature: 'Aline Uwase' });
    expect(Number(prop.body.agreedPrice)).toBe(15000);

    const sign = await request(app).post(`/api/bookings/${bookingId}/agreement/sign`)
      .set(authHeader(worker.token)).send({ signature: 'Jean Bosco' });
    expect(sign.status).toBe(200);
    expect(sign.body.agreement).toMatchObject({ status: 'signed', requesterSigned: true, workerSigned: true, workerSignature: 'Jean Bosco' });

    // notifications
    const wn = await request(app).get('/api/notifications').set(authHeader(worker.token));
    expect(wn.body.some((n) => n.type === 'agreement_proposed' && n.bookingId === bookingId)).toBe(true);
    const rn = await request(app).get('/api/notifications').set(authHeader(requester.token));
    expect(rn.body.some((n) => n.type === 'agreement_signed' && n.bookingId === bookingId)).toBe(true);
  });

  test('role rules: only requester proposes, only worker signs; validation', async () => {
    const { requester, worker, bookingId } = await bookedAndAccepted();
    expect((await request(app).post(`/api/bookings/${bookingId}/agreement`).set(authHeader(worker.token)).send({ amount: 100, signature: 'x' })).status).toBe(403);
    expect((await request(app).post(`/api/bookings/${bookingId}/agreement`).set(authHeader(requester.token)).send({ amount: 0, signature: 'x' })).status).toBe(400);
    expect((await request(app).post(`/api/bookings/${bookingId}/agreement`).set(authHeader(requester.token)).send({ amount: 100 })).status).toBe(400);
    // sign before propose → 400
    expect((await request(app).post(`/api/bookings/${bookingId}/agreement/sign`).set(authHeader(worker.token)).send({ signature: 'W' })).status).toBe(400);
  });
});

describe('escrow (deposit → hold → release / refund)', () => {
  test('deposit requires a signed agreement; then holds; completion releases + earnings', async () => {
    const { requester, worker, bookingId } = await bookedAndAccepted();

    // deposit before signing → 400
    expect((await request(app).post(`/api/bookings/${bookingId}/escrow/deposit`).set(authHeader(requester.token))).status).toBe(400);

    await request(app).post(`/api/bookings/${bookingId}/agreement`).set(authHeader(requester.token)).send({ amount: 15000, signature: 'R' });
    await request(app).post(`/api/bookings/${bookingId}/agreement/sign`).set(authHeader(worker.token)).send({ signature: 'W' });

    const dep = await request(app).post(`/api/bookings/${bookingId}/escrow/deposit`).set(authHeader(requester.token));
    expect(dep.status).toBe(200);
    expect(dep.body.escrow).toMatchObject({ status: 'held' });
    expect(Number(dep.body.escrow.amount)).toBe(15000);
    // worker notified
    const wn = await request(app).get('/api/notifications').set(authHeader(worker.token));
    expect(wn.body.some((n) => n.type === 'escrow_deposited' && n.bookingId === bookingId)).toBe(true);

    // run to completion → released + earnings row
    await request(app).post(`/api/bookings/${bookingId}/checkin`).set(authHeader(worker.token));
    await request(app).post(`/api/bookings/${bookingId}/confirm-start`).set(authHeader(requester.token));
    await request(app).post(`/api/bookings/${bookingId}/checkout`).set(authHeader(worker.token));
    const done = await request(app).post(`/api/bookings/${bookingId}/confirm-completion`).set(authHeader(requester.token));
    expect(done.body.escrow.status).toBe('released');

    const earn = await pool.query('SELECT amount FROM earnings_record WHERE booking_id = $1', [bookingId]);
    expect(earn.rows.length).toBe(1);
    expect(Number(earn.rows[0].amount)).toBe(15000);

    // deposit-only is requester-role gated
    const { bookingId: b2, worker: w2 } = await bookedAndAccepted();
    expect((await request(app).post(`/api/bookings/${b2}/escrow/deposit`).set(authHeader(w2.token))).status).toBe(403);
  });
});

describe('worker availability while booked', () => {
  test('accept → unavailable; completion → available again', async () => {
    const { worker, bookingId, requester } = await bookedAndAccepted();
    // after accept, worker is unavailable
    const me1 = await request(app).get('/api/workers/me').set(authHeader(worker.token));
    expect(me1.body.is_available).toBe(false);

    // finalize + deposit + full loop
    await request(app).post(`/api/bookings/${bookingId}/agreement`).set(authHeader(requester.token)).send({ amount: 5000, signature: 'R' });
    await request(app).post(`/api/bookings/${bookingId}/agreement/sign`).set(authHeader(worker.token)).send({ signature: 'W' });
    await request(app).post(`/api/bookings/${bookingId}/escrow/deposit`).set(authHeader(requester.token));
    await request(app).post(`/api/bookings/${bookingId}/checkin`).set(authHeader(worker.token));
    await request(app).post(`/api/bookings/${bookingId}/confirm-start`).set(authHeader(requester.token));
    await request(app).post(`/api/bookings/${bookingId}/checkout`).set(authHeader(worker.token));
    await request(app).post(`/api/bookings/${bookingId}/confirm-completion`).set(authHeader(requester.token));

    const me2 = await request(app).get('/api/workers/me').set(authHeader(worker.token));
    expect(me2.body.is_available).toBe(true);
  });

  test('1-hour fallback: a worker with a fresh active booking is hidden from browse even if is_available=true', async () => {
    const { worker } = await bookedAndAccepted(); // accepted → is_available=false + fresh booking
    // Force is_available back to true to isolate the fallback clause.
    await pool.query('UPDATE workers SET is_available = true WHERE worker_id = $1', [worker.worker_id]);
    const { token } = await registerRequester();
    const res = await request(app).get('/api/workers').set(authHeader(token));
    expect(res.body.map((w) => w.worker_id)).not.toContain(worker.worker_id);
  });
});
