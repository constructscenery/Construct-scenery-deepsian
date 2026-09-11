const db = require('../config/db');

// Trade names that appear as cost_type in percentometer_ratios and map to labour trades
const TRADE_COST_TYPES = new Set(['Carpenters', 'Painters', 'Stagehands', 'Riggers', 'Sculptors', 'Metalwork']);

// ─── GET /api/percentometer/ratios ───────────────────────────────────────────
// ?current=true → only the currently active ratios (effective_to IS NULL)
const getRatios = async (req, res) => {
  try {
    const where = req.query.current === 'true' ? 'WHERE effective_to IS NULL' : '';
    const { rows } = await db.query(
      `SELECT id, cost_type, percentage, effective_from, effective_to, created_at
       FROM percentometer_ratios
       ${where}
       ORDER BY percentage DESC, cost_type`,
      []
    );
    res.json(rows);
  } catch (err) {
    console.error('getRatios:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/percentometer/calculate ───────────────────────────────────────
// Stateless calculation — no DB write. Returns full breakdown from a known cost.
const calculate = async (req, res) => {
  const { known_cost, known_cost_type } = req.body;
  if (!known_cost) return res.status(400).json({ error: 'known_cost is required' });

  try {
    const { rows } = await db.query(
      'SELECT * FROM percentometer_ratios WHERE effective_to IS NULL ORDER BY percentage DESC'
    );
    const costType   = known_cost_type || 'Carpenters';
    const knownRatio = rows.find(r => r.cost_type === costType);
    if (!knownRatio)
      return res.status(400).json({ error: `Unknown cost type: ${costType}` });

    const totalEstimate = parseFloat(known_cost) / parseFloat(knownRatio.percentage);
    res.json({
      known_cost:               parseFloat(known_cost),
      known_cost_type:          costType,
      total_estimated_job_cost: totalEstimate,
      breakdown: rows.map(r => ({
        cost_type:       r.cost_type,
        percentage:      parseFloat(r.percentage) * 100,
        estimated_value: totalEstimate * parseFloat(r.percentage),
      })),
    });
  } catch (err) {
    console.error('calculate:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PATCH /api/percentometer/ratios/:id  (MD only) ──────────────────────────
// Creates a new versioned row — never updates in place.
// Closes the previous active row for that cost_type by setting effective_to = today.
// All ratios must still sum to 100% after the update.
const updateRatio = async (req, res) => {
  const role = req.user?.role;
  if (!['managing_director', 'construction_accountant', 'construction_coordinator'].includes(role))
    return res.status(403).json({ error: 'Unauthorized to update percentometer ratios' });

  const { percentage } = req.body;
  if (percentage === undefined) return res.status(400).json({ error: 'percentage is required' });
  const newPct = parseFloat(percentage);
  if (isNaN(newPct) || newPct <= 0 || newPct >= 1)
    return res.status(400).json({ error: 'percentage must be a decimal between 0 and 1 (e.g. 0.42 for 42%)' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [existing] } = await client.query(
      'SELECT * FROM percentometer_ratios WHERE id = $1 AND effective_to IS NULL',
      [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Active ratio not found' });

    // Check that all other active ratios + new value sum to ~100%
    const { rows: others } = await client.query(
      'SELECT percentage FROM percentometer_ratios WHERE effective_to IS NULL AND id != $1',
      [req.params.id]
    );
    const otherSum = others.reduce((s, r) => s + parseFloat(r.percentage), 0);
    if (Math.abs(otherSum + newPct - 1.0) > 0.005)
      return res.status(400).json({
        error: `Ratios must sum to 100%. Current others sum: ${(otherSum * 100).toFixed(1)}%, new value: ${(newPct * 100).toFixed(1)}%. Total would be ${((otherSum + newPct) * 100).toFixed(1)}%.`,
      });

    const today = new Date().toISOString().split('T')[0];

    // Close the current row
    await client.query(
      'UPDATE percentometer_ratios SET effective_to = $1 WHERE id = $2',
      [today, req.params.id]
    );

    // Insert new versioned row
    const { rows: [newRow] } = await client.query(
      `INSERT INTO percentometer_ratios (cost_type, percentage, effective_from)
       VALUES ($1,$2,$3)
       RETURNING id, cost_type, percentage, effective_from, effective_to`,
      [existing.cost_type, newPct, today]
    );

    await client.query('COMMIT');
    res.json(newRow);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('updateRatio:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ─── GET /api/percentometer/actuals/:productionId ────────────────────────────
// Returns the post-production actuals computed on archive.
// If still processing: { status: 'processing' }
// If complete: per-cost-type rows with side-by-side comparison data.
const getActuals = async (req, res) => {
  const { productionId } = req.params;
  try {
    const { rows: actuals } = await db.query(
      `SELECT * FROM percentometer_actuals
       WHERE production_id = $1
       ORDER BY actual_percentage DESC NULLS LAST`,
      [productionId]
    );

    if (!actuals.length)
      return res.status(404).json({ error: 'No actuals found for this production — ensure it has been archived' });

    const firstRow = actuals[0];
    if (firstRow.status === 'processing')
      return res.json({ status: 'processing', message: 'Processing — check back shortly' });

    if (firstRow.status === 'failed')
      return res.json({ status: 'failed', error: firstRow.error_message });

    // Fetch current ratios for side-by-side comparison
    const { rows: ratios } = await db.query(
      'SELECT cost_type, percentage FROM percentometer_ratios WHERE effective_to IS NULL'
    );
    const ratioMap = Object.fromEntries(ratios.map(r => [r.cost_type, parseFloat(r.percentage)]));

    const grandTotal = parseFloat(firstRow.grand_total || 0);
    const comparison = actuals.filter(r => r.cost_type).map(r => {
      const historicalPct  = ratioMap[r.cost_type] || 0;
      const estimatedValue = grandTotal * historicalPct;
      const actualAmount   = parseFloat(r.actual_amount || 0);
      const actualPct      = parseFloat(r.actual_percentage || 0);
      const varianceGbp    = actualAmount - estimatedValue;
      const variancePct    = estimatedValue > 0 ? (varianceGbp / estimatedValue) * 100 : null;

      let rag = 'unknown';
      if (variancePct !== null) {
        if      (Math.abs(variancePct) <= 5)  rag = 'green';
        else if (Math.abs(variancePct) <= 15) rag = 'amber';
        else                                   rag = 'red';
      }

      return {
        cost_type:       r.cost_type,
        historical_pct:  parseFloat((historicalPct * 100).toFixed(1)),
        estimated_gbp:   parseFloat(estimatedValue.toFixed(2)),
        actual_gbp:      parseFloat(actualAmount.toFixed(2)),
        actual_pct:      parseFloat(actualPct.toFixed(1)),
        variance_gbp:    parseFloat(varianceGbp.toFixed(2)),
        variance_pct:    variancePct !== null ? parseFloat(variancePct.toFixed(1)) : null,
        rag,
      };
    });

    res.json({ status: 'complete', grand_total: grandTotal, computed_at: firstRow.computed_at, comparison });
  } catch (err) {
    console.error('getActuals:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getRatios, calculate, updateRatio, getActuals };
