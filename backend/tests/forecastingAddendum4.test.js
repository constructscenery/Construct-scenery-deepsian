'use strict';

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const forecastingRouter = require('../routes/forecasting');
const app = makeApp(['/api/forecasting', forecastingRouter]);
const {
  resolveRate, buildDefaultCostForecastLines, buildDefaultLabourFlowRows,
} = require('../services/forecastingDefaults');

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

describe.each(['cost-forecasts', 'labour-flows'])('%s lock protection', resource => {
  test('a save to a locked record rolls back and releases its connection', async () => {
    dbMock.respond([], [{ id: 'locked-plan', status: 'locked' }], []);
    const res = await request(app).put(`/api/forecasting/${resource}/locked-plan`).set(authHeader('accountant')).send({});
    expect(res.status).toBe(400);
    const client = await dbMock.connect.mock.results[0].value;
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), ['locked-plan']);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test.each([false, true])('lock rejection rolls back (record exists: %s)', exists => {
    dbMock.respond([], exists ? [{ id: 'locked-plan', status: 'locked' }] : [], []);
    return request(app).post(`/api/forecasting/${resource}/locked-plan/lock`).set(authHeader('coordinator')).then(async res => {
      expect(res.status).toBe(exists ? 400 : 404);
      const client = await dbMock.connect.mock.results[0].value;
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
    });
  });
});

describe('Client apprentice and improver rates', () => {
  const clientRates = [
    ['Apprentice Year 1', 107, 535],
    ['Apprentice Year 2', 130, 650],
    ['Apprentice Year 3', 170, 850],
    ['Improver Year 4', 238, 1190],
  ];
  const rates = ['Carpenters', 'Scenic Painters', 'Riggers'].flatMap(trade =>
    clientRates.map(([rank, daily, weekly]) => ({
      id: `${trade}-${rank}`, trade, rank, daily_rate: String(daily), weekly_rate: String(weekly),
    }))
  );

  test.each(clientRates)('%s uses the full agreed rate, not a fallback discount', (rank, daily, weekly) => {
    expect(resolveRate(rates, 'Carpenters', rank, 0.6)).toMatchObject({
      daily_rate: daily, weekly_rate: weekly,
    });
  });

  test('both tools use the agreed rates under each department', () => {
    for (const build of [buildDefaultCostForecastLines, buildDefaultLabourFlowRows]) {
      const lines = build(rates);
      for (const rate of rates) {
        const rank = rate.rank === 'Improver Year 4' ? 'Improver' : rate.rank;
        expect(lines.find(line => line.trade === rate.trade && line.rank === rank))
          .toMatchObject({ weekly_rate: Number(rate.weekly_rate), bectu_rate_id: rate.id });
      }
    }
  });

  test('an exact rank wins over a legacy alias regardless of row order', () => {
    expect(resolveRate([
      { id: 'alias', trade: 'Carpenters', rank: 'Improver', daily_rate: '200' },
      ...rates,
    ], 'Carpenters', 'Improver Year 4')).toMatchObject({ daily_rate: 238, weekly_rate: 1190 });
  });

  test('fallback percentages apply only when the requested grade is missing', () => {
    expect(resolveRate(SAMPLE_BECTU_RATES, 'Carpenters', 'Apprentice Year 1', 0.6))
      .toMatchObject({ bectu_rate_id: null, daily_rate: 198.6, weekly_rate: 993 });
  });
});

// ─── Tool 1: Cost Forecasts ───────────────────────────────────────────────────
describe('Cost Forecasts API (Addendum 4)', () => {
  test('an unlocked forecast picks up an explicitly zeroed rate', async () => {
    dbMock.respond(
      [{ ...SAMPLE_COST_FORECAST, total_crew_cost: 535, total_non_labour_cost: 0, grand_total_cost: 535 }],
      [{ id: 'line-1', trade: 'Carpenters', rank: 'Apprentice Year 1', unit_rate: 535, units: 1, line_total: 535 }],
      [],
      [{ id: 'rate-1', trade: 'Carpenters', rank: 'Apprentice Year 1', daily_rate: '0.00', weekly_rate: '0.00' }],
    );
    const res = await request(app).get('/api/forecasting/cost-forecasts/cf-001').set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.body.crew_lines[0]).toMatchObject({ unit_rate: 0, line_total: 0 });
    expect(res.body.grand_total_cost).toBe(0);
  });

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
    dbMock.respond([]);
    dbMock.respond([SAMPLE_COST_FORECAST]); // existing
    dbMock.respond(SAMPLE_BECTU_RATES);     // bectu rates for snapshot
    dbMock.respond([{ id: 'line-1', trade: 'Carpenters', rank: 'Carpenter', units: 2, unit_rate: 100 }]);
    dbMock.respond([]);
    dbMock.respond([{ ...SAMPLE_COST_FORECAST, status: 'locked' }]); // update returning
    dbMock.respond([]);

    const res = await request(app)
      .post('/api/forecasting/cost-forecasts/cf-001/lock')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('locked');
    const client = await dbMock.connect.mock.results[0].value;
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE cost_forecast_crew_lines'), [1655, 'br-1', 'line-1']);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
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
  test.each([535, 0])('an unlocked unlinked grade picks up a live weekly rate of %s', async weeklyRate => {
    dbMock.respond(
      [{ ...SAMPLE_LABOUR_FLOW, end_date: '2026-10-11', grand_total_cost: 642 }],
      [{ id: 'row-1', section: 'carpenters', trade: 'Carpenters', rank: 'Apprentice Year 1', bectu_rate_id: null, weekly_rate: 321, headcounts: { '1': 2 } }],
      [{ id: 'rate-1', trade: 'Carpenters', rank: 'Apprentice Year 1', daily_rate: weeklyRate / 5, weekly_rate: weeklyRate }],
    );
    const res = await request(app).get('/api/forecasting/labour-flows/lf-001').set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(res.body.rows[0]).toMatchObject({ bectu_rate_id: 'rate-1', weekly_rate: weeklyRate, row_total_cost: weeklyRate * 2 });
    expect(res.body.grand_total_cost).toBe(weeklyRate * 2);
    expect(res.body.department_weekly_totals.carpenters['1']).toBe(weeklyRate * 2);
  });

  test('locked labour flows retain their saved rates', async () => {
    dbMock.respond(
      [{ ...SAMPLE_LABOUR_FLOW, status: 'locked', end_date: '2026-10-11', grand_total_cost: 642 }],
      [{ id: 'row-1', section: 'carpenters', trade: 'Carpenters', rank: 'Apprentice Year 1', bectu_rate_id: null, weekly_rate: 321, headcounts: { '1': 2 } }],
    );
    const res = await request(app).get('/api/forecasting/labour-flows/lf-001').set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body.rows[0].weekly_rate).toBe(321);
    expect(dbMock.query.mock.calls.some(([sql]) => sql.includes('FROM bectu_rates'))).toBe(false);
  });

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
    dbMock.respond([]);
    dbMock.respond([SAMPLE_LABOUR_FLOW]);
    dbMock.respond(SAMPLE_BECTU_RATES);
    dbMock.respond([{ id: 'row-1', trade: 'Carpenters', rank: 'Carpenter', weekly_rate: 100, headcounts: { '1': 2 } }]);
    dbMock.respond([]);
    dbMock.respond([{ ...SAMPLE_LABOUR_FLOW, status: 'locked' }]);
    dbMock.respond([]);

    const res = await request(app)
      .post('/api/forecasting/labour-flows/lf-001/lock')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('locked');
    const client = await dbMock.connect.mock.results[0].value;
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE labour_flow_rows'), [1655, 'br-1', 2, 3310, 'row-1']);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE labour_flows'), ['user-md-001', expect.any(String), 'lf-001', 3310]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
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

  test('GET /api/forecasting/labour-flows/burn-rate — returns weekly burn rate mapped to timesheets', async () => {
    dbMock.respond([
      { ...SAMPLE_LABOUR_FLOW, start_date: '2026-10-05', end_date: '2026-10-11' }, // 1 week
    ]);
    dbMock.respond([
      { id: 'row-1', labour_flow_id: 'lf-001', weekly_rate: '1000.00', headcounts: { '1': 3 } },
    ]);
    dbMock.respond([
      { id: 'ts-1', week_ending_date: '2026-10-11', status: 'finalised', grand_total: '2800.00' },
    ]);

    const res = await request(app)
      .get('/api/forecasting/labour-flows/burn-rate?labour_flow_id=lf-001')
      .set(authHeader('accountant'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('flow');
    expect(res.body).toHaveProperty('burn_rate');
    expect(res.body.burn_rate).toHaveLength(1);
    expect(res.body.burn_rate[0].forecasted_weekly).toBe(3000);
    expect(res.body.burn_rate[0].actual_weekly_pay).toBe(2800);
  });
});
