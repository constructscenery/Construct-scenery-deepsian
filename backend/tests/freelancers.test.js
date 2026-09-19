const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');
const app = makeApp(['/api/crew', require('../routes/crew')]);
const contactId = '12345678-1234-1234-1234-123456789012';
const contact = { id: contactId, full_name: 'Alex Example', email: 'alex@example.test', phone: 'enc(+44 7700 900123)', notes: 'enc(Available next week)', skills: 'Carpentry', is_favourite: false, call_priority: 'backup' };

beforeEach(() => dbMock.reset());

describe.each(['md', 'accountant', 'coordinator'])('freelancer access: %s', role => {
  test('lists contacts and decrypts personal fields', async () => {
    dbMock.respond([contact]);
    const res = await request(app).get('/api/crew/freelancers').set(authHeader(role));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ phone: '+44 7700 900123', notes: 'Available next week' });
    expect(dbMock.query.mock.calls[0][0]).toContain('FROM freelancer_contacts');
  });

  test('creates a contact with encrypted phone and notes', async () => {
    dbMock.respond([contact]);
    const res = await request(app).post('/api/crew/freelancers').set(authHeader(role)).send({ full_name: 'Alex Example', email: 'alex@example.test', phone: '+44 7700 900123', notes: 'Available next week' });
    expect(res.status).toBe(201);
    expect(dbMock.query.mock.calls[0][1]).toEqual(['Alex Example', 'alex@example.test', 'enc(+44 7700 900123)', 'enc(Available next week)']);
  });

  test('updates call priority without overwriting other fields', async () => {
    dbMock.respond([{ ...contact, call_priority: 'never_call' }]);
    const res = await request(app).patch(`/api/crew/freelancers/${contactId}`).set(authHeader(role)).send({ call_priority: 'never_call' });
    expect(res.status).toBe(200);
    expect(res.body.call_priority).toBe('never_call');
    expect(dbMock.query.mock.calls[0][1]).toEqual(['never_call', contactId]);
  });

  test('deletes a contact', async () => {
    dbMock.respond({ rows: [], rowCount: 1 });
    const res = await request(app).delete(`/api/crew/freelancers/${contactId}`).set(authHeader(role));
    expect(res.status).toBe(204);
  });
});

test.each([
  {}, { full_name: ' ' }, { full_name: 42 }, { full_name: 'Alex', email: 'invalid' },
  { full_name: 'Alex', call_priority: 'unknown' }, { full_name: 'Alex', is_favourite: 'false' },
  { full_name: 'Alex', phone: { value: '123' } }, { full_name: 'Alex', notes: 'x'.repeat(10001) },
])('rejects invalid input without writing to the database: %j', async body => {
  const res = await request(app).post('/api/crew/freelancers').set(authHeader()).send(body);
  expect(res.status).toBe(400);
  expect(dbMock.query).not.toHaveBeenCalled();
});

test('clears phone and notes and saves favourite independently', async () => {
  dbMock.respond([{ ...contact, phone: null, notes: null, is_favourite: true }]);
  const res = await request(app).patch(`/api/crew/freelancers/${contactId}`).set(authHeader()).send({ phone: '', notes: null, is_favourite: true });
  expect(res.status).toBe(200);
  expect(dbMock.query.mock.calls[0][1]).toEqual([null, null, true, contactId]);
});

test.each(['patch', 'delete'])('returns 404 for missing contact on %s', async method => {
  const res = await request(app)[method](`/api/crew/freelancers/${contactId}`).set(authHeader()).send({ call_priority: 'first_call' });
  expect(res.status).toBe(404);
});

test('rejects unauthenticated requests', async () => {
  const res = await request(app).get('/api/crew/freelancers');
  expect(res.status).toBe(401);
});

test('rejects invalid IDs and empty patches', async () => {
  expect((await request(app).patch('/api/crew/freelancers/invalid').set(authHeader()).send({ is_favourite: true })).status).toBe(400);
  expect((await request(app).patch(`/api/crew/freelancers/${contactId}`).set(authHeader()).send({})).status).toBe(400);
  expect(dbMock.query).not.toHaveBeenCalled();
});