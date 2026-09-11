'use strict';
/**
 * Supplier Catalogue tests
 * Tests: list, getSupplierNames, getTemplate, createEntry, updateEntry, deleteEntry, importCSV
 * Access: Coordinator (full write), MD (full via *), Accountant (read-only)
 */

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

const router = require('../routes/materialsCatalogue');
const app = makeApp(['/api/materials-catalogue', router]);

const SAMPLE_ITEM = {
  id: 'sc-001', supplier_name: 'Wickes', product_description: 'Timber 4x2',
  unit_of_measure: 'metre', unit_price: 12.50, notes: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => dbMock.reset());

// ─── GET /api/materials-catalogue ─────────────────────────────────────────────
describe('GET /api/materials-catalogue', () => {
  test('Coordinator lists catalogue — 200', async () => {
    dbMock.respond([SAMPLE_ITEM]);
    const res = await request(app)
      .get('/api/materials-catalogue')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.body[0].supplier_name).toBe('Wickes');
  });

  test('Accountant lists catalogue (read-only) — 200', async () => {
    dbMock.respond([SAMPLE_ITEM]);
    const res = await request(app)
      .get('/api/materials-catalogue')
      .set(authHeader('accountant'));
    expect(res.status).toBe(200);
  });

  test('?supplier= filter passes to query', async () => {
    dbMock.respond([SAMPLE_ITEM]);
    const res = await request(app)
      .get('/api/materials-catalogue?supplier=Wickes')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(dbMock.query).toHaveBeenCalled();
  });
});

// ─── GET /api/materials-catalogue/suppliers ────────────────────────────────────
describe('GET /api/materials-catalogue/suppliers', () => {
  test('Returns array of distinct supplier names', async () => {
    dbMock.respond([{ supplier_name: 'Wickes' }, { supplier_name: 'B&Q' }]);
    const res = await request(app)
      .get('/api/materials-catalogue/suppliers')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['Wickes', 'B&Q']);
  });
});

// ─── GET /api/materials-catalogue/template ────────────────────────────────────
describe('GET /api/materials-catalogue/template', () => {
  test('Returns CSV template with correct content-type', async () => {
    const res = await request(app)
      .get('/api/materials-catalogue/template')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('Supplier Name');
  });
});

// ─── POST /api/materials-catalogue ────────────────────────────────────────────
describe('POST /api/materials-catalogue', () => {
  const validBody = {
    supplier_name: 'Travis Perkins',
    product_description: 'Plywood 18mm',
    unit_of_measure: 'sheet',
    unit_price: 45.00,
  };

  test('Coordinator creates entry — 201', async () => {
    dbMock.respond([{ ...SAMPLE_ITEM, ...validBody }]);
    const res = await request(app)
      .post('/api/materials-catalogue')
      .set(authHeader('coordinator'))
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.supplier_name).toBe('Travis Perkins');
  });

  test('Accountant creates entry — 201', async () => {
    dbMock.respond([{ ...SAMPLE_ITEM, ...validBody }]);
    const res = await request(app)
      .post('/api/materials-catalogue')
      .set(authHeader('accountant'))
      .send(validBody);
    expect(res.status).toBe(201);
  });

  test('Missing required fields → 400', async () => {
    const res = await request(app)
      .post('/api/materials-catalogue')
      .set(authHeader('coordinator'))
      .send({ supplier_name: 'Test' });
    expect(res.status).toBe(400);
  });
});

// ─── PATCH /api/materials-catalogue/:id ───────────────────────────────────────
describe('PATCH /api/materials-catalogue/:id', () => {
  test('Coordinator updates entry — 200', async () => {
    dbMock.respond([{ ...SAMPLE_ITEM, unit_price: 15.00 }]);
    const res = await request(app)
      .patch('/api/materials-catalogue/sc-001')
      .set(authHeader('coordinator'))
      .send({ unit_price: 15.00 });
    expect(res.status).toBe(200);
    expect(res.body.unit_price).toBe(15.00);
  });

  test('Not found → 404', async () => {
    dbMock.respond([]);
    const res = await request(app)
      .patch('/api/materials-catalogue/bad-id')
      .set(authHeader('coordinator'))
      .send({ unit_price: 10 });
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/materials-catalogue/:id ──────────────────────────────────────
describe('DELETE /api/materials-catalogue/:id', () => {
  test('Coordinator soft-deletes entry — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete('/api/materials-catalogue/sc-001')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Entry deleted');
  });

  test('Not found → 404', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });
    const res = await request(app)
      .delete('/api/materials-catalogue/bad-id')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/materials-catalogue/import ─────────────────────────────────────
describe('POST /api/materials-catalogue/import', () => {
  test('Coordinator imports CSV — 201 with imported count', async () => {
    dbMock.respond({ rows: [], rowCount: 1 });  // insert row 1
    dbMock.respond({ rows: [], rowCount: 1 });  // insert row 2

    const csv = Buffer.from(
      'Supplier Name,Product Description,Unit of Measure,Unit Price,Notes\n' +
      'Wickes,Timber 4x2,metre,12.50,Good quality\n' +
      'B&Q,Plywood 18mm,sheet,45.00,'
    );

    const res = await request(app)
      .post('/api/materials-catalogue/import')
      .set(authHeader('coordinator'))
      .attach('csv', csv, 'import.csv');

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('imported');
    expect(res.body.imported).toBeGreaterThan(0);
  });

  test('CSV with missing required columns → 400', async () => {
    const csv = Buffer.from('Name,Price\nWickes,12.50');
    const res = await request(app)
      .post('/api/materials-catalogue/import')
      .set(authHeader('coordinator'))
      .attach('csv', csv, 'bad.csv');
    expect(res.status).toBe(400);
  });

  test('No file uploaded → 400', async () => {
    const res = await request(app)
      .post('/api/materials-catalogue/import')
      .set(authHeader('coordinator'));
    expect(res.status).toBe(400);
  });

  test('Accountant → 403', async () => {
    const csv = Buffer.from('Supplier Name,Product Description,Unit of Measure,Unit Price\nW,P,m,5');
    const res = await request(app)
      .post('/api/materials-catalogue/import')
      .set(authHeader('accountant'))
      .attach('csv', csv, 'x.csv');
    expect(res.status).toBe(403);
  });
});
