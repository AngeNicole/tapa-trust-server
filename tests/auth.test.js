const { request, app, authHeader, registerRequester, registerWorker, closePool, uniqueEmail } = require('./helpers');

afterAll(closePool);

describe('auth', () => {
  test('register returns a token and a password-free user', async () => {
    const email = uniqueEmail('reg');
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'Ada', email, password: 'secret1', role: 'requester' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ name: 'Ada', email, role: 'requester' });
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('rejects an invalid role', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'X', email: uniqueEmail('bad'), password: 'secret1', role: 'admin' });
    expect(res.status).toBe(400);
  });

  test('rejects a short password', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ name: 'X', email: uniqueEmail('short'), password: '123', role: 'requester' });
    expect(res.status).toBe(400);
  });

  test('rejects a missing required field', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: uniqueEmail('nofield'), password: 'secret1', role: 'requester' });
    expect(res.status).toBe(400);
  });

  test('duplicate email returns 409', async () => {
    const email = uniqueEmail('dup');
    await request(app).post('/api/auth/register').send({ name: 'A', email, password: 'secret1', role: 'requester' });
    const res = await request(app).post('/api/auth/register').send({ name: 'B', email, password: 'secret1', role: 'worker' });
    expect(res.status).toBe(409);
  });

  test('login succeeds with correct credentials and fails otherwise', async () => {
    const email = uniqueEmail('login');
    await request(app).post('/api/auth/register').send({ name: 'L', email, password: 'secret1', role: 'requester' });

    const ok = await request(app).post('/api/auth/login').send({ email, password: 'secret1' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    const bad = await request(app).post('/api/auth/login').send({ email, password: 'wrongpass' });
    expect(bad.status).toBe(401);
  });

  test('protected route requires a token', async () => {
    const noTok = await request(app).get('/api/auth/me');
    expect(noTok.status).toBe(401);

    const { token, user } = await registerRequester();
    const withTok = await request(app).get('/api/auth/me').set(authHeader(token));
    expect(withTok.status).toBe(200);
    expect(withTok.body.user.user_id).toBe(user.user_id);
  });

  test('invalid token is rejected', async () => {
    const res = await request(app).get('/api/auth/me').set(authHeader('not.a.jwt'));
    expect(res.status).toBe(401);
  });
});

describe('account profile settings', () => {
  test('PUT /auth/me updates name, phone, and location', async () => {
    const { token } = await registerRequester();
    const res = await request(app).put('/api/auth/me').set(authHeader(token))
      .send({ name: 'Renamed User', phone: '0788000111', location: 'Musanze' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Renamed User', phone: '0788000111', location: 'Musanze' });

    const me = await request(app).get('/api/auth/me').set(authHeader(token));
    expect(me.body.user.name).toBe('Renamed User');
  });

  test('PUT /auth/me supports partial updates and clearing a field', async () => {
    const { token } = await registerRequester({ phone: '0780000000' });
    const cleared = await request(app).put('/api/auth/me').set(authHeader(token)).send({ phone: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.user.phone).toBeNull();
  });

  test('PUT /auth/me rejects an empty body and an empty name', async () => {
    const { token } = await registerRequester();
    expect((await request(app).put('/api/auth/me').set(authHeader(token)).send({})).status).toBe(400);
    expect((await request(app).put('/api/auth/me').set(authHeader(token)).send({ name: '   ' })).status).toBe(400);
  });

  test('PUT /auth/me requires auth', async () => {
    const res = await request(app).put('/api/auth/me').send({ name: 'x' });
    expect(res.status).toBe(401);
  });

  test('worker name change is mirrored to the worker profile', async () => {
    const worker = await registerWorker();
    await request(app).put('/api/auth/me').set(authHeader(worker.token)).send({ name: 'New Worker Name' });
    const profile = await request(app).get('/api/workers/me').set(authHeader(worker.token));
    expect(profile.body.name).toBe('New Worker Name');
  });

  test('PUT /auth/password changes the password and the new one works', async () => {
    const email = uniqueEmail('pwd');
    const reg = await request(app).post('/api/auth/register').send({ name: 'P', email, password: 'secret1', role: 'requester' });
    const token = reg.body.token;

    const change = await request(app).put('/api/auth/password').set(authHeader(token))
      .send({ currentPassword: 'secret1', newPassword: 'secret2' });
    expect(change.status).toBe(200);

    expect((await request(app).post('/api/auth/login').send({ email, password: 'secret1' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email, password: 'secret2' })).status).toBe(200);
  });

  test('PUT /auth/password rejects a wrong current password and a too-short new one', async () => {
    const { token } = await registerRequester();
    const wrong = await request(app).put('/api/auth/password').set(authHeader(token))
      .send({ currentPassword: 'nope', newPassword: 'secret2' });
    expect(wrong.status).toBe(400);

    const short = await request(app).put('/api/auth/password').set(authHeader(token))
      .send({ currentPassword: 'secret1', newPassword: '123' });
    expect(short.status).toBe(400);
  });
});
