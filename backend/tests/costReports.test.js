'use strict';
/**
 * Cost Reports controller tests
 * Tests: getCostReport, getType1Report, getType2Report, getSnapshot,
 *        addInvoice, deleteInvoice, omitEntry, unomitEntry, updatePoBilling,
 *        updateMarginsReference, upsertWeeklyPL, exportCostReportCSV
 */

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const costReportRouter = require('../routes/costReports');
const app = makeApp(['/api/cost-reports', costReportRouter]);

const PROD = { id: 'prod-1', name: 'Star Wars', contract_type: 'on_a_price', status: 'active_build', target_profit_pct: 10 };
const COST_PLUS_PROD = { id: 'prod-2', name: 'Dune', contract_type: 'cost_plus', status: 'active_build', target_profit_pct: 10 };

beforeEach(() => dbMock.reset());

// ─── GET /api/cost-reports/:productionId ──────────────────────────────────────
describe('GET /api/cost-reports/:productionId', () => {
  test('Accountant gets cost report — 200', async () => {
    dbMock.respond([PROD]);
    dbMock.respond([{ total_supplier: '50000', total_labour: '30000', total_costs: '80000', last_updated: null }]);
    dbMock.respond([{ total_invoiced: '100000' }]);
    dbMock.respond([]);   // supplier entries
    dbMock.respond([]);   // labour entries
    dbMock.respond([]);   // invoices

    const res = await request(app)
      .get('/api/cost-reports/prod-1')
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('production');
    expect(res.body).toHaveProperty('metrics');
  });

  test('as_at_date query returns snapshot', async () => {
    dbMock.respond([PROD]);
    dbMock.respond([{ total_supplier: '20000', total_labour: '10000', total_costs: '30000' }]); // snapshot
    dbMock.respond([]);  // supplier
    dbMock.respond([]);  // labour
    dbMock.respond([]);  // invoices

    const res = await request(app)
      .get('/api/cost-reports/prod-1?as_at_date=2026-01-01')
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.body.as_at_date).toBe('2026-01-01');
  });

  test('Unknown production → 404', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/cost-reports/nonexistent')
      .set(authHeader('accountant'));
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/cost-reports/:productionId/type1 ────────────────────────────────
describe('GET /api/cost-reports/:productionId/type1', () => {
  test('Returns Type 1 report for on_a_price production', async () => {
    dbMock.respond([PROD]);
    dbMock.respond([]);  // supplier entries
    dbMock.respond([]);  // labour entries
    dbMock.respond([{ total_supplier: '50000', total_labour: '30000', total_costs: '80000', last_updated: null }]);
    dbMock.respond([{ total_invoiced: '100000' }]);
    dbMock.respond([]);  // invoices

    const res = await request(app)
      .get('/api/cost-reports/prod-1/type1')
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('lead_summary');
    expect(res.body).toHaveProperty('supplier_costs');
    expect(res.body).toHaveProperty('labour_summary');
  });

  test('Returns 400 for cost_plus production (wrong type)', async () => {
    dbMock.respond([COST_PLUS_PROD]);
    const res = await request(app)
      .get('/api/cost-reports/prod-2/type1')
      .set(authHeader('accountant'));
    expect(res.status).toBe(400);
    expect(res.body.redirect_to).toBe('type2');
  });
});

// ─── GET /api/cost-reports/:productionId/type2 ────────────────────────────────
describe('GET /api/cost-reports/:productionId/type2', () => {
  test('Returns Type 2 report for cost_plus production', async () => {
    dbMock.respond([COST_PLUS_PROD]);
    dbMock.respond([{ id: 'b1', margin_rate: '0.10', contracted_weeks: 10 }]);  // budget
    dbMock.respond([]);   // budget lines
    dbMock.respond([]);   // supplier entries
    dbMock.respond([]);   // labour entries
    dbMock.respond([]);   // po_billing
    dbMock.respond([]);   // omitted entries
    dbMock.respond([{ production_id: 'prod-2', items: [], notes: null }]);  // margins_reference
    dbMock.respond([]);   // weekly_pl
    dbMock.respond([]);   // invoices

    const res = await request(app)
      .get('/api/cost-reports/prod-2/type2')
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('main_cost_report');
    expect(res.body).toHaveProperty('pos_and_billing');
    expect(res.body).toHaveProperty('labour_to_send');
    expect(res.body).toHaveProperty('materials_to_send');
    expect(res.body).toHaveProperty('weekly_pl');
    expect(res.body).toHaveProperty('margins_reference');
  });

  test('Returns 400 for on_a_price production', async () => {
    dbMock.respond([PROD]);
    const res = await request(app)
      .get('/api/cost-reports/prod-1/type2')
      .set(authHeader('accountant'));
    expect(res.status).toBe(400);
    expect(res.body.redirect_to).toBe('type1');
  });
});

// ─── GET /api/cost-reports/:productionId/snapshot ─────────────────────────────
describe('GET /api/cost-reports/:productionId/snapshot', () => {
  test('Returns snapshot for given as_at_date', async () => {
    dbMock.respond([{ total_supplier: '40000', total_labour: '20000', total_costs: '60000' }]);

    const res = await request(app)
      .get('/api/cost-reports/prod-1/snapshot?as_at_date=2026-03-01')
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.body.as_at_date).toBe('2026-03-01');
    expect(res.body.total_costs_to_date).toBe(60000);
  });

  test('Missing as_at_date → 400', async () => {
    const res = await request(app)
      .get('/api/cost-reports/prod-1/snapshot')
      .set(authHeader('accountant'));
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/cost-reports/:productionId/invoices ────────────────────────────
describe('POST /api/cost-reports/:productionId/invoices', () => {
  test('Accountant adds invoice — 201', async () => {
    dbMock.respond([{ id: 'inv-1', production_id: 'prod-1', amount: 5000, date: '2026-06-01' }]);

    const res = await request(app)
      .post('/api/cost-reports/prod-1/invoices')
      .set(authHeader('accountant'))
      .send({ amount: 5000, invoice_description: 'Test invoice' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  test('Missing amount → 400', async () => {
    const res = await request(app)
      .post('/api/cost-reports/prod-1/invoices')
      .set(authHeader('accountant'))
      .send({ invoice_description: 'No amount' });
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/cost-reports/:productionId/invoices/:invoiceId ──────────────
describe('DELETE /api/cost-reports/:productionId/invoices/:invoiceId', () => {
  test('Deletes invoice — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete('/api/cost-reports/prod-1/invoices/inv-1')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
  });

  test('Invoice not found → 404', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });
    const res = await request(app)
      .delete('/api/cost-reports/prod-1/invoices/bad-id')
      .set(authHeader('accountant'));
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/cost-reports/:productionId/omit-entry ─────────────────────────
describe('POST /api/cost-reports/:productionId/omit-entry', () => {
  test('Accountant omits an entry — 201', async () => {
    dbMock.respond([{ id: 'oe-1', entry_id: 'e1', week_ending_date: '2026-06-01' }]);
    const res = await request(app)
      .post('/api/cost-reports/prod-1/omit-entry')
      .set(authHeader('accountant'))
      .send({ entry_id: 'e1', week_ending_date: '2026-06-01' });
    expect(res.status).toBe(201);
  });

  test('Missing entry_id → 400', async () => {
    const res = await request(app)
      .post('/api/cost-reports/prod-1/omit-entry')
      .set(authHeader('accountant'))
      .send({ week_ending_date: '2026-06-01' });
    expect(res.status).toBe(400);
  });
});

// ─── PATCH /api/cost-reports/:productionId/po-billing/:sourceId ──────────────
describe('PATCH /api/cost-reports/:productionId/po-billing/:sourceId', () => {
  test('Accountant updates PO billing — 200', async () => {
    dbMock.respond([{ id: 'pb-1', cs_invoice_number: 'INV-001', amount_invoiced: 5000 }]);
    const res = await request(app)
      .patch('/api/cost-reports/prod-1/po-billing/source-1')
      .set(authHeader('accountant'))
      .send({ cs_invoice_number: 'INV-001', amount_invoiced: 5000 });
    expect(res.status).toBe(200);
  });
});

// ─── PUT /api/cost-reports/:productionId/margins-reference ───────────────────
describe('PUT /api/cost-reports/:productionId/margins-reference', () => {
  test('MD can update margins reference — 200', async () => {
    dbMock.respond([{ production_id: 'prod-2', items: ['10% on labour'], notes: null }]);
    const res = await request(app)
      .put('/api/cost-reports/prod-2/margins-reference')
      .set(authHeader('md'))
      .send({ items: ['10% on labour'], notes: 'Covers overheads' });
    expect(res.status).toBe(200);
  });

  test('Accountant updates margins-reference — 200', async () => {
    dbMock.respond([{ production_id: 'prod-2', items: [] }]);
    const res = await request(app)
      .put('/api/cost-reports/prod-2/margins-reference')
      .set(authHeader('accountant'))
      .send({ items: [] });
    expect(res.status).toBe(200);
  });
});

// ─── PUT /api/cost-reports/:productionId/weekly-pl/:weekEndingDate ────────────
describe('PUT /api/cost-reports/:productionId/weekly-pl/:weekEndingDate', () => {
  test('Accountant upserts weekly P&L — 200', async () => {
    dbMock.respond([{
      id: 'wpl-1', production_id: 'prod-2', week_ending_date: '2026-06-01',
      warrens_salary: 1200, luton_uplift: 150, box_rental_uplift: 75,
    }]);
    const res = await request(app)
      .put('/api/cost-reports/prod-2/weekly-pl/2026-06-01')
      .set(authHeader('accountant'))
      .send({ warrens_salary: 1200, luton_uplift: 150, box_rental_uplift: 75 });
    expect(res.status).toBe(200);
    expect(res.body.warrens_salary).toBe(1200);
  });
});

// ─── GET /api/cost-reports/:productionId/export/csv ──────────────────────────
describe('GET /api/cost-reports/:productionId/export/csv', () => {
  test('Accountant exports CSV — 200 with content-type text/csv', async () => {
    dbMock.respond([PROD]);
    dbMock.respond([]);  // supplier entries

    const res = await request(app)
      .get('/api/cost-reports/prod-1/export/csv?cost_type=supplier')
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });
});
