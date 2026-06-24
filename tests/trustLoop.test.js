const {
  request, app, authHeader, registerRequester, registerWorker, makeBookingAt, closePool,
} = require('./helpers');

afterAll(closePool);

describe('booking trust loop — happy path', () => {
  test('drives create → accept → checkin → confirm-start → checkout → confirm-completion', async () => {
    const requester = await registerRequester();
    const worker = await registerWorker();
    await request(app).put('/api/workers/me').set(authHeader(worker.token)).send({ skills: 'Plumbing' });

    const task = await request(app).post('/api/tasks').set(authHeader(requester.token))
      .send({ title: 'Fix sink', location: 'Kigali' });
    expect(task.status).toBe(201);
    expect(task.body.status).toBe('open');

    // create booking
    const created = await request(app).post('/api/bookings').set(authHeader(requester.token))
      .send({ task_id: task.body.task_id, worker_id: worker.worker_id });
    expect(created.status).toBe(201);
    const id = created.body.booking_id;
    expect(created.body).toMatchObject({
      status: 'pending', payment: 'pending', checkedIn: false, startConfirmed: false,
      checkedOut: false, endConfirmed: false, review: null,
      taskTitle: 'Fix sink', workerName: worker.user.name, requesterName: requester.user.name,
    });

    // task flips to assigned
    const assigned = await request(app).get(`/api/tasks/${task.body.task_id}`).set(authHeader(requester.token));
    expect(assigned.body.status).toBe('assigned');

    // accept
    const accepted = await request(app).post(`/api/bookings/${id}/accept`).set(authHeader(worker.token));
    expect(accepted.body.status).toBe('accepted');

    // checkin
    const checkedIn = await request(app).post(`/api/bookings/${id}/checkin`).set(authHeader(worker.token));
    expect(checkedIn.body.checkedIn).toBe(true);
    expect(checkedIn.body.status).toBe('accepted'); // not yet in_progress

    // confirm-start
    const started = await request(app).post(`/api/bookings/${id}/confirm-start`).set(authHeader(requester.token));
    expect(started.body).toMatchObject({ status: 'in_progress', startConfirmed: true, payment: 'confirmed' });

    // checkout
    const checkedOut = await request(app).post(`/api/bookings/${id}/checkout`).set(authHeader(worker.token));
    expect(checkedOut.body.checkedOut).toBe(true);

    // confirm-completion
    const completed = await request(app).post(`/api/bookings/${id}/confirm-completion`).set(authHeader(requester.token));
    expect(completed.body).toMatchObject({ status: 'completed', endConfirmed: true, payment: 'released' });

    // task flips to completed
    const doneTask = await request(app).get(`/api/tasks/${task.body.task_id}`).set(authHeader(requester.token));
    expect(doneTask.body.status).toBe('completed');
  });
});

describe('mutuality', () => {
  test('worker checkout alone does NOT complete the booking', async () => {
    const { body } = await makeBookingAt('checkedOut');
    expect(body.checkedOut).toBe(true);
    expect(body.endConfirmed).toBe(false);
    expect(body.status).toBe('in_progress'); // still needs requester confirmation
  });
});

describe('ordering guards (400)', () => {
  test('confirm-start before checkin', async () => {
    const { bookingId, requester } = await makeBookingAt('accepted');
    const res = await request(app).post(`/api/bookings/${bookingId}/confirm-start`).set(authHeader(requester.token));
    expect(res.status).toBe(400);
  });

  test('checkout before confirm-start', async () => {
    const { bookingId, worker } = await makeBookingAt('checkedIn');
    const res = await request(app).post(`/api/bookings/${bookingId}/checkout`).set(authHeader(worker.token));
    expect(res.status).toBe(400);
  });

  test('checkout twice', async () => {
    const { bookingId, worker } = await makeBookingAt('checkedOut');
    const res = await request(app).post(`/api/bookings/${bookingId}/checkout`).set(authHeader(worker.token));
    expect(res.status).toBe(400);
  });

  test('accept a non-pending booking', async () => {
    const { bookingId, worker } = await makeBookingAt('accepted');
    const res = await request(app).post(`/api/bookings/${bookingId}/accept`).set(authHeader(worker.token));
    expect(res.status).toBe(400);
  });
});

describe('authorization (401/403/404)', () => {
  test('requester cannot perform a worker action (role 403)', async () => {
    const { bookingId, requester } = await makeBookingAt('pending');
    const res = await request(app).post(`/api/bookings/${bookingId}/accept`).set(authHeader(requester.token));
    expect(res.status).toBe(403);
  });

  test('worker cannot post a task (role 403)', async () => {
    const worker = await registerWorker();
    const res = await request(app).post('/api/tasks').set(authHeader(worker.token)).send({ title: 'x' });
    expect(res.status).toBe(403);
  });

  test('a different requester cannot confirm someone else\'s booking (ownership 403)', async () => {
    const { bookingId } = await makeBookingAt('checkedIn');
    const intruder = await registerRequester();
    const res = await request(app).post(`/api/bookings/${bookingId}/confirm-start`).set(authHeader(intruder.token));
    expect(res.status).toBe(403);
  });

  test('missing booking returns 404', async () => {
    const worker = await registerWorker();
    const res = await request(app).post('/api/bookings/99999999/accept').set(authHeader(worker.token));
    expect(res.status).toBe(404);
  });

  test('no token returns 401', async () => {
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(401);
  });

  test('cannot book a task you do not own (403)', async () => {
    const owner = await registerRequester();
    const worker = await registerWorker();
    const task = await request(app).post('/api/tasks').set(authHeader(owner.token)).send({ title: 'mine' });
    const intruder = await registerRequester();
    const res = await request(app).post('/api/bookings').set(authHeader(intruder.token))
      .send({ task_id: task.body.task_id, worker_id: worker.worker_id });
    expect(res.status).toBe(403);
  });
});

describe('payment-status access control', () => {
  test('parties can read it, outsiders get 403', async () => {
    const { bookingId, requester, worker } = await makeBookingAt('completed');

    const asRequester = await request(app).get(`/api/bookings/${bookingId}/payment-status`).set(authHeader(requester.token));
    expect(asRequester.status).toBe(200);
    expect(asRequester.body.status).toBe('released');

    const asWorker = await request(app).get(`/api/bookings/${bookingId}/payment-status`).set(authHeader(worker.token));
    expect(asWorker.status).toBe(200);

    const outsider = await registerRequester();
    const asOutsider = await request(app).get(`/api/bookings/${bookingId}/payment-status`).set(authHeader(outsider.token));
    expect(asOutsider.status).toBe(403);
  });
});

describe('reviews', () => {
  test('review a completed booking, nudges worker rating, appears in booking + history', async () => {
    const { bookingId, requester, worker } = await makeBookingAt('completed');

    const review = await request(app).post('/api/reviews').set(authHeader(requester.token))
      .send({ booking_id: bookingId, rating: 5, comment: 'Excellent' });
    expect(review.status).toBe(201);
    expect(review.body.rating).toBe(5);

    // worker rating updated
    const profile = await request(app).get(`/api/workers/${worker.worker_id}`).set(authHeader(requester.token));
    expect(profile.body.rating).toBe(5);
    expect(profile.body.taskHistory.length).toBe(1);
    expect(profile.body.taskHistory[0]).toMatchObject({ status: 'completed', review: { rating: 5, comment: 'Excellent' } });

    // review shows up on the BookingView
    const list = await request(app).get('/api/bookings').set(authHeader(requester.token));
    const bv = list.body.find((b) => b.booking_id === bookingId);
    expect(bv.review).toMatchObject({ rating: 5, comment: 'Excellent' });
  });

  test('cannot review the same booking twice (409)', async () => {
    const { bookingId, requester } = await makeBookingAt('completed');
    await request(app).post('/api/reviews').set(authHeader(requester.token)).send({ booking_id: bookingId, rating: 4 });
    const dup = await request(app).post('/api/reviews').set(authHeader(requester.token)).send({ booking_id: bookingId, rating: 3 });
    expect(dup.status).toBe(409);
  });

  test('cannot review a booking that is not completed (400)', async () => {
    const { bookingId, requester } = await makeBookingAt('in_progress');
    const res = await request(app).post('/api/reviews').set(authHeader(requester.token)).send({ booking_id: bookingId, rating: 5 });
    expect(res.status).toBe(400);
  });

  test('rating out of range is rejected (400)', async () => {
    const { bookingId, requester } = await makeBookingAt('completed');
    const res = await request(app).post('/api/reviews').set(authHeader(requester.token)).send({ booking_id: bookingId, rating: 9 });
    expect(res.status).toBe(400);
  });
});

describe('rebook', () => {
  test('creates a fresh pending booking titled from the worker\'s first skill', async () => {
    const { worker, requester } = await makeBookingAt('completed');
    const res = await request(app).post(`/api/bookings/rebook/${worker.worker_id}`).set(authHeader(requester.token));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.payment).toBe('pending');
    expect(res.body.taskTitle).toBe('Rebooking: Plumbing');
  });
});

describe('booking scoping', () => {
  test('GET /bookings returns only the caller\'s bookings', async () => {
    const { bookingId, requester, worker } = await makeBookingAt('pending');

    const asRequester = await request(app).get('/api/bookings').set(authHeader(requester.token));
    expect(asRequester.body.some((b) => b.booking_id === bookingId)).toBe(true);

    const asWorker = await request(app).get('/api/bookings').set(authHeader(worker.token));
    expect(asWorker.body.some((b) => b.booking_id === bookingId)).toBe(true);

    const outsider = await registerRequester();
    const asOutsider = await request(app).get('/api/bookings').set(authHeader(outsider.token));
    expect(asOutsider.body.some((b) => b.booking_id === bookingId)).toBe(false);
  });
});
