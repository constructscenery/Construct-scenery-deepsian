/**
 * Xero integration (Addendum 6 — Sales).
 *
 * Read-only: theOffice never writes to Xero. One Xero organisation is connected by an
 * Administrator; every sync pulls that organisation's sales invoices (ACCREC) into
 * xero_invoices. Allocation columns on xero_invoices are never touched by a sync.
 *
 * Tokens: access tokens last 30 minutes; refresh tokens rotate on every use and lapse after
 * 60 days unused. Both are stored AES-256-GCM encrypted (config/crypto). Only one sync runs at
 * a time (Postgres advisory lock) so two refreshes can never race and kill the connection.
 *
 * Env: XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI, optional XERO_SCOPES.
 * Enum references: XeroConnectionStatus, XeroInvoiceStatus (src/enums).
 */
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');

const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const REVOKE_URL = 'https://identity.xero.com/connect/revocation';
const CONNECTIONS_URL = 'https://api.xero.com/connections';
const INVOICES_URL = 'https://api.xero.com/api.xro/2.0/Invoices';

// Xero apps created after 2 March 2026 must use granular scopes (accounting.invoices.read);
// an older app can set XERO_SCOPES to use accounting.transactions.read instead.
const DEFAULT_SCOPES = 'offline_access accounting.invoices.read';
const PAGE_SIZE = 1000;                  // Xero maximum
const AUTO_SYNC_MINUTES = 5;             // opening Sales re-syncs at most this often
const SYNC_LOCK_KEY = 4021934;           // pg advisory lock id for the Xero sync
const XERO_STATUSES = ['draft', 'submitted', 'authorised', 'paid', 'voided', 'deleted']; // XeroInvoiceStatus

class XeroError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const config = () => ({
  clientId: process.env.XERO_CLIENT_ID || '',
  clientSecret: process.env.XERO_CLIENT_SECRET || '',
  redirectUri: process.env.XERO_REDIRECT_URI || '',
  scopes: process.env.XERO_SCOPES || DEFAULT_SCOPES,
});

const isConfigured = () => {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
};

const stateSecret = () => {
  if (!process.env.JWT_SECRET) throw new XeroError('JWT_SECRET is not set', 500);
  return process.env.JWT_SECRET;
};

// ─── OAuth ───────────────────────────────────────────────────────────────────

/** URL that sends an Administrator to Xero's consent screen. `state` is a signed, 10-minute token (CSRF guard). */
const buildAuthorizeUrl = userId => {
  if (!isConfigured()) throw new XeroError('Xero is not configured on the server', 503);
  const c = config();
  const state = jwt.sign({ purpose: 'xero_connect', uid: userId }, stateSecret(), { expiresIn: '10m' });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    scope: c.scopes,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
};

/** Returns the user id the state was issued to, or throws. */
const verifyState = state => {
  try {
    const payload = jwt.verify(state, stateSecret());
    if (payload.purpose !== 'xero_connect' || !payload.uid) throw new Error('wrong purpose');
    return payload.uid;
  } catch {
    throw new XeroError('The Xero connection request expired or was invalid. Please try again.', 400);
  }
};

const basicAuth = () => {
  const c = config();
  return `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`;
};

/** POST to Xero's token endpoint. Returns { access_token, refresh_token, expires_in } or throws (with .oauthError). */
const tokenRequest = async body => {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new XeroError(`Xero token request failed (${data.error || res.status})`);
    err.oauthError = data.error || null;
    throw err;
  }
  return data;
};

const expiryFrom = expiresIn => new Date(Date.now() + (Number(expiresIn) || 1800) * 1000);

/** The organisation to use: the most recently authorised ORGANISATION connection. */
const pickTenant = connections => {
  const orgs = (connections || []).filter(c => c.tenantType === 'ORGANISATION' && c.tenantId);
  orgs.sort((a, b) => String(b.updatedDateUtc || '').localeCompare(String(a.updatedDateUtc || '')));
  return orgs[0] || null;
};

/** Finish the OAuth callback: exchange the code, pick the organisation, store the connection. */
const completeConnection = async ({ code, state }) => {
  if (!isConfigured()) throw new XeroError('Xero is not configured on the server', 503);
  if (!code) throw new XeroError('Xero did not return an authorisation code', 400);
  const userId = verifyState(state);

  const { rows: [user] } = await db.query(
    'SELECT id, role, is_active FROM users WHERE id = $1',
    [userId]
  );
  // UserRole.MANAGING_DIRECTOR = Administrator in Addendum 6 §11
  if (!user || user.is_active === false || user.role !== 'managing_director') {
    throw new XeroError('Only an Administrator can connect Xero', 403);
  }

  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config().redirectUri });

  const res = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new XeroError(`Could not read Xero organisations (${res.status})`);
  const tenant = pickTenant(await res.json());
  if (!tenant) throw new XeroError('No Xero organisation was authorised. Choose an organisation on the Xero screen.', 400);

  // A (re)connection always starts with a full sync: last_synced_at is cleared.
  const { rows: [conn] } = await db.query(
    `INSERT INTO xero_connection
       (singleton, tenant_id, tenant_name, access_token, refresh_token, access_token_expires_at,
        status, connected_by, connected_at, last_synced_at, last_sync_attempt_at, last_sync_status,
        last_sync_error, last_sync_count, updated_at)
     VALUES (true, $1, $2, $3, $4, $5, 'connected', $6, NOW(), NULL, NULL, NULL, NULL, NULL, NOW())
     ON CONFLICT (singleton) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id, tenant_name = EXCLUDED.tenant_name,
       access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
       access_token_expires_at = EXCLUDED.access_token_expires_at, status = 'connected',
       connected_by = EXCLUDED.connected_by, connected_at = NOW(), last_synced_at = NULL,
       last_sync_attempt_at = NULL, last_sync_status = NULL, last_sync_error = NULL,
       last_sync_count = NULL, updated_at = NOW()
     RETURNING id, tenant_id, tenant_name`,
    [tenant.tenantId, tenant.tenantName || null, encrypt(tokens.access_token), encrypt(tokens.refresh_token),
      expiryFrom(tokens.expires_in), userId]
  );
  return { connection: conn, userId };
};

// ─── Connection state ────────────────────────────────────────────────────────

const getConnection = async () => {
  const { rows: [conn] } = await db.query('SELECT * FROM xero_connection WHERE singleton = true');
  return conn || null;
};

/** Safe-to-show status (never includes tokens). */
const getStatus = async () => {
  const { rows: [c] } = await db.query(
    `SELECT xc.status, xc.tenant_name, xc.connected_at, u.full_name AS connected_by_name,
            xc.last_synced_at, xc.last_sync_attempt_at, xc.last_sync_status, xc.last_sync_error, xc.last_sync_count
     FROM xero_connection xc LEFT JOIN users u ON u.id = xc.connected_by
     WHERE xc.singleton = true`
  );
  return {
    configured: isConfigured(),
    status: c?.status || 'not_connected',
    tenant_name: c?.tenant_name || null,
    connected_at: c?.connected_at || null,
    connected_by_name: c?.connected_by_name || null,
    last_synced_at: c?.last_synced_at || null,
    last_sync_attempt_at: c?.last_sync_attempt_at || null,
    last_sync_status: c?.last_sync_status || null,
    last_sync_error: c?.last_sync_error || null,
    last_sync_count: c?.last_sync_count ?? null,
  };
};

/**
 * A valid access token, refreshing it if it expires within a minute.
 * Must only be called while holding the sync lock (refresh tokens rotate).
 */
const getAccessToken = async conn => {
  const expiresAt = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return decrypt(conn.access_token);

  let tokens;
  try {
    tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(conn.refresh_token) });
  } catch (err) {
    if (err.oauthError === 'invalid_grant') {
      await db.query(
        "UPDATE xero_connection SET status = 'needs_reconnect', updated_at = NOW() WHERE id = $1",
        [conn.id]
      );
      throw new XeroError('The Xero connection has expired. The Managing Director needs to reconnect Xero on the Sales page.', 409);
    }
    throw err;
  }
  // New access + rotated refresh token are saved together.
  await db.query(
    `UPDATE xero_connection
     SET access_token = $2, refresh_token = $3, access_token_expires_at = $4, updated_at = NOW()
     WHERE id = $1`,
    [conn.id, encrypt(tokens.access_token), encrypt(tokens.refresh_token), expiryFrom(tokens.expires_in)]
  );
  return tokens.access_token;
};

/** Disconnect: revoke at Xero (best effort), clear tokens, keep the row and cached invoices. */
const disconnect = async () => {
  const conn = await getConnection();
  if (!conn || conn.status === 'disconnected') return;
  if (conn.refresh_token && isConfigured()) {
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: decrypt(conn.refresh_token) }),
      });
    } catch (err) {
      console.error('[Xero] Token revocation failed (connection cleared locally):', err.message);
    }
  }
  await db.query(
    `UPDATE xero_connection
     SET status = 'disconnected', access_token = NULL, refresh_token = NULL,
         access_token_expires_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [conn.id]
  );
};

// ─── Invoice sync ────────────────────────────────────────────────────────────

/** Xero dates: "2026-10-01T00:00:00" (DateString) or "/Date(1759276800000+0000)/". */
const parseXeroDate = (dateString, msDate) => {
  if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateString)) return dateString.slice(0, 10);
  const ms = /\/Date\((-?\d+)/.exec(msDate || '')?.[1];
  return ms ? new Date(Number(ms)).toISOString().slice(0, 10) : null;
};
const parseXeroTimestamp = value => {
  const ms = /\/Date\((-?\d+)/.exec(value || '')?.[1];
  if (ms) return new Date(Number(ms));
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
};
const money = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Map a Xero invoice onto xero_invoices columns; null for anything that is not a sales invoice. */
const mapInvoice = (inv, tenantId) => {
  const status = String(inv.Status || '').toLowerCase();
  if (inv.Type !== 'ACCREC' || !inv.InvoiceID || !XERO_STATUSES.includes(status)) return null;
  return [
    inv.InvoiceID,
    tenantId,
    inv.InvoiceNumber || null,
    inv.Contact?.Name || null,
    parseXeroDate(inv.DateString, inv.Date),
    parseXeroDate(inv.DueDateString, inv.DueDate),
    money(inv.SubTotal),
    money(inv.TotalTax),
    money(inv.Total),
    money(inv.AmountPaid),
    money(inv.AmountCredited),
    money(inv.AmountDue),
    inv.CurrencyCode || 'GBP',
    status,
    inv.Reference || null,
    parseXeroTimestamp(inv.UpdatedDateUTC),
  ];
};

const UPSERT_COLUMNS = [
  'xero_invoice_id', 'tenant_id', 'invoice_number', 'contact_name', 'invoice_date', 'due_date',
  'sub_total', 'total_tax', 'total', 'amount_paid', 'amount_credited', 'amount_due',
  'currency_code', 'xero_status', 'reference', 'xero_updated_at',
];

/** Insert or update a page of invoices in one statement. Allocation columns are left alone. */
const upsertInvoices = async rows => {
  if (!rows.length) return;
  const n = UPSERT_COLUMNS.length;
  const values = rows.map((_, r) => `(${UPSERT_COLUMNS.map((__, c) => `$${r * n + c + 1}`).join(', ')})`).join(', ');
  const updates = UPSERT_COLUMNS.filter(c => c !== 'xero_invoice_id').map(c => `${c} = EXCLUDED.${c}`).join(', ');
  await db.query(
    `INSERT INTO xero_invoices (${UPSERT_COLUMNS.join(', ')}) VALUES ${values}
     ON CONFLICT (xero_invoice_id) DO UPDATE SET ${updates}, updated_at = NOW()`,
    rows.flat()
  );
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** GET from the Accounting API; waits and retries once on a rate limit (429). */
const xeroGet = async (url, accessToken, tenantId, extraHeaders = {}) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, 'xero-tenant-id': tenantId, Accept: 'application/json', ...extraHeaders },
    });
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 5, 60);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new XeroError('Xero refused access to the organisation. An Administrator may need to reconnect Xero.', 409);
    }
    if (!res.ok) throw new XeroError(`Xero returned an error (${res.status})`);
    return res.json();
  }
  throw new XeroError('Xero rate limit reached. Try again in a minute.', 429);
};

/** "2026-11-10T09:15:00" — UTC to the second, as Xero's If-Modified-Since expects. */
const xeroTimestamp = date => new Date(date).toISOString().slice(0, 19);

/** Fetch every changed sales invoice and upsert it. Returns the number of invoices written. */
const pullInvoices = async (conn, accessToken) => {
  const headers = conn.last_synced_at ? { 'If-Modified-Since': xeroTimestamp(conn.last_synced_at) } : {};
  let written = 0;
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ where: 'Type=="ACCREC"', page: String(page), pageSize: String(PAGE_SIZE) });
    const data = await xeroGet(`${INVOICES_URL}?${params}`, accessToken, conn.tenant_id, headers);
    const invoices = data.Invoices || [];
    const rows = invoices.map(inv => mapInvoice(inv, conn.tenant_id)).filter(Boolean);
    await upsertInvoices(rows);
    written += rows.length;

    const pageCount = data.pagination?.pageCount;
    if (pageCount ? page >= pageCount : invoices.length < PAGE_SIZE) break;
  }
  return written;
};

/**
 * Sync sales invoices from Xero.
 * trigger: 'manual' (Sync Now) | 'auto' (Sales opened) | 'scheduled' (nightly) | 'connect'.
 * 'auto' does nothing if a sync was attempted in the last few minutes.
 * Returns { ran, reason?, count?, status }. Throws XeroError when the sync itself fails.
 */
const syncInvoices = async ({ trigger = 'manual' } = {}) => {
  if (!isConfigured()) throw new XeroError('Xero is not configured on the server', 503);
  const conn = await getConnection();
  if (!conn || conn.status !== 'connected') {
    throw new XeroError(conn?.status === 'needs_reconnect'
      ? 'The Xero connection has expired. The Managing Director needs to reconnect Xero on the Sales page.'
      : 'Xero is not connected', 409);
  }

  if (trigger === 'auto' && conn.last_sync_attempt_at
    && Date.now() - new Date(conn.last_sync_attempt_at).getTime() < AUTO_SYNC_MINUTES * 60_000) {
    return { ran: false, reason: 'recent', status: await getStatus() };
  }

  const lockClient = await db.connect();
  let locked = false;
  try {
    const { rows: [{ locked: got }] } = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [SYNC_LOCK_KEY]);
    locked = got === true;
    if (!locked) return { ran: false, reason: 'already_running', status: await getStatus() };

    // Re-read under the lock: another sync may have just rotated the tokens.
    const current = await getConnection();
    if (!current || current.status !== 'connected') throw new XeroError('Xero is not connected', 409);

    const startedAt = new Date();
    try {
      const accessToken = await getAccessToken(current);
      const count = await pullInvoices(current, accessToken);
      await db.query(
        `UPDATE xero_connection
         SET last_synced_at = $2, last_sync_attempt_at = $2, last_sync_status = 'success',
             last_sync_error = NULL, last_sync_count = $3, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $4`, // skip if a different organisation was connected meanwhile
        [current.id, startedAt, count, current.tenant_id]
      );
      console.log(`[Xero] ${trigger} sync: ${count} invoice(s) updated`);
      return { ran: true, count, status: await getStatus() };
    } catch (err) {
      await db.query(
        `UPDATE xero_connection
         SET last_sync_attempt_at = $2, last_sync_status = 'failed', last_sync_error = $3, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $4`,
        [current.id, startedAt, String(err.message || 'Sync failed').slice(0, 500), current.tenant_id]
      );
      console.error(`[Xero] ${trigger} sync failed:`, err.message);
      throw err instanceof XeroError ? err : new XeroError('Xero sync failed. Showing data from the last successful sync.');
    }
  } finally {
    if (locked) await lockClient.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
};

/**
 * Comments (notes) left on an invoice in Xero, newest first — read live, not stored.
 * Returns { available: false } when Xero can't be asked right now (not connected, a sync is
 * refreshing the token, or Xero refused); the Sales page then just says comments are unavailable.
 */
const getInvoiceNotes = async xeroInvoiceId => {
  const unavailable = { available: false, notes: [] };
  if (!isConfigured()) return unavailable;
  const conn = await getConnection();
  if (!conn || conn.status !== 'connected') return unavailable;

  try {
    let accessToken;
    const expiresAt = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
    if (expiresAt - Date.now() > 60_000) {
      accessToken = decrypt(conn.access_token);
    } else {
      // Token needs refreshing: only under the sync lock, so a refresh never races a sync.
      const lockClient = await db.connect();
      try {
        const { rows: [{ locked }] } = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [SYNC_LOCK_KEY]);
        if (!locked) return unavailable;
        try {
          const current = await getConnection();
          if (!current || current.status !== 'connected') return unavailable;
          accessToken = await getAccessToken(current);
        } finally {
          await lockClient.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY]).catch(() => {});
        }
      } finally {
        lockClient.release();
      }
    }

    const data = await xeroGet(`${INVOICES_URL}/${encodeURIComponent(xeroInvoiceId)}/History`, accessToken, conn.tenant_id);
    const notes = (data.HistoryRecords || [])
      .filter(h => String(h.Changes || '').toLowerCase() === 'note' && h.Details)
      .map(h => ({ text: h.Details, user: h.User || null, date: parseXeroTimestamp(h.DateUTC || h.DateUTCString) }))
      .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
    return { available: true, notes };
  } catch (err) {
    console.error('[Xero] Could not read invoice comments:', err.message);
    return unavailable;
  }
};

/** Nightly job: sync if Xero is configured and connected; keeps the refresh token from lapsing. */
const runScheduledSync = async () => {
  if (!isConfigured()) return { ran: false, reason: 'not_configured' };
  const conn = await getConnection();
  if (!conn || conn.status !== 'connected') return { ran: false, reason: 'not_connected' };
  return syncInvoices({ trigger: 'scheduled' });
};

module.exports = {
  XeroError,
  isConfigured,
  buildAuthorizeUrl,
  completeConnection,
  getStatus,
  disconnect,
  syncInvoices,
  runScheduledSync,
  getInvoiceNotes,
  // exported for unit tests
  _mapInvoice: mapInvoice,
  _pickTenant: pickTenant,
  _parseXeroDate: parseXeroDate,
};
