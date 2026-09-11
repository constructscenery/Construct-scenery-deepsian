'use strict';

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

jest.mock('../services/costReportService', () => ({
  recordSupplierCost: jest.fn().mockResolvedValue(undefined),
  softDeleteEntry:    jest.fn().mockResolvedValue(undefined),
}));

const poRouter = require('../routes/purchaseOrders');
const app = makeApp(['/api/purchase-orders', poRouter]);

beforeEach(() => dbMock.reset());

describe('GET /api/purchase-orders/import/template', () => {
  test('Coordinator can get import template', async () => {
    const res = await request(app)
      .get('/api/purchase-orders/import/template')
      .set(authHeader('coordinator'));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('PO Number,Date,Supplier Name');
  });
});

describe('POST /api/purchase-orders/import', () => {
  test('Coordinator can import valid CSV purchase orders', async () => {
    dbMock.respond([]); // BEGIN
    dbMock.respond([{ id: 'prod-1', status: 'active' }]); // lookup prod
    dbMock.respond([]); // PO check
    dbMock.respond([{ // insert PO
      id: 'po-imported-1',
      po_number: 'PO-9999',
      supplier_name: 'Scenic Arts Ltd',
      date_of_po: '2026-06-27',
      production_id: 'prod-1',
      net_amount: 500,
      vat: 100,
      gross_amount: 600,
      status: 'approved'
    }]);
    dbMock.respond([]); // recordSupplierCost (cost_report_entries insert)
    dbMock.respond([]); // COMMIT

    const csv = Buffer.from(
      'PO Number,Date,Supplier Name,Supplier Email,Street Name,Zip Code,City,County,Production Name,Set Code,Account Code,Description,Department,Net Amount,VAT,Gross Amount,Payment Method,Status\n' +
      'PO-9999,2026-06-27,Scenic Arts Ltd,info@scenicarts.com,12 Studio Lane,M1 2AB,Manchester,Greater Manchester,Demo Production,S001,MAT-001,Scenic paints and brushes,Scenic Art,500.00,100.00,600.00,supplier_account,approved'
    );

    const res = await request(app)
      .post('/api/purchase-orders/import')
      .set(authHeader('coordinator'))
      .attach('csv', csv, 'import.csv');

    expect(res.status).toBe(200);
    expect(res.body.total_rows).toBe(1);
    expect(res.body.imported_count).toBe(1);
    expect(res.body.skipped_count).toBe(0);
    expect(res.body.errors.length).toBe(0);
  });

  test('Gracefully skips row with invalid/missing data', async () => {
    // Row 1: Valid
    dbMock.respond([]); // BEGIN
    dbMock.respond([{ id: 'prod-1', status: 'active' }]); // lookup prod
    dbMock.respond([]); // PO check
    dbMock.respond([{ id: 'po-imp-1', po_number: 'PO-100', supplier_name: 'Timber' }]); // insert PO
    dbMock.respond([]); // recordSupplierCost
    dbMock.respond([]); // COMMIT

    // Row 2: Missing Supplier Name (Validation fails before DB queries, but after BEGIN)
    dbMock.respond([]); // BEGIN
    dbMock.respond([]); // ROLLBACK

    // Row 3: Non-existent production name
    dbMock.respond([]); // BEGIN
    dbMock.respond([]); // lookup prod (returns empty)
    dbMock.respond([]); // ROLLBACK

    const csv = Buffer.from(
      'PO Number,Date,Supplier Name,Supplier Email,Street Name,Zip Code,City,County,Production Name,Set Code,Account Code,Description,Department,Net Amount,VAT,Gross Amount,Payment Method,Status\n' +
      'PO-100,2026-06-27,Scenic Arts Ltd,info@scenicarts.com,12 Studio Lane,M1 2AB,Manchester,Greater Manchester,Active Prod,S001,MAT-001,Scenic paints,Scenic Art,500.00,100.00,600.00,supplier_account,approved\n' +
      'PO-101,2026-06-27,,info@scenicarts.com,12 Studio Lane,M1 2AB,Manchester,Greater Manchester,Active Prod,S001,MAT-001,Scenic paints,Scenic Art,500.00,100.00,600.00,supplier_account,approved\n' +
      'PO-102,2026-06-27,Scenic Arts Ltd,info@scenicarts.com,12 Studio Lane,M1 2AB,Manchester,Greater Manchester,Fake Prod,S001,MAT-001,Scenic paints,Scenic Art,500.00,100.00,600.00,supplier_account,approved'
    );

    const res = await request(app)
      .post('/api/purchase-orders/import')
      .set(authHeader('coordinator'))
      .attach('csv', csv, 'import.csv');

    expect(res.status).toBe(200);
    expect(res.body.total_rows).toBe(3);
    expect(res.body.imported_count).toBe(1);
    expect(res.body.skipped_count).toBe(2);
    expect(res.body.errors.length).toBe(2);

    expect(res.body.errors[0].row).toBe(3);
    expect(res.body.errors[0].error).toContain('Supplier Name is required');

    expect(res.body.errors[1].row).toBe(4);
    expect(res.body.errors[1].error).toContain('Production "Fake Prod" not found');
  });

  test('MD and Accountant are permitted to upload PO CSV — not 403', async () => {
    const csv = Buffer.from('PO Number,Date,Supplier Name\nPO-100,2026-06-27,Scenic Arts Ltd');

    for (const role of ['md', 'accountant']) {
      dbMock.respond([{ id: 'p-1', name: 'Active Prod', status: 'active_build' }]);
      dbMock.respond([]); // BEGIN
      dbMock.respond([]); // ROLLBACK

      const res = await request(app)
        .post('/api/purchase-orders/import')
        .set(authHeader(role))
        .attach('csv', csv, 'import.csv');

      expect(res.status).not.toBe(403);
    }
  });
});
