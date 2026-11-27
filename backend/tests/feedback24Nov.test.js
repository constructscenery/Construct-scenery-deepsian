'use strict';
/**
 * Ben's feedback of 24 Nov 2026 — FB-01 … FB-08 (see FEEDBACK_24NOV_IMPLEMENTATION_PLAN.md).
 * Unit tests for the pure calculators + HTTP-contract tests with the mocked DB.
 * Real-SQL behaviour (Xero + manual invoices, ex VAT, verify override, cost forecasts) is covered by
 * the Postgres end-to-end run described in the plan (§6).
 */
const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const percentometer = require('../services/percentometerCalc');
const CFC = require('../services/costForecastCalc');
const { sumPL } = require('../services/liveCostService');

const app = makeApp(
  ['/api/productions', require('../routes/productions')],
  ['/api/settings', require('../routes/settings')],
  ['/api/timesheets', require('../routes/timesheets')],
  ['/api/forecasting', require('../routes/forecasting')],
);

beforeEach(() => dbMock.reset());

// ─── FB-07 — Percentometer = Ben's spreadsheet (golden master) ───────────────
// Cached values from "Percentometer FINAL .xlsx" (Excel's own results, read with openpyxl data_only).
const EXCEL = {
  carpenters_cost: 170050,
  total: 539841.2698412698,
  lines: {
    Carpenters: 170050, Painters: 72878.57142857143, Stagehands: 36439.28571428572, Riggers: 24292.85714285714,
    Sculptors: 8097.619047619047, Plasterwork: 24292.85714285714, Glass: 4048.8095238095234, Metalwork: 8097.619047619047,
    Paint: 8097.619047619047, Timber: 36439.28571428572, Misc: 12146.42857142857,
    'Above-the-line fixed costs': 134960.31746031746,
  },
};
const BEN_CREW = [
  { grade: 'Supervisor', weekly_rate: 2365, headcount: 1, weeks: 6 },
  { grade: 'Chargehand', weekly_rate: 391 * 5, headcount: 3, weeks: 4 },
  { grade: 'Carpenter', weekly_rate: 1655, headcount: 10, weeks: 8 },
];

describe('FB-07 percentometerCalc', () => {
  const ratios = percentometer.DEFAULT_RATIOS;

  test('crew builder reproduces the spreadsheet carpenters cost', () => {
    expect(percentometer.carpenterCostFromCrew(BEN_CREW).total).toBe(EXCEL.carpenters_cost);
  });

  test('every line matches Excel to the penny at 25% ATL', () => {
    const r = percentometer.calculate({ knownCost: 170050, ratios, atlPct: 25 });
    expect(r.total_estimated_job_cost).toBeCloseTo(EXCEL.total, 2);
    for (const line of r.breakdown) {
      expect(EXCEL.lines[line.cost_type]).toBeDefined();
      expect(Math.abs(line.estimated_value - EXCEL.lines[line.cost_type])).toBeLessThanOrEqual(0.005);
    }
    expect(r.breakdown).toHaveLength(12);
    const sum = r.breakdown.reduce((s, l) => s + l.estimated_value, 0);
    expect(Math.abs(sum - r.total_estimated_job_cost)).toBeLessThan(0.05);  // pennies of rounding only
    expect(r.breakdown.find(l => l.cost_type === 'Carpenters').percentage).toBe(31.5);
  });

  test('ATL 0 reproduces the old ratio-only maths and adds no ATL line', () => {
    const r = percentometer.calculate({ knownCost: 42000, ratios, atlPct: 0 });
    expect(r.total_estimated_job_cost).toBe(100000);
    expect(r.breakdown.some(l => l.is_atl)).toBe(false);
  });

  test.each([[-1], [100], ['abc'], [null]])('rejects ATL %p', atl => {
    expect(percentometer.calculate({ knownCost: 1000, ratios, atlPct: atl }).error).toMatch(/atl_pct/);
  });

  test('rejects bad cost, unknown cost type and bad crew rows', () => {
    expect(percentometer.calculate({ knownCost: 0, ratios, atlPct: 25 }).error).toMatch(/known_cost/);
    expect(percentometer.calculate({ knownCost: 10, knownCostType: 'Nope', ratios, atlPct: 25 }).error).toMatch(/Unknown/);
    expect(percentometer.carpenterCostFromCrew([]).error).toBeDefined();
    expect(percentometer.carpenterCostFromCrew([{ weekly_rate: -1, headcount: 1, weeks: 1 }]).error).toBeDefined();
    expect(percentometer.carpenterCostFromCrew(Array(51).fill(BEN_CREW[0])).error).toMatch(/50/);
  });
});

describe('FB-07 Percentometer API', () => {
  test('POST /percentometer/calculate with crew uses active ratios + saved ATL', async () => {
    dbMock.respond([], [{ value: 25 }]);            // no stored ratios → defaults; ATL setting
    const res = await request(app).post('/api/forecasting/percentometer/calculate')
      .set(authHeader('coordinator')).send({ crew: BEN_CREW });
    expect(res.status).toBe(200);
    expect(res.body.known_cost).toBe(170050);
    expect(res.body.total_estimated_job_cost).toBeCloseTo(539841.27, 2);
    expect(res.body.crew).toHaveLength(3);
    expect(dbMock.queries[0].sql).toMatch(/effective_to IS NULL/);   // F-A: history excluded
  });

  test('ATL override in the body wins over the setting; bad body → 400', async () => {
    dbMock.respond([]);
    let res = await request(app).post('/api/forecasting/percentometer/calculate')
      .set(authHeader('md')).send({ known_cost: 42000, atl_pct: 0 });
    expect(res.body.total_estimated_job_cost).toBe(100000);
    res = await request(app).post('/api/forecasting/percentometer/calculate').set(authHeader('md')).send({});
    expect(res.status).toBe(400);
    res = await request(app).post('/api/forecasting/percentometer/calculate').set(authHeader('md')).send({ crew: [{ weekly_rate: 'x' }] });
    expect(res.status).toBe(400);
  });

  test('GET /percentometer/settings', async () => {
    dbMock.respond([{ value: 30 }]);
    const res = await request(app).get('/api/forecasting/percentometer/settings').set(authHeader('guest'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ atl_pct: 30, default_atl_pct: 25 });
  });

  test.each([[100], [-1], ['25'], [null]])('PATCH settings percentometer_atl_pct %p → 400', async v => {
    const res = await request(app).patch('/api/settings/percentometer_atl_pct').set(authHeader('md')).send({ value: v });
    expect(res.status).toBe(400);
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  test('PATCH settings percentometer_atl_pct 20 saves and audits', async () => {
    dbMock.respond([{ key: 'percentometer_atl_pct', value: 20 }]);
    const res = await request(app).patch('/api/settings/percentometer_atl_pct').set(authHeader('accountant')).send({ value: 20 });
    expect(res.status).toBe(200);
    expect(dbMock.queries.some(q => /INSERT INTO audit_log/.test(q.sql) && JSON.stringify(q.params).includes('percentometer_atl_changed'))).toBe(true);
  });
});

// ─── FB-08 — Cost Forecast pricing ────────────────────────────────────────────
// Shared cases — the frontend copy (frontend/src/lib/costForecastCalc.ts) is checked against the same
// table by the parity script in the plan (§6).
const FC = { travel_hourly_rate: 25, per_diem_rate: 40, margin_enabled: true, margin_pct: 10 };
const CREW_CASES = [
  // [name, line, settings, expected line_total, expected margin]
  ['base only (existing forecasts unchanged)', { units: 2, unit_rate: 1655 }, { ...FC, margin_enabled: false }, 3310, 0],
  ['all extras on defaults', { units: 1, unit_rate: 1655, daily_rate: 331, default_ot_rate: 52.26, ot_hours: 4, travel_hours: 5, per_diem_days: 5, saturday_days: 1, sunday_days: 1 },
    FC, 1655 + 209.04 + 125 + 200 + 331 + 662, 318.20],
  ['typed overrides win', { units: 0, unit_rate: 1655, daily_rate: 331, default_ot_rate: 52.26, ot_hours: 2, ot_rate: 60, saturday_days: 1, saturday_rate: '400', sunday_days: 1, sunday_rate: 500 },
    FC, 120 + 400 + 500, 102],
  ['blank override = default', { units: 0, daily_rate: 300, sunday_days: 2, sunday_rate: '' }, FC, 1200, 120],
  ['line margin toggle off', { units: 1, unit_rate: 1000, margin_applied: false }, FC, 1000, 0],
  ['master margin off', { units: 1, unit_rate: 1000, margin_applied: true }, { ...FC, margin_enabled: false }, 1000, 0],
  ['string inputs from the form', { units: '1.5', unit_rate: '1000.10', ot_hours: '', travel_hours: '2' }, { ...FC, margin_pct: '12.5' }, 1500.15 + 50, 193.77],
];

describe('FB-08 costForecastCalc', () => {
  test.each(CREW_CASES)('%s', (_n, line, fc, total, margin) => {
    const r = CFC.priceCrewLine(line, fc);
    expect(r.line_total).toBeCloseTo(total, 2);
    expect(r.margin_amount).toBeCloseTo(margin, 2);
  });

  test('non-labour lines + totals keep cost and margin apart', () => {
    const crew = [{ line_total: 3310, margin_amount: 331 }];
    const nl = [CFC.priceNonLabourLine({ quantity: 2, unit_rate: 500 }, FC), CFC.priceNonLabourLine({ quantity: 1, unit_rate: 99.99, margin_applied: false }, FC)];
    expect(nl).toEqual([{ line_total: 1000, margin_amount: 100 }, { line_total: 99.99, margin_amount: 0 }]);
    expect(CFC.sumForecast(crew, nl)).toEqual({
      total_crew_cost: 3310, total_non_labour_cost: 1099.99, grand_total_cost: 4409.99, margin_total: 431, grand_total_with_margin: 4840.99,
    });
  });

  const RATES = [
    { id: 'br-1', trade: 'Carpenters', rank: 'Carpenter', daily_rate: '331.00', weekly_rate: '1655.00', overtime_rate: '52.26' },
    { id: 'br-3', trade: 'Non-BECTU', rank: 'Construction Manager', daily_rate: '550.00', weekly_rate: '2750.00', overtime_rate: null },
  ];

  test('card rates × commercial multiplier; derived OT when the card has none', () => {
    expect(CFC.cardRatesFor(RATES, { trade: 'Carpenters', rank: 'Carpenter' }, 1.1, 'weekly'))
      .toEqual({ bectu_rate_id: 'br-1', unit_rate: 1820.5, daily_rate: 364.1, default_ot_rate: 57.49 });
    expect(CFC.cardRatesFor(RATES, { trade: 'Non-BECTU', rank: 'Construction Manager' }, 1, 'daily'))
      .toEqual({ bectu_rate_id: 'br-3', unit_rate: 550, daily_rate: 550, default_ot_rate: 86.84 });   // 550 × 1.5 / 9.5
  });

  test('apprentice grades scale from the standard grade; unknown grades keep their stored rate', () => {
    const app1 = CFC.cardRatesFor(RATES, { trade: 'Carpenters', rank: 'Apprentice Year 1' }, 1, 'weekly');
    expect(app1).toMatchObject({ bectu_rate_id: null, unit_rate: 993, daily_rate: 198.6 });
    expect(CFC.cardRatesFor(RATES, { trade: 'Riggers', rank: 'Rigger' }, 1, 'weekly')).toBeNull();
    const kept = CFC.syncLineRates({ trade: 'Riggers', rank: 'Rigger', unit_rate: 123 }, RATES, 1, 'weekly');
    expect(kept.unit_rate).toBe(123);
  });

  test('sync never touches typed overrides, hours or toggles', () => {
    const line = { trade: 'Carpenters', rank: 'Carpenter', unit_rate: 1, ot_rate: 99, saturday_rate: 1, ot_hours: 3, margin_applied: false };
    expect(CFC.syncLineRates(line, RATES, 1, 'weekly')).toMatchObject({ unit_rate: 1655, ot_rate: 99, saturday_rate: 1, ot_hours: 3, margin_applied: false });
  });

  test('input validation', () => {
    expect(CFC.parseSettings({ rate_card_type: 'gold' }).error).toBeDefined();
    expect(CFC.parseSettings({ margin_pct: -1 }).error).toBeDefined();
    expect(CFC.parseSettings({ travel_hourly_rate: '' }).error).toBeDefined();
    expect(CFC.parseSettings({ margin_enabled: 1, margin_pct: '12.345' }).values).toEqual({ margin_enabled: true, margin_pct: 12.35 });
    expect(CFC.parseCrewLineInput({ units: -1 }).error).toBeDefined();
    expect(CFC.parseCrewLineInput({ ot_rate: 'x' }).error).toBeDefined();
    expect(CFC.parseCrewLineInput({ units: '', ot_rate: '' }).values).toMatchObject({ units: 0, ot_rate: null, margin_applied: true });
  });
});

describe('FB-08 Cost Forecast API validation', () => {
  test.each([
    [{ rate_card_type: 'gold' }],
    [{ margin_pct: 'ten' }],
    [{ default_view: 'monthly' }],
    [{ crew_lines: [{ id: 'l1', ot_hours: -2 }] }],
    [{ crew_lines: 'nope' }],
    [{ non_labour_lines: {} }],
  ])('PUT %p → 400 before touching the DB', async body => {
    const res = await request(app).put('/api/forecasting/cost-forecasts/cf-1').set(authHeader('accountant')).send(body);
    expect(res.status).toBe(400);
    expect(dbMock.connect).not.toHaveBeenCalled();
  });
});

// ─── FB-02 — production budget ────────────────────────────────────────────────
describe('FB-02 production budget (agreed_price)', () => {
  const PID = '22222222-2222-2222-2222-222222222222';
  test.each([['-5'], ['12.345'], ['abc'], [1e13]])('PUT agreed_price %p → 400', async v => {
    dbMock.respond([{ id: PID }]);   // router.param existence check
    const res = await request(app).put(`/api/productions/${PID}`).set(authHeader('md')).send({ agreed_price: v });
    expect(res.status).toBe(400);
    expect(dbMock.queries.some(q => /UPDATE productions/.test(q.sql))).toBe(false);
  });

  test('PUT "£75,000.50" stores 75000.5 and audits old → new', async () => {
    dbMock.respond([{ id: PID }], [{ agreed_price: null }], [{ id: PID, name: 'Instacart', agreed_price: '75000.50' }]);
    const res = await request(app).put(`/api/productions/${PID}`).set(authHeader('accountant')).send({ agreed_price: '£75,000.50' });
    expect(res.status).toBe(200);
    const upd = dbMock.queries.find(q => /UPDATE productions SET/.test(q.sql));
    expect(upd.sql).toMatch(/agreed_price = \$1/);
    expect(upd.params[0]).toBe(75000.5);
    const audit = dbMock.queries.find(q => /INSERT INTO audit_log/.test(q.sql));
    expect(JSON.stringify(audit.params)).toContain('production_budget_changed');
  });

  test('unchanged budget is not re-audited; null clears', async () => {
    dbMock.respond([{ id: PID }], [{ agreed_price: '75000.00' }], [{ id: PID, name: 'X', agreed_price: '75000.00' }]);
    await request(app).put(`/api/productions/${PID}`).set(authHeader('md')).send({ agreed_price: 75000 });
    expect(dbMock.queries.some(q => /INSERT INTO audit_log/.test(q.sql))).toBe(false);
    dbMock.reset();
    dbMock.respond([{ id: PID }], [{ agreed_price: '75000.00' }], [{ id: PID, name: 'X', agreed_price: null }]);
    const res = await request(app).put(`/api/productions/${PID}`).set(authHeader('md')).send({ agreed_price: '' });
    expect(res.status).toBe(200);
    expect(dbMock.queries.find(q => /UPDATE productions SET/.test(q.sql)).params[0]).toBeNull();
  });
});

// ─── FB-03 — P&L totals ───────────────────────────────────────────────────────
describe('FB-03 sumPL', () => {
  const row = (b, pl) => ({ budget_revenue: b, profit_loss: pl, labour_charged: 10, materials_charged: 5, management_costs: 0 });
  test('no budgeted production → null budget / profit, not a green £0', () => {
    expect(sumPL([row(null, null), row(null, null)])).toMatchObject({ budget_revenue: null, profit_loss: null, budgeted_count: 0, labour_charged: 20 });
  });
  test('loss totals stay negative', () => {
    expect(sumPL([row(100, -50), row(null, null)])).toMatchObject({ budget_revenue: 100, profit_loss: -50, budgeted_count: 1 });
  });
});

// ─── FB-05 / FB-06 — bulk verify + verify without invoice ─────────────────────
const TS_ID = '11111111-1111-1111-1111-111111111111';
describe('FB-06 verify without invoice', () => {
  test('self-employed, no invoice, no reason → 409 INVOICE_REQUIRED (contract unchanged)', async () => {
    dbMock.respond([{ id: TS_ID, status: 'distributed', invoice_attachment_url: null, employment_status: 'self_employed' }]);
    const res = await request(app).post(`/api/timesheets/${TS_ID}/verify`).set(authHeader('coordinator')).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVOICE_REQUIRED');
    expect(dbMock.queries.some(q => /UPDATE timesheets/.test(q.sql))).toBe(false);
  });

  test('a reason under 5 characters is refused', async () => {
    dbMock.respond([{ id: TS_ID, status: 'distributed', invoice_attachment_url: null, employment_status: 'self_employed' }]);
    const res = await request(app).post(`/api/timesheets/${TS_ID}/verify`).set(authHeader('md')).send({ invoice_override_reason: ' ok ' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/at least 5/);
  });

  test('with a reason: finalised, override stored, audited', async () => {
    dbMock.respond(
      [{ id: TS_ID, status: 'amendment_requested', invoice_attachment_url: null, employment_status: 'self_employed' }],
      [{ id: TS_ID, status: 'finalised', production_id: 'p1', week_ending_date: '2026-11-22', crew_member_id: 'c1' }],
    );
    const res = await request(app).post(`/api/timesheets/${TS_ID}/verify`).set(authHeader('accountant'))
      .send({ invoice_override_reason: 'Invoice promised by email' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/without invoice/);
    const upd = dbMock.queries.find(q => /UPDATE timesheets/.test(q.sql));
    expect(upd.params.slice(0, 4)).toEqual([TS_ID, true, 'Invoice promised by email', 'user-acc-001']);
    const audit = dbMock.queries.find(q => /INSERT INTO audit_log/.test(q.sql));
    expect(JSON.stringify(audit.params)).toContain('timesheet_finalised_without_invoice');
  });

  test('PAYE with a reason: verified normally, no override recorded', async () => {
    dbMock.respond(
      [{ id: TS_ID, status: 'distributed', invoice_attachment_url: null, employment_status: 'paye' }],
      [{ id: TS_ID, status: 'finalised' }],
    );
    const res = await request(app).post(`/api/timesheets/${TS_ID}/verify`).set(authHeader('md')).send({ invoice_override_reason: 'not needed here' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Timesheet verified');
    expect(dbMock.queries.find(q => /UPDATE timesheets/.test(q.sql)).params[1]).toBe(false);
  });

  test('already verified → 409', async () => {
    dbMock.respond([{ id: TS_ID, status: 'finalised', invoice_attachment_url: 'x', employment_status: 'paye' }]);
    const res = await request(app).post(`/api/timesheets/${TS_ID}/verify`).set(authHeader('md')).send({});
    expect(res.status).toBe(409);
  });
});

describe('FB-05 bulk verify', () => {
  test.each([
    [{}], [{ timesheet_ids: [] }], [{ timesheet_ids: 'abc' }], [{ timesheet_ids: ['not-a-uuid'] }],
    [{ timesheet_ids: Array.from({ length: 201 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`) }],
  ])('400 for %#', async body => {
    const res = await request(app).post('/api/timesheets/bulk-verify').set(authHeader('accountant')).send(body);
    expect(res.status).toBe(400);
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  test('verifies the eligible ones and lists the rest with reasons (never overrides)', async () => {
    const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', C = '00000000-0000-0000-0000-00000000000c';
    dbMock.respond(
      [{ id: A, status: 'distributed', invoice_attachment_url: null, employment_status: 'paye' }],
      [{ id: A, status: 'finalised' }],
      [],   // audit for A
      [{ id: B, status: 'distributed', invoice_attachment_url: null, employment_status: 'self_employed' }],
      [{ id: C, status: 'draft', invoice_attachment_url: null, employment_status: 'paye' }],
    );
    const res = await request(app).post('/api/timesheets/bulk-verify').set(authHeader('coordinator')).send({ timesheet_ids: [A, B, C, A] });
    expect(res.status).toBe(200);
    expect(res.body.verified).toEqual([A]);
    expect(res.body.skipped.map(s => [s.timesheet_id, s.code])).toEqual([[B, 'INVOICE_REQUIRED'], [C, 'NOT_READY']]);
    expect(dbMock.queries.filter(q => /UPDATE timesheets/.test(q.sql))).toHaveLength(1);
  });

  test('guest cannot bulk verify', async () => {
    const res = await request(app).post('/api/timesheets/bulk-verify').set(authHeader('guest')).send({ timesheet_ids: [TS_ID] });
    expect(res.status).toBe(403);
  });
});

// ─── Audit fixes (27 Nov) ──────────────────────────────────────────────────────
describe('audit fixes', () => {
  const pctApp = makeApp(['/api/percentometer', require('../routes/percentometer')]);

  test('GET /api/percentometer/ratios?current=true survives the dropped effective_to column (F-H)', async () => {
    dbMock.query.mockImplementationOnce(async () => { const e = new Error('column "effective_to" does not exist'); e.code = '42703'; throw e; });
    dbMock.respond([{ id: 'r1', cost_type: 'Carpenters', percentage: '0.42', effective_from: null, effective_to: null }]);
    const res = await request(pctApp).get('/api/percentometer/ratios?current=true').set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('other DB errors still surface as 500', async () => {
    dbMock.query.mockImplementationOnce(async () => { const e = new Error('boom'); e.code = '57P01'; throw e; });
    const res = await request(pctApp).get('/api/percentometer/ratios').set(authHeader('md'));
    expect(res.status).toBe(500);
  });

  test('PATCH /forecasts/:id for a missing scenario rolls back before releasing the client', async () => {
    dbMock.respond([], []);   // BEGIN, SELECT → none
    const res = await request(app).patch('/api/forecasting/forecasts/f-404').set(authHeader('md')).send({ name: 'x' });
    expect(res.status).toBe(404);
    const client = await dbMock.connect.mock.results[0].value;
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
