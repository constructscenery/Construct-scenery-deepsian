const request = require('supertest');
const { makeApp, authHeader, dbMock } = require('./setup');
const app = makeApp(['/api/quotes', require('../routes/quotes')]);

const QUOTE_ID = '11111111-1111-1111-1111-111111111111';
const PROD_ID = '22222222-2222-2222-2222-222222222222';
const LINE_A = '33333333-3333-3333-3333-333333333333';
const LINE_B = '44444444-4444-4444-4444-444444444444';

const draftQuote = (over = {}) => ({
  id: QUOTE_ID,
  reference: 'CSL-Q-0041',
  title: 'Scenic Construction — Les Mis UK Tour',
  quote_date: '2026-11-10',
  valid_until: '2026-12-10',
  recipient_type: 'internal',
  production_id: PROD_ID,
  department: 'Scenic',
  recipient_name: null,
  recipient_company: null,
  recipient_email: null,
  discount_type: null,
  discount_value: '0.00',
  vat_treatment: 'standard',
  subtotal: '0.00',
  status: 'draft',
  po_reference: null,
  ...over,
});

/**
 * Answer queries by matching SQL text, so tests don't depend on the exact number or
 * order of queries (transactions add BEGIN/COMMIT, audit adds an insert, etc.).
 * handlers: [[regex, rows | (sql, params) => rows], ...]; unmatched queries return [].
 */
const originalQuery = dbMock.query.getMockImplementation();
const originalConnect = dbMock.connect.getMockImplementation();
function routeSql(handlers) {
  const answer = async (sql, params) => {
    dbMock.queries.push({ sql, params });
    for (const [re, rows] of handlers) {
      if (re.test(sql)) {
        const r = typeof rows === 'function' ? rows(sql, params) : rows;
        return { rows: r, rowCount: r.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  dbMock.query.mockImplementation(answer);
  dbMock.connect.mockImplementation(async () => ({ query: jest.fn(answer), release: jest.fn() }));
}
const ran = re => dbMock.queries.find(q => re.test(q.sql));

beforeEach(() => dbMock.reset());
afterEach(() => {
  dbMock.query.mockImplementation(originalQuery);
  dbMock.connect.mockImplementation(originalConnect);
});

describe.each(['md', 'accountant', 'coordinator'])('quotes access: %s', role => {
  test('rejects an unknown status filter', async () => {
    const res = await request(app).get('/api/quotes?status=draft,expired').set(authHeader(role));
    expect(res.status).toBe(400);
  });

  test('lists quotes', async () => {
    routeSql([[/FROM quotes q/, [draftQuote({ production_name: 'Les Mis' })]]]);
    const res = await request(app).get('/api/quotes').set(authHeader(role));
    expect(res.status).toBe(200);
    expect(res.body[0].reference).toBe('CSL-Q-0041');
  });

  test('creates an internal quote with a CSL-Q reference', async () => {
    routeSql([
      [/nextval\('quote_reference_seq'\)/, [{ n: '42' }]],
      [/INSERT INTO quotes/, (sql, params) => [draftQuote({ reference: params[0] })]],
    ]);
    const res = await request(app).post('/api/quotes').set(authHeader(role)).send({
      title: 'Scenic Construction', recipient_type: 'internal', production_id: PROD_ID, department: 'Scenic',
    });
    expect(res.status).toBe(201);
    expect(res.body.reference).toBe('CSL-Q-0042');
    expect(res.body.lines).toEqual([]);
  });
});

describe('guest is read-only', () => {
  test('guest can list quotes', async () => {
    routeSql([[/FROM quotes q/, []]]);
    const res = await request(app).get('/api/quotes').set(authHeader('guest'));
    expect(res.status).toBe(200);
  });

  test('guest cannot create a quote', async () => {
    const res = await request(app).post('/api/quotes').set(authHeader('guest')).send({ title: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('create quote validation', () => {
  const base = { title: 'T', recipient_type: 'external', recipient_name: 'Ann', recipient_company: 'Stage Right', recipient_email: 'ann@stageright.co.uk' };

  test('defaults Valid Until to 30 days after the quote date', async () => {
    routeSql([
      [/nextval/, [{ n: 1 }]],
      [/INSERT INTO quotes/, (sql, params) => [{ ...draftQuote(), quote_date: params[2], valid_until: params[3] }]],
    ]);
    const res = await request(app).post('/api/quotes').set(authHeader('md')).send({ ...base, quote_date: '2026-11-10' });
    expect(res.status).toBe(201);
    expect(res.body.valid_until).toBe('2026-12-10');
  });

  test.each([
    [{ title: '' }, /title is required/],
    [{ recipient_type: 'other' }, /Recipient type/],
    [{ recipient_email: 'not-an-email' }, /Email address is not valid/],
    [{ recipient_company: '' }, /Company is required/],
    [{ quote_date: '2026-11-10', valid_until: '2026-11-01' }, /cannot be earlier/],
    [{ vat_treatment: 'reduced' }, /VAT treatment/],
    [{ discount_type: 'percent', discount_value: 150 }, /more than 100/],
    [{ quote_date: '2026-02-30' }, /Quote date must be a valid date/],
  ])('rejects %o', async (override, message) => {
    const res = await request(app).post('/api/quotes').set(authHeader('md')).send({ ...base, ...override });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  test('internal quote needs production and department', async () => {
    let res = await request(app).post('/api/quotes').set(authHeader('md')).send({ title: 'T', recipient_type: 'internal', department: 'Props' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Production is required/);
    res = await request(app).post('/api/quotes').set(authHeader('md')).send({ title: 'T', recipient_type: 'internal', production_id: PROD_ID });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Department is required/);
  });
});

describe('editing is Draft-only', () => {
  test('header update recalculates totals', async () => {
    routeSql([
      [/FOR UPDATE/, [draftQuote({ subtotal: '1000.00' })]],
      [/SELECT quantity, unit_rate FROM quote_lines/, [{ quantity: '1', unit_rate: '1000' }]],
      [/FROM quotes q/, [draftQuote({ vat_treatment: 'zero' })]],
    ]);
    const res = await request(app).patch(`/api/quotes/${QUOTE_ID}`).set(authHeader('coordinator')).send({ vat_treatment: 'zero' });
    expect(res.status).toBe(200);
    const totals = ran(/UPDATE quotes SET subtotal/);
    expect(totals.params.slice(1)).toEqual([1000, 0, 0, 1000]);
  });

  test('a Sent quote cannot be edited', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote({ status: 'sent' })]]]);
    const res = await request(app).patch(`/api/quotes/${QUOTE_ID}`).set(authHeader('md')).send({ title: 'New' });
    expect(res.status).toBe(409);
    expect(ran(/ROLLBACK/)).toBeTruthy();
  });

  test('a Sent quote cannot be deleted', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote({ status: 'sent' })]]]);
    const res = await request(app).delete(`/api/quotes/${QUOTE_ID}`).set(authHeader('md'));
    expect(res.status).toBe(409);
    expect(ran(/DELETE FROM quotes/)).toBeFalsy();
  });

  test('a Draft that was sent before (a revision) cannot be deleted', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote({ revision: 2, sent_at: '2026-11-10T10:00:00Z' })]]]);
    const res = await request(app).delete(`/api/quotes/${QUOTE_ID}`).set(authHeader('md'));
    expect(res.status).toBe(409);
    expect(ran(/DELETE FROM quotes/)).toBeFalsy();
  });

  test('a Draft quote can be deleted', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote()]]]);
    const res = await request(app).delete(`/api/quotes/${QUOTE_ID}`).set(authHeader('md'));
    expect(res.status).toBe(204);
    expect(ran(/DELETE FROM quotes/)).toBeTruthy();
  });

  test('missing quote is 404', async () => {
    routeSql([[/FOR UPDATE/, []]]);
    const res = await request(app).patch(`/api/quotes/${QUOTE_ID}`).set(authHeader('md')).send({ title: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('lines', () => {
  test('adds a labour line with total = qty × rate and recalculates the quote', async () => {
    routeSql([
      [/FOR UPDATE/, [draftQuote()]],
      [/next_order/, [{ next_order: 1 }]],
      [/SELECT quantity, unit_rate FROM quote_lines/, [{ quantity: '5', unit_rate: '312.50' }]],
      [/FROM quotes q/, [draftQuote()]],
      [/FROM quote_lines WHERE quote_id/, []],
    ]);
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/lines`).set(authHeader('coordinator')).send({
      line_type: 'labour_grade', description: 'Carpenter', quantity: 5, unit: 'day', unit_rate: 312.5,
    });
    expect(res.status).toBe(201);
    const insert = ran(/INSERT INTO quote_lines/);
    expect(insert.params[8]).toBe(1562.5);
    expect(ran(/UPDATE quotes SET subtotal/).params.slice(1)).toEqual([1562.5, 0, 312.5, 1875]);
  });

  test('rounds quantity and rate to 2 dp so the stored values match the line total', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote()]], [/next_order/, [{ next_order: 1 }]]]);
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/lines`).set(authHeader('md')).send({
      line_type: 'materials', description: 'Timber', quantity: 0.333, unit_rate: 300.005,
    });
    expect(res.status).toBe(201);
    const insert = ran(/INSERT INTO quote_lines/);
    expect(insert.params[5]).toBe(0.33);
    expect(insert.params[7]).toBe(300.01);
    expect(insert.params[8]).toBe(99);
  });

  test('a quantity that rounds to 0 is rejected', async () => {
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/lines`).set(authHeader('md')).send({
      line_type: 'materials', description: 'Timber', quantity: 0.004, unit_rate: 10,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Quantity must be more than 0/);
  });

  test('misc line defaults quantity to 1', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote()]], [/next_order/, [{ next_order: 3 }]]]);
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/lines`).set(authHeader('md')).send({
      line_type: 'misc', description: 'Travel and subsistence', unit_rate: 450,
    });
    expect(res.status).toBe(201);
    const insert = ran(/INSERT INTO quote_lines/);
    expect(insert.params[5]).toBe(1);
    expect(insert.params[8]).toBe(450);
  });

  test.each([
    [{ line_type: 'labour', description: 'x', quantity: 1, unit_rate: 1 }, /Line type/],
    [{ line_type: 'materials', description: '', quantity: 1, unit_rate: 1 }, /Description is required/],
    [{ line_type: 'materials', description: 'MDF', quantity: 0, unit_rate: 1 }, /Quantity must be more than 0/],
    [{ line_type: 'materials', description: 'MDF', quantity: 2, unit_rate: -5 }, /Rate must be 0 or more/],
    [{ line_type: 'plant_hire', description: 'Scissor lift', quantity: 2 }, /Rate must be 0 or more/],
  ])('rejects line %o', async (body, message) => {
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/lines`).set(authHeader('md')).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  test('cannot add a line to a Sent quote', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote({ status: 'sent' })]]]);
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/lines`).set(authHeader('md')).send({
      line_type: 'materials', description: 'MDF', quantity: 1, unit_rate: 10,
    });
    expect(res.status).toBe(409);
  });

  test('updates a line', async () => {
    routeSql([
      [/FOR UPDATE/, [draftQuote()]],
      [/SELECT \* FROM quote_lines WHERE id/, [{ id: LINE_A, quote_id: QUOTE_ID, line_type: 'materials', description: 'MDF', quantity: '10', unit: 'sheet', unit_rate: '20', note: null }]],
    ]);
    const res = await request(app).patch(`/api/quotes/${QUOTE_ID}/lines/${LINE_A}`).set(authHeader('md')).send({ quantity: 12 });
    expect(res.status).toBe(200);
    const update = ran(/UPDATE quote_lines SET line_type/);
    expect(update.params[4]).toBe(12);
    expect(update.params[7]).toBe(240);
  });

  test('deleting an unknown line is 404', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote()]], [/DELETE FROM quote_lines/, []]]);
    const res = await request(app).delete(`/api/quotes/${QUOTE_ID}/lines/${LINE_A}`).set(authHeader('md'));
    expect(res.status).toBe(404);
  });

  test('reorders lines', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote()]], [/SELECT id FROM quote_lines/, [{ id: LINE_A }, { id: LINE_B }]]]);
    const res = await request(app).put(`/api/quotes/${QUOTE_ID}/lines/reorder`).set(authHeader('md')).send({ line_ids: [LINE_B, LINE_A] });
    expect(res.status).toBe(200);
    expect(ran(/WITH ORDINALITY/).params[1]).toEqual([LINE_B, LINE_A]);
  });

  test('reorder must include every line once', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote()]], [/SELECT id FROM quote_lines/, [{ id: LINE_A }, { id: LINE_B }]]]);
    const res = await request(app).put(`/api/quotes/${QUOTE_ID}/lines/reorder`).set(authHeader('md')).send({ line_ids: [LINE_A] });
    expect(res.status).toBe(400);
  });
});

describe('status workflow', () => {
  test('Sent can only be reached through Send', async () => {
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/status`).set(authHeader('md')).send({ status: 'sent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Use Send/);
  });

  test('skipping a step is refused', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote({ status: 'sent' })]]]);
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/status`).set(authHeader('md')).send({ status: 'awaiting_po_ref' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/approved, declined/);
  });

  test('Declined is final', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote({ status: 'declined' })]]]);
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/status`).set(authHeader('md')).send({ status: 'approved' });
    expect(res.status).toBe(409);
  });

  test('Invoice Raised needs a PO reference', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote({ status: 'awaiting_po_ref' })]]]);
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/status`).set(authHeader('md')).send({ status: 'invoice_raised', po_reference: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PO reference/);
  });

  test('Invoice Raised stores the PO reference', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote({ status: 'awaiting_po_ref' })]]]);
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/status`).set(authHeader('md')).send({ status: 'invoice_raised', po_reference: 'PO-7781' });
    expect(res.status).toBe(200);
    const update = ran(/UPDATE quotes SET status/);
    expect(update.params[1]).toBe('invoice_raised');
    expect(update.params[3]).toBe('PO-7781');
    expect(ran(/INSERT INTO audit_log/)).toBeTruthy();
  });

  test('unknown status is 400', async () => {
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/status`).set(authHeader('md')).send({ status: 'expired' });
    expect(res.status).toBe(400);
  });
});


// ─── Send, revise, PDF, secure link ──────────────────────────────────────────

const express = require('express');
const email = require('../config/email');
email.templates.quoteSent = jest.fn(() => ({ subject: 'Quote', html: '<p>quote</p>' }));
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const LINES = [
  { id: LINE_A, line_type: 'labour_grade', description: 'Carpenter — Chargehand', quantity: '4.00', unit: 'day', unit_rate: '312.00', line_total: '1248.00', note: null },
  { id: LINE_B, line_type: 'materials', description: '18mm MDF', quantity: '10.00', unit: 'sheet', unit_rate: '28.50', line_total: '285.00', note: 'Fire rated' },
];
const sendSql = (quote, lines = LINES, extra = []) => routeSql([
  ...extra,
  [/FOR UPDATE/, [quote]],
  [/FROM quotes q/, [{ ...quote, production_name: 'Les Mis', subtotal: '1533.00', vat_amount: '306.60', total: '1839.60' }]],
  [/FROM quote_lines WHERE quote_id/, lines],
]);

describe('sending a quote', () => {
  beforeEach(() => { email.sendEmail.mockClear(); email.sendEmail.mockResolvedValue(true); });

  test('needs at least one line', async () => {
    sendSql(draftQuote({ revision: 1 }), []);
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('coordinator')).send({ method: 'download' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one line/);
    expect(ran(/INSERT INTO quote_sends/)).toBeFalsy();
  });

  test('download moves Draft to Sent and records the send with a snapshot', async () => {
    sendSql(draftQuote({ revision: 1 }));
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('coordinator')).send({ method: 'download' });
    expect(res.status).toBe(200);
    expect(ran(/UPDATE quotes SET status = 'sent', sent_at = NOW\(\)/)).toBeTruthy();
    const insert = ran(/INSERT INTO quote_sends/);
    expect(insert.params.slice(1, 4)).toEqual([1, 'download', null]);
    const snapshot = JSON.parse(insert.params[4]);
    expect(snapshot.status).toBe('sent');
    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot).not.toHaveProperty('sends');
    expect(snapshot).not.toHaveProperty('share_token');
    expect(email.sendEmail).not.toHaveBeenCalled();
    const audit = ran(/INSERT INTO audit_log/);
    expect(audit).toBeTruthy();
  });

  test('email goes to the external recipient with the PDF attached', async () => {
    sendSql(draftQuote({ revision: 1, recipient_type: 'external', recipient_email: 'ann@stageright.co.uk' }));
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('md')).send({ method: 'email' });
    expect(res.status).toBe(200);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const mail = email.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('ann@stageright.co.uk');
    expect(mail.attachments[0].filename).toBe('CSL-Q-0041.pdf');
    expect(mail.attachments[0].content.slice(0, 4).toString()).toBe('%PDF');
    expect(ran(/INSERT INTO quote_sends/).params[3]).toBe('ann@stageright.co.uk');
  });

  test('an internal quote needs an email address to send to', async () => {
    sendSql(draftQuote({ revision: 1 }));
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('md')).send({ method: 'email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email address/);
  });

  test('rejects a bad email address', async () => {
    sendSql(draftQuote({ revision: 1 }));
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('md')).send({ method: 'email', to: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not valid/);
  });

  test('if the email fails nothing is recorded', async () => {
    email.sendEmail.mockRejectedValueOnce(new Error('SES down'));
    sendSql(draftQuote({ revision: 1 }));
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('md')).send({ method: 'email', to: 'pm@production.co.uk' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/could not be sent/);
    expect(res.body.error).not.toMatch(/SES down/);
    expect(ran(/ROLLBACK/)).toBeTruthy();
    expect(ran(/COMMIT/)).toBeFalsy();
  });

  test('rejects a list of addresses in one field', async () => {
    sendSql(draftQuote({ revision: 1 }));
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('md')).send({ method: 'email', to: 'a@b.co.uk,c' });
    expect(res.status).toBe(400);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  test('link creates a share token once and reuses it', async () => {
    sendSql(draftQuote({ revision: 1, share_token: null }));
    let res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('md')).send({ method: 'link' });
    expect(res.status).toBe(200);
    const token = ran(/UPDATE quotes SET status = 'sent'/).params[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(res.body.share_token).toBe(token);

    dbMock.reset();
    sendSql(draftQuote({ status: 'sent', revision: 1, share_token: token }));
    res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('md')).send({ method: 'link' });
    expect(res.status).toBe(200);
    expect(ran(/UPDATE quotes SET status = 'sent'/).params[1]).toBe(token);
  });

  test('a Sent quote can be re-sent; the audit says re-sent', async () => {
    sendSql(draftQuote({ status: 'sent', revision: 2, share_token: 'abcdefghijklmnopqrstuvwxyz012345' }));
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('md')).send({ method: 'download' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('share_token');
    expect(ran(/INSERT INTO quote_sends/).params[1]).toBe(2);
    expect(JSON.stringify(ran(/INSERT INTO audit_log/).params)).toMatch(/quote_resent/);
  });

  test.each(['approved', 'declined', 'awaiting_po_ref', 'invoice_raised'])('a %s quote cannot be sent', async status => {
    sendSql(draftQuote({ status }));
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('md')).send({ method: 'download' });
    expect(res.status).toBe(409);
  });

  test('unknown method is 400', async () => {
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('md')).send({ method: 'fax' });
    expect(res.status).toBe(400);
  });

  test('guest cannot send', async () => {
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/send`).set(authHeader('guest')).send({ method: 'download' });
    expect(res.status).toBe(403);
  });
});

describe('revising a quote', () => {
  test('a Sent quote reopens as the next revision in Draft', async () => {
    routeSql([[/FOR UPDATE/, [draftQuote({ status: 'sent', revision: 1 })]]]);
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/revise`).set(authHeader('coordinator'));
    expect(res.status).toBe(200);
    expect(ran(/UPDATE quotes SET status = 'draft', revision = revision \+ 1/)).toBeTruthy();
    expect(JSON.stringify(ran(/INSERT INTO audit_log/).params)).toMatch(/revision 2/);
  });

  test.each(['draft', 'approved', 'declined'])('a %s quote cannot be revised', async status => {
    routeSql([[/FOR UPDATE/, [draftQuote({ status })]]]);
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/revise`).set(authHeader('md'));
    expect(res.status).toBe(409);
  });
});

describe('quote PDF', () => {
  const SEND_ID = '55555555-5555-5555-5555-555555555555';

  test('downloads the current quote (guest can too)', async () => {
    routeSql([
      [/FROM quotes q/, [{ ...draftQuote({ revision: 1 }), production_name: 'Les Mis' }]],
      [/FROM quote_lines WHERE quote_id/, LINES],
    ]);
    const res = await request(app).get(`/api/quotes/${QUOTE_ID}/pdf`).set(authHeader('guest')).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="CSL-Q-0041.pdf"/);
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('downloads a past send exactly as sent', async () => {
    routeSql([[/FROM quote_sends WHERE id/, [{ snapshot: { ...draftQuote({ status: 'sent', revision: 2 }), lines: LINES } }]]]);
    const res = await request(app).get(`/api/quotes/${QUOTE_ID}/pdf?send_id=${SEND_ID}`).set(authHeader('md')).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/CSL-Q-0041-rev2.pdf/);
    expect(ran(/FROM quote_sends WHERE id/).params).toEqual([SEND_ID, QUOTE_ID]);
  });

  test('unknown send is 404', async () => {
    routeSql([]);
    const res = await request(app).get(`/api/quotes/${QUOTE_ID}/pdf?send_id=${SEND_ID}`).set(authHeader('md'));
    expect(res.status).toBe(404);
  });
});

describe('secure preview link (no login)', () => {
  const pub = express();
  pub.use('/api/public/quotes', require('../routes/quotesPublic'));
  const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

  test('shows the latest sent version inline', async () => {
    routeSql([[/WHERE q.share_token = \$1/, [{ snapshot: { ...draftQuote({ status: 'sent', revision: 1 }), lines: LINES } }]]]);
    const res = await request(pub).get(`/api/public/quotes/${TOKEN}`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline/);
    expect(ran(/share_token/).params).toEqual([TOKEN]);
  });

  test('a malformed token never reaches the database', async () => {
    routeSql([]);
    const res = await request(pub).get('/api/public/quotes/short');
    expect(res.status).toBe(404);
    expect(dbMock.queries).toHaveLength(0);
  });

  test('an unknown token is 404', async () => {
    routeSql([]);
    const res = await request(pub).get(`/api/public/quotes/${TOKEN}`);
    expect(res.status).toBe(404);
  });
});

describe('the share token is never exposed in reads', () => {
  const withToken = { ...draftQuote({ status: 'sent', revision: 1 }), share_token: 'abcdefghijklmnopqrstuvwxyz012345' };

  test.each(['md', 'guest'])('list (%s)', async role => {
    routeSql([[/FROM quotes q/, [withToken]]]);
    const res = await request(app).get('/api/quotes').set(authHeader(role));
    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty('share_token');
  });

  test.each(['md', 'guest'])('detail (%s)', async role => {
    routeSql([[/FROM quotes q/, [withToken]]]);
    const res = await request(app).get(`/api/quotes/${QUOTE_ID}`).set(authHeader(role));
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('share_token');
    expect(res.body.reference).toBe('CSL-Q-0041');
  });

  test('create', async () => {
    routeSql([[/nextval/, [{ n: 7 }]], [/INSERT INTO quotes/, [{ ...withToken, share_token: null }]]]);
    const res = await request(app).post('/api/quotes').set(authHeader('md')).send({
      title: 'T', recipient_type: 'internal', production_id: PROD_ID, department: 'Props',
    });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('share_token');
    expect(res.body.sends).toEqual([]);
  });
});
