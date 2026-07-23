// Job posting: a requester posts a job, a verified worker browses it and
// expresses interest (which opens a conversation), and both chat in the thread.
const {
  request, app, authHeader, registerRequester, registerWorker, approveWorker, closePool,
} = require('./helpers');

afterAll(closePool);

async function verifiedWorker() {
  const worker = await registerWorker();
  await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills: 'Plumbing', bio: 'exp' });
  await approveWorker(worker.worker_id);
  return worker;
}

describe('jobs: post → browse → express interest via chat', () => {
  test('full happy path', async () => {
    const requester = await registerRequester();
    const worker = await verifiedWorker();

    // Requester posts a job.
    const created = await request(app).post('/api/jobs').set(authHeader(requester.token))
      .send({ title: 'Fix a leaking sink', description: 'Kitchen', category: 'Plumbing', budget: 15000, location: 'Kimironko' });
    expect(created.status).toBe(201);
    const jobId = created.body.job_id;
    expect(created.body.budget).toBe(15000);

    // Worker browses open jobs and sees it (skill filter works too).
    const browse = await request(app).get('/api/jobs?skill=Plumb').set(authHeader(worker.token));
    expect(browse.body.map((j) => j.job_id)).toContain(jobId);

    // Worker expresses interest with an intro message → opens a conversation.
    const interest = await request(app).post(`/api/jobs/${jobId}/interest`).set(authHeader(worker.token)).send({ message: 'I can help today.' });
    expect(interest.status).toBe(201);
    const interestId = interest.body.interestId;

    // Requester sees the interested worker + the intro as the last message.
    const interests = await request(app).get(`/api/jobs/${jobId}/interests`).set(authHeader(requester.token));
    expect(interests.body).toHaveLength(1);
    expect(interests.body[0].interestId).toBe(interestId);
    expect(interests.body[0].lastMessage).toMatch(/help today/);

    // Both read + post in the thread.
    const t1 = await request(app).get(`/api/jobs/interests/${interestId}/messages`).set(authHeader(requester.token));
    expect(t1.body).toHaveLength(1);
    const reply = await request(app).post(`/api/jobs/interests/${interestId}/messages`).set(authHeader(requester.token)).send({ body: 'Great — when can you come?' });
    expect(reply.status).toBe(201);
    const t2 = await request(app).get(`/api/jobs/interests/${interestId}/messages`).set(authHeader(worker.token));
    expect(t2.body).toHaveLength(2);

    // Requester's job list shows the interest count; worker's list shows the job.
    const mine = await request(app).get('/api/jobs/mine').set(authHeader(requester.token));
    expect(mine.body.find((j) => j.job_id === jobId).interestCount).toBe(1);
    const myInt = await request(app).get('/api/jobs/interests/mine').set(authHeader(worker.token));
    expect(myInt.body.map((r) => r.interestId)).toContain(interestId);
  });

  test('an unverified worker cannot express interest (403)', async () => {
    const requester = await registerRequester();
    const worker = await registerWorker(); // complete profile but NOT approved
    await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills: 'Plumbing', bio: 'x' });
    const job = await request(app).post('/api/jobs').set(authHeader(requester.token)).send({ title: 'Paint a wall' });
    const res = await request(app).post(`/api/jobs/${job.body.job_id}/interest`).set(authHeader(worker.token)).send({ message: 'hi' });
    expect(res.status).toBe(403);
  });

  test('role + access rules', async () => {
    const worker = await verifiedWorker();
    // A worker cannot post a job.
    expect((await request(app).post('/api/jobs').set(authHeader(worker.token)).send({ title: 'x' })).status).toBe(403);

    // An outsider cannot read someone else's job conversation.
    const requester = await registerRequester();
    const job = await request(app).post('/api/jobs').set(authHeader(requester.token)).send({ title: 'Move boxes' });
    const interestId = (await request(app).post(`/api/jobs/${job.body.job_id}/interest`).set(authHeader(worker.token)).send({ message: 'me' })).body.interestId;
    const outsider = await registerRequester();
    const res = await request(app).get(`/api/jobs/interests/${interestId}/messages`).set(authHeader(outsider.token));
    expect(res.status).toBe(403);
  });

  test('cannot express interest in a closed job (409)', async () => {
    const requester = await registerRequester();
    const worker = await verifiedWorker();
    const job = await request(app).post('/api/jobs').set(authHeader(requester.token)).send({ title: 'Assemble a shelf' });
    await request(app).post(`/api/jobs/${job.body.job_id}/close`).set(authHeader(requester.token));
    const res = await request(app).post(`/api/jobs/${job.body.job_id}/interest`).set(authHeader(worker.token)).send({ message: 'hi' });
    expect(res.status).toBe(409);
  });
});
