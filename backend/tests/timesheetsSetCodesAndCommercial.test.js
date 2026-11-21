'use strict';
/**
 * CS-04 / CS-08 / CS-02 through the real timesheet endpoints:
 *  - unknown set numbers are saved but reported as warnings
 *  - a commercial production uplifts rate-card rates by the configured % and stores rate_multiplier
 *  - a manual rate override is never uplifted
 *  - a roll-forward draft is priced straight away (no £0 drafts)
 */
const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

jest.mock('../services/timesheetPdfService', () => ({
  generateTimesheetPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
}));
jest.mock('../config/email', () => ({ sendEmail: jest.fn().mockResolvedValue({}), templates: new Proxy({}, { get: () => () => ({}) }) }));
const { sendEmail } = require('../config/email');

const app = makeApp(['/api/timesheets', require('../routes/timesheets')]);
const PROD = '11111111-1111-1111-1111-111111111111';
const TS = '22222222-2222-2222-2222-222222222222';
const CREW = '33333333-3333-3333-3333-333333333333';

const originalQuery = dbMock.query.getMockImplementation();
function routeSql(handlers) {
  const impl = async (sql, params) => {
    dbMock.queries.push({ sql, params });
    for (const [re, rows] of handlers) {
      if (re.test(sql)) {
        const r = typeof rows === 'function' ? rows(sql, params) : rows;
        return { rows: r, rowCount: r.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  dbMock.query.mockImplementation(impl);
  dbMock.connect.mockImplementation(async () => ({ query: jest.fn(impl), release: jest.fn() }));
}
const ran = re => dbMock.queries.filter(q => re.test(q.sql));
beforeEach(() => { dbMock.reset(); jest.clearAllMocks(); });
afterEach(() => dbMock.query.mockImplementation(originalQuery));

const baseTs = (over = {}) => ({
  id: TS, production_id: PROD, crew_member_id: CREW, week_ending_date: '2026-11-22', status: 'draft',
  crew_trade: 'Carpenters', crew_rank: 'Carpenter', employment_status: 'paye', vat_registration_number: null,
  email: 'crew@example.com', rate_card_type: 'standard', commercial_uplift_pct: 10, ...over,
});
const fiveDays = (set = '100') => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d, i) => ({
  date: `2026-11-${16 + i}`, day_of_week: d, full_day_worked: true, overtime_hours: i === 0 ? 2 : 0, set_number: set,
}));
const updateParams = () => ran(/UPDATE timesheets SET\s+weekly_rate/)[0].params;

describe('PUT /api/timesheets/:id/entries', () => {
  test('standard production: rate card used as-is, multiplier 1 stored, no warnings for a known set', async () => {
    routeSql([
      [/FROM timesheets t\s+JOIN crew_members cm ON t.crew_member_id = cm.id\s+LEFT JOIN productions p/, [baseTs()]],
      [/FROM bectu_rates/, [{ daily_rate: '300.00', overtime_rate: '50.00' }]],
      [/UPDATE timesheets SET\s+weekly_rate/, (sql, p) => [{ id: TS, gross_total: String(p[7]) }]],
      [/FROM sets\s+WHERE production_id = \$1/, [{ code: '100' }]],
    ]);
    const res = await request(app).put(`/api/timesheets/${TS}/entries`).set(authHeader('coordinator')).send({ entries: fiveDays('100') });
    expect(res.status).toBe(200);
    const p = updateParams();
    expect(p[0]).toBe(1500);          // 5 × 300
    expect(p[3]).toBe(100);           // 2h × 50
    expect(p[10]).toBe(1);            // rate_multiplier
    expect(res.body.warnings).toBeUndefined();
  });

  test('commercial production: day and OT rates × 1.1 (rounded per rate), multiplier stored', async () => {
    routeSql([
      [/LEFT JOIN productions p/, [baseTs({ rate_card_type: 'commercial', commercial_uplift_pct: 10 })]],
      [/FROM bectu_rates/, [{ daily_rate: '59.07', overtime_rate: '10.00' }]],
      [/UPDATE timesheets SET\s+weekly_rate/, [{ id: TS }]],
    ]);
    const res = await request(app).put(`/api/timesheets/${TS}/entries`).set(authHeader('md')).send({ entries: fiveDays('') });
    expect(res.status).toBe(200);
    const p = updateParams();
    expect(p[0]).toBeCloseTo(5 * 64.98, 10);   // 59.07 × 1.1 = 64.977 → 64.98 per day
    expect(p[3]).toBeCloseTo(2 * 11, 10);       // 10 × 1.1 = 11 per OT hour
    expect(p[10]).toBe(1.1);
  });

  test('commercial production with a manual rate override: override used exactly', async () => {
    routeSql([
      [/LEFT JOIN productions p/, [baseTs({ rate_card_type: 'commercial' })]],
      [/UPDATE timesheets SET\s+weekly_rate/, [{ id: TS }]],
    ]);
    const res = await request(app).put(`/api/timesheets/${TS}/entries`).set(authHeader('md')).send({ entries: fiveDays(''), rate_override: 200 });
    expect(res.status).toBe(200);
    expect(updateParams()[0]).toBe(1000);
    expect(ran(/FROM bectu_rates/)).toHaveLength(0);
  });

  test('unknown set numbers are saved but returned as warnings', async () => {
    routeSql([
      [/LEFT JOIN productions p/, [baseTs()]],
      [/FROM bectu_rates/, [{ daily_rate: '300.00' }]],
      [/UPDATE timesheets SET\s+weekly_rate/, [{ id: TS }]],
      [/FROM sets\s+WHERE production_id = \$1/, []],
    ]);
    const res = await request(app).put(`/api/timesheets/${TS}/entries`).set(authHeader('md')).send({ entries: fiveDays('999') });
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([expect.objectContaining({ set_code: '999' })]);
    expect(ran(/INSERT INTO timesheet_entries/)[0].params).toContain('999');
  });

  test('saving a draft never emails the crew member', async () => {
    routeSql([
      [/LEFT JOIN productions p/, [baseTs({ status: 'draft' })]],
      [/FROM bectu_rates/, [{ daily_rate: '300.00' }]],
      [/UPDATE timesheets SET\s+weekly_rate/, [{ id: TS }]],
    ]);
    await request(app).put(`/api/timesheets/${TS}/entries`).set(authHeader('md')).send({ entries: fiveDays('') });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('finalised timesheets stay locked', async () => {
    routeSql([[/LEFT JOIN productions p/, [baseTs({ status: 'finalised' })]]]);
    const res = await request(app).put(`/api/timesheets/${TS}/entries`).set(authHeader('md')).send({ entries: fiveDays('') });
    expect(res.status).toBe(403);
    expect(ran(/UPDATE timesheets SET\s+weekly_rate/)).toHaveLength(0);
  });
});

describe('POST /api/timesheets roll-forward (CS-02)', () => {
  test('a draft copied from last week is priced immediately', async () => {
    routeSql([
      [/SELECT status FROM productions WHERE id/, [{ status: 'active_build' }]],
      [/SELECT id, first_name, last_name, is_active FROM crew_members/, [{ id: CREW, is_active: true }]],
      [/SELECT id FROM timesheets\s+WHERE crew_member_id = \$1 AND production_id = \$2 AND week_ending_date = \$3/, (sql, p) => (p[2] === '2026-11-15' ? [{ id: 'prev-ts' }] : [])],
      [/INSERT INTO timesheets/, [{ id: TS }]],
      [/SELECT \* FROM timesheet_entries WHERE timesheet_id = \$1 ORDER BY date/, (sql, p) => (p[0] === 'prev-ts'
        ? [{ date: '2026-11-09', day_of_week: 'Monday', full_day_worked: true, overtime_hours: '0' }]
        : [{ date: '2026-11-16', day_of_week: 'Monday', full_day_worked: true, overtime_hours: '0' }])],
      [/LEFT JOIN productions p/, [baseTs()]],
      [/FROM bectu_rates/, [{ daily_rate: '300.00' }]],
    ]);
    const res = await request(app).post('/api/timesheets').set(authHeader('coordinator'))
      .send({ crew_member_id: CREW, production_id: PROD, week_ending_date: '2026-11-22' });
    expect(res.status).toBe(201);
    const priced = ran(/UPDATE timesheets SET\s+weekly_rate/);
    expect(priced).toHaveLength(1);
    expect(priced[0].params[0]).toBe(300);          // weekly_rate for the copied Monday
    expect(priced[0].sql).toContain("status <> 'finalised'");
  });
});
