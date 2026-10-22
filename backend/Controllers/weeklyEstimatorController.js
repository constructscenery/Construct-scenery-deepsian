const db = require('../config/db');
const { logAudit } = require('../services/auditService');

/**
 * GET /api/forecasting/weekly-custom-estimates
 * List all saved weekly custom estimates, optionally filtered by production_id
 */
const listEstimates = async (req, res) => {
  try {
    const { production_id } = req.query;
    const conds = [];
    const params = [];
    let i = 1;

    if (production_id) {
      conds.push(`e.production_id = $${i++}`);
      params.push(production_id);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT e.*,
              p.name AS production_name,
              p.production_code AS production_code,
              p.status AS production_status,
              u.full_name AS created_by_name
       FROM weekly_custom_estimates e
       LEFT JOIN productions p ON p.id = e.production_id
       LEFT JOIN users u ON u.id = e.created_by
       ${where}
       ORDER BY e.updated_at DESC`,
      params
    );

    res.json({ estimates: rows });
  } catch (err) {
    console.error('listEstimates error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/forecasting/weekly-custom-estimates/:id
 * Retrieve a single custom estimate by ID
 */
const getEstimateById = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `SELECT e.*,
              p.name AS production_name,
              p.production_code AS production_code,
              p.status AS production_status,
              u.full_name AS created_by_name
       FROM weekly_custom_estimates e
       LEFT JOIN productions p ON p.id = e.production_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Weekly custom estimate not found' });
    }

    res.json({ estimate: rows[0] });
  } catch (err) {
    console.error('getEstimateById error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/forecasting/weekly-custom-estimates
 * Create a new custom weekly estimate
 */
const createEstimate = async (req, res) => {
  try {
    const {
      title,
      production_id,
      num_weeks = 3,
      start_date,
      margin_enabled = true,
      margin_percentage = 10.0,
      weeks_config = [],
      summary_totals = {},
      notes = '',
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const parsedWeeks = Math.max(1, parseInt(num_weeks, 10) || 3);
    const parsedMargin = parseFloat(margin_percentage) >= 0 ? parseFloat(margin_percentage) : 10.0;

    const { rows } = await db.query(
      `INSERT INTO weekly_custom_estimates (
        title,
        production_id,
        num_weeks,
        start_date,
        margin_enabled,
        margin_percentage,
        weeks_config,
        summary_totals,
        notes,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        title.trim(),
        production_id || null,
        parsedWeeks,
        start_date || null,
        Boolean(margin_enabled),
        parsedMargin,
        JSON.stringify(weeks_config || []),
        JSON.stringify(summary_totals || {}),
        notes || '',
        req.user?.id || null,
      ]
    );

    const created = rows[0];

    try {
      await logAudit({
        userId: req.user?.id,
        action: 'CREATE',
        entity: 'weekly_custom_estimate',
        entityId: created.id,
        details: { title: created.title, num_weeks: created.num_weeks, margin_percentage: created.margin_percentage },
        req,
      });
    } catch (auditErr) {
      console.warn('Audit log failed for createEstimate:', auditErr.message);
    }

    res.status(201).json({ estimate: created });
  } catch (err) {
    console.error('createEstimate error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * PUT /api/forecasting/weekly-custom-estimates/:id
 * Update an existing custom estimate
 */
const updateEstimate = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      production_id,
      num_weeks,
      start_date,
      margin_enabled,
      margin_percentage,
      weeks_config,
      summary_totals,
      notes,
    } = req.body;

    const existingRes = await db.query('SELECT * FROM weekly_custom_estimates WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Weekly custom estimate not found' });
    }
    const existing = existingRes.rows[0];

    const updatedTitle = title !== undefined ? title.trim() : existing.title;
    if (!updatedTitle) {
      return res.status(400).json({ error: 'Title cannot be empty' });
    }

    const updatedProductionId = production_id !== undefined ? (production_id || null) : existing.production_id;
    const updatedNumWeeks = num_weeks !== undefined ? Math.max(1, parseInt(num_weeks, 10) || 1) : existing.num_weeks;
    const updatedStartDate = start_date !== undefined ? (start_date || null) : existing.start_date;
    const updatedMarginEnabled = margin_enabled !== undefined ? Boolean(margin_enabled) : existing.margin_enabled;
    const updatedMarginPct = margin_percentage !== undefined ? parseFloat(margin_percentage) : existing.margin_percentage;
    const updatedWeeksConfig = weeks_config !== undefined ? JSON.stringify(weeks_config) : JSON.stringify(existing.weeks_config);
    const updatedSummaryTotals = summary_totals !== undefined ? JSON.stringify(summary_totals) : JSON.stringify(existing.summary_totals);
    const updatedNotes = notes !== undefined ? notes : existing.notes;

    const { rows } = await db.query(
      `UPDATE weekly_custom_estimates
       SET title = $1,
           production_id = $2,
           num_weeks = $3,
           start_date = $4,
           margin_enabled = $5,
           margin_percentage = $6,
           weeks_config = $7,
           summary_totals = $8,
           notes = $9,
           updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        updatedTitle,
        updatedProductionId,
        updatedNumWeeks,
        updatedStartDate,
        updatedMarginEnabled,
        updatedMarginPct,
        updatedWeeksConfig,
        updatedSummaryTotals,
        updatedNotes,
        id,
      ]
    );

    const updated = rows[0];

    try {
      await logAudit({
        userId: req.user?.id,
        action: 'UPDATE',
        entity: 'weekly_custom_estimate',
        entityId: id,
        details: { title: updated.title, num_weeks: updated.num_weeks },
        req,
      });
    } catch (auditErr) {
      console.warn('Audit log failed for updateEstimate:', auditErr.message);
    }

    res.json({ estimate: updated });
  } catch (err) {
    console.error('updateEstimate error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE /api/forecasting/weekly-custom-estimates/:id
 * Delete a custom estimate
 */
const deleteEstimate = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      'DELETE FROM weekly_custom_estimates WHERE id = $1 RETURNING id, title',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Weekly custom estimate not found' });
    }

    try {
      await logAudit({
        userId: req.user?.id,
        action: 'DELETE',
        entity: 'weekly_custom_estimate',
        entityId: id,
        details: { title: rows[0].title },
        req,
      });
    } catch (auditErr) {
      console.warn('Audit log failed for deleteEstimate:', auditErr.message);
    }

    res.json({ message: 'Weekly estimate deleted successfully', id });
  } catch (err) {
    console.error('deleteEstimate error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/forecasting/weekly-custom-estimates/rates/lookup
 * Standard lookup of rates from bectu_rates + common presets (vehicles, travel, etc.)
 */
const getRatesLookup = async (req, res) => {
  try {
    const { rows: rates } = await db.query(
      `SELECT id, trade, rank, daily_rate, overtime_rate, weekly_rate, rate_type
       FROM bectu_rates
       WHERE effective_to IS NULL
       ORDER BY trade, rank`
    );

    // Standard preset vehicle & equipment rates
    const standardPresets = {
      vehicles: [
        { name: 'Luton Van (Runaround)', default_weekly_rate: 450, default_daily_rate: 90 },
        { name: '7.5 Tonne Lorry', default_weekly_rate: 750, default_daily_rate: 150 },
        { name: 'Transit Van (LWB)', default_weekly_rate: 380, default_daily_rate: 76 },
        { name: 'Box Rental (Tools & Equipment)', default_weekly_rate: 350, default_daily_rate: 70 },
      ],
      defaultTravelHourlyRate: 25.00,
      defaultMarginPercentage: 10.00,
    };

    res.json({
      rates,
      presets: standardPresets,
    });
  } catch (err) {
    console.error('getRatesLookup error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  listEstimates,
  getEstimateById,
  createEstimate,
  updateEstimate,
  deleteEstimate,
  getRatesLookup,
};
