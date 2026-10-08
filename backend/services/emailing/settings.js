/**
 * Crew emailing settings + internal test group.
 *
 * Safe defaults: live sending OFF and every automation OFF. While live sending is
 * off, messages are only delivered to addresses in email_test_recipients, so the
 * whole workflow can be exercised with a small internal group first.
 */
const db = require('../../config/db');

const DEFAULTS = Object.freeze({
  live_sending_enabled:          'false',
  automation_timesheet_reminders: 'false', // Sunday 16:00 (Europe/London) — current week
  automation_timesheet_followups: 'false', // Monday 10:00 — previous week, still missing
  automation_invoice_requests:   'false', // Tuesday 10:00 — self-employed, invoice missing
  reply_to_address:              process.env.EMAIL_REPLY_TO || 'invoice@constructscenery.co.uk',
  from_name:                     process.env.EMAIL_FROM_NAME || 'Construct Scenery',
  portal_link_ttl_days:          '60',
});

const BOOLEAN_KEYS = [
  'live_sending_enabled',
  'automation_timesheet_reminders',
  'automation_timesheet_followups',
  'automation_invoice_requests',
];

const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]{2,}$/;
const isValidEmail = (value) => typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim());

const CACHE_MS = 15_000;
let cache = null;

function coerce(raw) {
  const out = {};
  for (const [key, def] of Object.entries(DEFAULTS)) {
    const value = raw[key] ?? def;
    if (BOOLEAN_KEYS.includes(key)) out[key] = value === 'true';
    else if (key === 'portal_link_ttl_days') out[key] = Math.min(365, Math.max(1, parseInt(value, 10) || 60));
    else out[key] = value;
  }
  return out;
}

async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let rows = [];
  try {
    ({ rows } = await db.query('SELECT key, value FROM email_settings'));
  } catch (err) {
    // Table missing (migration not run yet) — fall back to safe defaults.
    console.error('[emailing] email_settings read failed:', err.message);
  }
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const value = coerce(raw);
  cache = { at: Date.now(), value };
  return value;
}

/** Validates and saves a partial settings object. Returns the full updated settings. */
async function updateSettings(patch, userId) {
  const errors = [];
  const entries = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULTS)) { errors.push(`Unknown setting: ${key}`); continue; }
    if (BOOLEAN_KEYS.includes(key)) {
      if (typeof value !== 'boolean') { errors.push(`${key} must be true or false`); continue; }
      entries.push([key, String(value)]);
    } else if (key === 'reply_to_address') {
      if (!isValidEmail(value)) { errors.push('reply_to_address must be a valid email address'); continue; }
      entries.push([key, value.trim()]);
    } else if (key === 'portal_link_ttl_days') {
      const n = parseInt(value, 10);
      if (!Number.isInteger(n) || n < 1 || n > 365) { errors.push('portal_link_ttl_days must be 1–365'); continue; }
      entries.push([key, String(n)]);
    } else if (key === 'from_name') {
      const name = String(value || '').trim();
      if (!name || name.length > 80 || /[<>"\r\n]/.test(name)) { errors.push('from_name must be 1–80 characters with no <, > or quotes'); continue; }
      entries.push([key, name]);
    }
  }
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });

  for (const [key, value] of entries) {
    await db.query(
      `INSERT INTO email_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [key, value, userId || null]
    );
  }
  cache = null;
  return getSettings({ fresh: true });
}

async function listTestRecipients() {
  const { rows } = await db.query(
    `SELECT tr.id, tr.email, tr.name, tr.created_at, u.full_name AS added_by_name
     FROM email_test_recipients tr
     LEFT JOIN users u ON u.id = tr.added_by
     ORDER BY tr.created_at`
  );
  return rows;
}

async function addTestRecipient({ email, name }, userId) {
  if (!isValidEmail(email)) throw Object.assign(new Error('A valid email address is required'), { status: 400 });
  const { rows } = await db.query(
    `INSERT INTO email_test_recipients (email, name, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT ((LOWER(email))) DO NOTHING
     RETURNING id, email, name, created_at`,
    [email.trim(), name ? String(name).trim().slice(0, 120) : null, userId || null]
  );
  if (!rows.length) throw Object.assign(new Error('That address is already in the test group'), { status: 409 });
  return rows[0];
}

async function removeTestRecipient(id) {
  const { rowCount } = await db.query('DELETE FROM email_test_recipients WHERE id = $1', [id]);
  return rowCount > 0;
}

/**
 * Current send policy: whether live sending is enabled and, when it isn't,
 * which addresses may still receive messages.
 */
async function getSendPolicy() {
  const settings = await getSettings();
  let testEmails = new Set();
  try {
    const { rows } = await db.query('SELECT LOWER(email) AS email FROM email_test_recipients');
    testEmails = new Set(rows.map((r) => r.email));
  } catch (err) {
    console.error('[emailing] test recipients read failed:', err.message);
  }
  const allows = (email) => settings.live_sending_enabled || testEmails.has(String(email || '').toLowerCase());
  return { live: settings.live_sending_enabled, testEmails, allows, settings };
}

function _resetCache() { cache = null; }

module.exports = {
  DEFAULTS, BOOLEAN_KEYS, isValidEmail,
  getSettings, updateSettings, getSendPolicy,
  listTestRecipients, addTestRecipient, removeTestRecipient,
  _resetCache,
};
