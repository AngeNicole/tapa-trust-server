const { pool } = require('../config/db');
const { createNotification } = require('./notifications.controller');

// Job posts: a requester advertises a job; verified workers browse open jobs and
// "express interest", which opens a conversation (job_interest + job_message).
// The requester reads interested workers, chats, and books one from their profile
// (the existing book-from-profile trust loop). Jobs never bypass verification or
// escrow — they're a discovery surface on top of the booking flow.

const FREE_TEXT_CAP = 2000;
const clip = (s, n = FREE_TEXT_CAP) => (typeof s === 'string' ? s.trim().slice(0, n) : null);

function jobRow(r) {
  return {
    job_id: r.job_id,
    title: r.title,
    description: r.description,
    category: r.category,
    budget: r.budget == null ? null : Number(r.budget),
    location: r.location,
    status: r.status,
    createdAt: r.created_at,
    requesterName: r.requester_name,
    interestCount: r.interest_count == null ? undefined : Number(r.interest_count),
  };
}

// POST /api/jobs   (requester) — create a job post
async function createJob(req, res, next) {
  const { title, description, category, budget, location } = req.body || {};
  if (!title || !clip(title)) return res.status(400).json({ error: 'A job title is required.' });
  const amt = Number(budget);
  const budgetVal = Number.isFinite(amt) && amt > 0 ? Math.round(amt) : null;
  try {
    const r = await pool.query(
      `INSERT INTO job_post (requester_user_id, title, description, category, budget, location)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.user_id, clip(title, 160), clip(description), clip(category, 80), budgetVal, clip(location, 160)]
    );
    return res.status(201).json(jobRow(r.rows[0]));
  } catch (err) { return next(err); }
}

// GET /api/jobs/mine   (requester) — my job posts + how many workers are interested
async function listMyJobs(req, res, next) {
  try {
    const r = await pool.query(
      `SELECT jp.*, (SELECT COUNT(*)::int FROM job_interest ji WHERE ji.job_id = jp.job_id) AS interest_count
       FROM job_post jp WHERE jp.requester_user_id = $1 ORDER BY jp.job_id DESC`,
      [req.user.user_id]
    );
    return res.json(r.rows.map(jobRow));
  } catch (err) { return next(err); }
}

// POST /api/jobs/:id/close   (requester, owner) — close a job (stops new interest)
async function closeJob(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id' });
  try {
    const r = await pool.query(
      `UPDATE job_post SET status = 'closed' WHERE job_id = $1 AND requester_user_id = $2 RETURNING *`,
      [id, req.user.user_id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Job not found' });
    return res.json(jobRow(r.rows[0]));
  } catch (err) { return next(err); }
}

// GET /api/jobs   (authed) — browse OPEN jobs; optional ?skill filter (title/category)
async function browseJobs(req, res, next) {
  const { skill } = req.query;
  const where = ["jp.status = 'open'"];
  const params = [];
  if (skill && skill.trim()) {
    params.push(`%${skill.trim()}%`);
    where.push(`(jp.category ILIKE $${params.length} OR jp.title ILIKE $${params.length})`);
  }
  try {
    const r = await pool.query(
      `SELECT jp.*, u.name AS requester_name
       FROM job_post jp JOIN users u ON u.user_id = jp.requester_user_id
       WHERE ${where.join(' AND ')} ORDER BY jp.job_id DESC`,
      params
    );
    return res.json(r.rows.map(jobRow));
  } catch (err) { return next(err); }
}

// Resolve the caller's worker_id (workers only). Returns null if none.
async function myWorkerId(userId) {
  const r = await pool.query('SELECT worker_id FROM workers WHERE user_id = $1', [userId]);
  return r.rows[0] ? r.rows[0].worker_id : null;
}
async function isVerified(workerId) {
  const r = await pool.query(
    `SELECT 1 FROM verification_request WHERE worker_id = $1 AND status = 'approved' LIMIT 1`, [workerId]
  );
  return !!r.rows[0];
}

// POST /api/jobs/:id/interest   (worker, verified) — express interest with a message
async function expressInterest(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id' });
  const body = clip((req.body || {}).message);
  if (!body) return res.status(400).json({ error: 'Add a short message to introduce yourself.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query("SELECT job_id, requester_user_id, title, status FROM job_post WHERE job_id = $1", [id])).rows[0];
    if (!job) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Job not found' }); }
    if (job.status !== 'open') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This job is closed.' }); }
    const workerId = await myWorkerId(req.user.user_id);
    if (!workerId) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Complete your worker profile first.' }); }
    if (!(await isVerified(workerId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only admin-verified workers can respond to jobs.' });
    }
    // One interest per (job, worker); reuse it if they already expressed interest.
    const interest = (await client.query(
      `INSERT INTO job_interest (job_id, worker_id) VALUES ($1, $2)
       ON CONFLICT (job_id, worker_id) DO UPDATE SET job_id = EXCLUDED.job_id
       RETURNING interest_id`, [id, workerId]
    )).rows[0];
    await client.query(
      'INSERT INTO job_message (interest_id, sender_user_id, body) VALUES ($1, $2, $3)',
      [interest.interest_id, req.user.user_id, body]
    );
    await createNotification(client, job.requester_user_id, 'job_interest', `A worker is interested in your job "${job.title}".`, null);
    await client.query('COMMIT');
    return res.status(201).json({ interestId: interest.interest_id });
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
}

// GET /api/jobs/:id/interests   (requester, owner) — workers who are interested
async function getJobInterests(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id' });
  try {
    const owns = await pool.query('SELECT 1 FROM job_post WHERE job_id = $1 AND requester_user_id = $2', [id, req.user.user_id]);
    if (!owns.rows[0]) return res.status(404).json({ error: 'Job not found' });
    const r = await pool.query(
      `SELECT ji.interest_id, ji.worker_id, w.name, w.photo, w.skills, w.rating, w.user_id AS worker_user_id,
              (SELECT body FROM job_message m WHERE m.interest_id = ji.interest_id ORDER BY m.message_id DESC LIMIT 1) AS last_message
       FROM job_interest ji JOIN workers w ON w.worker_id = ji.worker_id
       WHERE ji.job_id = $1 ORDER BY ji.interest_id DESC`, [id]
    );
    return res.json(r.rows.map((x) => ({
      interestId: x.interest_id,
      workerId: x.worker_id,
      workerUserId: x.worker_user_id,
      name: x.name,
      photo: x.photo,
      skills: x.skills,
      rating: x.rating == null ? 0 : Number(x.rating),
      lastMessage: x.last_message,
    })));
  } catch (err) { return next(err); }
}

// GET /api/jobs/interests/mine   (worker) — jobs this worker expressed interest in
async function listMyInterests(req, res, next) {
  try {
    const workerId = await myWorkerId(req.user.user_id);
    if (!workerId) return res.json([]);
    const r = await pool.query(
      `SELECT ji.interest_id, jp.job_id, jp.title, jp.status, u.name AS requester_name,
              (SELECT body FROM job_message m WHERE m.interest_id = ji.interest_id ORDER BY m.message_id DESC LIMIT 1) AS last_message
       FROM job_interest ji
       JOIN job_post jp ON jp.job_id = ji.job_id
       JOIN users u ON u.user_id = jp.requester_user_id
       WHERE ji.worker_id = $1 ORDER BY ji.interest_id DESC`, [workerId]
    );
    return res.json(r.rows.map((x) => ({
      interestId: x.interest_id,
      jobId: x.job_id,
      title: x.title,
      status: x.status,
      requesterName: x.requester_name,
      lastMessage: x.last_message,
    })));
  } catch (err) { return next(err); }
}

// Access to an interest thread: the job's requester OR the interested worker.
async function interestAccess(req, interestId) {
  const r = await pool.query(
    `SELECT ji.interest_id, jp.requester_user_id, w.user_id AS worker_user_id, jp.title
     FROM job_interest ji JOIN job_post jp ON jp.job_id = ji.job_id
     JOIN workers w ON w.worker_id = ji.worker_id
     WHERE ji.interest_id = $1`, [interestId]
  );
  const row = r.rows[0];
  if (!row) return { notFound: true };
  const uid = req.user.user_id;
  return { ok: uid === row.requester_user_id || uid === row.worker_user_id, row };
}

// GET /api/jobs/interests/:interestId/messages   (participant)
async function getInterestMessages(req, res, next) {
  const id = Number(req.params.interestId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const acc = await interestAccess(req, id);
    if (acc.notFound) return res.status(404).json({ error: 'Conversation not found' });
    if (!acc.ok) return res.status(403).json({ error: 'You are not part of this conversation' });
    const r = await pool.query(
      `SELECT m.message_id, m.body, m.created_at, m.sender_user_id, u.name AS sender_name, u.role AS sender_role
       FROM job_message m LEFT JOIN users u ON u.user_id = m.sender_user_id
       WHERE m.interest_id = $1 ORDER BY m.message_id ASC`, [id]
    );
    return res.json(r.rows.map((x) => ({
      message_id: x.message_id, body: x.body, created_at: x.created_at,
      senderName: x.sender_name, senderRole: x.sender_role,
      mine: x.sender_user_id === req.user.user_id,
    })));
  } catch (err) { return next(err); }
}

// POST /api/jobs/interests/:interestId/messages   (participant)
async function postInterestMessage(req, res, next) {
  const id = Number(req.params.interestId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const body = clip((req.body || {}).body);
  if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });
  try {
    const acc = await interestAccess(req, id);
    if (acc.notFound) return res.status(404).json({ error: 'Conversation not found' });
    if (!acc.ok) return res.status(403).json({ error: 'You are not part of this conversation' });
    await pool.query('INSERT INTO job_message (interest_id, sender_user_id, body) VALUES ($1, $2, $3)', [id, req.user.user_id, body]);
    // Notify the other participant.
    const other = req.user.user_id === acc.row.requester_user_id ? acc.row.worker_user_id : acc.row.requester_user_id;
    await createNotification(pool, other, 'job_message', `New message about the job "${acc.row.title}".`, null);
    return res.status(201).json({ ok: true });
  } catch (err) { return next(err); }
}

module.exports = {
  createJob, listMyJobs, closeJob, browseJobs,
  expressInterest, getJobInterests, listMyInterests,
  getInterestMessages, postInterestMessage,
};
