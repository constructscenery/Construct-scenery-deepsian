'use strict';
/**
 * Percentometer controller tests
 * Tests: getRatios, calculate, updateRatio (versioned), getActuals
 */

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const router = require('../routes/percentometer');
const app = makeApp(['/api/percentometer', router]);

const SAMPLE_RATIOS = [
  { id: 'r1', cost_type: 'Carpenters',  percentage: 0.42, effective_from: '2026-04-06', effective_to: null },
  { id: 'r2', cost_type: 'Painters',    percentage: 0.18, effective_from: '2026-04-06', effective_to: null },
  { id: 'r3', cost_type: 'Stagehands',  percentage: 0.09, effective_from: '2026-04-06', effective_to: null },
  { id: 'r4', cost_type: 'Riggers',     percentage: 0.06, effective_from: '2026-04-06', effective_to: null },
  { id: 'r5', cost_type: 'Timber',      percentage: 0.09, effective_from: '2026-04-06', effective_to: null },
  { id: 'r6', cost_type: 'Plasterwork', percentage: 0.06, effective_from: '2026-04-06', effective_to: null },
  { id: 'r7', cost_type: 'Misc',        percentage: 0.03, effective_from: '2026-04-06', effective_to: null },
  { id: 'r8', cost_type: 'Sculptors',   percentage: 0.02, effective_from: '2026-04-06', effective_to: null },
  { id: 'r9', cost_type: 'Metalwork',   percentage: 0.02, effective_from: '2026-04-06', effective_to: null },
  { id: 'r10',cost_type: 'Paint',       percentage: 0.02, effective_from: '2026-04-06', effective_to: null },
  { id: 'r11',cost_type: 'Glass',       percentage: 0.01, effective_from: '2026-04-06', effective_to: null },
];

beforeEach(() => dbMock.reset());

// ─── GET /api/percentometer/ratios ────────────────────────────────────────────
describe('GET /api/percentometer/ratios', () => {
  test('Returns current ratios for all roles', async () => {
    dbMock.respond(SAMPLE_RATIOS);
    const res = await request(app)
      .get('/api/percentometer/ratios')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(11);
  });

  test('?current=true filter applied', async () => {
    dbMock.respond(SAMPLE_RATIOS);
    const res = await request(app)
      .get('/api/percentometer/ratios?current=true')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('effective_to IS NULL'), expect.anything()
    );
  });

  test('No auth → 401', async () => {
    const res = await request(app).get('/api/percentometer/ratios');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/percentometer/calculate ───────────────────────────────────────
describe('POST /api/percentometer/calculate', () => {
  test('Calculates full job cost from carpenter input', async () => {
    dbMock.respond(SAMPLE_RATIOS);
    const res = await request(app)
      .post('/api/percentometer/calculate')
      .set(authHeader('md'))
      .send({ known_cost: 42000, known_cost_type: 'Carpenters' });

    expect(res.status).toBe(200);
    expect(res.body.total_estimated_job_cost).toBeCloseTo(100000, 0);  // 42000 / 0.42
    expect(Array.isArray(res.body.breakdown)).toBe(true);
    expect(res.body.breakdown).toHaveLength(11);
  });

  test('Missing known_cost → 400', async () => {
    const res = await request(app)
      .post('/api/percentometer/calculate')
      .set(authHeader('md'))
      .send({});
    expect(res.status).toBe(400);
  });

  test('Unknown cost type → 400', async () => {
    dbMock.respond(SAMPLE_RATIOS);
    const res = await request(app)
      .post('/api/percentometer/calculate')
      .set(authHeader('md'))
      .send({ known_cost: 10000, known_cost_type: 'Unicorns' });
    expect(res.status).toBe(400);
  });

  test('Accountant can calculate — 200', async () => {
    dbMock.respond(SAMPLE_RATIOS);
    const res = await request(app)
      .post('/api/percentometer/calculate')
      .set(authHeader('accountant'))
      .send({ known_cost: 21000, known_cost_type: 'Carpenters' });
    expect(res.status).toBe(200);
  });
});

// ─── PATCH /api/percentometer/ratios/:id ─────────────────────────────────────
describe('PATCH /api/percentometer/ratios/:id', () => {
  test('MD updates ratio — creates new versioned row', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });  // BEGIN
    // existing ratio
    dbMock.respond([SAMPLE_RATIOS[0]]);
    // other active ratios (sum = 0.58 so new 0.42 makes 1.00)
    dbMock.respond(SAMPLE_RATIOS.slice(1).map(r => ({ percentage: r.percentage })));
    // UPDATE old row (expire it)
    dbMock.respond({ rows: [], rowCount: 1 });
    // INSERT new versioned row
    dbMock.respond([{ id: 'r1-new', cost_type: 'Carpenters', percentage: 0.42, effective_from: '2026-06-07' }]);
    dbMock.respond({ rows: [], rowCount: 0 });  // COMMIT

    const res = await request(app)
      .patch('/api/percentometer/ratios/r1')
      .set(authHeader('md'))
      .send({ percentage: 0.42 });

    expect(res.status).toBe(200);
    expect(res.body.cost_type).toBe('Carpenters');
    expect(res.body.percentage).toBe(0.42);
  });

  test('Accountant can also update ratio — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });  // BEGIN
    dbMock.respond([SAMPLE_RATIOS[0]]);
    dbMock.respond(SAMPLE_RATIOS.slice(1).map(r => ({ percentage: r.percentage })));
    dbMock.respond({ rows: [], rowCount: 1 });
    dbMock.respond([{ id: 'r1-new', cost_type: 'Carpenters', percentage: 0.42, effective_from: '2026-06-07' }]);
    dbMock.respond({ rows: [], rowCount: 0 });  // COMMIT

    const res = await request(app)
      .patch('/api/percentometer/ratios/r1')
      .set(authHeader('accountant'))
      .send({ percentage: 0.42 });

    expect(res.status).toBe(200);
  });

  test('Coordinator updates ratio — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });  // BEGIN
    dbMock.respond([SAMPLE_RATIOS[0]]);          // find current ratio
    dbMock.respond(SAMPLE_RATIOS);               // find all other active ratios (for sum check)
    dbMock.respond({ rows: [], rowCount: 1 });  // UPDATE old row (effective_to)
    dbMock.respond([{ ...SAMPLE_RATIOS[0], id: 'r-new', percentage: '0.4200', effective_to: null }]); // INSERT new row
    dbMock.respond({ rows: [], rowCount: 0 });  // COMMIT

    const res = await request(app)
      .patch('/api/percentometer/ratios/r1')
      .set(authHeader('coordinator'))
      .send({ percentage: 0.42 });
    expect(res.status).toBe(200);
  });

  test('Ratios not summing to 100% → 400', async () => {
    dbMock.respond([SAMPLE_RATIOS[0]]);
    // others sum to 0.58, new value 0.50 → total 1.08 ≠ 1.00
    dbMock.respond(SAMPLE_RATIOS.slice(1).map(r => ({ percentage: r.percentage })));

    const res = await request(app)
      .patch('/api/percentometer/ratios/r1')
      .set(authHeader('md'))
      .send({ percentage: 0.50 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('sum');
  });

  test('Invalid percentage value → 400', async () => {
    const res = await request(app)
      .patch('/api/percentometer/ratios/r1')
      .set(authHeader('md'))
      .send({ percentage: 1.5 });  // > 1
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/percentometer/actuals/:productionId ────────────────────────────
describe('GET /api/percentometer/actuals/:productionId', () => {
  test('Returns processing state when job still running', async () => {
    dbMock.respond([{ status: 'processing', cost_type: null }]);
    const res = await request(app)
      .get('/api/percentometer/actuals/prod-1')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processing');
  });

  test('Returns complete comparison when job done', async () => {
    dbMock.respond([
      { status: 'complete', cost_type: 'Carpenters', actual_amount: '42000', actual_percentage: '42', grand_total: '100000' },
      { status: 'complete', cost_type: 'Painters',   actual_amount: '18000', actual_percentage: '18', grand_total: '100000' },
    ]);
    dbMock.respond(SAMPLE_RATIOS);  // current ratios for comparison

    const res = await request(app)
      .get('/api/percentometer/actuals/prod-1')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('complete');
    expect(res.body.grand_total).toBe(100000);
    expect(Array.isArray(res.body.comparison)).toBe(true);
  });

  test('No actuals found → 404', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/percentometer/actuals/prod-unknown')
      .set(authHeader('md'));
    expect(res.status).toBe(404);
  });
});
