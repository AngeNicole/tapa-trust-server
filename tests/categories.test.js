const {
  request, app, authHeader, registerRequester, createAdmin, closePool,
} = require('./helpers');

afterAll(closePool);

let seq = 0;
const catName = () => `Cat ${Date.now()}_${seq++}_${Math.floor(Math.random() * 1e6)}`;

async function makeCategory(adminToken, name = catName(), description = 'desc') {
  const res = await request(app).post('/api/admin/categories').set(authHeader(adminToken)).send({ name, description });
  return res.body; // { category_id, name, description, status }
}

describe('category management', () => {
  test('create returns status active; list includes status', async () => {
    const adminToken = await createAdmin();
    const { token } = await registerRequester();
    const cat = await makeCategory(adminToken);
    expect(cat.status).toBe('active');

    const list = await request(app).get('/api/categories').set(authHeader(token));
    const row = list.body.find((c) => c.category_id === cat.category_id);
    expect(row).toMatchObject({ status: 'active' });
    expect(row).toHaveProperty('name');
    expect(row).toHaveProperty('description');
  });

  test('edit name and description (partial); 404/400/409', async () => {
    const adminToken = await createAdmin();
    const cat = await makeCategory(adminToken);

    const upd = await request(app).patch(`/api/admin/categories/${cat.category_id}`).set(authHeader(adminToken))
      .send({ name: `${cat.name} (edited)`, description: 'new desc' });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ name: `${cat.name} (edited)`, description: 'new desc' });

    // consolidated: name + status in a single PATCH (uses its own category so it
    // doesn't disturb the duplicate-name check below)
    const c2 = await makeCategory(adminToken);
    const combo = await request(app).patch(`/api/admin/categories/${c2.category_id}`).set(authHeader(adminToken))
      .send({ name: `${c2.name} (v2)`, status: 'archived' });
    expect(combo.status).toBe(200);
    expect(combo.body).toMatchObject({ name: `${c2.name} (v2)`, status: 'archived' });
    // invalid status → 400
    expect((await request(app).patch(`/api/admin/categories/${c2.category_id}`).set(authHeader(adminToken)).send({ status: 'nope' })).status).toBe(400);

    expect((await request(app).patch('/api/admin/categories/99999999').set(authHeader(adminToken)).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).patch(`/api/admin/categories/${cat.category_id}`).set(authHeader(adminToken)).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/admin/categories/${cat.category_id}`).set(authHeader(adminToken)).send({ name: '   ' })).status).toBe(400);

    // duplicate name → 409
    const other = await makeCategory(adminToken);
    const dup = await request(app).patch(`/api/admin/categories/${other.category_id}`).set(authHeader(adminToken)).send({ name: `${cat.name} (edited)` });
    expect(dup.status).toBe(409);
  });

  test('archive hides from default list; status tabs (active/archived/all)', async () => {
    const adminToken = await createAdmin();
    const { token } = await registerRequester();
    const cat = await makeCategory(adminToken);

    const arch = await request(app).patch(`/api/admin/categories/${cat.category_id}`).set(authHeader(adminToken)).send({ status: 'archived' });
    expect(arch.status).toBe(200);
    expect(arch.body.status).toBe('archived');

    // default (active) list excludes it
    const active = await request(app).get('/api/categories').set(authHeader(token));
    expect(active.body.map((c) => c.category_id)).not.toContain(cat.category_id);
    // archived tab includes it
    const archived = await request(app).get('/api/categories?status=archived').set(authHeader(token));
    expect(archived.body.map((c) => c.category_id)).toContain(cat.category_id);
    // all tab includes it
    const all = await request(app).get('/api/categories?status=all').set(authHeader(token));
    expect(all.body.map((c) => c.category_id)).toContain(cat.category_id);

    // restore
    const restore = await request(app).patch(`/api/admin/categories/${cat.category_id}`).set(authHeader(adminToken)).send({ status: 'active' });
    expect(restore.body.status).toBe('active');
    const active2 = await request(app).get('/api/categories').set(authHeader(token));
    expect(active2.body.map((c) => c.category_id)).toContain(cat.category_id);
  });

  test('bad status value rejected (400) on set and on list filter', async () => {
    const adminToken = await createAdmin();
    const { token } = await registerRequester();
    const cat = await makeCategory(adminToken);
    expect((await request(app).patch(`/api/admin/categories/${cat.category_id}`).set(authHeader(adminToken)).send({ status: 'nope' })).status).toBe(400);
    expect((await request(app).get('/api/categories?status=nope').set(authHeader(token))).status).toBe(400);
  });

  test('delete removes the category', async () => {
    const adminToken = await createAdmin();
    const { token } = await registerRequester();
    const cat = await makeCategory(adminToken);

    const del = await request(app).delete(`/api/admin/categories/${cat.category_id}`).set(authHeader(adminToken));
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ category_id: cat.category_id, deleted: true });

    const all = await request(app).get('/api/categories?status=all').set(authHeader(token));
    expect(all.body.map((c) => c.category_id)).not.toContain(cat.category_id);
    expect((await request(app).delete(`/api/admin/categories/${cat.category_id}`).set(authHeader(adminToken))).status).toBe(404);
  });

  test('category management is admin-only', async () => {
    const adminToken = await createAdmin();
    const cat = await makeCategory(adminToken);
    const { token } = await registerRequester();
    expect((await request(app).patch(`/api/admin/categories/${cat.category_id}`).set(authHeader(token)).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).patch(`/api/admin/categories/${cat.category_id}`).set(authHeader(token)).send({ status: 'archived' })).status).toBe(403);
    expect((await request(app).delete(`/api/admin/categories/${cat.category_id}`).set(authHeader(token))).status).toBe(403);
  });
});
