const db  = require('../config/db');
const csv = require('csv-parse/sync');
const { logAudit } = require('../services/auditService');

// UserRole.MANAGING_DIRECTOR / CONSTRUCTION_ACCOUNTANT / CONSTRUCTION_COORDINATOR may change rates.
// Guests are read-only (RC-03).
const RATE_MANAGER_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];
const canManageRates = (role) => RATE_MANAGER_ROLES.includes(role);

// Every money column a rate version holds. Commercial NULL = Auto (standard × uplift %).
const RATE_FIELDS = [
  'daily_rate', 'overtime_rate', 'weekly_rate',
  'commercial_daily_rate', 'commercial_overtime_rate', 'commercial_weekly_rate',
];
const rateColumns = (alias = '') => {
  const a = alias ? `${alias}.` : '';
  return `${a}id, ${a}trade, ${a}rank, ${a}daily_rate, ${a}overtime_rate, ${a}weekly_rate,
              ${a}commercial_daily_rate, ${a}commercial_overtime_rate, ${a}commercial_weekly_rate,
              ${a}rate_year, ${a}rate_type, ${a}effective_from::text AS effective_from, ${a}effective_to::text AS effective_to,
              ${a}created_by, ${a}change_note, ${a}created_at`;
};
const RATE_COLUMNS = rateColumns();
const MAX_RATE = 100000;
const MAX_NOTE = 500;
// Today in the UK — the date a rate change takes effect from (Render runs in UTC).
const UK_TODAY_SQL = `(now() AT TIME ZONE 'Europe/London')::date`;

/**
 * Validate one rate value from a request body.
 * undefined → not sent; null / '' → cleared (commercial: back to Auto); else 0–100,000 with at most 2 dp.
 */
const parseRateValue = (field, v) => {
  if (v === undefined) return { skip: true };
  if (v === null || v === '') return { value: null };
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0 || n > MAX_RATE) return { error: `${field} must be a number from 0 to ${MAX_RATE}` };
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { error: `${field} can have at most 2 decimal places` };
  return { value: Math.round(n * 100) / 100 };
};

const sameMoney = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) < 0.005;
};

// ─── GET /api/crew-rates ──────────────────────────────────────────────────────
// ?current=true  → only active rows (effective_to IS NULL)
// ?trade=X       → filter by trade
// ?type=bectu|non_bectu → filter by rate_type
const getRates = async (req, res) => {
  try {
    const conds  = [];
    const params = [];
    let   i      = 1;

    if (req.query.current === 'true') conds.push(`effective_to IS NULL`);
    if (req.query.trade) { conds.push(`trade = $${i++}`); params.push(req.query.trade); }
    if (req.query.type)  { conds.push(`rate_type = $${i++}`); params.push(req.query.type); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT ${RATE_COLUMNS}
       FROM   bectu_rates
       ${where}
       ORDER  BY rate_type, trade, rank, effective_from DESC NULLS LAST`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('getRates:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/crew-rates/history ─────────────────────────────────────────────
// Returns all historical (non-current) rate records grouped by rate_year.
// Current rates are excluded — use ?current=true on GET /api/crew-rates for those.
const getHistory = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ${RATE_COLUMNS}
       FROM   bectu_rates
       WHERE  effective_to IS NOT NULL
       ORDER  BY effective_from DESC, trade, rank`
    );

    // Group by rate_year
    const byYear = {};
    rows.forEach(r => {
      const yr = r.rate_year || 'Unknown';
      if (!byYear[yr]) byYear[yr] = { rate_year: yr, effective_from: r.effective_from, rows: [] };
      byYear[yr].rows.push(r);
    });

    res.json(Object.values(byYear).sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from))));
  } catch (err) {
    console.error('getHistory:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/crew-rates/:id/versions ────────────────────────────────────────
// Every version of the rate's grade (trade + rank), newest first, with who made it and why (RC-03).
const getVersions = async (req, res) => {
  try {
    const { rows: [rate] } = await db.query('SELECT trade, rank FROM bectu_rates WHERE id = $1', [req.params.id]);
    if (!rate) return res.status(404).json({ error: 'Rate not found' });
    const { rows } = await db.query(
      `SELECT ${rateColumns('br')}, u.full_name AS created_by_name
       FROM   bectu_rates br
       LEFT JOIN users u ON u.id = br.created_by
       WHERE  br.trade = $1 AND br.rank = $2
       ORDER  BY br.effective_from DESC NULLS LAST, br.created_at DESC`,
      [rate.trade, rate.rank]
    );
    res.json(rows);
  } catch (err) {
    console.error('getVersions:', err);
    res.status(500).json({ error: 'Unable to load rate history' });
  }
};

// ─── PATCH /api/crew-rates/:id ────────────────────────────────────────────────
// Change a rate (standard and/or commercial). RC-03: rates are versioned so old work keeps its rates —
//   • only the CURRENT version can be changed (409 otherwise);
//   • a change closes the current version the day before today (UK) and inserts a new version from today;
//   • a second change on the day a version started corrects that version in place;
//   • nothing changed → the current version is returned and nothing is written.
// Body: any of RATE_FIELDS (number, or null to clear — commercial null = Auto) and change_note (≤ 500).
// Returns the current version (a new id when a version was created).
const updateRate = async (req, res) => {
  if (!canManageRates(req.user?.role))
    return res.status(403).json({ error: 'Permission denied: cannot update rate card entries' });

  const body = req.body || {};
  const values = {};
  for (const f of RATE_FIELDS) {
    const p = parseRateValue(f, body[f]);
    if (p.error) return res.status(400).json({ error: p.error });
    if (!p.skip) values[f] = p.value;
  }
  if (!Object.keys(values).length) return res.status(400).json({ error: 'No fields to update' });

  let note = null;
  if (body.change_note !== undefined && body.change_note !== null) {
    if (typeof body.change_note !== 'string') return res.status(400).json({ error: 'change_note must be text' });
    note = body.change_note.trim() || null;
    if (note && note.length > MAX_NOTE) return res.status(400).json({ error: `change_note can be at most ${MAX_NOTE} characters` });
  }

  const client = await db.connect();
  let result;
  try {
    await client.query('BEGIN');
    const { rows: [existing] } = await client.query(
      `SELECT *, effective_from::text AS effective_from, effective_to::text AS effective_to,
              (effective_from IS NOT NULL AND effective_from >= ${UK_TODAY_SQL}) AS starts_today_or_later,
              ${UK_TODAY_SQL}::text AS today
       FROM bectu_rates WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!existing) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Rate not found' }); }
    if (existing.effective_to != null) {
      await client.query('ROLLBACK');
      const { rows: [current] } = await db.query(
        'SELECT id FROM bectu_rates WHERE trade = $1 AND rank = $2 AND effective_to IS NULL', [existing.trade, existing.rank]
      );
      return res.status(409).json({
        error: 'This is an old version of the rate and cannot be changed. Refresh and edit the current rate.',
        current_id: current?.id || null,
      });
    }

    const next = {};
    for (const f of RATE_FIELDS) next[f] = f in values ? values[f] : existing[f];
    const changed = RATE_FIELDS.filter(f => !sameMoney(existing[f], next[f]));
    if (!changed.length) {
      await client.query('ROLLBACK');
      const { rows: [same] } = await db.query(`SELECT ${RATE_COLUMNS} FROM bectu_rates WHERE id = $1`, [existing.id]);
      return res.json(same);
    }

    const userId = req.user?.id || null;
    let saved;
    let action;
    if (existing.starts_today_or_later) {
      // The version started today (or is not in force yet): correct it rather than stacking same-day versions.
      action = 'rate_corrected';
      ({ rows: [saved] } = await client.query(
        `UPDATE bectu_rates SET
           daily_rate = $1, overtime_rate = $2, weekly_rate = $3,
           commercial_daily_rate = $4, commercial_overtime_rate = $5, commercial_weekly_rate = $6,
           created_by = $7, change_note = $8
         WHERE id = $9
         RETURNING ${RATE_COLUMNS}`,
        [...RATE_FIELDS.map(f => next[f]), userId, note, existing.id]
      ));
    } else {
      action = 'rate_version_created';
      await client.query(
        `UPDATE bectu_rates SET effective_to = ${UK_TODAY_SQL} - 1 WHERE id = $1`,
        [existing.id]
      );
      ({ rows: [saved] } = await client.query(
        `INSERT INTO bectu_rates
           (trade, rank, rate_year, rate_type,
            daily_rate, overtime_rate, weekly_rate,
            commercial_daily_rate, commercial_overtime_rate, commercial_weekly_rate,
            effective_from, created_by, change_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${UK_TODAY_SQL}, $11, $12)
         RETURNING ${RATE_COLUMNS}`,
        [existing.trade, existing.rank, existing.rate_year, existing.rate_type,
          ...RATE_FIELDS.map(f => next[f]), userId, note]
      ));
    }
    await client.query('COMMIT');
    result = { existing, saved, action, changed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This rate was changed by someone else at the same time. Refresh and try again.' });
    }
    console.error('updateRate:', err);
    return res.status(500).json({ error: 'Unable to save the rate change' });
  } finally {
    client.release();
  }

  const { existing, saved, action, changed } = result;
  res.json(saved);

  const money = v => (v == null ? 'Auto' : `£${Number(v).toFixed(2)}`);
  const pick = row => Object.fromEntries(RATE_FIELDS.map(f => [f, row[f] == null ? null : Number(row[f])]));
  await logAudit({
    userId: req.user?.id,
    userName: req.user?.full_name,
    userRole: req.user?.role,
    category: 'rate_card',
    action,
    entityType: 'bectu_rates',
    entityId: `${existing.trade} - ${existing.rank}`,
    details: `${action === 'rate_corrected' ? 'Corrected' : 'Changed'} rate for ${existing.trade} (${existing.rank}) ` +
      `from ${saved.effective_from}: ` +
      changed.map(f => `${f.replace(/_/g, ' ')} ${money(existing[f])} → ${money(saved[f])}`).join(', ') +
      (note ? ` — ${note}` : ''),
    metadata: {
      trade: existing.trade,
      rank: existing.rank,
      rate_year: existing.rate_year,
      previous_version_id: existing.id,
      version_id: saved.id,
      effective_from: saved.effective_from,
      changed_fields: changed,
      previous: pick(existing),
      updated: pick(saved),
      change_note: note,
    },
  });
};

/**
 * RC-03 checks for a rate-card import, against the current version of each grade in the file:
 *   blocked   — the import date is not after the current version's start (versions must move forward);
 *               re-importing the same rate year with the same date is allowed (it updates that version)
 *   overrides — grades whose current version has Set commercial rates; the new version starts on Auto
 */
const importChecks = async (q, records, effectiveFrom, rateYear) => {
  const grades = records.filter(r => r.trade && r.rank);
  if (!grades.length) return { blocked: [], overrides: [] };
  const { rows: current } = await q.query(
    `SELECT trade, rank, rate_year, effective_from::text AS effective_from,
            commercial_daily_rate, commercial_overtime_rate, commercial_weekly_rate
     FROM bectu_rates
     WHERE effective_to IS NULL AND COALESCE(rate_type, 'bectu') = 'bectu'
       AND (trade, rank) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
    [grades.map(r => r.trade), grades.map(r => r.rank)]
  );
  const date = String(effectiveFrom).slice(0, 10);
  const blocked = current
    .filter(c => c.effective_from && c.effective_from >= date && !(c.rate_year === rateYear && c.effective_from === date))
    .map(c => ({ trade: c.trade, rank: c.rank, current_from: c.effective_from, current_rate_year: c.rate_year }));
  const overrides = current
    .filter(c => c.commercial_daily_rate != null || c.commercial_overtime_rate != null || c.commercial_weekly_rate != null)
    .filter(c => !(c.rate_year === rateYear && c.effective_from === date))
    .map(c => ({
      trade: c.trade, rank: c.rank,
      commercial_daily_rate: c.commercial_daily_rate, commercial_overtime_rate: c.commercial_overtime_rate,
      commercial_weekly_rate: c.commercial_weekly_rate,
    }));
  return { blocked, overrides };
};

// ─── POST /api/crew-rates/preview  (MD + Accountant) ─────────────────────────
// Parses the uploaded CSV and returns a diff against current active rates.
// No DB writes — purely for the confirmation step before committing import.
// Returns: { rate_year, effective_from, changes: [{trade, rank, old_daily, new_daily, old_ot, new_ot, is_new}] }
const previewCSV = async (req, res) => {
  if (!canManageRates(req.user?.role))
    return res.status(403).json({ error: 'Only MD or Construction Accountant can preview rate card imports' });

  if (!req.file) return res.status(400).json({ error: 'No CSV file provided' });

  const { effective_from, rate_year } = req.body;
  if (!effective_from) return res.status(400).json({ error: 'effective_from date is required' });
  if (!rate_year)      return res.status(400).json({ error: 'rate_year is required (e.g. 2027/28)' });

  let records;
  try {
    records = csv.parse(req.file.buffer.toString(), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` });
  }

  if (!records.length) return res.status(400).json({ error: 'CSV is empty' });

  const required = ['trade', 'rank', 'daily_rate', 'overtime_rate'];
  const missing  = required.filter(c => !Object.keys(records[0]).includes(c));
  if (missing.length)
    return res.status(400).json({ error: `CSV missing columns: ${missing.join(', ')}` });

  try {
    // Load all current active BECTU rates for comparison
    const { rows: current } = await db.query(
      `SELECT trade, rank, daily_rate, overtime_rate, weekly_rate
       FROM bectu_rates
       WHERE effective_to IS NULL AND COALESCE(rate_type, 'bectu') = 'bectu'`
    );
    const { blocked, overrides } = await importChecks(db, records, effective_from, rate_year);
    const currentMap = Object.fromEntries(current.map(r => [`${r.trade}||${r.rank}`, r]));

    const changes = records
      .filter(r => r.trade && r.rank)
      .map(r => {
        const key     = `${r.trade}||${r.rank}`;
        const old     = currentMap[key];
        const newD    = parseFloat(r.daily_rate);
        const newOT   = parseFloat(r.overtime_rate);
        const newW    = r.weekly_rate ? parseFloat(r.weekly_rate) : newD * 5;
        return {
          trade:        r.trade,
          rank:         r.rank,
          old_daily:    old ? parseFloat(old.daily_rate   || 0) : null,
          new_daily:    newD,
          old_overtime: old ? parseFloat(old.overtime_rate || 0) : null,
          new_overtime: newOT,
          old_weekly:   old ? parseFloat(old.weekly_rate  || 0) : null,
          new_weekly:   newW,
          is_new:       !old,
          daily_changed: old ? parseFloat(old.daily_rate || 0) !== newD : true,
          ot_changed:    old ? parseFloat(old.overtime_rate || 0) !== newOT : true,
        };
      });

    res.json({
      rate_year,
      effective_from,
      row_count:     changes.length,
      new_entries:   changes.filter(c => c.is_new).length,
      changed_rates: changes.filter(c => !c.is_new && (c.daily_changed || c.ot_changed)).length,
      changes,
      // RC-03: rows that can't be imported with this date, and Set commercial rates that won't carry forward
      blocked,
      commercial_overrides_not_carried: overrides,
    });
  } catch (err) {
    console.error('previewCSV:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/crew-rates/import  (MD + Accountant) ──────────────────────────
// Commits a new rate card year. Expires current active rows, inserts new ones.
// No rate change takes effect on already-finalised timesheets or processed pay runs —
// those rows snapshot the rate at creation time.
const importCSV = async (req, res) => {
  if (!canManageRates(req.user?.role))
    return res.status(403).json({ error: 'Only MD or Construction Accountant can import rate cards' });

  if (!req.file) return res.status(400).json({ error: 'No CSV file provided' });

  const { effective_from, rate_year } = req.body;
  if (!effective_from) return res.status(400).json({ error: 'effective_from date is required (e.g. 2027-04-06)' });
  if (!rate_year)      return res.status(400).json({ error: 'rate_year is required (e.g. 2027/28)' });

  let records;
  try {
    records = csv.parse(req.file.buffer.toString(), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` });
  }

  const required = ['trade', 'rank', 'daily_rate', 'overtime_rate'];
  const missing  = required.filter(c => !Object.keys(records[0] ?? {}).includes(c));
  if (missing.length)
    return res.status(400).json({ error: `CSV missing columns: ${missing.join(', ')}` });

  const client = await db.connect();
  let inserted = 0;
  let expired  = 0;

  try {
    await client.query('BEGIN');

    // RC-03: a new card must start after the version it replaces (re-importing the same year + date is allowed)
    const { blocked, overrides } = await importChecks(client, records, effective_from, rate_year);
    if (blocked.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Effective from ${effective_from} is not after the current rate for ${blocked.length} grade(s). ` +
          `Choose a later date. First: ${blocked[0].trade} / ${blocked[0].rank} (current from ${blocked[0].current_from}).`,
        blocked,
      });
    }

    for (const row of records) {
      const { trade, rank, daily_rate, overtime_rate } = row;
      if (!trade || !rank) continue;

      const weekly = row.weekly_rate ? parseFloat(row.weekly_rate) : parseFloat(daily_rate) * 5;

      // Expire current active row for this trade/rank
      const { rowCount } = await client.query(
        `UPDATE bectu_rates
         SET effective_to = $1::date - INTERVAL '1 day'
         WHERE trade = $2 AND rank = $3 AND effective_to IS NULL AND COALESCE(rate_type, 'bectu') = 'bectu'
           AND effective_from IS DISTINCT FROM $1::date`,
        [effective_from, trade, rank]
      );
      expired += rowCount;

      // Insert the new version. RC-03: the key is (trade, rank, rate_year, effective_from), so re-importing
      // the same year and date updates that version. New versions start with commercial rates on Auto.
      await client.query(
        `INSERT INTO bectu_rates
           (trade, rank, daily_rate, overtime_rate, weekly_rate, rate_year, rate_type, effective_from, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'bectu',$7,$8)
         ON CONFLICT (trade, rank, rate_year, effective_from) DO UPDATE
           SET daily_rate     = EXCLUDED.daily_rate,
               overtime_rate  = EXCLUDED.overtime_rate,
               weekly_rate    = EXCLUDED.weekly_rate,
               effective_to   = NULL`,
        [trade, rank, parseFloat(daily_rate), parseFloat(overtime_rate), weekly, rate_year, effective_from, req.user?.id || null]
      );
      inserted++;
    }

    await client.query('COMMIT');
    res.json({
      message: `${rate_year} rate card imported successfully`, rate_year, inserted, expired, effective_from,
      commercial_overrides_not_carried: overrides,
    });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'rate_card',
      action: 'rate_card_imported',
      entityType: 'bectu_rates',
      entityId: rate_year,
      details: `Imported new BECTU rate card for ${rate_year} effective ${effective_from} (${inserted} rates updated/inserted, ${expired} previous rates retired)`,
      metadata: { rate_year, effective_from, inserted, expired, commercial_overrides_not_carried: overrides },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(400).json({ error: 'The import would leave two current rates for the same grade. Check the file for duplicate trade / rank rows.' });
    }
    console.error('importCSV:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

module.exports = { getRates, getHistory, getVersions, updateRate, previewCSV, importCSV };
