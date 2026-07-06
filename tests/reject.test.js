const {
  request, app, authHeader, registerRequester, makeBookingAt, closePool,
} = require('./helpers');

afterAll(closePool);

describe('worker rejects a booking with a reason', () => {
  test('reject a pending booking → cancelled + reason; notifies requester', async () => {
    const { requester, worker, bookingId } = await makeBookingAt('pending');

    const res = await request(app).post(`/api/bookings/${bookingId}/reject`)
      .set(authHeader(worker.token)).send({ reason: 'Too far from me' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.cancelReason).toBe('Too far from me');

    // requester gets a booking_rejected notification carrying the bookingId
    const notifs = await request(app).get('/api/notifications').set(authHeader(requester.token));
    expect(notifs.body.some((n) => n.type === 'booking_rejected' && n.bookingId === bookingId)).toBe(true);
  });

  test('reject an accepted (but not started) booking is allowed', async () => {
    const { worker, bookingId } = await makeBookingAt('accepted');
    const res = await request(app).post(`/api/bookings/${bookingId}/reject`).set(authHeader(worker.token)).send({ reason: 'Double-booked' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  test('reason is required (400)', async () => {
    const { worker, bookingId } = await makeBookingAt('pending');
    expect((await request(app).post(`/api/bookings/${bookingId}/reject`).set(authHeader(worker.token)).send({})).status).toBe(400);
    expect((await request(app).post(`/api/bookings/${bookingId}/reject`).set(authHeader(worker.token)).send({ reason: '   ' })).status).toBe(400);
  });

  test('cannot reject once work has started (in_progress) (400)', async () => {
    const { worker, bookingId } = await makeBookingAt('in_progress');
    const res = await request(app).post(`/api/bookings/${bookingId}/reject`).set(authHeader(worker.token)).send({ reason: 'changed mind' });
    expect(res.status).toBe(400);
  });

  test('authz: requester cannot reject (role 403); another worker cannot (ownership 403)', async () => {
    const { requester, bookingId } = await makeBookingAt('pending');
    expect((await request(app).post(`/api/bookings/${bookingId}/reject`).set(authHeader(requester.token)).send({ reason: 'x' })).status).toBe(403);

    const { registerWorker } = require('./helpers');
    const otherWorker = await registerWorker();
    expect((await request(app).post(`/api/bookings/${bookingId}/reject`).set(authHeader(otherWorker.token)).send({ reason: 'x' })).status).toBe(403);
  });
});
