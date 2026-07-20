const {
  request, app, authHeader, registerRequester, registerWorker, approveWorker, closePool,
} = require('./helpers');

afterAll(closePool);

async function availableWorker() {
  const worker = await registerWorker();
  await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills: 'Plumbing', bio: 'x' });
  await request(app).put('/api/workers/me/availability').set(authHeader(worker.token)).send({ is_available: true });
  await approveWorker(worker.worker_id); // verified-only: must be approved to be booked
  return worker;
}

describe('no double-booking (server guard)', () => {
  test('a second active booking with the same worker → 409; a different worker is fine', async () => {
    const requester = await registerRequester();
    const w1 = await availableWorker();
    const w2 = await availableWorker();

    const first = await request(app).post(`/api/bookings/book/${w1.worker_id}`).set(authHeader(requester.token));
    expect(first.status).toBe(201);

    const dup = await request(app).post(`/api/bookings/book/${w1.worker_id}`).set(authHeader(requester.token));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/active booking/i);

    const other = await request(app).post(`/api/bookings/book/${w2.worker_id}`).set(authHeader(requester.token));
    expect(other.status).toBe(201);
  });

  test('once the active booking is terminal (cancelled), booking the same worker again is allowed', async () => {
    const requester = await registerRequester();
    const worker = await availableWorker();
    const b = await request(app).post(`/api/bookings/book/${worker.worker_id}`).set(authHeader(requester.token));
    await request(app).post(`/api/bookings/${b.body.booking_id}/decline`).set(authHeader(requester.token)).send({ reason: 'changed mind' });

    const again = await request(app).post(`/api/bookings/book/${worker.worker_id}`).set(authHeader(requester.token));
    expect(again.status).toBe(201);
  });

  test('rebook is guarded too when an active booking exists', async () => {
    const requester = await registerRequester();
    const worker = await availableWorker();
    await request(app).post(`/api/bookings/book/${worker.worker_id}`).set(authHeader(requester.token));
    const rb = await request(app).post(`/api/bookings/rebook/${worker.worker_id}`).set(authHeader(requester.token));
    expect(rb.status).toBe(409);
  });
});
