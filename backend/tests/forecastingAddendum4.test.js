'use strict';

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const forecastingRouter = require('../routes/forecasting');
const app = makeApp(['/api/forecasting', forecastingRouter]);

const SAMPLE_BECTU_RATES = [
  { id: 'br-1', trade: 'Carpenters', rank: 'Carpenter', daily_rate: '331.00', weekly_rate: '1655.00', overtime_rate: '59.07', effective_to: null },
  { id: 'br-2', trade: 'Carpenters', rank: 'Supervisor', daily_rate: '473.00', weekly_rate: '2365.00', overtime_rate: '70.00', effective_to: null },
  { id: 'br-3', trade: 'Non-BECTU', rank: 'Construction Manager', daily_rate: '550.00', weekly_rate: '2750.00', overtime_rate: '82.50', effective_to: null },
];

const SAMPLE_COST_FORECAST = {
  id: 'cf-001',
  production_id: 'prod-001',
  title: 'Main Cost Plan',
  start_date: '2026-10-05',
  end_date: '2026-11-15',
  default_view: 'weekly',
  status: 'draft',
  version: 1,
  total_crew_cost: '10000.00',
  total_non_labour_cost: '2500.00',
  grand_total_cost: '12500.00',
  production_name: 'The Office',
};

const SAMPLE_LABOUR_FLOW = {
  id: 'lf-001',
  production_id: 'prod-001',
  title: 'Master Weekly Labour Flow',
  start_date: '2026-10-05',
  end_date: '2026-11-15',
  num_weeks: 6,
  status: 'draft',
  version: 1,
  grand_total_cost: '15000.00',
  production_name: 'The Office',
};

beforeEach(() => dbMock.reset());

// ─── Tool 1: Cost Forecasts ───────────────────────────────────────────────────
describe('Cost Forecasts API (Addendum 4)', () => {
  test('GET /api/forecasting/cost-forecasts — lists forecasts for all roles', async () => {
    dbMock.respond([SAMPLE_COST_FORECAST]);
    const res = await request(app)
      .get('/api/forecasting/cost-forecasts?production_id=prod-001')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].title).toBe('Main Cost Plan');
  });

  test('POST /api/forecasting/cost-forecasts — validates required fields', async () => {
    const res = await request(app)
      .post('/api/forecasting/cost-forecasts')
      .set(authHeader('coordinator'))
      .send({ title: 'Plan A' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('production_id is required');
  });

  test('GET /api/forecasting/cost-forecasts/:id — returns 404 when not found', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/forecasting/cost-forecasts/non-existent')
      .set(authHeader('accountant'));
    expect(res.status).toBe(404);
  });

  test('POST /api/forecasting/cost-forecasts/:id/lock — locks forecast and captures snapshot', async () => {
    dbMock.respond([SAMPLE_COST_FORECAST]); // existing
    dbMock.respond(SAMPLE_BECTU_RATES);     // bectu rates for snapshot
    dbMock.respond([{ ...SAMPLE_COST_FORECAST, status: 'locked' }]); // update returning

    const res = await request(app)
      .post('/api/forecasting/cost-forecasts/cf-001/lock')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('locked');
  });

  test('DELETE /api/forecasting/cost-forecasts/:id — deletes forecast', async () => {
    dbMock.respond([SAMPLE_COST_FORECAST]);
    const res = await request(app)
      .delete('/api/forecasting/cost-forecasts/cf-001')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('cf-001');
  });
});

// ─── Tool 2: Weekly Labour Flows ──────────────────────────────────────────────
describe('Weekly Labour Flows API (Addendum 4)', () => {
  test('GET /api/forecasting/labour-flows — lists labour flows', async () => {
    dbMock.respond([SAMPLE_LABOUR_FLOW]);
    const res = await request(app)
      .get('/api/forecasting/labour-flows?production_id=prod-001')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].title).toBe('Master Weekly Labour Flow');
  });

  test('POST /api/forecasting/labour-flows — validates required fields', async () => {
    const res = await request(app)
      .post('/api/forecasting/labour-flows')
      .set(authHeader('accountant'))
      .send({ production_id: 'prod-001' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('title is required');
  });

  test('GET /api/forecasting/labour-flows/:id — returns 404 when not found', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/forecasting/labour-flows/non-existent')
      .set(authHeader('md'));
    expect(res.status).toBe(404);
  });

  test('POST /api/forecasting/labour-flows/:id/lock — locks flow', async () => {
    dbMock.respond([SAMPLE_LABOUR_FLOW]);
    dbMock.respond(SAMPLE_BECTU_RATES);
    dbMock.respond([{ ...SAMPLE_LABOUR_FLOW, status: 'locked' }]);

    const res = await request(app)
      .post('/api/forecasting/labour-flows/lf-001/lock')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('locked');
  });

  test('GET /api/forecasting/labour-flows/:id/export/csv — exports formatted CSV', async () => {
    dbMock.respond([SAMPLE_LABOUR_FLOW]);
    dbMock.respond([
      { section: 'carpenters', trade: 'Carpenters', rank: 'Carpenter', weekly_rate: '1655.00', headcounts: { '1': 2, '2': 3 } }
    ]);

    const res = await request(app)
      .get('/api/forecasting/labour-flows/lf-001/export/csv')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('The Office - Master Weekly Labour Flow');
    expect(res.text).toContain('DEPARTMENT — CARPENTERS');
    expect(res.text).toContain('Carpenter');
  });

  test('DELETE /api/forecasting/labour-flows/:id — deletes labour flow', async () => {
    dbMock.respond([SAMPLE_LABOUR_FLOW]);
    const res = await request(app)
      .delete('/api/forecasting/labour-flows/lf-001')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('lf-001');
  });
});
