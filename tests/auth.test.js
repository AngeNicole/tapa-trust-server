const { request, app, authHeader, registerRequester, closePool, uniqueEmail } = require('./helpers');

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
