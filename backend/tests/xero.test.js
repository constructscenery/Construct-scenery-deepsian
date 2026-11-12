const request = require('supertest');
const jwt = require('jsonwebtoken');
const { makeApp, authHeader, dbMock } = require('./setup');

process.env.XERO_CLIENT_ID = 'client-id';
process.env.XERO_CLIENT_SECRET = 'client-secret';
process.env.XERO_REDIRECT_URI = 'https://app.example.com/api/public/xero/callback';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
delete process.env.FRONTEND_URL;

const xero = require('../services/xeroService');
const app = makeApp(['/api/xero', require('../routes/xero')]);
const express = require('express');
const publicApp = express().use('/api/public/xero', require('../routes/xeroPublic'));

const CONN_ID = '77777777-7777-7777-7777-777777777777';
const conn = (over = {}) => ({
  id: CONN_ID,
  tenant_id: 'tenant-1',
  tenant_name: 'Construct Scenery Ltd',
  access_token: 'enc(access-1)',
  refresh_token: 'enc(refresh-1)',
  access_token_expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
  status: 'connected',
  last_synced_at: null,
  last_sync_attempt_at: null,
  ...over,
});

const xeroInvoice = (over = {}) => ({
  Type: 'ACCREC',
  InvoiceID: 'inv-guid-1',
  InvoiceNumber: 'INV-0041',
  Contact: { Name: 'Phantom Productions Ltd' },
  DateString: '2026-10-01T00:00:00',
  DueDateString: '2026-10-31T00:00:00',
  Status: 'AUTHORISED',
  SubTotal: 3500, TotalTax: 700, Total: 4200, AmountPaid: 0, AmountCredited: 0, AmountDue: 4200,
  CurrencyCode: 'GBP',
  Reference: 'PHAN-UK',
  UpdatedDateUTC: '/Date(1759276800000+0000)/',
  ...over,
});

// ─── helpers ─────────────────────────────────────────────────────────────────
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
const ran = re => dbMock.queries.filter(q => re.test(q.sql));

const jsonResponse = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: k => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});

beforeEach(() => {
  dbMock.reset();
  global.fetch = jest.fn();
});
afterEach(() => {
  dbMock.query.mockImplementation(originalQuery);
  dbMock.connect.mockImplementation(originalConnect);
});

// ─── mapping ─────────────────────────────────────────────────────────────────
describe('invoice mapping', () => {
  test('maps a Xero sales invoice onto xero_invoices columns', () => {
    const row = xero._mapInvoice(xeroInvoice(), 'tenant-1');
    expect(row).toEqual([
      'inv-guid-1', 'tenant-1', 'INV-0041', 'Phantom Productions Ltd', '2026-10-01', '2026-10-31',
      3500, 700, 4200, 0, 0, 4200, 'GBP', 'authorised', 'PHAN-UK', new Date(1759276800000),
    ]);
  });

  test('falls back to /Date()/ dates and defaults missing amounts to 0', () => {
    const row = xero._mapInvoice(xeroInvoice({ DateString: undefined, Date: '/Date(1759276800000+0000)/', AmountCredited: undefined }), 't');
    expect(row[4]).toBe('2025-10-01');
    expect(row[10]).toBe(0);
  });

  test('ignores purchase invoices and unknown statuses', () => {
    expect(xero._mapInvoice(xeroInvoice({ Type: 'ACCPAY' }), 't')).toBeNull();
    expect(xero._mapInvoice(xeroInvoice({ Status: 'ARCHIVED' }), 't')).toBeNull();
  });

  test('picks the most recently authorised organisation', () => {
    const t = xero._pickTenant([
      { tenantId: 'a', tenantType: 'ORGANISATION', updatedDateUtc: '2026-01-01T00:00:00' },
      { tenantId: 'pm', tenantType: 'PRACTICEMANAGER', updatedDateUtc: '2026-12-01T00:00:00' },
      { tenantId: 'b', tenantType: 'ORGANISATION', updatedDateUtc: '2026-11-01T00:00:00' },
    ]);
    expect(t.tenantId).toBe('b');
    expect(xero._pickTenant([])).toBeNull();
  });
});

// ─── OAuth ───────────────────────────────────────────────────────────────────
describe('connect', () => {
  test('authorize URL asks for read-only invoice scope with a signed state', () => {
    const url = new URL(xero.buildAuthorizeUrl('user-md-001'));
    expect(url.origin + url.pathname).toBe('https://login.xero.com/identity/connect/authorize');
    expect(url.searchParams.get('scope')).toBe('offline_access accounting.invoices.read');
    expect(url.searchParams.get('redirect_uri')).toBe(process.env.XERO_REDIRECT_URI);
    expect(jwt.verify(url.searchParams.get('state'), process.env.JWT_SECRET).uid).toBe('user-md-001');
  });

  test('not configured → 503', () => {
    const saved = process.env.XERO_CLIENT_SECRET;
    delete process.env.XERO_CLIENT_SECRET;
    expect(() => xero.buildAuthorizeUrl('u')).toThrow(/not configured/);
    process.env.XERO_CLIENT_SECRET = saved;
  });

  test('completes the connection and stores encrypted tokens', async () => {
    routeSql([
      [/FROM users WHERE id/, [{ id: 'user-md-001', role: 'managing_director', is_active: true }]],
      [/INSERT INTO xero_connection/, [{ id: CONN_ID, tenant_id: 'tenant-1', tenant_name: 'Construct Scenery Ltd' }]],
    ]);
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 1800 }))
      .mockResolvedValueOnce(jsonResponse([{ tenantId: 'tenant-1', tenantName: 'Construct Scenery Ltd', tenantType: 'ORGANISATION' }]));

    const state = jwt.sign({ purpose: 'xero_connect', uid: 'user-md-001' }, process.env.JWT_SECRET);
    const { connection } = await xero.completeConnection({ code: 'abc', state });
    expect(connection.tenant_id).toBe('tenant-1');

    const [tokenCall] = global.fetch.mock.calls;
    expect(tokenCall[0]).toBe('https://identity.xero.com/connect/token');
    expect(tokenCall[1].headers.Authorization).toBe(`Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);
    expect(String(tokenCall[1].body)).toContain('grant_type=authorization_code');

    const insert = ran(/INSERT INTO xero_connection/)[0];
    expect(insert.params.slice(0, 4)).toEqual(['tenant-1', 'Construct Scenery Ltd', 'enc(access-1)', 'enc(refresh-1)']);
    expect(insert.sql).toContain('last_synced_at = NULL'); // reconnect forces a full sync
  });

  test('rejects a forged or expired state', async () => {
    await expect(xero.completeConnection({ code: 'abc', state: 'not-a-token' })).rejects.toMatchObject({ status: 400 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('only an Administrator can complete the connection', async () => {
    routeSql([[/FROM users WHERE id/, [{ id: 'user-coord-001', role: 'construction_coordinator', is_active: true }]]]);
    const state = jwt.sign({ purpose: 'xero_connect', uid: 'user-coord-001' }, process.env.JWT_SECRET);
    await expect(xero.completeConnection({ code: 'abc', state })).rejects.toMatchObject({ status: 403 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── sync ────────────────────────────────────────────────────────────────────
describe('sync', () => {
  const syncSql = (connection, extra = []) => routeSql([
    [/pg_try_advisory_lock/, [{ locked: true }]],
    [/SELECT \* FROM xero_connection/, [connection]],
    ...extra,
  ]);

  test('pulls every page of sales invoices and records success', async () => {
    syncSql(conn());
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ Invoices: [xeroInvoice(), xeroInvoice({ InvoiceID: 'g2', Type: 'ACCPAY' })], pagination: { page: 1, pageCount: 2 } }))
      .mockResolvedValueOnce(jsonResponse({ Invoices: [xeroInvoice({ InvoiceID: 'g3', InvoiceNumber: 'INV-0042' })], pagination: { page: 2, pageCount: 2 } }));

    const result = await xero.syncInvoices({ trigger: 'manual' });
    expect(result).toMatchObject({ ran: true, count: 2 });

    const [url1, opts1] = global.fetch.mock.calls[0];
    expect(url1).toContain('where=Type%3D%3D%22ACCREC%22');
    expect(url1).toContain('pageSize=1000');
    expect(opts1.headers['xero-tenant-id']).toBe('tenant-1');
    expect(opts1.headers.Authorization).toBe('Bearer access-1');
    expect(opts1.headers['If-Modified-Since']).toBeUndefined(); // first sync is a full sync

    const upserts = ran(/INSERT INTO xero_invoices/);
    expect(upserts).toHaveLength(2);
    expect(upserts[0].sql).toContain('ON CONFLICT (xero_invoice_id) DO UPDATE');
    expect(upserts[0].sql).not.toMatch(/production_id|allocated_|first_synced_at/); // allocations untouched
    expect(upserts[0].params).toHaveLength(16); // ACCPAY row dropped

    const success = ran(/last_sync_status = 'success'/)[0];
    expect(success.params[2]).toBe(2);
    expect(ran(/pg_advisory_unlock/)).toHaveLength(1);
  });

  test('later syncs only ask for invoices changed since the last successful sync', async () => {
    syncSql(conn({ last_synced_at: '2026-11-10T09:15:30.000Z' }));
    global.fetch.mockResolvedValueOnce(jsonResponse({ Invoices: [] }));
    await xero.syncInvoices();
    expect(global.fetch.mock.calls[0][1].headers['If-Modified-Since']).toBe('2026-11-10T09:15:30');
  });

  test('refreshes an expiring access token and saves the rotated refresh token', async () => {
    syncSql(conn({ access_token_expires_at: new Date(Date.now() + 10_000).toISOString() }));
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 1800 }))
      .mockResolvedValueOnce(jsonResponse({ Invoices: [] }));
    await xero.syncInvoices();
    expect(String(global.fetch.mock.calls[0][1].body)).toContain('refresh_token=refresh-1');
    const save = ran(/SET access_token = \$2, refresh_token = \$3/)[0];
    expect(save.params.slice(1, 3)).toEqual(['enc(access-2)', 'enc(refresh-2)']);
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer access-2');
  });

  test('a rejected refresh token marks the connection as needing reconnect', async () => {
    syncSql(conn({ access_token_expires_at: null }));
    global.fetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));
    await expect(xero.syncInvoices()).rejects.toMatchObject({ status: 409 });
    expect(ran(/status = 'needs_reconnect'/)).toHaveLength(1);
    expect(ran(/last_sync_status = 'failed'/)).toHaveLength(1);
    expect(ran(/INSERT INTO xero_invoices/)).toHaveLength(0);
  });

  test('an API failure keeps the cached data and records the error', async () => {
    syncSql(conn());
    global.fetch.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(xero.syncInvoices()).rejects.toThrow(/Xero returned an error \(500\)/);
    const failed = ran(/last_sync_status = 'failed'/)[0];
    expect(failed.params[2]).toMatch(/500/);
    expect(ran(/last_sync_status = 'success'/)).toHaveLength(0);
    expect(ran(/pg_advisory_unlock/)).toHaveLength(1);
  });

  test('waits and retries once when rate limited', async () => {
    syncSql(conn());
    global.fetch
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(jsonResponse({ Invoices: [xeroInvoice()] }));
    const result = await xero.syncInvoices();
    expect(result.count).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('only one sync runs at a time', async () => {
    routeSql([
      [/pg_try_advisory_lock/, [{ locked: false }]],
      [/SELECT \* FROM xero_connection/, [conn()]],
    ]);
    const result = await xero.syncInvoices();
    expect(result).toMatchObject({ ran: false, reason: 'already_running' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(ran(/pg_advisory_unlock/)).toHaveLength(0);
  });

  test('auto sync skips if one was attempted in the last few minutes', async () => {
    syncSql(conn({ last_sync_attempt_at: new Date(Date.now() - 60_000).toISOString() }));
    const result = await xero.syncInvoices({ trigger: 'auto' });
    expect(result).toMatchObject({ ran: false, reason: 'recent' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('not connected → 409', async () => {
    routeSql([[/SELECT \* FROM xero_connection/, [conn({ status: 'disconnected' })]]]);
    await expect(xero.syncInvoices()).rejects.toMatchObject({ status: 409 });
  });

  test('the nightly job does nothing when Xero is not connected', async () => {
    routeSql([[/SELECT \* FROM xero_connection/, []]]);
    expect(await xero.runScheduledSync()).toEqual({ ran: false, reason: 'not_connected' });
  });
});

describe('invoice comments', () => {
  test('returns only notes from the Xero history, newest first', async () => {
    routeSql([[/SELECT \* FROM xero_connection/, [conn()]]]);
    global.fetch.mockResolvedValueOnce(jsonResponse({ HistoryRecords: [
      { Changes: 'Created', User: 'System', Details: 'INV-0041 created', DateUTC: '/Date(1759276800000+0000)/' },
      { Changes: 'Note', User: 'Jo Smith', Details: 'Client will pay Friday', DateUTC: '/Date(1759363200000+0000)/' },
      { Changes: 'Note', User: 'Jo Smith', Details: 'Chased by phone', DateUTC: '/Date(1759449600000+0000)/' },
    ] }));
    const result = await xero.getInvoiceNotes('inv-guid-1');
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.xero.com/api.xro/2.0/Invoices/inv-guid-1/History');
    expect(result.available).toBe(true);
    expect(result.notes.map(n => n.text)).toEqual(['Chased by phone', 'Client will pay Friday']);
    expect(result.notes[0].user).toBe('Jo Smith');
  });

  test('unavailable when not connected, without calling Xero', async () => {
    routeSql([[/SELECT \* FROM xero_connection/, [conn({ status: 'disconnected' })]]]);
    expect(await xero.getInvoiceNotes('inv-guid-1')).toEqual({ available: false, notes: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('unavailable (not an error) when Xero refuses', async () => {
    routeSql([[/SELECT \* FROM xero_connection/, [conn()]]]);
    global.fetch.mockResolvedValueOnce(jsonResponse({}, 403));
    expect(await xero.getInvoiceNotes('inv-guid-1')).toEqual({ available: false, notes: [] });
  });

  test('does not refresh the token while a sync holds the lock', async () => {
    routeSql([
      [/SELECT \* FROM xero_connection/, [conn({ access_token_expires_at: null })]],
      [/pg_try_advisory_lock/, [{ locked: false }]],
    ]);
    expect(await xero.getInvoiceNotes('inv-guid-1')).toEqual({ available: false, notes: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('disconnect', () => {
  test('revokes the refresh token and clears tokens but keeps the row', async () => {
    routeSql([[/SELECT \* FROM xero_connection/, [conn()]]]);
    global.fetch.mockResolvedValueOnce(jsonResponse({}));
    await xero.disconnect();
    expect(global.fetch.mock.calls[0][0]).toBe('https://identity.xero.com/connect/revocation');
    expect(String(global.fetch.mock.calls[0][1].body)).toBe('token=refresh-1');
    const update = ran(/SET status = 'disconnected'/)[0];
    expect(update.sql).toContain('refresh_token = NULL');
    expect(ran(/DELETE FROM/)).toHaveLength(0);
  });

  test('still disconnects locally if Xero cannot be reached', async () => {
    routeSql([[/SELECT \* FROM xero_connection/, [conn()]]]);
    global.fetch.mockRejectedValueOnce(new Error('network down'));
    await xero.disconnect();
    expect(ran(/SET status = 'disconnected'/)).toHaveLength(1);
  });
});

// ─── routes ──────────────────────────────────────────────────────────────────
describe('routes', () => {
  test.each(['md', 'accountant', 'coordinator', 'guest'])('%s can read the status (no tokens exposed)', async role => {
    routeSql([[/FROM xero_connection xc/, [{ status: 'connected', tenant_name: 'Construct Scenery Ltd', last_sync_status: 'success' }]]]);
    const res = await request(app).get('/api/xero/status').set(authHeader(role));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, status: 'connected', tenant_name: 'Construct Scenery Ltd' });
    expect(JSON.stringify(res.body)).not.toMatch(/token/);
  });

  test('status is not_connected when there is no connection row', async () => {
    routeSql([]);
    const res = await request(app).get('/api/xero/status').set(authHeader('md'));
    expect(res.body.status).toBe('not_connected');
  });

  test.each(['accountant', 'coordinator', 'guest'])('%s cannot connect or disconnect Xero', async role => {
    expect((await request(app).get('/api/xero/connect').set(authHeader(role))).status).toBe(403);
    expect((await request(app).delete('/api/xero/connection').set(authHeader(role))).status).toBe(403);
  });

  test('Administrator gets the consent URL', async () => {
    const res = await request(app).get('/api/xero/connect').set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/login\.xero\.com\/identity\/connect\/authorize\?/);
  });

  test('guest cannot sync', async () => {
    const res = await request(app).post('/api/xero/sync').set(authHeader('guest')).send({});
    expect(res.status).toBe(403);
  });

  test('auto sync quietly does nothing when Xero is not connected', async () => {
    routeSql([]);
    const res = await request(app).post('/api/xero/sync').set(authHeader('coordinator')).send({ mode: 'auto' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ran: false, reason: 'not_connected' });
  });

  test('manual sync when not connected → 409 with status', async () => {
    routeSql([]);
    const res = await request(app).post('/api/xero/sync').set(authHeader('coordinator')).send({ mode: 'manual' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not connected/);
    expect(res.body.status.status).toBe('not_connected');
  });

  test('Administrator disconnects and it is audited', async () => {
    routeSql([
      [/FROM xero_connection xc/, [{ status: 'connected', tenant_name: 'Construct Scenery Ltd' }]],
      [/SELECT \* FROM xero_connection/, [conn()]],
    ]);
    global.fetch.mockResolvedValueOnce(jsonResponse({}));
    const res = await request(app).delete('/api/xero/connection').set(authHeader('md'));
    expect(res.status).toBe(200);
    expect(ran(/INSERT INTO audit_log/)).toHaveLength(1);
  });

  test('callback: cancelled consent goes back to Sales', async () => {
    const res = await request(publicApp).get('/api/public/xero/callback?error=access_denied');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://app.example.com/sales?xero=cancelled&message=access_denied');
  });

  test('callback: bad state redirects with an error and never calls Xero', async () => {
    const res = await request(publicApp).get('/api/public/xero/callback?code=abc&state=forged');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/app\.example\.com\/sales\?xero=error&message=/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('callback: success stores the connection, audits it and redirects', async () => {
    routeSql([
      [/FROM users WHERE id/, [{ id: 'user-md-001', role: 'managing_director', is_active: true }]],
      [/INSERT INTO xero_connection/, [{ id: CONN_ID, tenant_id: 'tenant-1', tenant_name: 'Construct Scenery Ltd' }]],
      [/SELECT \* FROM xero_connection/, [conn()]],
      [/pg_try_advisory_lock/, [{ locked: true }]],
    ]);
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 1800 }))
      .mockResolvedValueOnce(jsonResponse([{ tenantId: 'tenant-1', tenantName: 'Construct Scenery Ltd', tenantType: 'ORGANISATION' }]))
      .mockResolvedValue(jsonResponse({ Invoices: [] })); // background first sync
    const state = jwt.sign({ purpose: 'xero_connect', uid: 'user-md-001' }, process.env.JWT_SECRET);
    const res = await request(publicApp).get(`/api/public/xero/callback?code=abc&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://app.example.com/sales?xero=connected');
    expect(ran(/INSERT INTO audit_log/)).toHaveLength(1);
    await new Promise(r => setImmediate(r)); // let the background sync settle
  });
});
