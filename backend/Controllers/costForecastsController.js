const db = require('../config/db');
const { logAudit } = require('../services/auditService');
const {
  STANDARD_NON_LABOUR_ITEMS,
  buildDefaultCostForecastLines,
} = require('../services/forecastingDefaults');
const CFC = require('../services/costForecastCalc');           // FB-08 pricing (OT, travel, per diem, weekends, margin)
const { rateMultiplierFor } = require('../services/timesheetCalc');

/**
 * GET /api/forecasting/cost-forecasts
 * Filter by production_id or status
 */
const listCostForecasts = async (req, res) => {
  try {
    const conds = [];
    const params = [];
    let i = 1;

    if (req.query.production_id) {
      conds.push(`cf.production_id = $${i++}`);
      params.push(req.query.production_id);
    }
    if (req.query.status) {
      conds.push(`cf.status = $${i++}`);
      params.push(req.query.status);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT cf.*,
              p.name AS production_name,
              p.production_code AS production_code,
              u.full_name AS created_by_name,
              lu.full_name AS locked_by_name
       FROM cost_forecasts cf
       JOIN productions p ON cf.production_id = p.id
       LEFT JOIN users u ON cf.created_by = u.id
       LEFT JOIN users lu ON cf.locked_by = lu.id
       ${where}
       ORDER BY cf.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('listCostForecasts:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── FB-08 helpers ────────────────────────────────────────────────────────────

const ACTIVE_BECTU_SQL = `SELECT * FROM bectu_rates WHERE effective_to IS NULL ORDER BY trade, rank`;

/** Rate multiplier for a forecast's rate card: standard → 1, commercial → 1 + current uplift %. */
const multiplierFor = async (client, rateCardType) => {
  if (rateCardType !== 'commercial') return 1;  // RateCardType.COMMERCIAL
  const { rows: [row] } = await client.query(
    `SELECT value FROM app_settings WHERE key = 'commercial_rate_uplift_pct'`
  );
  return rateMultiplierFor({ rate_card_type: 'commercial', commercial_uplift_pct: row?.value });
};

/** The forecast-level settings the line pricing needs. */
const settingsOf = fc => ({
  travel_hourly_rate: fc.travel_hourly_rate ?? CFC.DEFAULTS.travel_hourly_rate,
  per_diem_rate:      fc.per_diem_rate      ?? CFC.DEFAULTS.per_diem_rate,
  margin_enabled:     fc.margin_enabled     ?? CFC.DEFAULTS.margin_enabled,
  margin_pct:         fc.margin_pct         ?? CFC.DEFAULTS.margin_pct,
});

const CREW_PRICE_COLUMNS = [
  'units', 'unit_rate', 'rate_unit', 'bectu_rate_id', 'daily_rate', 'default_ot_rate',
  'ot_hours', 'ot_rate', 'travel_hours', 'per_diem_days', 'saturday_days', 'saturday_rate',
  'sunday_days', 'sunday_rate', 'margin_applied', 'line_total', 'margin_amount',
];
const same = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) ? Math.abs(na - nb) < 0.005 : String(a) === String(b);
};

/**
 * Re-price crew + non-labour lines in memory. When bectuRates is given the synced card columns are
 * refreshed first (unlocked forecasts only); typed values are never touched.
 */
const priceLines = (fc, crewLines, nonLabourLines, { bectuRates = null, multiplier = 1 } = {}) => {
  const view = fc.default_view === 'daily' ? 'daily' : 'weekly';
  const settings = settingsOf(fc);
  const crew = crewLines.map(line => {
    const synced = bectuRates ? CFC.syncLineRates(line, bectuRates, multiplier, view) : { ...line };
    const priced = CFC.priceCrewLine(synced, settings);
    return { ...synced, rate_unit: view, line_total: priced.line_total, margin_amount: priced.margin_amount };
  });
  const nonLabour = nonLabourLines.map(line => {
    const priced = CFC.priceNonLabourLine(line, settings);
    return { ...line, line_total: priced.line_total, margin_amount: priced.margin_amount };
  });
  return { crew, nonLabour, totals: CFC.sumForecast(crew, nonLabour) };
};

/** Persist crew lines whose priced values differ from what is stored (all lines when force). */
const storeCrewLines = async (client, storedById, crew, { force = false } = {}) => {
  for (const line of crew) {
    const before = storedById.get(line.id);
    if (!force && before && CREW_PRICE_COLUMNS.every(c => same(before[c], line[c]))) continue;
    await client.query(
      `UPDATE cost_forecast_crew_lines
       SET units = $1, unit_rate = $2, rate_unit = $3, bectu_rate_id = $4, daily_rate = $5, default_ot_rate = $6,
           ot_hours = $7, ot_rate = $8, travel_hours = $9, per_diem_days = $10, saturday_days = $11, saturday_rate = $12,
           sunday_days = $13, sunday_rate = $14, margin_applied = $15, line_total = $16, margin_amount = $17
       WHERE id = $18 AND cost_forecast_id = $19`,
      [
        line.units ?? 0, line.unit_rate ?? 0, line.rate_unit, line.bectu_rate_id ?? null, line.daily_rate ?? 0, line.default_ot_rate ?? 0,
        line.ot_hours ?? 0, line.ot_rate ?? null, line.travel_hours ?? 0, line.per_diem_days ?? 0, line.saturday_days ?? 0, line.saturday_rate ?? null,
        line.sunday_days ?? 0, line.sunday_rate ?? null, line.margin_applied !== false, line.line_total, line.margin_amount,
        line.id, line.cost_forecast_id,
      ]
    );
  }
};

const storeTotals = (client, id, totals, multiplier) => client.query(
  `UPDATE cost_forecasts
   SET total_crew_cost = $1, total_non_labour_cost = $2, grand_total_cost = $3,
       margin_total = $4, grand_total_with_margin = $5, rate_multiplier = $6
   WHERE id = $7
   RETURNING *`,
  [totals.total_crew_cost, totals.total_non_labour_cost, totals.grand_total_cost,
   totals.margin_total, totals.grand_total_with_margin, multiplier, id]
);

/**
 * POST /api/forecasting/cost-forecasts
 * Creates a new Cost Forecast and auto-populates standard crew & non-labour lines.
 * FB-08: the forecast starts on the production's rate card (standard / commercial).
 */
const createCostForecast = async (req, res) => {
  const { production_id, title, start_date, end_date, default_view = 'weekly', notes } = req.body;

  if (!production_id) return res.status(400).json({ error: 'production_id is required' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
  if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date are required' });
  if (new Date(end_date) < new Date(start_date)) return res.status(400).json({ error: 'end_date must be on or after start_date' });
  const view = default_view === 'daily' ? 'daily' : 'weekly';

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [production] } = await client.query(
      'SELECT id, rate_card_type FROM productions WHERE id = $1', [production_id]
    );
    if (!production) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Production not found' });
    }
    const rateCardType = production.rate_card_type === 'commercial' ? 'commercial' : 'standard';  // RateCardType
    const multiplier   = await multiplierFor(client, rateCardType);

    // 1. Fetch active bectu rates
    const { rows: bectuRates } = await client.query(ACTIVE_BECTU_SQL);

    // 2. Insert header
    const { rows: [forecast] } = await client.query(
      `INSERT INTO cost_forecasts
         (production_id, title, start_date, end_date, default_view, status, notes, created_by,
          rate_card_type, rate_multiplier, travel_hourly_rate, per_diem_rate, margin_enabled, margin_pct)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [production_id, title.trim(), start_date, end_date, view, notes || null, req.user?.id || null,
       rateCardType, multiplier, CFC.DEFAULTS.travel_hourly_rate, CFC.DEFAULTS.per_diem_rate,
       CFC.DEFAULTS.margin_enabled, CFC.DEFAULTS.margin_pct]
    );

    // 3. Build & insert default crew lines (card rates × the forecast's multiplier)
    const defaultCrew = buildDefaultCostForecastLines(bectuRates);
    for (const c of defaultCrew) {
      const card = CFC.cardRatesFor(bectuRates, c, multiplier, view);
      const unitRate = card ? card.unit_rate : (view === 'daily' ? c.daily_rate : c.weekly_rate);
      await client.query(
        `INSERT INTO cost_forecast_crew_lines
           (cost_forecast_id, section, trade, rank, cost_code, bectu_rate_id, unit_rate, units, rate_unit, line_total, sort_order,
            daily_rate, default_ot_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          forecast.id, c.section, c.trade, c.rank, c.cost_code, c.bectu_rate_id,
          unitRate, 0, view, 0, c.sort_order,
          card ? card.daily_rate : (c.daily_rate || 0), card ? card.default_ot_rate : 0,
        ]
      );
    }

    // 4. Build & insert default non-labour lines
    let sortOrder = 0;
    let totalNL = 0;
    for (const nl of STANDARD_NON_LABOUR_ITEMS) {
      const lineTotal = CFC.priceNonLabourLine(nl, settingsOf(forecast)).line_total;
      totalNL += lineTotal;
      await client.query(
        `INSERT INTO cost_forecast_non_labour_lines
           (cost_forecast_id, category, cost_code, description, unit_rate, quantity, unit_type, line_total, is_custom, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)`,
        [forecast.id, nl.category, nl.cost_code, nl.description, nl.unit_rate, nl.quantity, nl.unit_type, lineTotal, sortOrder++]
      );
    }
    totalNL = Number(totalNL.toFixed(2));

    // 5. Initial totals (no crew units yet; margin starts off)
    await client.query(
      `UPDATE cost_forecasts
       SET total_non_labour_cost = $1, grand_total_cost = $1, grand_total_with_margin = $1
       WHERE id = $2`,
      [totalNL, forecast.id]
    );

    await client.query('COMMIT');

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'forecasting',
      action: 'cost_forecast_created',
      entityType: 'cost_forecasts',
      entityId: forecast.id,
      details: `Created Cost Forecast "${forecast.title}" for production (${rateCardType} rate card)`,
    });

    res.status(201).json({ ...forecast, total_non_labour_cost: totalNL, grand_total_cost: totalNL, grand_total_with_margin: totalNL });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createCostForecast:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

/**
 * GET /api/forecasting/cost-forecasts/:id
 * Fetches forecast details and line items. If unlocked, syncs crew lines with the active rate card
 * (× the forecast's rate multiplier). FB-08: typed overrides, hours/days and margin toggles are
 * never touched by the sync; only rows/totals that actually change are written.
 */
const getCostForecastById = async (req, res) => {
  try {
    const { rows: [forecast] } = await db.query(
      `SELECT cf.*,
              p.name AS production_name,
              p.production_code AS production_code,
              p.rate_card_type AS production_rate_card_type,
              u.full_name AS created_by_name,
              lu.full_name AS locked_by_name
       FROM cost_forecasts cf
       JOIN productions p ON cf.production_id = p.id
       LEFT JOIN users u ON cf.created_by = u.id
       LEFT JOIN users lu ON cf.locked_by = lu.id
       WHERE cf.id = $1`,
      [req.params.id]
    );
    if (!forecast) return res.status(404).json({ error: 'Cost Forecast not found' });

    const { rows: storedCrew } = await db.query(
      `SELECT * FROM cost_forecast_crew_lines WHERE cost_forecast_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );
    const { rows: storedNonLabour } = await db.query(
      `SELECT * FROM cost_forecast_non_labour_lines WHERE cost_forecast_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );

    let crewLines = storedCrew;
    let nonLabourLines = storedNonLabour;

    // Live sync for unlocked forecasts:
    if (forecast.status !== 'locked') {
      const { rows: bectuRates } = await db.query(ACTIVE_BECTU_SQL);
      const multiplier = await multiplierFor(db, forecast.rate_card_type);
      const priced = priceLines(forecast, storedCrew, storedNonLabour, { bectuRates, multiplier });

      await storeCrewLines(db, new Map(storedCrew.map(l => [l.id, l])), priced.crew);
      for (const nl of priced.nonLabour) {
        const before = storedNonLabour.find(x => x.id === nl.id);
        if (before && same(before.line_total, nl.line_total) && same(before.margin_amount, nl.margin_amount)) continue;
        await db.query(
          `UPDATE cost_forecast_non_labour_lines SET line_total = $1, margin_amount = $2 WHERE id = $3`,
          [nl.line_total, nl.margin_amount, nl.id]
        );
      }
      crewLines = priced.crew;
      nonLabourLines = priced.nonLabour;

      const t = priced.totals;
      const changed =
        !same(forecast.total_crew_cost, t.total_crew_cost) ||
        !same(forecast.total_non_labour_cost, t.total_non_labour_cost) ||
        !same(forecast.grand_total_cost, t.grand_total_cost) ||
        !same(forecast.margin_total, t.margin_total) ||
        !same(forecast.grand_total_with_margin, t.grand_total_with_margin) ||
        !same(forecast.rate_multiplier, multiplier);
      if (changed) {
        await storeTotals(db, forecast.id, t, multiplier);
        Object.assign(forecast, t, { rate_multiplier: multiplier });
      }
    }

    res.json({
      ...forecast,
      crew_lines: crewLines,
      non_labour_lines: nonLabourLines,
    });
  } catch (err) {
    console.error('getCostForecastById:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * PUT /api/forecasting/cost-forecasts/:id
 * Updates quantities, view mode, custom lines, dates and FB-08 options, then re-prices server-side.
 * Body (all optional): title, start_date, end_date, default_view, notes,
 *   rate_card_type, travel_hourly_rate, per_diem_rate, margin_enabled, margin_pct,
 *   crew_lines: [{ id, units, ot_hours, ot_rate, travel_hours, per_diem_days, saturday_days,
 *                 saturday_rate, sunday_days, sunday_rate, margin_applied, unit_rate* }]
 *     (*unit_rate is only used for grades that are not on the rate card),
 *   non_labour_lines: [{ category, cost_code, description, unit_rate, quantity, unit_type,
 *                       is_custom, margin_applied }]  (replaces the list)
 * Returns the forecast header with its priced crew_lines and non_labour_lines.
 */
const updateCostForecast = async (req, res) => {
  const { title, start_date, end_date, default_view, notes, crew_lines, non_labour_lines } = req.body;

  const settings = CFC.parseSettings(req.body);
  if (settings.error) return res.status(400).json({ error: settings.error });
  if (default_view !== undefined && !['weekly', 'daily'].includes(default_view))
    return res.status(400).json({ error: 'default_view must be weekly or daily' });

  const crewInput = new Map();
  if (crew_lines !== undefined) {
    if (!Array.isArray(crew_lines)) return res.status(400).json({ error: 'crew_lines must be an array' });
    for (const l of crew_lines) {
      const parsed = CFC.parseCrewLineInput(l);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const clientRate = Number(l.unit_rate);
      crewInput.set(l.id, { ...parsed.values, client_unit_rate: Number.isFinite(clientRate) && clientRate >= 0 ? clientRate : null });
    }
  }
  if (non_labour_lines !== undefined && !Array.isArray(non_labour_lines))
    return res.status(400).json({ error: 'non_labour_lines must be an array' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [existing] } = await client.query(
      `SELECT * FROM cost_forecasts WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cost Forecast not found' });
    }
    if (existing.status === 'locked') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot edit a locked forecast. Create a new revision version.' });
    }

    // 1. Update header fields
    const newView = default_view || existing.default_view;
    const s = settings.values;
    const { rows: [header] } = await client.query(
      `UPDATE cost_forecasts
       SET title = COALESCE($1, title),
           start_date = COALESCE($2, start_date),
           end_date = COALESCE($3, end_date),
           default_view = $4,
           notes = COALESCE($5, notes),
           rate_card_type     = COALESCE($6, rate_card_type),
           travel_hourly_rate = COALESCE($7, travel_hourly_rate),
           per_diem_rate      = COALESCE($8, per_diem_rate),
           margin_enabled     = COALESCE($9, margin_enabled),
           margin_pct         = COALESCE($10, margin_pct),
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        title ? title.trim() : null,
        start_date || null,
        end_date || null,
        newView,
        notes !== undefined ? notes : existing.notes,
        s.rate_card_type ?? null,
        s.travel_hourly_rate ?? null,
        s.per_diem_rate ?? null,
        s.margin_enabled ?? null,
        s.margin_pct ?? null,
        req.params.id,
      ]
    );

    // 2. Crew lines: merge the typed values onto the stored lines
    const { rows: storedCrew } = await client.query(
      `SELECT * FROM cost_forecast_crew_lines WHERE cost_forecast_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );
    const mergedCrew = storedCrew.map(line => {
      const input = crewInput.get(line.id);
      if (!input) return line;
      const { client_unit_rate, ...typed } = input;
      return { ...line, ...typed, unit_rate: client_unit_rate ?? line.unit_rate };
    });

    // 3. Non-labour lines: replace the list when provided (as before)
    if (Array.isArray(non_labour_lines)) {
      await client.query(`DELETE FROM cost_forecast_non_labour_lines WHERE cost_forecast_id = $1`, [req.params.id]);
      let order = 0;
      for (const nl of non_labour_lines) {
        const qty  = parseFloat(nl.quantity) || 0;
        const rate = parseFloat(nl.unit_rate) || 0;
        await client.query(
          `INSERT INTO cost_forecast_non_labour_lines
             (cost_forecast_id, category, cost_code, description, unit_rate, quantity, unit_type, line_total, is_custom, sort_order, margin_applied)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            req.params.id,
            nl.category || 'materials',
            nl.cost_code || null,
            nl.description || 'Cost Item',
            rate,
            qty,
            nl.unit_type || 'lump_sum',
            Number((qty * rate).toFixed(2)),
            Boolean(nl.is_custom),
            order++,
            nl.margin_applied === undefined ? true : Boolean(nl.margin_applied),
          ]
        );
      }
    }
    const { rows: storedNonLabour } = await client.query(
      `SELECT * FROM cost_forecast_non_labour_lines WHERE cost_forecast_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );

    // 4. Re-price everything server-side against the live card × the (possibly new) multiplier
    const { rows: bectuRates } = await client.query(ACTIVE_BECTU_SQL);
    const multiplier = await multiplierFor(client, header.rate_card_type);
    const priced = priceLines(header, mergedCrew, storedNonLabour, { bectuRates, multiplier });
    await storeCrewLines(client, new Map(storedCrew.map(l => [l.id, l])), priced.crew);
    for (const nl of priced.nonLabour) {
      await client.query(
        `UPDATE cost_forecast_non_labour_lines SET line_total = $1, margin_amount = $2 WHERE id = $3`,
        [nl.line_total, nl.margin_amount, nl.id]
      );
    }

    // 5. Update grand totals
    const { rows: [updated] } = await storeTotals(client, req.params.id, priced.totals, multiplier);

    await client.query('COMMIT');

    if (s.rate_card_type && s.rate_card_type !== existing.rate_card_type) {
      await logAudit({
        userId: req.user?.id, userName: req.user?.full_name, userRole: req.user?.role,
        category: 'forecasting', action: 'cost_forecast_rate_card_changed', entityType: 'cost_forecasts',
        entityId: req.params.id,
        details: `Cost Forecast "${updated.title}" switched from ${existing.rate_card_type || 'standard'} to ${s.rate_card_type} rates`,
      });
    }

    res.json({ ...updated, crew_lines: priced.crew, non_labour_lines: priced.nonLabour });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('updateCostForecast:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

/**
 * POST /api/forecasting/cost-forecasts/:id/lock
 * Locks forecast, freezing a snapshot of all rates (and the rate multiplier) at this moment.
 */
const lockCostForecast = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [forecast] } = await client.query(
      `SELECT * FROM cost_forecasts WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!forecast || forecast.status === 'locked') {
      await client.query('ROLLBACK');
      return res.status(forecast ? 400 : 404).json({ error: forecast ? 'Forecast is already locked' : 'Cost Forecast not found' });
    }

    // Capture frozen snapshot of active rates
    const { rows: bectuRates } = await client.query(ACTIVE_BECTU_SQL);
    const multiplier = await multiplierFor(client, forecast.rate_card_type);

    const { rows: storedCrew } = await client.query(
      `SELECT * FROM cost_forecast_crew_lines WHERE cost_forecast_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );
    const { rows: storedNonLabour } = await client.query(
      `SELECT * FROM cost_forecast_non_labour_lines WHERE cost_forecast_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );
    const priced = priceLines(forecast, storedCrew, storedNonLabour, { bectuRates, multiplier });
    await storeCrewLines(client, new Map(storedCrew.map(l => [l.id, l])), priced.crew);
    for (const nl of priced.nonLabour) {
      await client.query(
        `UPDATE cost_forecast_non_labour_lines SET line_total = $1, margin_amount = $2 WHERE id = $3`,
        [nl.line_total, nl.margin_amount, nl.id]
      );
    }

    const snapshot = {
      locked_at: new Date().toISOString(),
      locked_by: req.user?.full_name,
      bectu_rates: bectuRates.map(r => ({
        id: r.id, trade: r.trade, rank: r.rank, daily_rate: r.daily_rate, overtime_rate: r.overtime_rate, weekly_rate: r.weekly_rate,
      })),
      rate_card_type: forecast.rate_card_type || 'standard',
      rate_multiplier: multiplier,
      settings: settingsOf(forecast),
    };

    const t = priced.totals;
    const { rows: [locked] } = await client.query(
      `UPDATE cost_forecasts
       SET status = 'locked',
           locked_at = NOW(),
           locked_by = $1,
           rates_snapshot = $2,
           total_crew_cost = $3,
           total_non_labour_cost = $4,
           grand_total_cost = $5,
           margin_total = $6,
           grand_total_with_margin = $7,
           rate_multiplier = $8,
           updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [req.user?.id || null, JSON.stringify(snapshot), t.total_crew_cost, t.total_non_labour_cost, t.grand_total_cost,
       t.margin_total, t.grand_total_with_margin, multiplier, req.params.id]
    );
    await client.query('COMMIT');

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'forecasting',
      action: 'cost_forecast_locked',
      entityType: 'cost_forecasts',
      entityId: forecast.id,
      details: `Approved & locked Cost Forecast "${forecast.title}" (Grand Total: £${locked.grand_total_cost}` +
        `${Number(locked.margin_total) > 0 ? `; with margin £${locked.grand_total_with_margin}` : ''})`,
    });

    res.json(locked);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('lockCostForecast:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

/**
 * POST /api/forecasting/cost-forecasts/:id/version
 * Creates a revised draft clone (v2, v3) from a locked forecast — FB-08 options and line extras included.
 */
const versionCostForecast = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [original] } = await client.query(
      `SELECT * FROM cost_forecasts WHERE id = $1`,
      [req.params.id]
    );
    if (!original) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Original Cost Forecast not found' }); }
    if (original.status !== 'locked') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Only locked forecasts can be versioned. Lock this forecast first before creating a revision.' }); }

    const newVersion = (original.version || 1) + 1;
    const newTitle = original.title.includes('(Rev')
      ? original.title.replace(/\(Rev \d+\)/, `(Rev ${newVersion})`)
      : `${original.title} (Rev ${newVersion})`;

    // Create cloned header
    const { rows: [cloned] } = await client.query(
      `INSERT INTO cost_forecasts
         (production_id, title, start_date, end_date, default_view, status, version, parent_forecast_id,
          total_crew_cost, total_non_labour_cost, grand_total_cost, notes, created_by,
          rate_card_type, rate_multiplier, travel_hourly_rate, per_diem_rate, margin_enabled, margin_pct,
          margin_total, grand_total_with_margin)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING *`,
      [
        original.production_id,
        newTitle,
        original.start_date,
        original.end_date,
        original.default_view,
        newVersion,
        original.id,
        original.total_crew_cost,
        original.total_non_labour_cost,
        original.grand_total_cost,
        original.notes,
        req.user?.id || null,
        original.rate_card_type || 'standard',
        original.rate_multiplier ?? 1,
        original.travel_hourly_rate ?? CFC.DEFAULTS.travel_hourly_rate,
        original.per_diem_rate ?? CFC.DEFAULTS.per_diem_rate,
        original.margin_enabled ?? CFC.DEFAULTS.margin_enabled,
        original.margin_pct ?? CFC.DEFAULTS.margin_pct,
        original.margin_total ?? 0,
        original.grand_total_with_margin ?? original.grand_total_cost,
      ]
    );

    // Clone crew lines
    await client.query(
      `INSERT INTO cost_forecast_crew_lines
         (cost_forecast_id, section, trade, rank, cost_code, bectu_rate_id, unit_rate, units, rate_unit, line_total, sort_order,
          daily_rate, default_ot_rate, ot_hours, ot_rate, travel_hours, per_diem_days, saturday_days, saturday_rate,
          sunday_days, sunday_rate, margin_applied, margin_amount)
       SELECT $1, section, trade, rank, cost_code, bectu_rate_id, unit_rate, units, rate_unit, line_total, sort_order,
          daily_rate, default_ot_rate, ot_hours, ot_rate, travel_hours, per_diem_days, saturday_days, saturday_rate,
          sunday_days, sunday_rate, margin_applied, margin_amount
       FROM cost_forecast_crew_lines
       WHERE cost_forecast_id = $2`,
      [cloned.id, original.id]
    );

    // Clone non-labour lines
    await client.query(
      `INSERT INTO cost_forecast_non_labour_lines
         (cost_forecast_id, category, cost_code, description, unit_rate, quantity, unit_type, line_total, is_custom, sort_order,
          margin_applied, margin_amount)
       SELECT $1, category, cost_code, description, unit_rate, quantity, unit_type, line_total, is_custom, sort_order,
          margin_applied, margin_amount
       FROM cost_forecast_non_labour_lines
       WHERE cost_forecast_id = $2`,
      [cloned.id, original.id]
    );

    await client.query('COMMIT');

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'forecasting',
      action: 'cost_forecast_versioned',
      entityType: 'cost_forecasts',
      entityId: cloned.id,
      details: `Created revision ${newVersion} ("${newTitle}") from forecast ${original.id}`,
    });

    res.status(201).json(cloned);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('versionCostForecast:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/forecasting/cost-forecasts/:id
 */
const deleteCostForecast = async (req, res) => {
  try {
    const { rows: [deleted] } = await db.query(
      `DELETE FROM cost_forecasts WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!deleted) return res.status(404).json({ error: 'Cost Forecast not found' });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'forecasting',
      action: 'cost_forecast_deleted',
      entityType: 'cost_forecasts',
      entityId: deleted.id,
      details: `Deleted Cost Forecast "${deleted.title}"`,
    });

    res.json({ message: 'Cost Forecast deleted', id: deleted.id });
  } catch (err) {
    console.error('deleteCostForecast:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  listCostForecasts,
  createCostForecast,
  getCostForecastById,
  updateCostForecast,
  lockCostForecast,
  versionCostForecast,
  deleteCostForecast,
};
