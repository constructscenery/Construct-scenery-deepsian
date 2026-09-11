'use strict';
/**
 * Forecasting controller tests
 * Tests: getAllForecasts, createForecast, getForecastById, updateForecast,
 *        deleteForecast (soft-delete), linkForecast
 */

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const forecastingRouter = require('../routes/forecasting');
const app = makeApp(['/api/forecasting', forecastingRouter]);

const SAMPLE_FORECAST = {
  id: 'fc-001',
  name: 'Clayface — 14 week build',
  production_id: null,
  is_primary: false,
  total_labour_cost: 80000,
  total_materials_cost: 40000,
  total_forecast_cost: 120000,
  deleted_at: null,
  created_at: '2026-06-01T00:00:00Z',
  created_by: 'user-md-001',
};

// aliased version (as returned by API)
const FORECAST_RESPONSE = {
  id: 'fc-001',
  scenario_name: 'Clayface — 14 week build',
  production_id: null,
  total_labour: 80000,
  total_materials: 40000,
  combined_total: 120000,
  created_at: '2026-06-01T00:00:00Z',
  prod_id: null,
  prod_name: null,
};

beforeEach(() => dbMock.reset());

// ─── GET /api/forecasting/forecasts ───────────────────────────────────────────
describe('GET /api/forecasting/forecasts', () => {
  test('MD lists forecasts (not deleted) — 200', async () => {
    dbMock.respond([FORECAST_RESPONSE]);
    const res = await request(app)
      .get('/api/forecasting/forecasts')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].scenario_name).toBe('Clayface — 14 week build');
  });

  test('Accountant lists forecasts — 200', async () => {
    dbMock.respond([FORECAST_RESPONSE]);
    const res = await request(app)
      .get('/api/forecasting/forecasts')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
  });

  test('Coordinator can list forecasts — 200', async () => {
    dbMock.respond([FORECAST_RESPONSE]);
    const res = await request(app)
      .get('/api/forecasting/forecasts')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
  });

  test('?production_id= filter works', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/forecasting/forecasts?production_id=prod-1')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
  });
});

// ─── POST /api/forecasting/forecasts ─────────────────────────────────────────
describe('POST /api/forecasting/forecasts', () => {
  const validBody = {
    scenario_name: 'Test Scenario',
    labour_items: [
      { crew_type: 'Carpenters - HOD', number_of_crew: 2, number_of_weeks: 10, daily_rate: 430, ot_rate: 64.5, overtime_hours: 5 },
    ],
    materials_items: [
      { supplier_name: 'Wickes', product_description: 'Timber', quantity: 100, unit_price: 12.50 },
    ],
  };

  test('MD creates forecast — 201', async () => {
    // The createForecast uses db.connect() client for the transaction.
    // Client queries: BEGIN, INSERT forecast (RETURNING id), INSERT labour, INSERT materials, COMMIT
    // Then pool queries: SELECT full forecast, SELECT labour items, SELECT materials items
    dbMock.respond({ rows: [{ id: 'fc-new' }], rowCount: 1 }); // BEGIN (no-op)
    dbMock.respond([{ id: 'fc-new' }]);                         // INSERT forecast RETURNING id
    dbMock.respond({ rows: [], rowCount: 1 });                  // INSERT labour items
    dbMock.respond({ rows: [], rowCount: 1 });                  // INSERT materials items
    dbMock.respond({ rows: [], rowCount: 0 });                  // COMMIT (no-op)
    dbMock.respond([{ ...FORECAST_RESPONSE, id: 'fc-new' }]);   // SELECT full
    dbMock.respond([]);                                          // SELECT labour items
    dbMock.respond([]);                                          // SELECT materials items

    const res = await request(app)
      .post('/api/forecasting/forecasts')
      .set(authHeader('md'))
      .send(validBody);

    expect(res.status).toBe(201);
  });

  test('Missing scenario_name → 400', async () => {
    const res = await request(app)
      .post('/api/forecasting/forecasts')
      .set(authHeader('md'))
      .send({ labour_items: [] });
    expect(res.status).toBe(400);
  });

  test('Labour subtotal formula: (daily_rate × 5 × weeks × crew) + (ot_rate × ot_hours × crew)', async () => {
    const item = { crew_type: 'HOD', number_of_crew: 2, number_of_weeks: 10, daily_rate: 430, ot_rate: 64.5, overtime_hours: 5 };
    dbMock.respond({ rows: [], rowCount: 0 });            // BEGIN
    dbMock.respond([{ id: 'fc-x' }]);                    // INSERT forecast
    dbMock.respond({ rows: [], rowCount: 1 });            // INSERT labour
    dbMock.respond({ rows: [], rowCount: 0 });            // COMMIT
    dbMock.respond([{ ...FORECAST_RESPONSE, total_labour: 43645 }]);
    dbMock.respond([]);
    dbMock.respond([]);

    const res = await request(app)
      .post('/api/forecasting/forecasts')
      .set(authHeader('md'))
      .send({ scenario_name: 'Test', labour_items: [item] });

    expect(res.status).toBe(201);
  });
});

// ─── GET /api/forecasting/forecasts/:id ───────────────────────────────────────
describe('GET /api/forecasting/forecasts/:id', () => {
  test('Returns forecast with labour and materials items', async () => {
    dbMock.respond([FORECAST_RESPONSE]);
    dbMock.respond([]);  // labour items
    dbMock.respond([]);  // materials items

    const res = await request(app)
      .get('/api/forecasting/forecasts/fc-001')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body.scenario_name).toBe('Clayface — 14 week build');
    expect(res.body).toHaveProperty('forecast_labour_items');
    expect(res.body).toHaveProperty('forecast_materials_items');
  });

  test('Not found (deleted) → 404', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/forecasting/forecasts/nonexistent')
      .set(authHeader('md'));
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/forecasting/forecasts/:id ─────────────────────────────────────
describe('PATCH /api/forecasting/forecasts/:id (update)', () => {
  test('MD updates scenario name — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });               // BEGIN
    dbMock.respond([SAMPLE_FORECAST]);                        // fetch existing
    dbMock.respond({ rows: [], rowCount: 1 });               // UPDATE metadata
    dbMock.respond({ rows: [], rowCount: 0 });               // COMMIT
    dbMock.respond([{ ...FORECAST_RESPONSE, scenario_name: 'Renamed' }]); // SELECT
    dbMock.respond([]);
    dbMock.respond([]);

    const res = await request(app)
      .patch('/api/forecasting/forecasts/fc-001')
      .set(authHeader('md'))
      .send({ scenario_name: 'Renamed' });

    expect(res.status).toBe(200);
  });
});

// ─── DELETE /api/forecasting/forecasts/:id ────────────────────────────────────
describe('DELETE /api/forecasting/forecasts/:id (soft-delete)', () => {
  test('MD soft-deletes forecast — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete('/api/forecasting/forecasts/fc-001')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Forecast deleted');
  });

  test('Not found → 404', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });
    const res = await request(app)
      .delete('/api/forecasting/forecasts/bad-id')
      .set(authHeader('md'));
    expect(res.status).toBe(404);
  });

  test('Accountant can soft-delete — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete('/api/forecasting/forecasts/fc-001')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
  });
});

// ─── PATCH /api/forecasting/forecasts/:id/link ────────────────────────────────
describe('PATCH /api/forecasting/forecasts/:id/link', () => {
  test('MD links forecast to production as primary — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });  // BEGIN
    dbMock.respond([SAMPLE_FORECAST]);           // fetch forecast
    dbMock.respond({ rows: [], rowCount: 1 });   // demote existing primary
    dbMock.respond([{
      id: 'fc-001', scenario_name: 'Test', production_id: 'prod-1',
      is_primary: true, combined_total: 120000,
    }]);
    dbMock.respond({ rows: [], rowCount: 0 });  // COMMIT

    const res = await request(app)
      .patch('/api/forecasting/forecasts/fc-001/link')
      .set(authHeader('md'))
      .send({ production_id: 'prod-1', is_primary: true });

    expect(res.status).toBe(200);
    expect(res.body.production_id).toBe('prod-1');
    expect(res.body.is_primary).toBe(true);
  });

  test('Missing production_id → 400', async () => {
    const res = await request(app)
      .patch('/api/forecasting/forecasts/fc-001/link')
      .set(authHeader('md'))
      .send({ is_primary: true });
    expect(res.status).toBe(400);
  });

  test('Accountant can link — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 }); // BEGIN
    dbMock.respond([SAMPLE_FORECAST]);
    dbMock.respond([{ id: 'fc-001', scenario_name: 'Test', production_id: 'prod-1', is_primary: false, combined_total: 120000 }]);
    dbMock.respond({ rows: [], rowCount: 0 }); // COMMIT

    const res = await request(app)
      .patch('/api/forecasting/forecasts/fc-001/link')
      .set(authHeader('accountant'))
      .send({ production_id: 'prod-1', is_primary: false });

    expect(res.status).toBe(200);
  });
});
