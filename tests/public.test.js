const {
  request, app, authHeader, registerRequester, registerWorker, makeBookingAt, closePool,
} = require('./helpers');

afterAll(closePool);

// A complete + available worker with all optional fields filled.
async function availableWorkerWithProfile() {
  const worker = await registerWorker();
  await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({
    skills: 'Plumbing, Electrical', bio: 'Experienced', education: 'BSc', certifications: 'Cert X',
  });
  await request(app).put('/api/workers/me/availability').set(authHeader(worker.token)).send({ is_available: true });
  return worker;
}

const PUBLIC_KEYS = ['bio', 'certifications', 'completedJobs', 'education', 'name', 'photo', 'rating', 'skills', 'verification', 'worker_id'];

describe('public worker browse (no auth)', () => {
  test('GET /api/public/workers returns available workers with NO token', async () => {
    const worker = await availableWorkerWithProfile();
    const res = await request(app).get('/api/public/workers'); // no Authorization header
    expect(res.status).toBe(200);
    const row = res.body.find((w) => w.worker_id === worker.worker_id);
    expect(row).toBeTruthy();
    expect(row).toMatchObject({ bio: 'Experienced', verification: 'unverified' });
    expect(row.skills).toContain('Plumbing');
    expect(row).toHaveProperty('rating');
    expect(row).toHaveProperty('completedJobs');
  });

  test('public projection contains the expected fields and NO sensitive ones', async () => {
    const worker = await availableWorkerWithProfile();
    const res = await request(app).get(`/api/public/workers/${worker.worker_id}`);
    expect(res.status).toBe(200);

    // exact field set — nothing extra leaks
    expect(Object.keys(res.body).sort()).toEqual([...PUBLIC_KEYS].sort());

    // explicit absence of sensitive fields
    for (const f of ['email', 'phone', 'user_id', 'location', 'password_hash', 'evidence', 'admin_id', 'created_at']) {
      expect(res.body[f]).toBeUndefined();
    }
  });

  test('public list shows ONLY available workers', async () => {
    const avail = await availableWorkerWithProfile();
    const hidden = await registerWorker(); // unavailable (and incomplete)
    const res = await request(app).get('/api/public/workers');
    const ids = res.body.map((w) => w.worker_id);
    expect(ids).toContain(avail.worker_id);
    expect(ids).not.toContain(hidden.worker_id);
  });

  test('?skill= filters the public list', async () => {
    const w = await availableWorkerWithProfile(); // Plumbing, Electrical
    const match = await request(app).get('/api/public/workers?skill=Plumbing');
    expect(match.body.map((x) => x.worker_id)).toContain(w.worker_id);
    const none = await request(app).get('/api/public/workers?skill=Welding');
    expect(none.body.map((x) => x.worker_id)).not.toContain(w.worker_id);
  });

  test('GET /api/public/workers/:id/history (no token): completed jobs, narrow shape', async () => {
    const { worker, bookingId, requester } = await makeBookingAt('completed');
    await request(app).post('/api/reviews').set(authHeader(requester.token))
      .send({ booking_id: bookingId, rating: 5, comment: 'Great' });

    const res = await request(app).get(`/api/public/workers/${worker.worker_id}/history`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(Object.keys(res.body[0]).sort()).toEqual(['comment', 'date', 'rating', 'taskTitle'].sort());
    expect(res.body[0]).toMatchObject({ rating: 5, comment: 'Great' });
  });

  test('404 for a missing worker; 400 for a non-integer id', async () => {
    expect((await request(app).get('/api/public/workers/99999999')).status).toBe(404);
    expect((await request(app).get('/api/public/workers/abc')).status).toBe(400);
  });
});
