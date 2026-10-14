const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');
const app = makeApp(['/api/containers', require('../routes/containers')]);

const containerId = '12345678-1234-1234-1234-123456789012';
const sampleContainer = {
  id: containerId,
  container_number: 'CONT-001',
  container_type: '20ft Storage Container',
  size: '20ft',
  status: 'available',
  ownership_status: 'owned',
  location: 'Construct Scenery Main Yard',
  assigned_production_id: null,
  condition: 'good',
  contents_description: 'Scenic timber offcuts and plywood',
  notes: 'Master lock key in office',
  is_archived: false,
};

beforeEach(() => dbMock.reset());

describe.each(['md', 'accountant', 'coordinator'])('containers access: %s', role => {
  test('lists containers', async () => {
    dbMock.respond([sampleContainer]);
    const res = await request(app).get('/api/containers').set(authHeader(role));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      container_number: 'CONT-001',
      status: 'available',
    });
    expect(dbMock.query.mock.calls[0][0]).toContain('FROM containers');
  });

  test('gets single container by ID', async () => {
    dbMock.respond([sampleContainer]);
    const res = await request(app).get(`/api/containers/${containerId}`).set(authHeader(role));
    expect(res.status).toBe(200);
    expect(res.body.container_number).toBe('CONT-001');
  });

  test('creates a container', async () => {
    dbMock.respond([sampleContainer]);
    const res = await request(app)
      .post('/api/containers')
      .set(authHeader(role))
      .send({
        container_number: 'CONT-001',
        container_type: '20ft Storage Container',
        size: '20ft',
        status: 'available',
        ownership_status: 'owned',
      });
    expect(res.status).toBe(201);
    expect(res.body.container_number).toBe('CONT-001');
  });

  test('updates a container', async () => {
    dbMock.respond([{ ...sampleContainer, location: 'Stage 4' }]);
    const res = await request(app)
      .patch(`/api/containers/${containerId}`)
      .set(authHeader(role))
      .send({ location: 'Stage 4' });
    expect(res.status).toBe(200);
    expect(res.body.location).toBe('Stage 4');
  });

  test('archives a container on delete', async () => {
    dbMock.respond([{ ...sampleContainer, is_archived: true }]);
    const res = await request(app)
      .delete(`/api/containers/${containerId}`)
      .set(authHeader(role));
    expect(res.status).toBe(204);
  });

  test('restores an archived container', async () => {
    dbMock.respond([{ ...sampleContainer, is_archived: false }]);
    const res = await request(app)
      .patch(`/api/containers/${containerId}/restore`)
      .set(authHeader(role));
    expect(res.status).toBe(200);
    expect(res.body.is_archived).toBe(false);
  });
});

test('guest can view containers but cannot create', async () => {
  dbMock.respond([sampleContainer]);
  const getRes = await request(app).get('/api/containers').set(authHeader('guest'));
  expect(getRes.status).toBe(200);

  const postRes = await request(app).post('/api/containers').set(authHeader('guest')).send({ container_number: 'C2' });
  expect(postRes.status).toBe(403);
});

test('validates container_number on creation', async () => {
  const res = await request(app)
    .post('/api/containers')
    .set(authHeader('coordinator'))
    .send({ container_number: '' });
  expect(res.status).toBe(400);
  expect(res.body.error).toContain('Container number is required');
});
