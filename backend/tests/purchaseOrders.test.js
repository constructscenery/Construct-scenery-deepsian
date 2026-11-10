'use strict';
/**
 * Purchase Orders controller tests
 * Tests: getAllPOs, createPO, updatePO, deletePO, submitPO, approvePO
 * Access (per tender):
 *   Create/edit/delete/submit: Coordinator only
 *   Approve:                   Accountant only
 *   Read:                      MD (+ Coordinator + Accountant)
 */

const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');

jest.mock('../services/costReportService', () => ({
  recordSupplierCost: jest.fn().mockResolvedValue(undefined),
  softDeleteEntry:    jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/poPdfService', () => ({
  ...jest.requireActual('../services/poPdfService'),
  generatePoPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
}));

const { sendEmail, templates } = require('../config/email');
templates.poIssued = () => ({ subject: 'PO', html: '<p>po</p>' });

const poRouter = require('../routes/purchaseOrders');
const app = makeApp(['/api/purchase-orders', poRouter]);

const SAMPLE_PO = {
  id: 'po-001', po_number: 'PO-0001', supplier_name: 'Treeline Timber',
  production_id: 'prod-1', net_amount: '500.00', vat: '100.00', gross_amount: '600.00',
  status: 'draft', prod_id: 'prod-1', prod_name: 'Star Wars',
};

beforeEach(() => dbMock.reset());

// ─── GET /api/purchase-orders ─────────────────────────────────────────────────
describe('GET /api/purchase-orders', () => {
  test('All three roles can list — 200', async () => {
    for (const role of ['md', 'accountant', 'coordinator']) {
      dbMock.respond([SAMPLE_PO]);
      const res = await request(app).get('/api/purchase-orders').set(authHeader(role));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    }
  });

  test('No auth → 401', async () => {
    const res = await request(app).get('/api/purchase-orders');
    expect(res.status).toBe(401);
  });

  test.each([
    ['current',   /p\.status != \$\d+/],
    ['completed', /p\.status = \$\d+/],
  ])('production_scope=%s filters by completed productions', async (scope, re) => {
    dbMock.respond([SAMPLE_PO]);
    const res = await request(app).get(`/api/purchase-orders?production_scope=${scope}`).set(authHeader('md'));
    expect(res.status).toBe(200);
    const { sql, params } = dbMock.queries[0];
    expect(sql).toMatch(re);
    expect(params).toContain('complete');
  });

  test('No production_scope → no completed-production filter (other callers unchanged)', async () => {
    dbMock.respond([SAMPLE_PO]);
    await request(app).get('/api/purchase-orders?status=submitted').set(authHeader('md'));
    expect(dbMock.queries[0].params).not.toContain('complete');
  });
});

// ─── POST /api/purchase-orders ────────────────────────────────────────────────
describe('POST /api/purchase-orders', () => {
  const validBody = { supplier_name: 'Treeline Timber', production_id: 'prod-1', net_amount: '500.00' };

  test('Coordinator creates PO — 201', async () => {
    dbMock.respond([{ status: 'active_build' }]);              // production lookup
    dbMock.respond({ rows: [{ max_num: 3 }] });                 // generatePoNumber
    dbMock.respond([{ ...SAMPLE_PO, po_number: 'PO-0004' }]);   // INSERT

    const res = await request(app)
      .post('/api/purchase-orders')
      .set(authHeader('coordinator'))
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.po_number).toBe('PO-0004');
  });

  test('MD creates PO — 201', async () => {
    dbMock.respond([{ status: 'active_build' }]);
    dbMock.respond({ rows: [{ max_num: 3 }] });
    dbMock.respond([{ ...SAMPLE_PO, po_number: 'PO-0004' }]);
    const res = await request(app).post('/api/purchase-orders').set(authHeader('md')).send(validBody);
    expect(res.status).toBe(201);
  });

  test('Accountant creates PO — 201', async () => {
    dbMock.respond([{ status: 'active_build' }]);
    dbMock.respond({ rows: [{ max_num: 3 }] });
    dbMock.respond([{ ...SAMPLE_PO, po_number: 'PO-0004' }]);
    const res = await request(app).post('/api/purchase-orders').set(authHeader('accountant')).send(validBody);
    expect(res.status).toBe(201);
  });

  test('No auth → 401', async () => {
    const res = await request(app).post('/api/purchase-orders').send(validBody);
    expect(res.status).toBe(401);
  });
});

// ─── PUT /api/purchase-orders/:id ─────────────────────────────────────────────
describe('PUT /api/purchase-orders/:id', () => {
  test('Coordinator edits draft PO — 200', async () => {
    dbMock.respond([{ status: 'draft' }]);                          // existing status check
    dbMock.respond([{ ...SAMPLE_PO, supplier_name: 'Updated Co' }]); // UPDATE RETURNING

    const res = await request(app)
      .put('/api/purchase-orders/po-001')
      .set(authHeader('coordinator'))
      .send({ supplier_name: 'Updated Co' });

    expect(res.status).toBe(200);
    expect(res.body.supplier_name).toBe('Updated Co');
  });

  test('MD edits draft PO — 200', async () => {
    dbMock.respond([{ status: 'draft' }]);
    dbMock.respond([{ ...SAMPLE_PO, supplier_name: 'X' }]);
    const res = await request(app)
      .put('/api/purchase-orders/po-001')
      .set(authHeader('md'))
      .send({ supplier_name: 'X' });
    expect(res.status).toBe(200);
  });

  test('Accountant edits draft PO — 200', async () => {
    dbMock.respond([{ status: 'draft' }]);
    dbMock.respond([{ ...SAMPLE_PO, supplier_name: 'X' }]);
    const res = await request(app)
      .put('/api/purchase-orders/po-001')
      .set(authHeader('accountant'))
      .send({ supplier_name: 'X' });
    expect(res.status).toBe(200);
  });
});

// ─── DELETE /api/purchase-orders/:id ──────────────────────────────────────────
describe('DELETE /api/purchase-orders/:id', () => {
  test('Coordinator deletes draft PO — 200', async () => {
    dbMock.respond([{ status: 'draft' }]);
    dbMock.respond({ rows: [], rowCount: 1 });
    const res = await request(app).delete('/api/purchase-orders/po-001').set(authHeader('coordinator'));
    expect(res.status).toBe(200);
  });

  test('MD deletes draft PO — 200', async () => {
    dbMock.respond([{ status: 'draft' }]);
    dbMock.respond({ rows: [], rowCount: 1 });
    const res = await request(app).delete('/api/purchase-orders/po-001').set(authHeader('md'));
    expect(res.status).toBe(200);
  });

  test('Accountant deletes draft PO — 200', async () => {
    dbMock.respond([{ status: 'draft' }]);
    dbMock.respond({ rows: [], rowCount: 1 });
    const res = await request(app).delete('/api/purchase-orders/po-001').set(authHeader('accountant'));
    expect(res.status).toBe(200);
  });
});

// ─── POST /api/purchase-orders/:id/submit ─────────────────────────────────────
describe('POST /api/purchase-orders/:id/submit', () => {
  test('Coordinator submits draft PO — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });           // BEGIN
    dbMock.respond([{ ...SAMPLE_PO, status: 'draft' }]); // SELECT
    dbMock.respond([{ ...SAMPLE_PO, status: 'submitted' }]); // UPDATE RETURNING
    dbMock.respond({ rows: [], rowCount: 1 });           // logStatusTransition INSERT
    dbMock.respond({ rows: [], rowCount: 0 });           // COMMIT

    const res = await request(app).post('/api/purchase-orders/po-001/submit').set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(res.body.purchase_order.status).toBe('submitted');
  });

  test('MD submits draft PO — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });           // BEGIN
    dbMock.respond([{ ...SAMPLE_PO, status: 'draft' }]); // SELECT
    dbMock.respond([{ ...SAMPLE_PO, status: 'submitted' }]); // UPDATE RETURNING
    dbMock.respond({ rows: [], rowCount: 1 });           // logStatusTransition INSERT
    dbMock.respond({ rows: [], rowCount: 0 });           // COMMIT
    const res = await request(app).post('/api/purchase-orders/po-001/submit').set(authHeader('md'));
    expect(res.status).toBe(200);
  });

  test('Accountant submits draft PO — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });           // BEGIN
    dbMock.respond([{ ...SAMPLE_PO, status: 'draft' }]); // SELECT
    dbMock.respond([{ ...SAMPLE_PO, status: 'submitted' }]); // UPDATE RETURNING
    dbMock.respond({ rows: [], rowCount: 1 });           // logStatusTransition INSERT
    dbMock.respond({ rows: [], rowCount: 0 });           // COMMIT
    const res = await request(app).post('/api/purchase-orders/po-001/submit').set(authHeader('accountant'));
    expect(res.status).toBe(200);
  });

  test('No auth → 401', async () => {
    const res = await request(app).post('/api/purchase-orders/po-001/submit');
    expect(res.status).toBe(401);
  });

  test('Submitting never emails the supplier', async () => {
    sendEmail.mockClear();
    const withEmail = { ...SAMPLE_PO, status: 'draft', supplier_email: 'sales@treeline.co.uk' };
    dbMock.respond({ rows: [], rowCount: 0 });                  // BEGIN
    dbMock.respond([withEmail]);                                // SELECT
    dbMock.respond([{ ...withEmail, status: 'submitted' }]);    // UPDATE RETURNING
    dbMock.respond({ rows: [], rowCount: 1 });                  // logStatusTransition INSERT
    dbMock.respond({ rows: [], rowCount: 0 });                  // COMMIT
    const res = await request(app).post('/api/purchase-orders/po-001/submit').set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

// ─── POST /api/purchase-orders/:id/issue (manual send to supplier) ───────────────
describe('POST /api/purchase-orders/:id/issue', () => {
  const PO_ID = '11111111-1111-4111-8111-111111111111';
  const base  = { ...SAMPLE_PO, id: PO_ID, supplier_email: 'sales@treeline.co.uk' };

  beforeEach(() => sendEmail.mockClear());

  test.each(['draft', 'submitted', 'invoice_received', 'voided'])('%s PO cannot be sent — 409, no email', async (status) => {
    dbMock.respond([{ ...base, status }]);
    const res = await request(app).post(`/api/purchase-orders/${PO_ID}/issue`).set(authHeader('md'));
    expect(res.status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('Approved PO is emailed once and its status is not changed', async () => {
    dbMock.respond([{ ...base, status: 'approved' }]);
    const res = await request(app).post(`/api/purchase-orders/${PO_ID}/issue`).set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('sales@treeline.co.uk');
    expect(dbMock.queries.some(q => /UPDATE\s+purchase_orders/i.test(q.sql))).toBe(false);
  });

  test('Approved PO without a supplier email — 400', async () => {
    dbMock.respond([{ ...base, status: 'approved', supplier_email: null }]);
    const res = await request(app).post(`/api/purchase-orders/${PO_ID}/issue`).set(authHeader('md'));
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

// ─── POST /api/purchase-orders/:id/approve ────────────────────────────────────
describe('POST /api/purchase-orders/:id/approve', () => {
  const SUBMITTED_WITH_INVOICE = {
    ...SAMPLE_PO, status: 'submitted', invoice_attachment_url: '/uploads/inv.pdf', prod_name: 'Star Wars',
  };

  test('Accountant approves submitted PO with invoice — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });             // BEGIN
    dbMock.respond([SUBMITTED_WITH_INVOICE]);               // SELECT po + prod
    dbMock.respond([{ ...SUBMITTED_WITH_INVOICE, status: 'approved' }]); // UPDATE RETURNING
    dbMock.respond({ rows: [], rowCount: 1 });             // logStatusTransition INSERT
    dbMock.respond({ rows: [], rowCount: 0 });             // COMMIT

    const res = await request(app).post('/api/purchase-orders/po-001/approve').set(authHeader('accountant'));
    expect(res.status).toBe(200);
    expect(res.body.purchase_order.status).toBe('approved');
  });

  test('MD approves submitted PO — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });             // BEGIN
    dbMock.respond([SUBMITTED_WITH_INVOICE]);               // SELECT po + prod
    dbMock.respond([{ ...SUBMITTED_WITH_INVOICE, status: 'approved' }]); // UPDATE RETURNING
    dbMock.respond({ rows: [], rowCount: 1 });             // logStatusTransition INSERT
    dbMock.respond({ rows: [], rowCount: 0 });             // COMMIT
    const res = await request(app).post('/api/purchase-orders/po-001/approve').set(authHeader('md'));
    expect(res.status).toBe(200);
  });

  test('Coordinator approves submitted PO — 200', async () => {
    dbMock.respond({ rows: [], rowCount: 0 });             // BEGIN
    dbMock.respond([SUBMITTED_WITH_INVOICE]);               // SELECT po + prod
    dbMock.respond([{ ...SUBMITTED_WITH_INVOICE, status: 'approved' }]); // UPDATE RETURNING
    dbMock.respond({ rows: [], rowCount: 1 });             // logStatusTransition INSERT
    dbMock.respond({ rows: [], rowCount: 0 });             // COMMIT
    const res = await request(app).post('/api/purchase-orders/po-001/approve').set(authHeader('coordinator'));
    expect(res.status).toBe(200);
  });

  test('No auth → 401', async () => {
    const res = await request(app).post('/api/purchase-orders/po-001/approve');
    expect(res.status).toBe(401);
  });
});

// ─── Department and Date Range Enhancements ───────────────────────────────────
describe('Purchase Orders - Department and Date Range Enhancements', () => {
  beforeEach(() => dbMock.reset());

  test('Coordinator creates PO with department — 201', async () => {
    dbMock.respond([{ status: 'active_build' }]);              // production lookup
    dbMock.respond({ rows: [{ max_num: 3 }] });                 // generatePoNumber
    dbMock.respond([{ ...SAMPLE_PO, po_number: 'PO-0004', department: 'Scenic Art' }]);   // INSERT

    const res = await request(app)
      .post('/api/purchase-orders')
      .set(authHeader('coordinator'))
      .send({ supplier_name: 'Treeline Timber', production_id: 'prod-1', net_amount: '500.00', department: 'Scenic Art' });

    expect(res.status).toBe(201);
    expect(res.body.po_number).toBe('PO-0004');
    expect(res.body.department).toBe('Scenic Art');
  });

  test('Coordinator updates PO department — 200', async () => {
    dbMock.respond([{ status: 'draft' }]);                          // existing status check
    dbMock.respond([{ ...SAMPLE_PO, department: 'Construction' }]); // UPDATE RETURNING

    const res = await request(app)
      .put('/api/purchase-orders/po-001')
      .set(authHeader('coordinator'))
      .send({ department: 'Construction' });

    expect(res.status).toBe(200);
    expect(res.body.department).toBe('Construction');
  });

  test('MD or Accountant can create/update PO department — 201/200', async () => {
    // MD create attempt
    dbMock.respond([{ status: 'active_build' }]);
    dbMock.respond({ rows: [{ max_num: 3 }] });
    dbMock.respond([{ ...SAMPLE_PO, po_number: 'PO-0004', department: 'Scenic Art' }]);
    const res1 = await request(app)
      .post('/api/purchase-orders')
      .set(authHeader('md'))
      .send({ supplier_name: 'Treeline Timber', production_id: 'prod-1', net_amount: '500.00', department: 'Scenic Art' });
    expect(res1.status).toBe(201);

    // Accountant update attempt
    dbMock.respond([{ status: 'draft' }]);
    dbMock.respond([{ ...SAMPLE_PO, department: 'Construction' }]);
    const res2 = await request(app)
      .put('/api/purchase-orders/po-001')
      .set(authHeader('accountant'))
      .send({ department: 'Construction' });
    expect(res2.status).toBe(200);
  });

  test('Filtering by department, date range boundaries, and future dates — 200', async () => {
    dbMock.respond([
      { ...SAMPLE_PO, department: 'Metalwork', date_of_po: '2026-12-25' } // future date
    ]);

    const res = await request(app)
      .get('/api/purchase-orders?department=Metalwork&date_from=2026-06-01&date_to=2027-01-01')
      .set(authHeader('md'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].department).toBe('Metalwork');
    expect(res.body[0].date_of_po).toBe('2026-12-25');
  });
});


// ─── Pro Forma & Actual Invoice / Receipt attachments ─────────────────────────
describe('PO attachments — Pro Forma & Actual Invoice / Receipt', () => {
  const URL_BODY = { invoice_attachment_url: '/uploads/inv.pdf', invoice_attachment_name: 'inv.pdf' };

  test('Invoice can be added to a PO approved on its Pro Forma — status stays approved', async () => {
    dbMock.respond([{ status: 'approved', invoice_attachment_url: null }]);
    dbMock.respond([{ ...SAMPLE_PO, status: 'approved', invoice_attachment_url: '/uploads/inv.pdf' }]);
    const res = await request(app)
      .post('/api/purchase-orders/po-001/attach-invoice')
      .set(authHeader('accountant'))
      .send(URL_BODY);
    expect(res.status).toBe(200);
    expect(res.body.purchase_order.status).toBe('approved');
    const update = dbMock.queries.find(c => /UPDATE purchase_orders/.test(c.sql));
    expect(update.params[2]).toBe('approved');
  });

  test('Existing invoice on an approved PO cannot be replaced — 400', async () => {
    dbMock.respond([{ status: 'approved', invoice_attachment_url: '/uploads/old.pdf' }]);
    const res = await request(app)
      .post('/api/purchase-orders/po-001/attach-invoice')
      .set(authHeader('accountant'))
      .send(URL_BODY);
    expect(res.status).toBe(400);
  });

  test('Invoice on a draft PO keeps it in draft', async () => {
    dbMock.respond([{ status: 'draft', invoice_attachment_url: null }]);
    dbMock.respond([{ ...SAMPLE_PO, status: 'draft' }]);
    const res = await request(app)
      .post('/api/purchase-orders/po-001/attach-invoice')
      .set(authHeader('coordinator'))
      .send(URL_BODY);
    expect(res.status).toBe(200);
    const update = dbMock.queries.find(c => /UPDATE purchase_orders/.test(c.sql));
    expect(update.params[2]).toBe('draft');
  });

  test('Invoice on a voided PO — 400', async () => {
    dbMock.respond([{ status: 'voided', invoice_attachment_url: null }]);
    const res = await request(app)
      .post('/api/purchase-orders/po-001/attach-invoice')
      .set(authHeader('coordinator'))
      .send(URL_BODY);
    expect(res.status).toBe(400);
  });

  test('Delete Pro Forma on a draft PO — 200', async () => {
    dbMock.respond([{ status: 'draft', confirmation_attachment_url: '/uploads/pf.pdf' }]);
    dbMock.respond({ rows: [], rowCount: 1 });
    const res = await request(app).delete('/api/purchase-orders/po-001/confirmation').set(authHeader('coordinator'));
    expect(res.status).toBe(200);
  });

  test('Delete Pro Forma on an approved PO — 403', async () => {
    dbMock.respond([{ status: 'approved', confirmation_attachment_url: '/uploads/pf.pdf' }]);
    const res = await request(app).delete('/api/purchase-orders/po-001/confirmation').set(authHeader('coordinator'));
    expect(res.status).toBe(403);
  });

  test('Delete Pro Forma when none attached — 404', async () => {
    dbMock.respond([{ status: 'draft', confirmation_attachment_url: null }]);
    const res = await request(app).delete('/api/purchase-orders/po-001/confirmation').set(authHeader('coordinator'));
    expect(res.status).toBe(404);
  });

  test('Delete Pro Forma — no auth → 401', async () => {
    const res = await request(app).delete('/api/purchase-orders/po-001/confirmation');
    expect(res.status).toBe(401);
  });
});
