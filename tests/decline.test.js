const {
  request, app, authHeader, registerRequester, registerWorker, makeBookingAt, closePool,
} = require('./helpers');

afterAll(closePool);

describe('decline / cancel a booking (either party, with reason)', () => {
  test('worker declines a pending booking → cancelled + reason; requester notified', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('pending');
    const res = await request(app).post(`/api/bookings/${bookingId}/decline`)
      .set(authHeader(worker.token)).send({ reason: 'Too far from me' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.cancelReason).toBe('Too far from me');

    const notifs = await request(app).get('/api/notifications').set(authHeader(requester.token));
    expect(notifs.body.some((n) => n.type === 'booking_declined' && n.bookingId === bookingId)).toBe(true);
  });

  test('requester declines an accepted booking → cancelled; worker freed', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('accepted');
    const res = await request(app).post(`/api/bookings/${bookingId}/decline`).set(authHeader(requester.token)).send({ reason: 'Changed plans' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    // worker notified
    const wn = await request(app).get('/api/notifications').set(authHeader(worker.token));
    expect(wn.body.some((n) => n.type === 'booking_declined' && n.bookingId === bookingId)).toBe(true);
  });

  test('declining an in-progress booking with held escrow → escrow refunded', async () => {
    const { requester, bookingId } = await makeBookingAt('in_progress'); // escrow held
    const res = await request(app).post(`/api/bookings/${bookingId}/decline`).set(authHeader(requester.token)).send({ reason: 'Emergency' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.escrow.status).toBe('refunded');
  });

  test('reason required (400); cannot decline a completed booking (400)', async () => {
    const { worker, bookingId } = await makeBookingAt('pending');
    expect((await request(app).post(`/api/bookings/${bookingId}/decline`).set(authHeader(worker.token)).send({})).status).toBe(400);

    const done = await makeBookingAt('completed');
    expect((await request(app).post(`/api/bookings/${done.bookingId}/decline`).set(authHeader(done.requester.token)).send({ reason: 'x' })).status).toBe(400);
  });

  test('a non-party cannot decline (403)', async () => {
    const { bookingId } = await makeBookingAt('pending');
    const outsider = await registerWorker();
    expect((await request(app).post(`/api/bookings/${bookingId}/decline`).set(authHeader(outsider.token)).send({ reason: 'x' })).status).toBe(403);
  });
});
