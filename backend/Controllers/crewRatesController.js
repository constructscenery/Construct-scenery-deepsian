const db  = require('../config/db');
const csv = require('csv-parse/sync');

const canManageRates = (role) =>
  ['managing_director', 'construction_accountant', 'construction_coordinator'].includes(role);

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
      `SELECT id, trade, rank, daily_rate, overtime_rate, weekly_rate,
              rate_year, rate_type, effective_from, effective_to, created_at
       FROM   bectu_rates
       ${where}
       ORDER  BY rate_type, trade, rank`,
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
      `SELECT id, trade, rank, daily_rate, overtime_rate, weekly_rate,
              rate_year, rate_type, effective_from, effective_to, created_at
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

// ─── PATCH /api/crew-rates/:id  (MD + Accountant — non-BECTU rates only) ──────
// Inline edit for non-BECTU roles (Coordinator, Manager, Luton Driver, etc.).
// BECTU rates must be updated via CSV import — use POST /import.
const updateRate = async (req, res) => {
  if (!canManageRates(req.user?.role))
    return res.status(403).json({ error: 'Only MD or Construction Accountant can update rate card entries' });

  const { daily_rate, overtime_rate, weekly_rate } = req.body;

  try {
    const { rows: [existing] } = await db.query(
      'SELECT * FROM bectu_rates WHERE id = $1',
      [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Rate not found' });
    if (existing.rate_type !== 'non_bectu')
      return res.status(400).json({ error: 'Only non-BECTU rates can be edited manually. Use CSV import for BECTU rates.' });

    const updates = [];
    const vals    = [];
    let   j       = 1;
    if (daily_rate    !== undefined) { updates.push(`daily_rate = $${j++}`);    vals.push(daily_rate    === '' ? null : parseFloat(daily_rate)); }
    if (overtime_rate !== undefined) { updates.push(`overtime_rate = $${j++}`); vals.push(overtime_rate === '' ? null : parseFloat(overtime_rate)); }
    if (weekly_rate   !== undefined) { updates.push(`weekly_rate = $${j++}`);   vals.push(weekly_rate   === '' ? null : parseFloat(weekly_rate)); }

    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    const { rows: [updated] } = await db.query(
      `UPDATE bectu_rates SET ${updates.join(', ')} WHERE id = $${j} RETURNING *`,
      [...vals, req.params.id]
    );
    res.json(updated);
  } catch (err) {
    console.error('updateRate:', err);
    res.status(500).json({ error: err.message });
  }
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
       WHERE effective_to IS NULL AND rate_type = 'bectu'`
    );
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

    for (const row of records) {
      const { trade, rank, daily_rate, overtime_rate } = row;
      if (!trade || !rank) continue;

      const weekly = row.weekly_rate ? parseFloat(row.weekly_rate) : parseFloat(daily_rate) * 5;

      // Expire current active row for this trade/rank
      const { rowCount } = await client.query(
        `UPDATE bectu_rates
         SET effective_to = $1::date - INTERVAL '1 day'
         WHERE trade = $2 AND rank = $3 AND effective_to IS NULL AND rate_type = 'bectu'`,
        [effective_from, trade, rank]
      );
      expired += rowCount;

      // Insert new row
      await client.query(
        `INSERT INTO bectu_rates
           (trade, rank, daily_rate, overtime_rate, weekly_rate, rate_year, rate_type, effective_from)
         VALUES ($1,$2,$3,$4,$5,$6,'bectu',$7)
         ON CONFLICT (trade, rank, rate_year) DO UPDATE
           SET daily_rate     = EXCLUDED.daily_rate,
               overtime_rate  = EXCLUDED.overtime_rate,
               weekly_rate    = EXCLUDED.weekly_rate,
               effective_from = EXCLUDED.effective_from,
               effective_to   = NULL`,
        [trade, rank, parseFloat(daily_rate), parseFloat(overtime_rate), weekly, rate_year, effective_from]
      );
      inserted++;
    }

    await client.query('COMMIT');
    res.json({ message: `${rate_year} rate card imported successfully`, rate_year, inserted, expired, effective_from });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('importCSV:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

module.exports = { getRates, getHistory, updateRate, previewCSV, importCSV };
