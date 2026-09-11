'use strict';
/**
 * Crew Rates controller tests
 * Tests: getRates, getHistory, updateRate, previewCSV, importCSV
 * Access: Accountant (write); MD read-only; all roles (read)
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

// ─── PATCH /api/crew-rates/:id ────────────────────────────────────────────────
describe('PATCH /api/crew-rates/:id', () => {
  test('Accountant updates non-BECTU rate — 200', async () => {
    dbMock.respond([NON_BECTU_RATE]);   // existing rate
    dbMock.respond([{ ...NON_BECTU_RATE, daily_rate: '360.00' }]);

    const res = await request(app)
      .patch('/api/crew-rates/cr-nb-001')
      .set(authHeader('accountant'))
      .send({ daily_rate: '360.00' });

    expect(res.status).toBe(200);
    expect(res.body.daily_rate).toBe('360.00');
  });

  test('Cannot edit BECTU rates via PATCH — 400', async () => {
    dbMock.respond([SAMPLE_RATE]);   // rate_type = 'bectu'
    const res = await request(app)
      .patch('/api/crew-rates/cr-001')
      .set(authHeader('accountant'))
      .send({ daily_rate: '500.00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('CSV import');
  });

  test('MD updates rate — 200', async () => {
    dbMock.respond([{ ...SAMPLE_RATE, daily_rate: '300.00' }]);
    const res = await request(app)
      .patch('/api/crew-rates/cr-nb-001')
      .set(authHeader('md'))
      .send({ daily_rate: '300' });
    expect(res.status).toBe(200);
  });

  test('Coordinator updates rate — 200', async () => {
    dbMock.respond([{ ...SAMPLE_RATE, daily_rate: '300.00' }]);
    const res = await request(app)
      .patch('/api/crew-rates/cr-nb-001')
      .set(authHeader('coordinator'))
      .send({ daily_rate: '300' });
    expect(res.status).toBe(200);
  });

  test('Rate not found → 404', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .patch('/api/crew-rates/bad-id')
      .set(authHeader('accountant'))
      .send({ daily_rate: '400' });
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
});
