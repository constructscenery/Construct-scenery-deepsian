'use strict';
/**
 * Crew Rates controller tests
 * Tests: getRates, getHistory, updateRate, previewCSV, importCSV
 * Access: MD, Accountant, Coordinator (write); guest read-only (RC-03); all roles (read)
 */

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const router = require('../routes/crewRates');
const app = makeApp(['/api/crew-rates', router]);

const SAMPLE_RATE = {
  id: 'cr-001', trade: 'Carpenters', rank: 'HOD',
  daily_rate: '430.00', overtime_rate: '64.50', weekly_rate: '2150.00',
  rate_year: '2026/27', rate_type: 'bectu',
  effective_from: '2026-04-06', effective_to: null,
};
const NON_BECTU_RATE = {
  id: 'cr-nb-001', trade: 'Construction Accountant', rank: 'Construction Accountant',
  daily_rate: '350.00', overtime_rate: '52.50', weekly_rate: '1750.00',
  rate_year: '2026/27', rate_type: 'non_bectu',
  effective_from: '2026-04-06', effective_to: null,
};

beforeEach(() => dbMock.reset());

// ─── GET /api/crew-rates ──────────────────────────────────────────────────────
describe('GET /api/crew-rates', () => {
  test('All authenticated roles can list rates — 200', async () => {
    for (const role of ['md', 'accountant', 'coordinator']) {
      dbMock.respond([SAMPLE_RATE]);
      const res = await request(app)
        .get('/api/crew-rates')
        .set(authHeader(role));
      expect(res.status).toBe(200);
      expect(res.body[0].trade).toBe('Carpenters');
    }
  });

  test('?current=true filters active rates', async () => {
    dbMock.respond([SAMPLE_RATE]);
    const res = await request(app)
      .get('/api/crew-rates?current=true')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('effective_to IS NULL'), expect.anything()
    );
  });

  test('No auth → 401', async () => {
    const res = await request(app).get('/api/crew-rates');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/crew-rates/history ─────────────────────────────────────────────
describe('GET /api/crew-rates/history', () => {
  test('Returns historical rates grouped by rate_year', async () => {
    dbMock.respond([
      { ...SAMPLE_RATE, effective_to: '2026-04-05', rate_year: '2025/26' },
    ]);
    const res = await request(app)
      .get('/api/crew-rates/history')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length) {
      expect(res.body[0]).toHaveProperty('rate_year');
      expect(res.body[0]).toHaveProperty('rows');
    }
  });
});

// ─── PATCH /api/crew-rates/:id  (RC-03: versioned) ───────────────────────────
// Query order: BEGIN → SELECT … FOR UPDATE → (close + INSERT | correct in place) → COMMIT → audit.
const OPEN = { rows: [], rowCount: 0 };                       // BEGIN / COMMIT / ROLLBACK
const current = (r, startsToday = false) => [{ ...r, starts_today_or_later: startsToday, today: '2026-11-27' }];
const sqlOf = () => dbMock.queries.map(q => q.sql).join('\n');

describe('PATCH /api/crew-rates/:id', () => {
  test('Accountant changes a non-BECTU rate — new version from today', async () => {
    dbMock.respond(OPEN, current(NON_BECTU_RATE), { rows: [], rowCount: 1 },
      [{ ...NON_BECTU_RATE, id: 'cr-nb-002', daily_rate: '360.00', effective_from: '2026-11-27' }]);
    const res = await request(app)
      .patch('/api/crew-rates/cr-nb-001')
      .set(authHeader('accountant'))
      .send({ daily_rate: '360.00' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('cr-nb-002');
    expect(res.body.daily_rate).toBe('360.00');
    expect(sqlOf()).toMatch(/SET effective_to = \(now\(\) AT TIME ZONE 'Europe\/London'\)::date - 1/);
    expect(sqlOf()).toMatch(/INSERT INTO bectu_rates/);
  });

  test('Accountant sets a commercial rate on a BECTU rate — 200', async () => {
    dbMock.respond(OPEN, current(SAMPLE_RATE), { rows: [], rowCount: 1 },
      [{ ...SAMPLE_RATE, id: 'cr-002', commercial_daily_rate: '500.00', effective_from: '2026-11-27' }]);
    const res = await request(app)
      .patch('/api/crew-rates/cr-001')
      .set(authHeader('accountant'))
      .send({ commercial_daily_rate: 500, change_note: 'Agreed rate' });
    expect(res.status).toBe(200);
    expect(res.body.commercial_daily_rate).toBe('500.00');
    const insert = dbMock.queries.find(q => /INSERT INTO bectu_rates/.test(q.sql));
    expect(insert.params).toEqual(expect.arrayContaining([500, 'Agreed rate']));
  });

  test('MD and Coordinator can change rates — 200', async () => {
    for (const role of ['md', 'coordinator']) {
      dbMock.reset();
      dbMock.respond(OPEN, current(SAMPLE_RATE), { rows: [], rowCount: 1 }, [{ ...SAMPLE_RATE, id: 'cr-003', daily_rate: '300.00' }]);
      const res = await request(app).patch('/api/crew-rates/cr-001').set(authHeader(role)).send({ daily_rate: '300' });
      expect(res.status).toBe(200);
    }
  });

  test('Guest cannot change rates — 403', async () => {
    const res = await request(app).patch('/api/crew-rates/cr-001').set(authHeader('guest')).send({ daily_rate: '300' });
    expect(res.status).toBe(403);
    expect(dbMock.queries.length).toBe(0);
  });

  test('Second change on the day a version started corrects it in place', async () => {
    dbMock.respond(OPEN, current({ ...SAMPLE_RATE, effective_from: '2026-11-27' }, true),
      [{ ...SAMPLE_RATE, daily_rate: '440.00', effective_from: '2026-11-27' }]);
    const res = await request(app).patch('/api/crew-rates/cr-001').set(authHeader('accountant')).send({ daily_rate: 440 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('cr-001');
    expect(sqlOf()).not.toMatch(/INSERT INTO bectu_rates/);
  });

  test('Same values → 200, nothing written', async () => {
    dbMock.respond(OPEN, current(SAMPLE_RATE), OPEN, [SAMPLE_RATE]);
    const res = await request(app).patch('/api/crew-rates/cr-001').set(authHeader('accountant')).send({ daily_rate: '430' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('cr-001');
    expect(sqlOf()).not.toMatch(/INSERT INTO bectu_rates|UPDATE bectu_rates/);
  });

  test('Old version → 409 with the current id', async () => {
    dbMock.respond(OPEN, current({ ...SAMPLE_RATE, effective_to: '2026-11-26' }), OPEN, [{ id: 'cr-002' }]);
    const res = await request(app).patch('/api/crew-rates/cr-001').set(authHeader('accountant')).send({ daily_rate: '440' });
    expect(res.status).toBe(409);
    expect(res.body.current_id).toBe('cr-002');
  });

  test('Invalid values → 400 before touching the database', async () => {
    for (const body of [{ daily_rate: -1 }, { commercial_daily_rate: 'abc' }, { weekly_rate: 100001 },
      { overtime_rate: 1.234 }, {}, { daily_rate: 1, change_note: 'x'.repeat(501) }]) {
      const res = await request(app).patch('/api/crew-rates/cr-001').set(authHeader('accountant')).send(body);
      expect(res.status).toBe(400);
    }
    expect(dbMock.queries.length).toBe(0);
  });

  test('Rate not found → 404', async () => {
    dbMock.respond(OPEN, []);
    const res = await request(app)
      .patch('/api/crew-rates/bad-id')
      .set(authHeader('accountant'))
      .send({ daily_rate: '400' });
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/crew-rates/:id/versions ────────────────────────────────────────
describe('GET /api/crew-rates/:id/versions', () => {
  test('Every role (guest included) can read a grade\'s versions — newest first', async () => {
    for (const role of ['md', 'accountant', 'coordinator', 'guest']) {
      dbMock.reset();
      dbMock.respond([{ trade: 'Carpenters', rank: 'HOD' }],
        [{ ...SAMPLE_RATE, id: 'cr-002', effective_from: '2026-11-27', created_by_name: 'Warren MD' }, { ...SAMPLE_RATE, effective_to: '2026-11-26' }]);
      const res = await request(app).get('/api/crew-rates/cr-001/versions').set(authHeader(role));
      expect(res.status).toBe(200);
      expect(res.body[0].id).toBe('cr-002');
    }
  });

  test('Unknown rate → 404', async () => {
    dbMock.respond([]);
    const res = await request(app).get('/api/crew-rates/nope/versions').set(authHeader('md'));
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/crew-rates/preview ────────────────────────────────────────────
describe('POST /api/crew-rates/preview', () => {
  test('Accountant previews CSV changes — 200 with diff', async () => {
    dbMock.respond([SAMPLE_RATE]);    // current active BECTU rates

    const csv = Buffer.from(
      'trade,rank,daily_rate,overtime_rate\n' +
      'Carpenters,HOD,450.00,67.50\n' +
      'Carpenters,Carpenter,340.00,51.00'
    );

    const res = await request(app)
      .post('/api/crew-rates/preview')
      .set(authHeader('accountant'))
      .field('effective_from', '2027-04-06')
      .field('rate_year', '2027/28')
      .attach('csv', csv, 'rates.csv');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rate_year', '2027/28');
    expect(res.body).toHaveProperty('row_count');
    expect(res.body).toHaveProperty('changes');
    expect(Array.isArray(res.body.changes)).toBe(true);
  });

  test('MD previews CSV changes — 200 with diff', async () => {
    dbMock.respond([SAMPLE_RATE]);
    const csv = Buffer.from('trade,rank,daily_rate,overtime_rate\nCarpenters,HOD,450,67.5');
    const res = await request(app)
      .post('/api/crew-rates/preview')
      .set(authHeader('md'))
      .field('effective_from', '2027-04-06')
      .field('rate_year', '2027/28')
      .attach('csv', csv, 'r.csv');
    expect(res.status).toBe(200);
  });

  test('Missing effective_from → 400', async () => {
    const csv = Buffer.from('trade,rank,daily_rate,overtime_rate\nCarpenters,HOD,450,67.5');
    const res = await request(app)
      .post('/api/crew-rates/preview')
      .set(authHeader('accountant'))
      .field('rate_year', '2027/28')
      .attach('csv', csv, 'r.csv');
    expect(res.status).toBe(400);
  });

  test('No file → 400', async () => {
    const res = await request(app)
      .post('/api/crew-rates/preview')
      .set(authHeader('accountant'))
      .field('effective_from', '2027-04-06')
      .field('rate_year', '2027/28');
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/crew-rates/import ─────────────────────────────────────────────
describe('POST /api/crew-rates/import', () => {
  test('Accountant imports new rate card — 200 with inserted count', async () => {
    dbMock.respond({ rows: [], rowCount: 1 });  // UPDATE expire old
    dbMock.respond({ rows: [], rowCount: 1 });  // INSERT new

    const csv = Buffer.from(
      'trade,rank,daily_rate,overtime_rate\n' +
      'Carpenters,HOD,450.00,67.50'
    );

    const res = await request(app)
      .post('/api/crew-rates/import')
      .set(authHeader('accountant'))
      .field('effective_from', '2027-04-06')
      .field('rate_year', '2027/28')
      .attach('csv', csv, 'rates.csv');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('inserted');
    expect(res.body).toHaveProperty('expired');
    expect(res.body.rate_year).toBe('2027/28');
  });

  test('MD imports rate card — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 1 });
    dbMock.respond({ rows: [], rowCount: 1 });
    const csv = Buffer.from('trade,rank,daily_rate,overtime_rate\nCarpenters,HOD,450,67.5');
    const res = await request(app)
      .post('/api/crew-rates/import')
      .set(authHeader('md'))
      .field('effective_from', '2027-04-06')
      .field('rate_year', '2027/28')
      .attach('csv', csv, 'r.csv');
    expect(res.status).toBe(200);
  });

  test('Coordinator imports rate card — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 1 });
    dbMock.respond({ rows: [], rowCount: 1 });
    const csv = Buffer.from('trade,rank,daily_rate,overtime_rate\nCarpenters,HOD,450,67.5');
    const res = await request(app)
      .post('/api/crew-rates/import')
      .set(authHeader('coordinator'))
      .field('effective_from', '2027-04-06')
      .field('rate_year', '2027/28')
      .attach('csv', csv, 'r.csv');
    expect(res.status).toBe(200);
  });

  test('Import dated on/before the current version → 400, nothing imported (RC-03)', async () => {
    dbMock.respond(OPEN, [{ trade: 'Carpenters', rank: 'HOD', rate_year: '2026/27', effective_from: '2027-05-01',
      commercial_daily_rate: null, commercial_overtime_rate: null, commercial_weekly_rate: null }]);
    const csv = Buffer.from('trade,rank,daily_rate,overtime_rate\nCarpenters,HOD,450,67.5');
    const res = await request(app)
      .post('/api/crew-rates/import')
      .set(authHeader('accountant'))
      .field('effective_from', '2027-04-06')
      .field('rate_year', '2027/28')
      .attach('csv', csv, 'r.csv');
    expect(res.status).toBe(400);
    expect(res.body.blocked[0]).toMatchObject({ trade: 'Carpenters', rank: 'HOD' });
    expect(dbMock.queries.map(q => q.sql).join('\n')).not.toMatch(/INSERT INTO bectu_rates/);
  });

  test('Preview warns when Set commercial rates will not carry into the new year', async () => {
    dbMock.respond([SAMPLE_RATE], [{ trade: 'Carpenters', rank: 'HOD', rate_year: '2026/27', effective_from: '2026-04-06',
      commercial_daily_rate: '480.00', commercial_overtime_rate: null, commercial_weekly_rate: null }]);
    const csv = Buffer.from('trade,rank,daily_rate,overtime_rate\nCarpenters,HOD,450,67.5');
    const res = await request(app)
      .post('/api/crew-rates/preview')
      .set(authHeader('accountant'))
      .field('effective_from', '2027-07-01')
      .field('rate_year', '2027/28')
      .attach('csv', csv, 'r.csv');
    expect(res.status).toBe(200);
    expect(res.body.blocked).toEqual([]);
    expect(res.body.commercial_overrides_not_carried).toHaveLength(1);
  });
});
