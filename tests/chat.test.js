const {
  request, app, authHeader, registerRequester, makeBookingAt, closePool,
} = require('./helpers');

afterAll(closePool);

describe('single booking (GET /bookings/:id)', () => {
  test('a party gets the BookingView; non-party 403; bad/missing id', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');

    const asReq = await request(app).get(`/api/bookings/${bookingId}`).set(authHeader(requester.token));
    expect(asReq.status).toBe(200);
    expect(asReq.body.booking_id).toBe(bookingId);
    // BookingView carries the client-contract fields
    for (const k of ['taskTitle', 'workerName', 'requesterName', 'requesterPhone', 'workerPhone',
      'status', 'agreedPrice', 'checkedIn', 'startConfirmed', 'checkedOut', 'endConfirmed',
      'startTs', 'endTs', 'payment', 'review']) {
      expect(k in asReq.body).toBe(true);
    }

    const asWorker = await request(app).get(`/api/bookings/${bookingId}`).set(authHeader(worker.token));
    expect(asWorker.status).toBe(200);

    const outsider = await registerRequester();
    expect((await request(app).get(`/api/bookings/${bookingId}`).set(authHeader(outsider.token))).status).toBe(403);
    expect((await request(app).get('/api/bookings/99999999').set(authHeader(requester.token))).status).toBe(404);
    expect((await request(app).get('/api/bookings/abc').set(authHeader(requester.token))).status).toBe(400);
  });
});

describe('booking chat (messages)', () => {
  test('GET returns { agreedPrice, messages[] } oldest→newest with sender role', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');

    await request(app).post(`/api/bookings/${bookingId}/messages`).set(authHeader(requester.token)).send({ body: 'Hi, Saturday?' });
    await request(app).post(`/api/bookings/${bookingId}/messages`).set(authHeader(worker.token)).send({ body: 'Yes, morning.' });

    const res = await request(app).get(`/api/bookings/${bookingId}/messages`).set(authHeader(worker.token));
    expect(res.status).toBe(200);
    expect(res.body.agreedPrice).toBeNull();
    expect(res.body.messages.map((m) => m.body)).toEqual(['Hi, Saturday?', 'Yes, morning.']);
    const first = res.body.messages[0];
    for (const k of ['message_id', 'body', 'amount', 'created_at', 'senderUserId', 'senderName', 'senderRole']) {
      expect(k in first).toBe(true);
    }
    expect(first.senderRole).toBe('requester');
    expect(first.senderUserId).toBe(requester.user.user_id);
    expect(res.body.messages[1].senderRole).toBe('worker');
  });

  test('a message may carry a body and/or an amount; empty is rejected', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');

    expect((await request(app).post(`/api/bookings/${bookingId}/messages`).set(authHeader(worker.token)).send({ amount: 8000 })).status).toBe(201);
    expect((await request(app).post(`/api/bookings/${bookingId}/messages`).set(authHeader(requester.token)).send({ body: 'ok', amount: 7000 })).status).toBe(201);
    expect((await request(app).post(`/api/bookings/${bookingId}/messages`).set(authHeader(worker.token)).send({})).status).toBe(400);
    expect((await request(app).post(`/api/bookings/${bookingId}/messages`).set(authHeader(worker.token)).send({ amount: -1 })).status).toBe(400);

    const res = await request(app).get(`/api/bookings/${bookingId}/messages`).set(authHeader(requester.token));
    expect(Number(res.body.messages[0].amount)).toBe(8000);
  });

  test('non-party 403; no token 401', async () => {
    const { bookingId } = await makeBookingAt('accepted');
    const outsider = await registerRequester();
    expect((await request(app).get(`/api/bookings/${bookingId}/messages`).set(authHeader(outsider.token))).status).toBe(403);
    expect((await request(app).post(`/api/bookings/${bookingId}/messages`).set(authHeader(outsider.token)).send({ body: 'x' })).status).toBe(403);
    expect((await request(app).get(`/api/bookings/${bookingId}/messages`)).status).toBe(401);
  });
});

describe('agree-price', () => {
  test('sets agreedPrice + payment amount; returns a BookingView', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');

    const res = await request(app).post(`/api/bookings/${bookingId}/agree-price`).set(authHeader(worker.token)).send({ amount: 7500 });
    expect(res.status).toBe(200);
    expect(Number(res.body.agreedPrice)).toBe(7500);

    const pay = await request(app).get(`/api/bookings/${bookingId}/payment-status`).set(authHeader(requester.token));
    expect(Number(pay.body.amount)).toBe(7500);

    // reflected in the messages endpoint's agreedPrice
    const msgs = await request(app).get(`/api/bookings/${bookingId}/messages`).set(authHeader(requester.token));
    expect(Number(msgs.body.agreedPrice)).toBe(7500);
  });

  test('bad amount 400; non-party 403', async () => {
    const { bookingId } = await makeBookingAt('accepted');
    const outsider = await registerRequester();
    expect((await request(app).post(`/api/bookings/${bookingId}/agree-price`).set(authHeader(outsider.token)).send({ amount: 100 })).status).toBe(403);
  });
});

describe('check-in gated on agreed price', () => {
  test('checkin blocked (400) until agree-price, then succeeds', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');

    const blocked = await request(app).post(`/api/bookings/${bookingId}/checkin`).set(authHeader(worker.token));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/price/i);

    await request(app).post(`/api/bookings/${bookingId}/agree-price`).set(authHeader(requester.token)).send({ amount: 6000 });

    const ok = await request(app).post(`/api/bookings/${bookingId}/checkin`).set(authHeader(worker.token));
    expect(ok.status).toBe(200);
    expect(ok.body.checkedIn).toBe(true);
  });
});

describe('chat notifications carry bookingId + type', () => {
  test('offer → other party gets type "offer"; agree → "price_agreed"; both with bookingId', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');

    // worker sends an offer → requester notified
    await request(app).post(`/api/bookings/${bookingId}/messages`).set(authHeader(worker.token)).send({ amount: 9000 });
    const reqNotifs = await request(app).get('/api/notifications').set(authHeader(requester.token));
    const offer = reqNotifs.body.find((n) => n.type === 'offer' && n.bookingId === bookingId);
    expect(offer).toBeTruthy();

    // requester agrees → worker notified
    await request(app).post(`/api/bookings/${bookingId}/agree-price`).set(authHeader(requester.token)).send({ amount: 9000 });
    const wrkNotifs = await request(app).get('/api/notifications').set(authHeader(worker.token));
    const agreed = wrkNotifs.body.find((n) => n.type === 'price_agreed' && n.bookingId === bookingId);
    expect(agreed).toBeTruthy();
  });
});
