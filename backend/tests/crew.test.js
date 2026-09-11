'use strict';
/**
 * Crew controller tests
 * Tests: list, create, getById, update, delete, bulk import (preview + commit)
 */

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const crewRouter = require('../routes/crew');
const app = makeApp(['/api/crew', crewRouter]);

const SAMPLE_CREW = {
  id: 'cm-001',
  crew_number: 'CS001',
  first_name: 'John',
  last_name: 'Smith',
  employment_status: 'paye',
  crew_trade: 'Carpenters',
  crew_rank: 'Carpenter',
  is_active: true,
  home_address: null,
  account_name: null,
  account_number: null,
  sort_code: null,
  emergency_contact_phone: null,
};

beforeEach(() => dbMock.reset());

// ─── GET /api/crew ────────────────────────────────────────────────────────────
describe('GET /api/crew', () => {
  test('MD can list crew — returns 200 with array', async () => {
    dbMock.respond([SAMPLE_CREW]);
    const res = await request(app).get('/api/crew').set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].crew_number).toBe('CS001');
  });

  test('Coordinator can list crew — returns 200', async () => {
    dbMock.respond([SAMPLE_CREW]);
    const res = await request(app).get('/api/crew').set(authHeader('coordinator'));
    expect(res.status).toBe(200);
  });

  test('No token → 401', async () => {
    const res = await request(app).get('/api/crew');
    expect(res.status).toBe(401);
  });

  test('?search= filters results', async () => {
    dbMock.respond([SAMPLE_CREW]);
    const res = await request(app)
      .get('/api/crew?search=John')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(dbMock.query).toHaveBeenCalled();
  });
});

// ─── POST /api/crew ───────────────────────────────────────────────────────────
describe('POST /api/crew', () => {
  const validBody = {
    first_name: 'Jane', last_name: 'Doe',
    employment_status: 'self_employed',
    crew_trade: 'Painters', crew_rank: 'Painter',
  };

  test('Accountant creates crew — returns 201', async () => {
    dbMock.respond({ rows: [{ max_num: 3 }] });
    dbMock.respond([{ ...SAMPLE_CREW, crew_number: 'CSC-0004' }]);
    const res = await request(app)
      .post('/api/crew')
      .set(authHeader('accountant'))
      .send(validBody);
    expect(res.status).toBe(201);
  });

  test('Coordinator creates crew — returns 201', async () => {
    dbMock.respond({ rows: [{ max_num: 4 }] });
    dbMock.respond([{ ...SAMPLE_CREW, crew_number: 'CSC-0005' }]);
    const res = await request(app)
      .post('/api/crew')
      .set(authHeader('coordinator'))
      .send(validBody);
    expect(res.status).toBe(201);
  });

  test('MD creates crew member — 201', async () => {
    dbMock.respond({ rows: [{ max_num: 1 }] });
    dbMock.respond([{ ...SAMPLE_CREW, first_name: 'Jane' }]);
    const res = await request(app)
      .post('/api/crew')
      .set(authHeader('md'))
      .send(validBody);
    expect(res.status).toBe(201);
  });

  test('Missing required fields → 400', async () => {
    const res = await request(app)
      .post('/api/crew')
      .set(authHeader('accountant'))
      .send({ first_name: 'Jane' });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/crew/:id ────────────────────────────────────────────────────────
describe('GET /api/crew/:id', () => {
  test('returns crew member with history', async () => {
    dbMock.respond([SAMPLE_CREW]);         // main crew query
    dbMock.respond([]);                    // production_history
    dbMock.respond([]);                    // timesheet_history
    dbMock.respond([]);                    // documents
    const res = await request(app)
      .get('/api/crew/cm-001')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body.crew_number).toBe('CS001');
  });

  test('returns 404 when not found', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .get('/api/crew/nonexistent')
      .set(authHeader('md'));
    expect(res.status).toBe(404);
  });
});

// ─── PUT /api/crew/:id ────────────────────────────────────────────────────────
describe('PUT /api/crew/:id', () => {
  test('Accountant updates crew — returns 200', async () => {
    dbMock.respond([{ ...SAMPLE_CREW, first_name: 'Updated' }]);
    const res = await request(app)
      .put('/api/crew/cm-001')
      .set(authHeader('accountant'))
      .send({ first_name: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.first_name).toBe('Updated');
  });

  test('MD updates crew member — 200', async () => {
    dbMock.respond([{ ...SAMPLE_CREW, first_name: 'Updated' }]);
    const res = await request(app)
      .put('/api/crew/cm-001')
      .set(authHeader('md'))
      .send({ first_name: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.first_name).toBe('Updated');
  });
});

// ─── DELETE /api/crew/:id ─────────────────────────────────────────────────────
describe('DELETE /api/crew/:id', () => {
  test('Coordinator soft-deletes crew member', async () => {
    dbMock.respond([SAMPLE_CREW]);                   // fetch crew member
    dbMock.respond([{ has_records: false }]);        // check for linked records
    dbMock.respond({ rows: [], rowCount: 1 });       // DELETE or UPDATE
    const res = await request(app)
      .delete('/api/crew/cm-001')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
  });

  test('MD soft-deletes crew member — 200', async () => {
    dbMock.respond([SAMPLE_CREW]);
    dbMock.respond([{ has_records: false }]);
    dbMock.respond({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete('/api/crew/cm-001')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/crew/import/template ───────────────────────────────────────────
describe('GET /api/crew/import/template', () => {
  test('returns CSV template file', async () => {
    const res = await request(app)
      .get('/api/crew/import/template')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('First Name');
  });
});

// ─── POST /api/crew/import/preview ───────────────────────────────────────────
describe('POST /api/crew/import/preview', () => {
  test('validates CSV and returns per-row preview', async () => {
    dbMock.respond([{ trade: 'Carpenters' }]);   // known trades
    dbMock.respond([]);                           // existing crew (no duplicates)

    const csv = Buffer.from(
      'First Name,Last Name,Date of Birth,Home Address,Employment Status,Crew Trade,Crew Rank,PAYE Withholding Rate,Company/Business Name,Company Registration Number or UTR,VAT Registration Number,Account Name,Account Number,Sort Code,Emergency Contact Name,Emergency Contact Relationship,Emergency Contact Phone\n' +
      'John,Smith,1990-01-01,,PAYE,Carpenters,Carpenter,20,,,,,,,,,'
    );

    const res = await request(app)
      .post('/api/crew/import/preview')
      .set(authHeader('coordinator'))
      .attach('csv', csv, 'test.csv');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_rows', 1);
    expect(res.body).toHaveProperty('valid_rows');
    expect(Array.isArray(res.body.preview)).toBe(true);
  });

  test('returns error when no file uploaded', async () => {
    const res = await request(app)
      .post('/api/crew/import/preview')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/crew/import ────────────────────────────────────────────────────
describe('POST /api/crew/import', () => {
  test('creates crew records from valid CSV', async () => {
    dbMock.respond([{ trade: 'Carpenters' }]);   // known trades
    dbMock.respond([]);                           // existing crew (email + account_number)
    // generateCrewNumber query
    dbMock.respond({ rows: [{ max_num: null }] });
    dbMock.respond({ rows: [], rowCount: 1 });    // INSERT

    const csv = Buffer.from(
      'First Name,Last Name,Date of Birth,Home Address,Employment Status,Crew Trade,Crew Rank,PAYE Withholding Rate,Company/Business Name,Company Registration Number or UTR,VAT Registration Number,Account Name,Account Number,Sort Code,Emergency Contact Name,Emergency Contact Relationship,Emergency Contact Phone\n' +
      'Jane,Doe,1985-05-10,,Self-Employed,Carpenters,HOD,,,,,,,,,,'
    );

    const res = await request(app)
      .post('/api/crew/import')
      .set(authHeader('coordinator'))
      .attach('csv', csv, 'import.csv');

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('total_rows');
    expect(res.body).toHaveProperty('created');
    expect(res.body).toHaveProperty('skipped');
  });
});
