const db = require('../config/db');
const { logAudit } = require('../services/auditService');
const {
  STANDARD_NON_LABOUR_ITEMS,
  buildDefaultCostForecastLines,
  resolveRate,
} = require('../services/forecastingDefaults');

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

/**
 * POST /api/forecasting/cost-forecasts
 * Creates a new Cost Forecast and auto-populates standard crew & non-labour lines
 */
const createCostForecast = async (req, res) => {
  const { production_id, title, start_date, end_date, default_view = 'weekly', notes } = req.body;

  if (!production_id) return res.status(400).json({ error: 'production_id is required' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
  if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date are required' });
  if (new Date(end_date) < new Date(start_date)) return res.status(400).json({ error: 'end_date must be on or after start_date' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch active bectu rates
    const { rows: bectuRates } = await client.query(
      `SELECT * FROM bectu_rates WHERE effective_to IS NULL ORDER BY trade, rank`
    );

    // 2. Insert header
    const { rows: [forecast] } = await client.query(
      `INSERT INTO cost_forecasts
         (production_id, title, start_date, end_date, default_view, status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7)
       RETURNING *`,
      [production_id, title.trim(), start_date, end_date, default_view, notes || null, req.user?.id || null]
    );

    // 3. Build & insert default crew lines
    const defaultCrew = buildDefaultCostForecastLines(bectuRates);
    for (const c of defaultCrew) {
      await client.query(
        `INSERT INTO cost_forecast_crew_lines
           (cost_forecast_id, section, trade, rank, cost_code, bectu_rate_id, unit_rate, units, rate_unit, line_total, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          forecast.id, c.section, c.trade, c.rank, c.cost_code, c.bectu_rate_id,
          default_view === 'daily' ? c.daily_rate : c.weekly_rate,
          0, default_view, 0, c.sort_order
        ]
      );
    }

    // 4. Build & insert default non-labour lines
    let sortOrder = 0;
    for (const nl of STANDARD_NON_LABOUR_ITEMS) {
      const lineTotal = (nl.unit_rate || 0) * (nl.quantity || 0);
      await client.query(
        `INSERT INTO cost_forecast_non_labour_lines
           (cost_forecast_id, category, cost_code, description, unit_rate, quantity, unit_type, line_total, is_custom, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)`,
        [forecast.id, nl.category, nl.cost_code, nl.description, nl.unit_rate, nl.quantity, nl.unit_type, lineTotal, sortOrder++]
      );
    }

    // 5. Update initial non-labour sum
    const { rows: [totals] } = await client.query(
      `SELECT COALESCE(SUM(line_total), 0) AS total_nl
       FROM cost_forecast_non_labour_lines
       WHERE cost_forecast_id = $1`,
      [forecast.id]
    );

    const totalNL = parseFloat(totals.total_nl) || 0;
    await client.query(
      `UPDATE cost_forecasts
       SET total_non_labour_cost = $1, grand_total_cost = $1
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
      details: `Created Cost Forecast "${forecast.title}" for production`,
    });

    res.status(201).json({ ...forecast, total_non_labour_cost: totalNL, grand_total_cost: totalNL });
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
 * Fetches forecast details and line items. If unlocked, syncs crew lines with active BECTU rates.
 */
const getCostForecastById = async (req, res) => {
  try {
    const { rows: [forecast] } = await db.query(
      `SELECT cf.*,
              p.name AS production_name,
              p.production_code AS production_code,
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

    let { rows: crewLines } = await db.query(
      `SELECT * FROM cost_forecast_crew_lines WHERE cost_forecast_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );

    const { rows: nonLabourLines } = await db.query(
      `SELECT * FROM cost_forecast_non_labour_lines WHERE cost_forecast_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );

    // Live sync for unlocked forecasts:
    if (forecast.status !== 'locked') {
      const { rows: bectuRates } = await db.query(
        `SELECT * FROM bectu_rates WHERE effective_to IS NULL`
      );

      let crewTotal = 0;
      for (const line of crewLines) {
        const rateInfo = resolveRate(bectuRates, line.trade, line.rank);
        const newRate = forecast.default_view === 'daily' ? rateInfo.daily_rate : rateInfo.weekly_rate;
        if (rateInfo.bectu_rate_id && (
          line.bectu_rate_id !== rateInfo.bectu_rate_id ||
          Math.abs(parseFloat(line.unit_rate) - newRate) > 0.001
        )) {
          line.unit_rate = newRate;
          line.bectu_rate_id = rateInfo.bectu_rate_id;
          line.line_total = Number((newRate * parseFloat(line.units || 0)).toFixed(2));
          await db.query(
            `UPDATE cost_forecast_crew_lines
             SET unit_rate = $1, bectu_rate_id = $2, line_total = $3
             WHERE id = $4`,
            [newRate, rateInfo.bectu_rate_id, line.line_total, line.id]
          );
        }
        crewTotal += parseFloat(line.line_total) || 0;
      }

      const nlTotal = nonLabourLines.reduce((acc, l) => acc + (parseFloat(l.line_total) || 0), 0);
      const grandTotal = crewTotal + nlTotal;

      if (
        Math.abs(parseFloat(forecast.total_crew_cost) - crewTotal) > 0.01 ||
        Math.abs(parseFloat(forecast.grand_total_cost) - grandTotal) > 0.01
      ) {
        forecast.total_crew_cost = crewTotal;
        forecast.total_non_labour_cost = nlTotal;
        forecast.grand_total_cost = grandTotal;
        await db.query(
          `UPDATE cost_forecasts
           SET total_crew_cost = $1, total_non_labour_cost = $2, grand_total_cost = $3
           WHERE id = $4`,
          [crewTotal, nlTotal, grandTotal, forecast.id]
        );
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
 * Updates quantities, view mode, custom lines, dates, and recalculates totals
 */
const updateCostForecast = async (req, res) => {
  const { title, start_date, end_date, default_view, notes, crew_lines, non_labour_lines } = req.body;

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
    await client.query(
      `UPDATE cost_forecasts
       SET title = COALESCE($1, title),
           start_date = COALESCE($2, start_date),
           end_date = COALESCE($3, end_date),
           default_view = $4,
           notes = COALESCE($5, notes),
           updated_at = NOW()
       WHERE id = $6`,
      [
        title ? title.trim() : null,
        start_date || null,
        end_date || null,
        newView,
        notes !== undefined ? notes : existing.notes,
        req.params.id,
      ]
    );

    // 2. Update crew lines if provided
    let crewTotal = 0;
    if (Array.isArray(crew_lines)) {
      for (const line of crew_lines) {
        const units = parseFloat(line.units) || 0;
        const unitRate = parseFloat(line.unit_rate) || 0;
        const lineTotal = Number((units * unitRate).toFixed(2));
        crewTotal += lineTotal;

        await client.query(
          `UPDATE cost_forecast_crew_lines
           SET units = $1, unit_rate = $2, rate_unit = $3, line_total = $4
           WHERE id = $5 AND cost_forecast_id = $6`,
          [units, unitRate, newView, lineTotal, line.id, req.params.id]
        );
      }
    } else {
      const { rows: [ct] } = await client.query(
        `SELECT COALESCE(SUM(line_total), 0) AS total FROM cost_forecast_crew_lines WHERE cost_forecast_id = $1`,
        [req.params.id]
      );
      crewTotal = parseFloat(ct.total) || 0;
    }

    // 3. Update or recreate non-labour lines if provided
    let nlTotal = 0;
    if (Array.isArray(non_labour_lines)) {
      // Delete existing and bulk insert updated list
      await client.query(
        `DELETE FROM cost_forecast_non_labour_lines WHERE cost_forecast_id = $1`,
        [req.params.id]
      );

      let s = 0;
      for (const nl of non_labour_lines) {
        const qty = parseFloat(nl.quantity) || 0;
        const rate = parseFloat(nl.unit_rate) || 0;
        const lineTotal = Number((qty * rate).toFixed(2));
        nlTotal += lineTotal;

        await client.query(
          `INSERT INTO cost_forecast_non_labour_lines
             (cost_forecast_id, category, cost_code, description, unit_rate, quantity, unit_type, line_total, is_custom, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            req.params.id,
            nl.category || 'materials',
            nl.cost_code || null,
            nl.description || 'Cost Item',
            rate,
            qty,
            nl.unit_type || 'lump_sum',
            lineTotal,
            Boolean(nl.is_custom),
            s++
          ]
        );
      }
    } else {
      const { rows: [nlt] } = await client.query(
        `SELECT COALESCE(SUM(line_total), 0) AS total FROM cost_forecast_non_labour_lines WHERE cost_forecast_id = $1`,
        [req.params.id]
      );
      nlTotal = parseFloat(nlt.total) || 0;
    }

    // 4. Update grand totals
    const grandTotal = crewTotal + nlTotal;
    const { rows: [updated] } = await client.query(
      `UPDATE cost_forecasts
       SET total_crew_cost = $1, total_non_labour_cost = $2, grand_total_cost = $3
       WHERE id = $4
       RETURNING *`,
      [crewTotal, nlTotal, grandTotal, req.params.id]
    );

    await client.query('COMMIT');
    res.json(updated);
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
 * Locks forecast, freezing a snapshot of all rates at this moment
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
    const { rows: bectuRates } = await client.query(
      `SELECT id, trade, rank, daily_rate, overtime_rate, weekly_rate FROM bectu_rates WHERE effective_to IS NULL`
    );

    const { rows: crewLines } = await client.query(
      `SELECT * FROM cost_forecast_crew_lines WHERE cost_forecast_id = $1`,
      [req.params.id]
    );
    for (const line of crewLines) {
      const rate = resolveRate(bectuRates, line.trade, line.rank);
      if (!rate.bectu_rate_id) continue;
      const unitRate = forecast.default_view === 'daily' ? rate.daily_rate : rate.weekly_rate;
      await client.query(
        `UPDATE cost_forecast_crew_lines SET unit_rate = $1, bectu_rate_id = $2,
         line_total = ROUND(units * $1::numeric, 2) WHERE id = $3`,
        [unitRate, rate.bectu_rate_id, line.id]
      );
    }

    const snapshot = {
      locked_at: new Date().toISOString(),
      locked_by: req.user?.full_name,
      bectu_rates: bectuRates,
    };

    const { rows: [locked] } = await client.query(
      `UPDATE cost_forecasts
       SET status = 'locked',
           locked_at = NOW(),
           locked_by = $1,
           rates_snapshot = $2,
           total_crew_cost = (SELECT COALESCE(SUM(line_total), 0) FROM cost_forecast_crew_lines WHERE cost_forecast_id = $3),
           total_non_labour_cost = (SELECT COALESCE(SUM(line_total), 0) FROM cost_forecast_non_labour_lines WHERE cost_forecast_id = $3),
           grand_total_cost = (SELECT COALESCE(SUM(line_total), 0) FROM cost_forecast_crew_lines WHERE cost_forecast_id = $3)
             + (SELECT COALESCE(SUM(line_total), 0) FROM cost_forecast_non_labour_lines WHERE cost_forecast_id = $3),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [req.user?.id || null, JSON.stringify(snapshot), req.params.id]
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
      details: `Approved & locked Cost Forecast "${forecast.title}" (Grand Total: £${locked.grand_total_cost})`,
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
 * Creates a revised draft clone (v2, v3) from a locked forecast
 */
const versionCostForecast = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [original] } = await client.query(
      `SELECT * FROM cost_forecasts WHERE id = $1`,
      [req.params.id]
    );
    if (!original) return res.status(404).json({ error: 'Original Cost Forecast not found' });
    if (original.status !== 'locked') return res.status(400).json({ error: 'Only locked forecasts can be versioned. Lock this forecast first before creating a revision.' });

    const newVersion = (original.version || 1) + 1;
    const newTitle = original.title.includes('(Rev')
      ? original.title.replace(/\(Rev \d+\)/, `(Rev ${newVersion})`)
      : `${original.title} (Rev ${newVersion})`;

    // Create cloned header
    const { rows: [cloned] } = await client.query(
      `INSERT INTO cost_forecasts
         (production_id, title, start_date, end_date, default_view, status, version, parent_forecast_id,
          total_crew_cost, total_non_labour_cost, grand_total_cost, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12)
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
        req.user?.id || null
      ]
    );

    // Clone crew lines
    await client.query(
      `INSERT INTO cost_forecast_crew_lines
         (cost_forecast_id, section, trade, rank, cost_code, bectu_rate_id, unit_rate, units, rate_unit, line_total, sort_order)
       SELECT $1, section, trade, rank, cost_code, bectu_rate_id, unit_rate, units, rate_unit, line_total, sort_order
       FROM cost_forecast_crew_lines
       WHERE cost_forecast_id = $2`,
      [cloned.id, original.id]
    );

    // Clone non-labour lines
    await client.query(
      `INSERT INTO cost_forecast_non_labour_lines
         (cost_forecast_id, category, cost_code, description, unit_rate, quantity, unit_type, line_total, is_custom, sort_order)
       SELECT $1, category, cost_code, description, unit_rate, quantity, unit_type, line_total, is_custom, sort_order
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
