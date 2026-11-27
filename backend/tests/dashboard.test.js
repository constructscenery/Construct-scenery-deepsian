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
// Without ?week_ending, the first query resolves the latest sent-out timesheet week.
const LATEST_WEEK = { week_ending: '2026-11-08' };

describe('GET /api/dashboard/labour-costs', () => {
  test('MD gets labour costs — 200', async () => {
    dbMock.respond(LATEST_WEEK, [
      { grand_total: '3500', status: 'finalised',   crew_member_id: 'c1', prod_id: 'p1', prod_name: 'Star Wars' },
      { grand_total: '2000', status: 'distributed', crew_member_id: 'c2', prod_id: 'p1', prod_name: 'Star Wars' },
    ]);

    const res = await request(app)
      .get('/api/dashboard/labour-costs')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body.current_week_ending).toBe('2026-11-08');
    expect(res.body.total_labour_this_week).toBe(5500);
    expect(res.body.breakdown[0]).toMatchObject({ production_id: 'p1', crew_count: 2 });
  });

  test('status = pending when not all finalised', async () => {
    dbMock.respond(LATEST_WEEK, [
      { grand_total: '2000', status: 'distributed', crew_member_id: 'c1', prod_id: 'p1', prod_name: 'Prod A' },
    ]);
    const res = await request(app)
      .get('/api/dashboard/labour-costs')
      .set(authHeader('md'));

    expect(res.body.breakdown[0].status).toBe('pending');
  });

  test('status = approved when all finalised', async () => {
    dbMock.respond(LATEST_WEEK, [
      { grand_total: '3000', status: 'finalised', crew_member_id: 'c1', prod_id: 'p1', prod_name: 'Prod A' },
    ]);
    const res = await request(app)
      .get('/api/dashboard/labour-costs')
      .set(authHeader('md'));

    expect(res.body.breakdown[0].status).toBe('approved');
  });

  test('explicit ?week_ending skips the latest-week lookup', async () => {
    dbMock.respond([
      { grand_total: '1000', status: 'finalised', crew_member_id: 'c1', prod_id: 'p1', prod_name: 'Prod A' },
    ]);
    const res = await request(app)
      .get('/api/dashboard/labour-costs?week_ending=2026-10-28')
      .set(authHeader('md'));

    expect(res.body.current_week_ending).toBe('2026-11-01');
    expect(res.body.total_labour_this_week).toBe(1000);
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
    dbMock.respond(
      LATEST_WEEK,
      [{ cnt: 13 }],
      [
        { production_id: 'p1', production: 'Star Wars', headcount: 8 },
        { production_id: 'p2', production: 'Dune',      headcount: 5 },
      ],
    );

    const res = await request(app)
      .get('/api/dashboard/crew-headcount')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body.week_ending).toBe('2026-11-08');
    expect(res.body.total_active_crew).toBe(13);
    expect(res.body.breakdown).toHaveLength(2);
    expect(res.body.breakdown[0]).toEqual({ production_id: 'p1', production_name: 'Star Wars', crew_count: 8 });
  });

  test('No timesheets that week → total = 0', async () => {
    dbMock.respond(LATEST_WEEK, [{ cnt: 0 }], []);
    const res = await request(app)
      .get('/api/dashboard/crew-headcount')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body.total_active_crew).toBe(0);
    expect(res.body.breakdown).toEqual([]);
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

// ─── GET /api/dashboard/production-pl (CS-01) ───────────────────────────────
describe('GET /api/dashboard/production-pl', () => {
  const A = 'prod-a', C = 'prod-c';
  const respondPL = () => {
    dbMock.respond([
      { id: A, name: 'Addlestone', production_code: '129', status: 'active_build', contract_type: 'on_a_price' },
      { id: C, name: 'No Budget', production_code: null, status: 'pre_production', contract_type: 'on_a_price' },
    ]);
    // live labour (grouped)
    dbMock.respond([{ production_id: A, labour_total: '2900', labour_management: '240', labour_booked: '500', labour_unbooked: '2400', draft_count: 2, timesheet_count: 4, crew_count: 4 }]);
    // live POs
    dbMock.respond([{ production_id: A, po_total: '1100', po_management: '100', po_approved: '700', po_count: 3 }]);
    // hire
    dbMock.respond([{ production_id: A, hire_start_date: '2026-11-02', return_date: '2026-11-16', weekly_hire_rate: '100' }]);
    // budget
    dbMock.respond([
      { production_id: A, contract_type: 'on_a_price', budget_revenue: '100000', invoiced_to_date: '4000' },
      { production_id: C, contract_type: 'on_a_price', budget_revenue: null, invoiced_to_date: null },
    ]);
  };

  test('five headings per production, with totals — 200', async () => {
    respondPL();
    const res = await request(app).get('/api/dashboard/production-pl').set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body.vat_basis).toBe('ex_vat');
    const [a, c] = res.body.productions;
    expect(a).toMatchObject({
      production_name: 'Addlestone', budget_revenue: 100000, labour_charged: 2660,
      materials_charged: 1200, materials_po: 1000, materials_hire: 200,
      management_costs: 340, profit_loss: 96140, profit_pct: 96.14, draft_timesheets: 2,
    });
    expect(c).toMatchObject({ budget_revenue: null, profit_loss: null, labour_charged: 0, materials_charged: 0 });
    expect(res.body.totals).toEqual({ budget_revenue: 100000, labour_charged: 2660, materials_charged: 1200, profit_loss: 96140, management_costs: 340, budgeted_count: 1 });
  });

  test('only active, non-deleted productions are listed', async () => {
    dbMock.respond([]);
    const res = await request(app).get('/api/dashboard/production-pl').set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(res.body.productions).toEqual([]);
    const q = dbMock.queries[0];
    expect(q.sql).toContain('deleted_at IS NULL');
    expect(q.params[0]).toEqual(['pre_production', 'active_build', 'strike']);
    expect(dbMock.queries).toHaveLength(1); // no per-production queries when nothing is active
  });

  test.each(['md', 'accountant', 'coordinator'])('%s can read it', async role => {
    dbMock.respond([]);
    const res = await request(app).get('/api/dashboard/production-pl').set(authHeader(role));
    expect(res.status).toBe(200);
  });

  test('cost-summary is unchanged (still gross cost-report based)', async () => {
    dbMock.respond([{ id: 'p1', name: 'X', contract_type: 'on_a_price', agreed_price: '1000' }]);
    dbMock.respond([{ total: '100' }]);
    const res = await request(app).get('/api/dashboard/cost-summary').set(authHeader('md'));
    expect(res.body[0]).toMatchObject({ total_budget: 1000, total_costs_to_date: 100 });
    expect(dbMock.queries[1].sql).toContain('FROM cost_report_entries');
  });
});
