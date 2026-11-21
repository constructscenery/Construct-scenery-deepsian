'use strict';
/** CS-05 — production history routes, validation and access (SQL itself verified against Postgres). */
const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const app = makeApp(['/api/productions', require('../routes/productions')]);
const PROD = '11111111-1111-1111-1111-111111111111';
const originalQuery = dbMock.query.getMockImplementation();
function routeSql(handlers) {
  dbMock.query.mockImplementation(async (sql, params) => {
    dbMock.queries.push({ sql, params });
    for (const [re, rows] of handlers) if (re.test(sql)) return { rows: typeof rows === 'function' ? rows(sql, params) : rows };
    return { rows: [] };
  });
}
const EXISTS = [/SELECT id FROM productions WHERE id = \$1 AND deleted_at IS NULL/, [{ id: PROD }]];
beforeEach(() => dbMock.reset());
afterEach(() => dbMock.query.mockImplementation(originalQuery));

describe('GET /api/productions/:id/history', () => {
  test('summary + weeks newest first, labour and POs merged per week', async () => {
    routeSql([
      EXISTS,
      [/SELECT id, name, production_code, status, contract_type FROM productions/, [{ id: PROD, name: 'Addlestone', status: 'active_build', contract_type: 'on_a_price' }]],
      [/GROUP BY production_id, week_ending_date/, [
        { production_id: PROD, week_ending_date: '2026-11-15', labour_total: '1500', labour_management: '0', labour_booked: '500', labour_unbooked: '1000', draft_count: 1, timesheet_count: 2, crew_count: 2 },
        { production_id: PROD, week_ending_date: '2026-11-22', labour_total: '1400', labour_management: '240', labour_booked: '0', labour_unbooked: '1400', draft_count: 1, timesheet_count: 2, crew_count: 2 },
      ]],
      [/GROUP BY po.production_id, 2/, [{ production_id: PROD, week_ending_date: '2026-11-29', po_total: '100', po_management: '100', po_approved: '0', po_count: 1 }]],
    ]);
    const res = await request(app).get(`/api/productions/${PROD}/history`).set(authHeader('guest'));
    expect(res.status).toBe(200);
    expect(res.body.weeks.map(w => w.week_ending_date)).toEqual(['2026-11-29', '2026-11-22', '2026-11-15']);
    expect(res.body.weeks[0]).toMatchObject({ labour_total: 0, po_total: 100, total: 100 });
    expect(res.body.weeks[2]).toMatchObject({ labour_total: 1500, crew_count: 2, total: 1500 });
    expect(res.body.summary).toHaveProperty('profit_loss');
  });

  test('unknown or deleted production is 404 (router param guard)', async () => {
    routeSql([]);
    const res = await request(app).get(`/api/productions/${PROD}/history`).set(authHeader('md'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/productions/:id/history/weeks/:weekEnding', () => {
  test('rejects a non-date week', async () => {
    routeSql([EXISTS]);
    const res = await request(app).get(`/api/productions/${PROD}/history/weeks/2026-02-30`).set(authHeader('md'));
    expect(res.status).toBe(400);
  });

  test('lists people and POs for the week; only live POs count in the total', async () => {
    routeSql([
      EXISTS,
      [/WITH\s+booked AS/, [{ id: 't1', status: 'draft', is_booked: false, net: '600', mgmt_share: '0.4', first_name: 'Dave', last_name: 'D', days_worked: 5, overtime_hours: '2', sets: '100, MGT1' }]],
      [/FROM purchase_orders po/, [
        { id: 'p1', po_number: 'PO1', status: 'issued', net_amount: '300', counts_in_costs: true },
        { id: 'p3', po_number: 'PO3', status: 'draft', net_amount: '999', counts_in_costs: false },
      ]],
    ]);
    const res = await request(app).get(`/api/productions/${PROD}/history/weeks/2026-11-22`).set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.body.timesheets[0]).toMatchObject({ name: 'Dave D', net: 600, paid: false, sets: '100, MGT1', overtime_hours: 2 });
    expect(res.body.totals).toEqual({ labour: 600, purchase_orders: 300 });
    const poQuery = dbMock.queries.find(q => /FROM purchase_orders po/.test(q.sql));
    expect(poQuery.sql).toContain("po.status <> 'voided'");
  });
});

describe('GET /api/productions/:id/set-costs', () => {
  test('every production set is listed; unknown and unassigned rows kept; totals add up', async () => {
    routeSql([
      EXISTS,
      [/day_sets AS/, [{ set_key: '100', label: '100', labour: '360' }, { set_key: 'zz9', label: 'ZZ9', labour: '40' }, { set_key: null, label: null, labour: '2300' }]],
      [/SUM\(net_amount\) AS materials/, [{ set_key: '100', label: '100', materials: '300' }, { set_key: 'mgt1', label: 'MGT1', materials: '100' }]],
      [/SELECT set_number, set_name FROM sets/, [{ set_number: '100', set_name: 'Kitchen' }, { set_number: '200', set_name: 'Hall' }]],
      [/SELECT code, name FROM universal_set_codes/, [{ code: 'MGT1', name: 'Ben' }]],
    ]);
    const res = await request(app).get(`/api/productions/${PROD}/set-costs`).set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(res.body.rows.map(r => [r.set_code, r.source, r.total])).toEqual([
      ['100', 'production', 660], ['200', 'production', 0], ['ZZ9', 'unknown', 40], ['MGT1', 'management', 100], [null, 'unassigned', 2300],
    ]);
    expect(res.body.totals).toEqual({ labour: 2700, materials: 400, total: 3100 });
  });
});
