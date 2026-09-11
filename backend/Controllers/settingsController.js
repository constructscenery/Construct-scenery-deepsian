const db = require('../config/db');

const ALLOWED_ROLES = new Set(['managing_director', 'construction_coordinator', 'construction_accountant']);

// ─── GET /api/settings ────────────────────────────────────────────────────────
// Returns all application settings as a flat key→value object.
const getSettings = async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT key, value, updated_at FROM app_settings ORDER BY key');
    const settings = Object.fromEntries(rows.map(r => [r.key, { value: r.value, updated_at: r.updated_at }]));
    res.json(settings);
  } catch (err) {
    console.error('getSettings:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PATCH /api/settings/:key ─────────────────────────────────────────────────
// Updates a single setting by key. Creates the row if it doesn't exist.
// handover_alert_days expects a JSON array of integers e.g. [14, 7, 3]
const patchSetting = async (req, res) => {
  if (!ALLOWED_ROLES.has(req.user?.role))
    return res.status(403).json({ error: 'Unauthorized to update settings' });

  const { key } = req.params;
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value is required' });

  // Validate handover_alert_days
  if (key === 'handover_alert_days') {
    if (!Array.isArray(value) || !value.every(d => Number.isInteger(d) && d > 0))
      return res.status(400).json({ error: 'handover_alert_days must be an array of positive integers, e.g. [14, 7]' });
  }

  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value      = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING key, value, updated_at`,
      [key, JSON.stringify(value), req.user.id]
    );
    res.json(row);
  } catch (err) {
    console.error('patchSetting:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getSettings, patchSetting };
