const {
  request, app, authHeader, registerRequester, registerWorker, createAdmin, closePool,
} = require('./helpers');

afterAll(closePool);

describe('categories', () => {
  test('GET /categories returns the 7 seeded categories', async () => {
    const { token } = await registerRequester();
    const res = await request(app).get('/api/categories').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(7);
    expect(res.body.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Plumbing', 'Cleaning', 'Electrical', 'Basic tech setup'])
    );
  });

  test('requires auth', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(401);
  });
});

describe('workers', () => {
  test('registering a worker auto-creates a profile reachable via /workers/me', async () => {
    const worker = await registerWorker();
    expect(worker.worker_id).toBeGreaterThan(0);
    const me = await request(app).get('/api/workers/me').set(authHeader(worker.token));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ worker_id: worker.worker_id, tier: 'Unverified' });
    expect(me.body.rating).toBe(0);
  });

  test('PUT /workers/me updates skills and bio', async () => {
    const worker = await registerWorker();
    const res = await request(app).put('/api/workers/me').set(authHeader(worker.token))
      .send({ skills: 'Plumbing, Electrical', bio: '10 yrs' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ skills: 'Plumbing, Electrical', bio: '10 yrs' });
  });

  test('non-worker cannot use /workers/me', async () => {
    const { token } = await registerRequester();
    const res = await request(app).get('/api/workers/me').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  test('GET /workers/:id includes empty taskHistory and zero activeJobsCount for a fresh worker', async () => {
    const worker = await registerWorker();
    const { token } = await registerRequester();
    const res = await request(app).get(`/api/workers/${worker.worker_id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.taskHistory).toEqual([]);
    expect(res.body.activeJobsCount).toBe(0);
  });

  test('GET /workers/:id/history is a list, and 404 for a missing worker', async () => {
    const worker = await registerWorker();
    const { token } = await registerRequester();
    const ok = await request(app).get(`/api/workers/${worker.worker_id}/history`).set(authHeader(token));
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body)).toBe(true);

    const missing = await request(app).get('/api/workers/99999999/history').set(authHeader(token));
    expect(missing.status).toBe(404);
  });

  test('invalid worker id returns 400', async () => {
    const { token } = await registerRequester();
    const res = await request(app).get('/api/workers/abc').set(authHeader(token));
    expect(res.status).toBe(400);
  });
});

describe('saved workers', () => {
  test('save is idempotent, list reflects it, delete removes it', async () => {
    const requester = await registerRequester();
    const worker = await registerWorker();
    const h = authHeader(requester.token);

    const s1 = await request(app).post('/api/saved-workers').set(h).send({ worker_id: worker.worker_id });
    expect(s1.status).toBe(201);
    await request(app).post('/api/saved-workers').set(h).send({ worker_id: worker.worker_id }); // again, no error

    const list = await request(app).get('/api/saved-workers').set(h);
    expect(list.status).toBe(200);
    expect(list.body.filter((w) => w.worker_id === worker.worker_id).length).toBe(1);

    const del = await request(app).delete(`/api/saved-workers/${worker.worker_id}`).set(h);
    expect(del.status).toBe(200);
    const after = await request(app).get('/api/saved-workers').set(h);
    expect(after.body.filter((w) => w.worker_id === worker.worker_id).length).toBe(0);
  });

  test('worker role cannot use saved-workers (requester only)', async () => {
    const worker = await registerWorker();
    const res = await request(app).get('/api/saved-workers').set(authHeader(worker.token));
    expect(res.status).toBe(403);
  });
});

describe('admin', () => {
  test('admin can list users and create a category; others are forbidden', async () => {
    const adminToken = await createAdmin();
    const users = await request(app).get('/api/admin/users').set(authHeader(adminToken));
    expect(users.status).toBe(200);
    expect(Array.isArray(users.body)).toBe(true);

    const cat = await request(app).post('/api/admin/categories').set(authHeader(adminToken))
      .send({ name: `Gardening ${Date.now()}`, description: 'Yard work' });
    expect(cat.status).toBe(201);
    expect(cat.body.category_id).toBeGreaterThan(0);

    const { token } = await registerRequester();
    const forbidden = await request(app).get('/api/admin/users').set(authHeader(token));
    expect(forbidden.status).toBe(403);
  });
});
