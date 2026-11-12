const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');
const app = makeApp(['/api/sales', require('../routes/sales')]);

const INV_ID = '55555555-5555-5555-5555-555555555555';
const PROD_ID = '66666666-6666-6666-6666-666666666666';

const invoice = (over = {}) => ({
  id: INV_ID,
  xero_invoice_id: 'xero-abc',
  invoice_number: 'INV-0041',
  contact_name: 'Phantom Productions Ltd',
  invoice_date: '2026-10-01',
  due_date: '2026-10-31',
  total: '4200.00',
  amount_paid: '0.00',
  amount_credited: '0.00',
  amount_due: '4200.00',
  xero_status: 'authorised',
  reference: 'PHAN-UK',
  production_id: null,
  production_name: null,
  sales_status: 'overdue',
  ...over,
});

const originalQuery = dbMock.query.getMockImplementation();
function routeSql(handlers) {
  dbMock.query.mockImplementation(async (sql, params) => {
    dbMock.queries.push({ sql, params });
    for (const [re, rows] of handlers) {
      if (re.test(sql)) {
        const r = typeof rows === 'function' ? rows(sql, params) : rows;
        return { rows: r, rowCount: r.length };
      }
    }
    return { rows: [], rowCount: 0 };
  });
}
const ran = re => dbMock.queries.find(q => re.test(q.sql));

beforeEach(() => dbMock.reset());
afterEach(() => dbMock.query.mockImplementation(originalQuery));

describe.each(['md', 'accountant', 'coordinator', 'guest'])('sales read access: %s', role => {
  test('lists invoices', async () => {
    routeSql([[/FROM inv/, [invoice()]]]);
    const res = await request(app).get('/api/sales/invoices').set(authHeader(role));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ invoice_number: 'INV-0041', sales_status: 'overdue' });
  });

  test('gets the summary', async () => {
    routeSql([[/GROUP BY production_id/, []]]);
    const res = await request(app).get('/api/sales/summary').set(authHeader(role));
    expect(res.status).toBe(200);
  });
});

describe('invoice list', () => {
  test('only shows authorised and paid Xero invoices, with derived status', async () => {
    routeSql([[/FROM inv/, []]]);
    await request(app).get('/api/sales/invoices').set(authHeader('md'));
    const { sql } = ran(/FROM inv/);
    expect(sql).toContain("'{authorised,paid}'");
    expect(sql).toContain("THEN 'overdue'");
    expect(sql).toContain("Europe/London");
  });

  test('combines status, unallocated, date range and search filters', async () => {
    routeSql([[/FROM inv/, []]]);
    const res = await request(app)
      .get('/api/sales/invoices?status=overdue,outstanding&production_id=unallocated&date_from=2026-10-01&date_to=2026-10-31&search=0041')
      .set(authHeader('md'));
    expect(res.status).toBe(200);
    const q = ran(/FROM inv/);
    expect(q.sql).toContain('production_id IS NULL');
    expect(q.params).toEqual([['overdue', 'outstanding'], '2026-10-01', '2026-10-31', '%0041%']);
  });

  test.each([
    ['status=draft', /Status must be/],
    ['production_id=nope', /Invalid production filter/],
    ['date_from=2026-13-40', /Invalid date_from/],
    ['date_to=2026-02-30', /Invalid date_to/],
    ['date_from=2026-11-01&date_to=2026-10-01', /cannot be after/],
  ])('rejects %s', async (qs, message) => {
    const res = await request(app).get(`/api/sales/invoices?${qs}`).set(authHeader('md'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });
});

describe('CSV export', () => {
  test('exports the filtered view with a header row and BOM', async () => {
    routeSql([[/FROM inv/, [
      invoice({ production_name: 'Les Misérables – National', sales_status: 'outstanding', contact_name: 'Cameron Mackintosh, Ltd' }),
    ]]]);
    const res = await request(app).get('/api/sales/invoices/export?status=outstanding').set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/sales-invoices-\d{4}-\d{2}-\d{2}\.csv/);
    expect(res.text.charCodeAt(0)).toBe(0xFEFF);
    const [header, row] = res.text.slice(1).trim().split('\r\n');
    expect(header).toBe('Invoice No.,Production,Contact,Invoice Date,Due Date,Total,Amount Due,Status,Reference');
    expect(row).toBe('INV-0041,Les Misérables – National,"Cameron Mackintosh, Ltd",2026-10-01,2026-10-31,4200.00,4200.00,Outstanding,PHAN-UK');
  });
});

test('CSV export neutralises text that Excel would run as a formula', async () => {
  routeSql([[/FROM inv/, [invoice({ contact_name: '=HYPERLINK("x")', reference: '-2+3' })]]]);
  const res = await request(app).get('/api/sales/invoices/export').set(authHeader('md'));
  const row = res.text.slice(1).trim().split('\r\n')[1];
  expect(row).toContain(`"'=HYPERLINK(""x"")"`);
  expect(row.endsWith(",'-2+3")).toBe(true);
  expect(row).toContain(',4200.00,4200.00,');
});

describe('allocation', () => {
  test('suggests the production whose code is in the Xero reference', async () => {
    routeSql([
      [/FROM inv WHERE id/, [invoice({ reference: 'PO 778 / phan-uk' })]],
      [/POSITION\(LOWER/, [{ id: PROD_ID, name: 'Phantom – UK Tour', production_code: 'PHAN-UK' }]],
    ]);
    const res = await request(app).get(`/api/sales/invoices/${INV_ID}`).set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.body.suggested_production).toMatchObject({ id: PROD_ID });
    expect(res.body.suggestion_count).toBe(1);
  });

  test('no single suggestion when several productions match', async () => {
    routeSql([
      [/FROM inv WHERE id/, [invoice()]],
      [/POSITION\(LOWER/, [{ id: PROD_ID }, { id: 'other' }]],
    ]);
    const res = await request(app).get(`/api/sales/invoices/${INV_ID}`).set(authHeader('coordinator'));
    expect(res.body.suggested_production).toBeNull();
    expect(res.body.suggestion_count).toBe(2);
  });

  test('allocates an invoice to a production and audits it', async () => {
    routeSql([
      [/FROM xero_invoices xi LEFT JOIN productions/, [{ id: INV_ID, invoice_number: 'INV-0041', production_id: null }]],
      [/FROM productions WHERE id/, [{ id: PROD_ID, name: 'Phantom – UK Tour' }]],
      [/FROM inv WHERE id/, [invoice({ production_id: PROD_ID, production_name: 'Phantom – UK Tour' })]],
    ]);
    const res = await request(app).patch(`/api/sales/invoices/${INV_ID}/allocation`).set(authHeader('coordinator')).send({ production_id: PROD_ID });
    expect(res.status).toBe(200);
    expect(res.body.production_id).toBe(PROD_ID);
    expect(ran(/UPDATE xero_invoices/).params).toEqual([INV_ID, PROD_ID, 'user-coord-001']);
    expect(ran(/INSERT INTO audit_log/)).toBeTruthy();
  });

  test('unallocates with production_id null', async () => {
    routeSql([[/FROM xero_invoices xi LEFT JOIN productions/, [{ id: INV_ID, invoice_number: 'INV-0041', production_id: PROD_ID, production_name: 'Phantom' }]]]);
    const res = await request(app).patch(`/api/sales/invoices/${INV_ID}/allocation`).set(authHeader('md')).send({ production_id: null });
    expect(res.status).toBe(200);
    expect(ran(/UPDATE xero_invoices/).params[1]).toBeNull();
  });

  test('unknown production is 400', async () => {
    routeSql([[/FROM xero_invoices xi LEFT JOIN productions/, [{ id: INV_ID, invoice_number: 'INV-0041', production_id: null }]]]);
    const res = await request(app).patch(`/api/sales/invoices/${INV_ID}/allocation`).set(authHeader('md')).send({ production_id: PROD_ID });
    expect(res.status).toBe(400);
    expect(ran(/UPDATE xero_invoices/)).toBeFalsy();
  });

  test('guest cannot allocate', async () => {
    const res = await request(app).patch(`/api/sales/invoices/${INV_ID}/allocation`).set(authHeader('guest')).send({ production_id: PROD_ID });
    expect(res.status).toBe(403);
  });
});

describe("What's Owed summary", () => {
  test('one row per allocated production plus totals (matches the spec example)', async () => {
    routeSql([[/GROUP BY production_id/, [
      { production_id: 'p1', production_name: 'Hamilton – UK Tour', invoice_count: 1, total_invoiced: '3300.00', received: '3300.00', outstanding: '0', overdue: '0' },
      { production_id: 'p2', production_name: 'Les Misérables – National', invoice_count: 1, total_invoiced: '6750.00', received: '0', outstanding: '6750.00', overdue: '0' },
      { production_id: 'p3', production_name: 'Phantom of the Opera – UK Tour', invoice_count: 1, total_invoiced: '4200.00', received: '0', outstanding: '0', overdue: '4200.00' },
    ]]]);
    const res = await request(app).get('/api/sales/summary').set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body.productions).toHaveLength(3);
    expect(res.body.totals).toEqual({ invoice_count: 3, total_invoiced: 14250, received: 3300, outstanding: 6750, overdue: 4200 });
    expect(ran(/GROUP BY production_id/).sql).toContain('WHERE production_id IS NOT NULL');
  });
});

describe('invoice comments', () => {
  test('says comments are unavailable when Xero is not connected', async () => {
    routeSql([[/SELECT xero_invoice_id FROM inv/, [{ xero_invoice_id: 'xero-abc' }]]]);
    const res = await request(app).get(`/api/sales/invoices/${INV_ID}/notes`).set(authHeader('guest'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, notes: [] });
  });

  test('unknown invoice → 404', async () => {
    routeSql([]);
    const res = await request(app).get(`/api/sales/invoices/${INV_ID}/notes`).set(authHeader('md'));
    expect(res.status).toBe(404);
  });
});

describe('unallocated reminder', () => {
  test('counts invoices unallocated for over 7 days', async () => {
    routeSql([[/first_synced_at/, [{ count: 3 }]]]);
    const res = await request(app).get('/api/sales/unallocated-reminder').set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3, days: 7 });
    expect(ran(/first_synced_at/).sql).toContain("INTERVAL '7 days'");
  });
});
