'use strict';
/** CS-03 — set code import, universal codes, dropdown source; set uniqueness on create/update/delete. */
const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const app = makeApp(
  ['/api/set-codes', require('../routes/setCodes')],
  ['/api/universal-set-codes', require('../routes/universalSetCodes')],
  ['/api/productions', require('../routes/productions')],
);
const PROD = '11111111-1111-1111-1111-111111111111';
const SET = '22222222-2222-2222-2222-222222222222';

const originalQuery = dbMock.query.getMockImplementation();
function routeSql(handlers) {
  const impl = async (sql, params) => {
    dbMock.queries.push({ sql, params });
    for (const [re, rows] of handlers) {
      if (re.test(sql)) {
        if (rows instanceof Error) throw rows;
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
// production exists (router.param check)
const PROD_EXISTS = [/SELECT id FROM productions WHERE id = \$1 AND deleted_at IS NULL/, [{ id: PROD }]];

beforeEach(() => dbMock.reset());
afterEach(() => dbMock.query.mockImplementation(originalQuery));

describe('GET /api/set-codes', () => {
  test('production sets first, then active universal codes; production wins on the same code', async () => {
    routeSql([
      [/FROM sets/, [{ set_number: '100', set_name: 'Kitchen' }, { set_number: ' mgt1 ', set_name: 'Odd local set' }]],
      [/FROM universal_set_codes WHERE is_active = TRUE/, [{ code: 'MGT1', name: 'Ben', category: 'management' }, { code: 'MGT2', name: 'Sian', category: 'management' }]],
    ]);
    const res = await request(app).get(`/api/set-codes?production_id=${PROD}`).set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { code: '100', name: 'Kitchen', source: 'production', category: 'production' },
      { code: 'mgt1', name: 'Odd local set', source: 'production', category: 'production' },
      { code: 'MGT2', name: 'Sian', source: 'universal', category: 'management' },
    ]);
  });

  test('invalid production id is 400', async () => {
    const res = await request(app).get('/api/set-codes?production_id=nope').set(authHeader('md'));
    expect(res.status).toBe(400);
  });

  test('guest can read the list', async () => {
    routeSql([]);
    const res = await request(app).get('/api/set-codes').set(authHeader('guest'));
    expect(res.status).toBe(200);
  });
});

describe('universal set codes', () => {
  test('create — trims, defaults to management, audits', async () => {
    routeSql([[/INSERT INTO universal_set_codes/, (sql, p) => [{ id: 'u1', code: p[0], name: p[1], category: p[2], is_active: true }]]]);
    const res = await request(app).post('/api/universal-set-codes').set(authHeader('md')).send({ code: ' MGT1 ', name: 'Ben' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'MGT1', category: 'management' });
    expect(ran(/INSERT INTO audit_log/)).toHaveLength(1);
  });

  test('duplicate code is 409', async () => {
    routeSql([[/INSERT INTO universal_set_codes/, Object.assign(new Error('dup'), { code: '23505' })]]);
    const res = await request(app).post('/api/universal-set-codes').set(authHeader('md')).send({ code: 'MGT1', name: 'Ben' });
    expect(res.status).toBe(409);
  });

  test('missing fields are 400; guest cannot write', async () => {
    expect((await request(app).post('/api/universal-set-codes').set(authHeader('md')).send({ code: 'X' })).status).toBe(400);
    expect((await request(app).post('/api/universal-set-codes').set(authHeader('guest')).send({ code: 'X', name: 'Y' })).status).toBe(403);
  });

  test('deactivate via PATCH (no delete route)', async () => {
    routeSql([[/UPDATE universal_set_codes SET is_active = \$1/, [{ id: SET, code: 'MGT1', is_active: false }]]]);
    const res = await request(app).patch(`/api/universal-set-codes/${SET}`).set(authHeader('accountant')).send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
    const del = await request(app).delete(`/api/universal-set-codes/${SET}`).set(authHeader('md'));
    expect(del.status).not.toBe(200);
  });

  test('is_active must be boolean', async () => {
    const res = await request(app).patch(`/api/universal-set-codes/${SET}`).set(authHeader('md')).send({ is_active: 'no' });
    expect(res.status).toBe(400);
  });

  test('CSV import adds new codes and updates existing ones', async () => {
    routeSql([
      [/SELECT id FROM universal_set_codes WHERE LOWER\(TRIM\(code\)\) = LOWER\(TRIM\(\$1\)\) FOR UPDATE/, (sql, p) => (p[0] === 'MGT1' ? [{ id: 'u1' }] : [])],
    ]);
    const csv = 'Code,Name\nMGT1,Ben Keville\nMGT2,Sian\n,missing code\nmgt2,dup in file\n';
    const res = await request(app).post('/api/universal-set-codes/import').set(authHeader('md')).attach('csv', Buffer.from(csv), 'u.csv');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.updated).toBe(1);
    expect(res.body.errors.map(e => e.row)).toEqual([4, 5]);
  });
});

describe('production set import', () => {
  const csv = [
    'Set Number,Set Name,Shoot Week,Handover Date,Completion Status,Notes',
    '100,Kitchen,Week 1,2026-12-04,not_started,',      // existing → update
    '101,Hallway,Week 2,11/12/2026,,=cmd()',           // new; formula char stripped
    ',No number,,,,',                                  // invalid
    '102,Bad date,,31/02/2026,,',                      // invalid date
    '103,Bad status,,,done,',                          // invalid status
    '100,Dup in file,,,,',                             // duplicate in file
  ].join('\n');

  test('preview reports create / update / invalid without writing', async () => {
    routeSql([PROD_EXISTS, [/SELECT id, set_number, set_name FROM sets/, [{ id: SET, set_number: ' 100', set_name: 'Kitchen' }]]]);
    const res = await request(app).post(`/api/productions/${PROD}/sets/import/preview`).set(authHeader('coordinator')).attach('csv', Buffer.from(csv), 's.csv');
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ total_rows: 6, create: 1, update: 1, invalid: 4 });
    const [r1, r2] = res.body.rows;
    expect(r1).toMatchObject({ action: 'update', existing_set_id: SET, handover_date: '2026-12-04' });
    expect(r2).toMatchObject({ action: 'create', handover_date: '2026-12-11', notes: 'cmd()' });
    expect(ran(/INSERT INTO sets|UPDATE sets/)).toHaveLength(0);
  });

  test('import upserts valid rows in one transaction and never deletes', async () => {
    routeSql([
      PROD_EXISTS,
      [/SELECT id, set_number, set_name FROM sets/, [{ id: SET, set_number: '100', set_name: 'Kitchen' }]],
      [/FOR UPDATE/, (sql, p) => (p[1] === '100' ? [{ id: SET }] : [])],
    ]);
    const res = await request(app).post(`/api/productions/${PROD}/sets/import`).set(authHeader('md')).attach('csv', Buffer.from(csv), 's.csv');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, updated: 1 });
    expect(res.body.errors).toHaveLength(4);
    expect(ran(/^BEGIN$/)).toHaveLength(1);
    expect(ran(/^COMMIT$/)).toHaveLength(1);
    expect(ran(/DELETE FROM sets/)).toHaveLength(0);
    const ins = ran(/INSERT INTO sets/)[0];
    expect(ins.params.slice(0, 6)).toEqual([PROD, '101', 'Hallway', 'Week 2', '2026-12-11', 'not_started']);
  });

  test('template downloads; guest cannot import', async () => {
    const t = await request(app).get('/api/productions/sets/import/template').set(authHeader('guest'));
    expect(t.status).toBe(200);
    expect(t.text.split('\r\n')[0]).toBe('set_number,set_name,shoot_week,handover_date,completion_status,notes');
    routeSql([PROD_EXISTS]);
    const g = await request(app).post(`/api/productions/${PROD}/sets/import`).set(authHeader('guest')).attach('csv', Buffer.from(csv), 's.csv');
    expect(g.status).toBe(403);
  });
});

describe('set uniqueness and delete guard', () => {
  test('creating a set with an existing number (any case/spacing) is 409', async () => {
    routeSql([PROD_EXISTS, [/LOWER\(TRIM\(set_number\)\) = LOWER\(TRIM\(\$2\)\)/, [{ 1: 1 }]]]);
    const res = await request(app).post(`/api/productions/${PROD}/sets`).set(authHeader('md')).send({ set_number: ' 100 ', set_name: 'Again' });
    expect(res.status).toBe(409);
    expect(ran(/INSERT INTO sets/)).toHaveLength(0);
  });

  test('a unique-index race still returns 409, not 500', async () => {
    routeSql([PROD_EXISTS, [/INSERT INTO sets/, Object.assign(new Error('dup'), { code: '23505' })]]);
    const res = await request(app).post(`/api/productions/${PROD}/sets`).set(authHeader('md')).send({ set_number: '100', set_name: 'Again' });
    expect(res.status).toBe(409);
  });

  test('sets without a number can still be created freely', async () => {
    routeSql([PROD_EXISTS, [/INSERT INTO sets/, [{ id: SET }]]]);
    const res = await request(app).post(`/api/productions/${PROD}/sets`).set(authHeader('md')).send({ set_name: 'TBC' });
    expect(res.status).toBe(201);
    expect(ran(/LOWER\(TRIM\(set_number\)\) = LOWER\(TRIM\(\$2\)\)/)).toHaveLength(0);
  });

  test('renaming a set to another set\'s number is 409; keeping its own number is fine', async () => {
    routeSql([PROD_EXISTS, [/id <> \$3::uuid/, (sql, p) => (p[1] === '200' ? [{ 1: 1 }] : [])], [/UPDATE sets SET/, [{ id: SET }]]]);
    expect((await request(app).put(`/api/productions/${PROD}/sets/${SET}`).set(authHeader('md')).send({ set_number: '200' })).status).toBe(409);
    expect((await request(app).put(`/api/productions/${PROD}/sets/${SET}`).set(authHeader('md')).send({ set_number: '100' })).status).toBe(200);
  });

  test('a set used on timesheet days cannot be deleted', async () => {
    routeSql([PROD_EXISTS, [/SELECT set_number FROM sets/, [{ set_number: '100' }]], [/FROM timesheet_entries te/, [{ cnt: '3' }]]]);
    const res = await request(app).delete(`/api/productions/${PROD}/sets/${SET}`).set(authHeader('md'));
    expect(res.status).toBe(400);
    expect(ran(/DELETE FROM sets/)).toHaveLength(0);
  });
});

describe('date parsing', () => {
  const { _parseDate } = require('../Controllers/setCodesController');
  test.each([
    ['2026-12-04', '2026-12-04'], ['4/12/2026', '2026-12-04'], ['', null], ['31/02/2026', undefined], ['2026-13-01', undefined], ['soon', undefined],
  ])('%s → %s', (input, out) => expect(_parseDate(input)).toBe(out));
});
