'use strict';
/**
 * Dashboard controller tests
 * Tests: cost-summary, labour-costs, crew-headcount, forecast-variance, weekly-pl
 * All endpoints are MD-only (403 for accountant/coordinator)
 */

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const dashboardRouter = require('../routes/dashboard');
const app = makeApp(['/api/dashboard', dashboardRouter]);

beforeEach(() => dbMock.reset());

// ─── GET /api/dashboard/cost-summary ─────────────────────────────────────────
describe('GET /api/dashboard/cost-summary', () => {
  test('MD gets cost summary — 200 with array', async () => {
    // active productions
    dbMock.respond([
      { id: 'prod-1', name: 'Star Wars', contract_type: 'cost_plus', agreed_price: null },
    ]);
    // costs for prod-1
    dbMock.respond([{ total: '50000' }]);
    // budget lines sum for prod-1 (cost_plus)
    dbMock.respond([{ total_budget: '100000' }]);

    const res = await request(app)
      .get('/api/dashboard/cost-summary')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('production_id', 'prod-1');
    expect(res.body[0]).toHaveProperty('rag_status');
    expect(res.body[0]).toHaveProperty('budget_utilisation_pct');
  });

  test('Accountant gets cost summary — 200', async () => {
    dbMock.respond([{ id: 'p1', name: 'Test', contract_type: 'on_a_price', agreed_price: '100000' }]);
    dbMock.respond([{ total: '50000' }]);
    dbMock.respond([{ total_budget: '100000' }]);
    const res = await request(app)
      .get('/api/dashboard/cost-summary')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
  });

  test('Coordinator gets cost summary — 200', async () => {
    dbMock.respond([{ id: 'p1', name: 'Test', contract_type: 'on_a_price', agreed_price: '100000' }]);
    dbMock.respond([{ total: '50000' }]);
    dbMock.respond([{ total_budget: '100000' }]);
    const res = await request(app)
      .get('/api/dashboard/cost-summary')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
  });

  test('RAG is green when utilisation < 75%', async () => {
    dbMock.respond([{ id: 'p1', name: 'Test', contract_type: 'on_a_price', agreed_price: '100000' }]);
    dbMock.respond([{ total: '50000' }]);         // 50% utilised
    dbMock.respond([{ total_budget: '100000' }]);

    const res = await request(app)
      .get('/api/dashboard/cost-summary')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body[0].rag_status).toBe('green');
    expect(res.body[0].budget_utilisation_pct).toBeCloseTo(50, 0);
  });

  test('RAG is red when utilisation > 90%', async () => {
    dbMock.respond([{ id: 'p1', name: 'Test', contract_type: 'on_a_price', agreed_price: '100000' }]);
    dbMock.respond([{ total: '95000' }]);         // 95% utilised
    dbMock.respond([{ total_budget: '100000' }]);

    const res = await request(app)
      .get('/api/dashboard/cost-summary')
      .set(authHeader('md'));

    expect(res.body[0].rag_status).toBe('red');
  });

  test('No budget set → rag_status = unknown', async () => {
    dbMock.respond([{ id: 'p1', name: 'Test', contract_type: 'on_a_price', agreed_price: null }]);
    dbMock.respond([{ total: '0' }]);
    dbMock.respond([{ total_budget: null }]);

    const res = await request(app)
      .get('/api/dashboard/cost-summary')
      .set(authHeader('md'));

    expect(res.body[0].rag_status).toBe('unknown');
    expect(res.body[0].total_budget).toBeNull();
  });

  test('Empty productions → empty array', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/dashboard/cost-summary')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── GET /api/dashboard/labour-costs ─────────────────────────────────────────
describe('GET /api/dashboard/labour-costs', () => {
  test('MD gets labour costs — 200', async () => {
    dbMock.respond([
      { grand_total: '3500', status: 'verified', prod_name: 'Star Wars' },
      { grand_total: '2000', status: 'sent', prod_name: 'Star Wars' },
    ]);

    const res = await request(app)
      .get('/api/dashboard/labour-costs')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('current_week_ending');
    expect(res.body).toHaveProperty('total_labour_this_week');
    expect(Array.isArray(res.body.breakdown)).toBe(true);
  });

  test('status = pending when not all verified', async () => {
    dbMock.respond([
      { grand_total: '2000', status: 'sent', prod_name: 'Prod A' },
    ]);
    const res = await request(app)
      .get('/api/dashboard/labour-costs')
      .set(authHeader('md'));

    expect(res.body.breakdown[0].status).toBe('pending');
  });

  test('status = approved when all verified', async () => {
    dbMock.respond([
      { grand_total: '3000', status: 'verified', prod_name: 'Prod A' },
    ]);
    const res = await request(app)
      .get('/api/dashboard/labour-costs')
      .set(authHeader('md'));

    expect(res.body.breakdown[0].status).toBe('approved');
  });

  test('Accountant gets labour costs — 200', async () => {
    dbMock.respond([
      { production_id: 'p1', prod_name: 'Test', approved_amount: '5000', pending_amount: '0', rejected_amount: '0' }
    ]);
    const res = await request(app)
      .get('/api/dashboard/labour-costs')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/dashboard/crew-headcount ───────────────────────────────────────
describe('GET /api/dashboard/crew-headcount', () => {
  test('MD gets crew headcount — 200', async () => {
    dbMock.respond([
      { prod_name: 'Star Wars', crew_count: '8' },
      { prod_name: 'Dune',      crew_count: '5' },
    ]);

    const res = await request(app)
      .get('/api/dashboard/crew-headcount')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body.total_active_crew).toBe(13);
    expect(res.body.breakdown).toHaveLength(2);
  });

  test('No timesheets this week → total = 0 with note', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/dashboard/crew-headcount')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body.total_active_crew).toBe(0);
    expect(res.body).toHaveProperty('note');
  });
});

// ─── GET /api/dashboard/forecast-variance ────────────────────────────────────
describe('GET /api/dashboard/forecast-variance', () => {
  test('MD gets forecast variance — 200', async () => {
    dbMock.respond([
      { forecast_id: 'f1', scenario_name: 'Estimate A', forecast_total: '100000', production_id: 'p1', production_name: 'Star Wars' },
    ]);
    dbMock.respond([{ total: '75000' }]);  // actual costs for p1

    const res = await request(app)
      .get('/api/dashboard/forecast-variance')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].variance_amount).toBeCloseTo(-25000, 0);  // under forecast
    expect(res.body[0].variance_pct).toBeCloseTo(-25, 0);
  });

  test('Empty → empty array', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/dashboard/forecast-variance')
      .set(authHeader('md'));
    expect(res.body).toEqual([]);
  });
});

// ─── GET /api/dashboard/weekly-pl ────────────────────────────────────────────
describe('GET /api/dashboard/weekly-pl', () => {
  test('MD gets weekly P&L — 200', async () => {
    // Active Cost Plus productions with a budget
    dbMock.respond([{ id: 'p1', name: 'Dune' }]);
    // margin rate
    dbMock.respond([{ margin_rate: '0.10' }]);
    // cost_report_entries
    dbMock.respond([
      { entry_type: 'labour', week_ending_date: '2026-06-01', date: null, gross_amount: '5000' },
    ]);
    // cost_report_weekly_pl
    dbMock.respond([
      { week_ending_date: '2026-06-01', warrens_salary: '500', luton_uplift: '100', box_rental_uplift: '50' },
    ]);

    const res = await request(app)
      .get('/api/dashboard/weekly-pl')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length) {
      expect(res.body[0]).toHaveProperty('production_name');
      expect(res.body[0]).toHaveProperty('weeks');
    }
  });
});

// ─── GET /api/dashboard/po-spend ─────────────────────────────────────────────
describe('GET /api/dashboard/po-spend', () => {
  test('MD gets PO spend with correct shape', async () => {
    dbMock.respond([{ gross_amount: '2000', production_id: 'p1', prod_name: 'Star Wars' }]); // today
    dbMock.respond([{ gross_amount: '2000', production_id: 'p1', prod_name: 'Star Wars' }]); // week

    const res = await request(app)
      .get('/api/dashboard/po-spend')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_approved_today');
    expect(res.body).toHaveProperty('total_approved_this_week');
    expect(res.body).toHaveProperty('breakdown');
    expect(Array.isArray(res.body.breakdown)).toBe(true);
  });
});
