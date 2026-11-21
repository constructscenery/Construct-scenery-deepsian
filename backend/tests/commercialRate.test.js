'use strict';
/** CS-08 — production rate card, uplift setting, production-wide recalculation. */
const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

jest.mock('../config/email', () => ({ sendEmail: jest.fn().mockResolvedValue({}), templates: new Proxy({}, { get: () => () => ({}) }) }));
const { sendEmail } = require('../config/email');

const app = makeApp(
  ['/api/productions', require('../routes/productions')],
  ['/api/settings', require('../routes/settings')],
);
const PROD = '11111111-1111-1111-1111-111111111111';

const originalQuery = dbMock.query.getMockImplementation();
function routeSql(handlers) {
  const impl = async (sql, params) => {
    dbMock.queries.push({ sql, params });
    for (const [re, rows] of handlers) {
      if (re.test(sql)) { const r = typeof rows === 'function' ? rows(sql, params) : rows; return { rows: r, rowCount: r.length }; }
    }
    return { rows: [], rowCount: 0 };
  };
  dbMock.query.mockImplementation(impl);
  dbMock.connect.mockImplementation(async () => ({ query: jest.fn(impl), release: jest.fn() }));
}
const ran = re => dbMock.queries.filter(q => re.test(q.sql));
const EXISTS = [/SELECT id FROM productions WHERE id = \$1 AND deleted_at IS NULL/, [{ id: PROD }]];
beforeEach(() => { dbMock.reset(); jest.clearAllMocks(); });
afterEach(() => dbMock.query.mockImplementation(originalQuery));

describe('production rate card', () => {
  test('rejects an unknown rate card', async () => {
    routeSql([EXISTS]);
    const res = await request(app).put(`/api/productions/${PROD}`).set(authHeader('md')).send({ rate_card_type: 'premium' });
    expect(res.status).toBe(400);
  });

  test('switching to commercial is saved and audited', async () => {
    routeSql([
      EXISTS,
      [/SELECT rate_card_type FROM productions/, [{ rate_card_type: 'standard' }]],
      [/UPDATE productions SET rate_card_type/, [{ id: PROD, name: 'Commercial – Gucci', rate_card_type: 'commercial' }]],
    ]);
    const res = await request(app).put(`/api/productions/${PROD}`).set(authHeader('coordinator')).send({ rate_card_type: 'commercial' });
    expect(res.status).toBe(200);
    const audit = ran(/INSERT INTO audit_log/)[0];
    expect(audit.params).toContain('production_rate_card_changed');
  });

  test('new productions default to standard', async () => {
    routeSql([[/INSERT INTO productions/, (sql, p) => [{ id: PROD, rate_card_type: p[20] }]]]);
    const res = await request(app).post('/api/productions').set(authHeader('md')).send({ name: 'X', contract_type: 'on_a_price' });
    expect(res.status).toBe(201);
    expect(res.body.rate_card_type).toBe('standard');
  });
});

describe('commercial uplift setting', () => {
  test.each([[-1], [101], ['10'], [null]])('rejects %p', async value => {
    const res = await request(app).patch('/api/settings/commercial_rate_uplift_pct').set(authHeader('md')).send({ value });
    expect(res.status).toBe(400);
  });
  test('accepts 12.5 and audits it', async () => {
    routeSql([[/INSERT INTO app_settings/, [{ key: 'commercial_rate_uplift_pct', value: 12.5 }]]]);
    const res = await request(app).patch('/api/settings/commercial_rate_uplift_pct').set(authHeader('accountant')).send({ value: 12.5 });
    expect(res.status).toBe(200);
    expect(ran(/INSERT INTO audit_log/)[0].params).toContain('commercial_rate_uplift_changed');
  });
});

describe('POST /api/productions/:id/recalculate-timesheets', () => {
  const tsRow = (id, grand, over = {}) => ({
    id, production_id: PROD, crew_member_id: 'c1', week_ending_date: '2026-11-22', status: 'distributed', email: 'x@y',
    crew_trade: 'Carpenters', crew_rank: 'Carpenter', employment_status: 'paye', vat_registration_number: null,
    rate_card_type: 'commercial', commercial_uplift_pct: 10, rate_multiplier: '1.0000', grand_total: String(grand), ...over,
  });
  const entries = [{ date: '2026-11-16', day_of_week: 'Monday', full_day_worked: true, overtime_hours: '0' }];

  test('re-prices reproducible timesheets with the new rate card, skips ones it cannot explain, sends no email', async () => {
    routeSql([
      EXISTS,
      [/SELECT id, name, status FROM productions WHERE id = \$1/, [{ id: PROD, name: 'Gucci', status: 'active_build' }]],
      [/FROM timesheets t JOIN crew_members cm ON cm.id = t.crew_member_id\s+WHERE t.production_id = \$1 AND t.status <> 'finalised'/, [
        { id: 'ok', week_ending_date: '2026-11-22', first_name: 'A', last_name: 'One' },
        { id: 'imported', week_ending_date: '2026-11-22', first_name: 'B', last_name: 'Two' },
      ]],
      [/SELECT rate_multiplier, grand_total FROM timesheets WHERE id = \$1/, (sql, p) => [{ rate_multiplier: '1.0000', grand_total: p[0] === 'ok' ? '300.00' : '355.00' }]],
      [/LEFT JOIN productions p ON p.id = t.production_id\s+WHERE t.id = \$1/, (sql, p) => [tsRow(p[0], p[0] === 'ok' ? 300 : 355)]],
      [/FROM timesheet_entries WHERE timesheet_id/, entries],
      [/FROM bectu_rates/, [{ daily_rate: '300.00', overtime_rate: '50.00' }]],
      [/UPDATE timesheets SET\s+weekly_rate/, (sql, p) => [{ id: p[10], grand_total: String(p[8]) }]],
    ]);
    const res = await request(app).post(`/api/productions/${PROD}/recalculate-timesheets`).set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recalculated: 1, changed: 1 });
    expect(res.body.skipped).toEqual([expect.objectContaining({ timesheet_id: 'imported', name: 'B Two' })]);
    const upd = ran(/UPDATE timesheets SET\s+weekly_rate/);
    expect(upd).toHaveLength(1);
    expect(upd[0].params[0]).toBe(330);   // 300 × 1.1
    expect(upd[0].params[9]).toBe(1.1);   // rate_multiplier stored
    expect(upd[0].sql).toContain("status <> 'finalised'");
    expect(ran(/^BEGIN$/)).toHaveLength(1);
    expect(ran(/^COMMIT$/)).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('archived productions are read-only', async () => {
    routeSql([EXISTS, [/SELECT id, name, status FROM productions WHERE id = \$1/, [{ id: PROD, status: 'archived' }]]]);
    const res = await request(app).post(`/api/productions/${PROD}/recalculate-timesheets`).set(authHeader('md'));
    expect(res.status).toBe(400);
  });

  test('guest cannot recalculate', async () => {
    const res = await request(app).post(`/api/productions/${PROD}/recalculate-timesheets`).set(authHeader('guest'));
    expect(res.status).toBe(403);
  });
});
