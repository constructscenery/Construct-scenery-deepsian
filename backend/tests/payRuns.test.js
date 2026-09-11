'use strict';
/**
 * Pay Runs controller tests
 * Tests: getAvailableWeeks, getPayRunPreview, createPayRun, getPayRunById, processPayRun, exportCsv
 * Access: MD + Accountant only (Coordinator → 403)
 */

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const router = require('../routes/payRuns');
const app = makeApp(['/api/pay-runs', router]);

const SAMPLE_TIMESHEET = {
  id: 'ts-001', grand_total: 3500, week_ending_date: '2026-06-01',
  first_name: 'John', last_name: 'Smith', crew_number: 'CS001',
  employment_status: 'paye', paye_withholding_rate: 20,
  sort_code: 'enc(12-34-56)', account_number: 'enc(12345678)', account_name: 'enc(J Smith)',
  prod_name: 'Star Wars',
};

beforeEach(() => dbMock.reset());

// ─── GET /api/pay-runs/available-weeks ────────────────────────────────────────
describe('GET /api/pay-runs/available-weeks', () => {
  test('Accountant gets available weeks — 200', async () => {
    dbMock.respond([
      { week_ending_date: '2026-06-01', timesheet_count: 5, pay_run_id: null, pay_run_status: null, processed_at: null },
    ]);
    const res = await request(app)
      .get('/api/pay-runs/available-weeks?production_id=prod-1')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].timesheet_count).toBe(5);
  });

  test('Missing production_id → 400', async () => {
    const res = await request(app)
      .get('/api/pay-runs/available-weeks')
      .set(authHeader('accountant'));
    expect(res.status).toBe(400);
  });

  test('Coordinator can access available-weeks — 200', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/pay-runs/available-weeks?production_id=prod-1')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/pay-runs/preview ────────────────────────────────────────────────
describe('GET /api/pay-runs/preview', () => {
  test('Returns preview with items, totals, and decrypted bank details', async () => {
    dbMock.respond([SAMPLE_TIMESHEET]);

    const res = await request(app)
      .get('/api/pay-runs/preview?production_id=prod-1&week_ending_date=2026-06-01')
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('total_gross');
    expect(res.body).toHaveProperty('total_net');
    expect(res.body.items[0]).toHaveProperty('payment_reference');
    expect(res.body.items[0]).toHaveProperty('withholding_amount');
  });

  test('PAYE withholding correctly calculated', async () => {
    // 20% withholding on £3500 gross = £700 withholding, £2800 net
    dbMock.respond([SAMPLE_TIMESHEET]);
    const res = await request(app)
      .get('/api/pay-runs/preview?production_id=prod-1&week_ending_date=2026-06-01')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(res.body.items[0].withholding_amount).toBeCloseTo(700, 0);
    expect(res.body.items[0].net_amount).toBeCloseTo(2800, 0);
  });

  test('No timesheets found → 404', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/pay-runs/preview?production_id=prod-1&week_ending_date=2026-06-01')
      .set(authHeader('accountant'));
    expect(res.status).toBe(404);
  });

  test('Missing params → 400', async () => {
    const res = await request(app)
      .get('/api/pay-runs/preview?production_id=prod-1')
      .set(authHeader('accountant'));
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/pay-runs ───────────────────────────────────────────────────────
describe('POST /api/pay-runs', () => {
  test('Accountant creates pay run — 201', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });  // BEGIN
    dbMock.respond([]);                           // no existing processed pay run
    dbMock.respond([{                             // verified timesheets
      ...SAMPLE_TIMESHEET, status: 'verified', crew_member_id: 'cm-001',
    }]);
    dbMock.respond([{ id: 'pr-001', production_id: 'prod-1', week_ending_date: '2026-06-01', status: 'draft', created_by: 'user-acc-001' }]); // INSERT pay_run
    dbMock.respond({ rows: [], rowCount: 1 });   // INSERT pay_run_items
    dbMock.respond({ rows: [], rowCount: 0 });   // COMMIT
    dbMock.respond([]);                           // SELECT items for response

    const res = await request(app)
      .post('/api/pay-runs')
      .set(authHeader('accountant'))
      .send({ production_id: 'prod-1', week_ending_date: '2026-06-01' });

    expect(res.status).toBe(201);
    expect(res.body.pay_run.status).toBe('draft');
  });

  test('Coordinator creates pay run — 201', async () => {
    dbMock.respond([{ id: 'pr-002', production_id: 'prod-1', status: 'draft', week_ending_date: '2026-06-01' }]);
    const res = await request(app)
      .post('/api/pay-runs')
      .set(authHeader('coordinator'))
      .send({ production_id: 'prod-1', week_ending_date: '2026-06-01' });
    expect(res.status).toBe(201);
  });
});

// ─── GET /api/pay-runs/:id ────────────────────────────────────────────────────
describe('GET /api/pay-runs/:id', () => {
  test('Returns pay run with pay_run_items', async () => {
    dbMock.respond([{ id: 'pr-001', production_id: 'prod-1', status: 'draft', week_ending_date: '2026-06-01', prod_name: 'Star Wars' }]);
    dbMock.respond([]);  // pay_run_items (empty is fine)

    const res = await request(app)
      .get('/api/pay-runs/pr-001')
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pay_run_items');
    expect(res.body.id).toBe('pr-001');
  });
});

// ─── POST /api/pay-runs/:id/process ──────────────────────────────────────────
describe('POST /api/pay-runs/:id/process', () => {
  test('Accountant processes a draft pay run — 200', async () => {
    // processPayRun uses client (transaction): BEGIN, UPDATE pay_runs, COMMIT
    // recordWeeklyLabour is mocked so no extra queries
    dbMock.respond({ rows: [], rowCount: 0 });  // BEGIN
    dbMock.respond([{ id: 'pr-001', status: 'processed', processed_at: new Date().toISOString(), production_id: 'prod-1', week_ending_date: '2026-06-01' }]); // UPDATE RETURNING
    dbMock.respond({ rows: [], rowCount: 0 });  // COMMIT

    const res = await request(app)
      .post('/api/pay-runs/pr-001/process')
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.body.pay_run.status).toBe('processed');
  });

  test('MD processes a draft pay run — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });  // BEGIN
    dbMock.respond([{ id: 'pr-001', status: 'processed', processed_at: new Date().toISOString(), production_id: 'prod-1', week_ending_date: '2026-06-01' }]); // UPDATE RETURNING
    dbMock.respond({ rows: [], rowCount: 0 });  // COMMIT
    const res = await request(app)
      .post('/api/pay-runs/pr-001/process')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
  });

  test('Coordinator processes a draft pay run — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });  // BEGIN
    dbMock.respond([{ id: 'pr-001', status: 'processed', processed_at: new Date().toISOString(), production_id: 'prod-1', week_ending_date: '2026-06-01' }]); // UPDATE RETURNING
    dbMock.respond({ rows: [], rowCount: 0 });  // COMMIT
    const res = await request(app)
      .post('/api/pay-runs/pr-001/process')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
  });

  test('Already processed → 409', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });  // BEGIN
    dbMock.respond([]);                          // UPDATE returns empty (already processed)
    dbMock.respond({ rows: [], rowCount: 0 });  // ROLLBACK
    const res = await request(app)
      .post('/api/pay-runs/pr-001/process')
      .set(authHeader('accountant'));
    expect(res.status).toBe(409);
  });
});

// ─── GET /api/pay-runs/:id/export-csv ────────────────────────────────────────
describe('GET /api/pay-runs/:id/export-csv', () => {
  test('Returns CSV file — 200', async () => {
    dbMock.respond([{ id: 'pr-001', production_id: 'prod-1', week_ending_date: '2026-06-01', status: 'processed' }]);
    dbMock.respond([SAMPLE_TIMESHEET]);

    const res = await request(app)
      .get('/api/pay-runs/pr-001/export-csv')
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });
});
