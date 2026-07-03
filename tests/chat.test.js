const {
  request, app, authHeader, registerRequester, registerWorker, makeBookingAt, closePool,
} = require('./helpers');

afterAll(closePool);

describe('booking chat (messages)', () => {
  test('both parties can send and read messages, oldest first', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');

    const m1 = await request(app).post(`/api/bookings/${bookingId}/messages`)
      .set(authHeader(requester.token)).send({ body: 'Hi, are you available Saturday?' });
    expect(m1.status).toBe(201);
    expect(m1.body).toMatchObject({ booking_id: bookingId, sender_user_id: requester.user.user_id, body: 'Hi, are you available Saturday?' });

    const m2 = await request(app).post(`/api/bookings/${bookingId}/messages`)
      .set(authHeader(worker.token)).send({ body: 'Yes, morning works.' });
    expect(m2.status).toBe(201);

    // worker can read the thread; oldest first
    const thread = await request(app).get(`/api/bookings/${bookingId}/messages`).set(authHeader(worker.token));
    expect(thread.status).toBe(200);
    expect(thread.body.map((m) => m.body)).toEqual(['Hi, are you available Saturday?', 'Yes, morning works.']);
  });

  test('empty body is rejected (400)', async () => {
    const { requester, bookingId } = await makeBookingAt('accepted');
    const res = await request(app).post(`/api/bookings/${bookingId}/messages`).set(authHeader(requester.token)).send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  test('a non-party cannot read or send (403)', async () => {
    const { bookingId } = await makeBookingAt('accepted');
    const outsider = await registerRequester();
    expect((await request(app).get(`/api/bookings/${bookingId}/messages`).set(authHeader(outsider.token))).status).toBe(403);
    expect((await request(app).post(`/api/bookings/${bookingId}/messages`).set(authHeader(outsider.token)).send({ body: 'hi' })).status).toBe(403);
  });

  test('no token is rejected (401)', async () => {
    const { bookingId } = await makeBookingAt('accepted');
    expect((await request(app).get(`/api/bookings/${bookingId}/messages`)).status).toBe(401);
  });
});

describe('structured price agreement', () => {
  test('propose then the other party accepts → price_agreed + payment.amount set', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');

    const proposed = await request(app).post(`/api/bookings/${bookingId}/propose-price`)
      .set(authHeader(worker.token)).send({ amount: 7500 });
    expect(proposed.status).toBe(200);
    expect(Number(proposed.body.proposedAmount)).toBe(7500);
    expect(proposed.body.priceAgreed).toBe(false);

    const accepted = await request(app).post(`/api/bookings/${bookingId}/accept-price`).set(authHeader(requester.token));
    expect(accepted.status).toBe(200);
    expect(accepted.body.priceAgreed).toBe(true);
    expect(Number(accepted.body.paymentAmount)).toBe(7500);

    // and payment-status reflects the amount
    const pay = await request(app).get(`/api/bookings/${bookingId}/payment-status`).set(authHeader(requester.token));
    expect(Number(pay.body.amount)).toBe(7500);
  });

  test('proposer cannot accept their own proposal (400)', async () => {
    const { worker, bookingId } = await makeBookingAt('accepted');
    await request(app).post(`/api/bookings/${bookingId}/propose-price`).set(authHeader(worker.token)).send({ amount: 3000 });
    const selfAccept = await request(app).post(`/api/bookings/${bookingId}/accept-price`).set(authHeader(worker.token));
    expect(selfAccept.status).toBe(400);
  });

  test('accept with no proposal is rejected (400); bad amount rejected (400)', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');
    expect((await request(app).post(`/api/bookings/${bookingId}/accept-price`).set(authHeader(requester.token))).status).toBe(400);
    expect((await request(app).post(`/api/bookings/${bookingId}/propose-price`).set(authHeader(worker.token)).send({ amount: -5 })).status).toBe(400);
  });

  test('a new proposal supersedes an unaccepted one', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');
    await request(app).post(`/api/bookings/${bookingId}/propose-price`).set(authHeader(worker.token)).send({ amount: 3000 });
    const second = await request(app).post(`/api/bookings/${bookingId}/propose-price`).set(authHeader(requester.token)).send({ amount: 4000 });
    expect(Number(second.body.proposedAmount)).toBe(4000);
    expect(second.body.priceAgreed).toBe(false);
    // now the worker (the other party to the latest proposal) accepts
    const accepted = await request(app).post(`/api/bookings/${bookingId}/accept-price`).set(authHeader(worker.token));
    expect(accepted.body.priceAgreed).toBe(true);
    expect(Number(accepted.body.paymentAmount)).toBe(4000);
  });
});

describe('check-in is gated on price agreement', () => {
  test('checkin is blocked (400) until price agreed, then succeeds', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');

    // no price agreed yet → checkin blocked
    const blocked = await request(app).post(`/api/bookings/${bookingId}/checkin`).set(authHeader(worker.token));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/price/i);

    // agree on the price
    await request(app).post(`/api/bookings/${bookingId}/propose-price`).set(authHeader(worker.token)).send({ amount: 6000 });
    await request(app).post(`/api/bookings/${bookingId}/accept-price`).set(authHeader(requester.token));

    // now checkin succeeds
    const ok = await request(app).post(`/api/bookings/${bookingId}/checkin`).set(authHeader(worker.token));
    expect(ok.status).toBe(200);
    expect(ok.body.checkedIn).toBe(true);
  });
});
