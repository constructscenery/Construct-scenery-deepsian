const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');
const app = makeApp(['/api/crew', require('../routes/crew')]);

const contactId = '12345678-1234-1234-1234-123456789012';
const sampleContact = {
  id: contactId,
  role_type: 'designer',
  full_name: 'Warren Lever',
  email: 'warren@constructscenery.co.uk',
  phone: 'enc(+44 7700 900999)',
  company_or_production: 'Construct Scenery Ltd',
  notes: 'enc(Production Designer on major stages)',
  is_favourite: true,
  call_priority: 'first_call',
};

beforeEach(() => dbMock.reset());

describe.each(['md', 'accountant', 'coordinator'])('crew role contacts access: %s', role => {
  test('lists contacts and decrypts encrypted fields', async () => {
    dbMock.respond([sampleContact]);
    const res = await request(app).get('/api/crew/role-contacts?role_type=designer').set(authHeader(role));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      full_name: 'Warren Lever',
      role_type: 'designer',
      phone: '+44 7700 900999',
      notes: 'Production Designer on major stages',
    });
    expect(dbMock.query.mock.calls[0][0]).toContain('FROM crew_role_contacts');
  });

  test('creates a role contact with encrypted phone and notes', async () => {
    dbMock.respond([sampleContact]);
    const res = await request(app)
      .post('/api/crew/role-contacts')
      .set(authHeader(role))
      .send({
        role_type: 'designer',
        full_name: 'Warren Lever',
        email: 'warren@constructscenery.co.uk',
        phone: '+44 7700 900999',
        company_or_production: 'Construct Scenery Ltd',
        notes: 'Production Designer on major stages',
      });
    expect(res.status).toBe(201);
    expect(dbMock.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['Warren Lever', 'warren@constructscenery.co.uk', 'designer'])
    );
  });

  test('updates call priority and favourite on role contact', async () => {
    dbMock.respond([{ ...sampleContact, call_priority: 'backup' }]);
    const res = await request(app)
      .patch(`/api/crew/role-contacts/${contactId}`)
      .set(authHeader(role))
      .send({ call_priority: 'backup' });
    expect(res.status).toBe(200);
    expect(res.body.call_priority).toBe('backup');
  });

  test('deletes a role contact', async () => {
    dbMock.respond([sampleContact], { rows: [], rowCount: 1 });
    const res = await request(app)
      .delete(`/api/crew/role-contacts/${contactId}`)
      .set(authHeader(role));
    expect(res.status).toBe(204);
  });
});

test('rejects creating contact without required role_type or name', async () => {
  const res = await request(app)
    .post('/api/crew/role-contacts')
    .set(authHeader('coordinator'))
    .send({ full_name: 'Missing Role' });
  expect(res.status).toBe(400);
});

test('returns 404 for missing role contact on delete', async () => {
  dbMock.respond({ rows: [], rowCount: 0 });
  const res = await request(app)
    .delete(`/api/crew/role-contacts/${contactId}`)
    .set(authHeader('md'));
  expect(res.status).toBe(404);
});
