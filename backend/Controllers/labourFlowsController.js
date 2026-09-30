const db = require('../config/db');
const { logAudit } = require('../services/auditService');
const {
  buildDefaultLabourFlowRows,
  calculateWeeks,
  resolveRate,
} = require('../services/forecastingDefaults');

/**
 * GET /api/forecasting/labour-flows
 */
const listLabourFlows = async (req, res) => {
  try {
    const conds = [];
    const params = [];
    let i = 1;

    if (req.query.production_id) {
      conds.push(`lf.production_id = $${i++}`);
      params.push(req.query.production_id);
    }
    if (req.query.status) {
      conds.push(`lf.status = $${i++}`);
      params.push(req.query.status);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT lf.*,
              p.name AS production_name,
              p.production_code AS production_code,
              u.full_name AS created_by_name,
              lu.full_name AS locked_by_name
       FROM labour_flows lf
       JOIN productions p ON lf.production_id = p.id
       LEFT JOIN users u ON lf.created_by = u.id
       LEFT JOIN users lu ON lf.locked_by = lu.id
       ${where}
       ORDER BY lf.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('listLabourFlows:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/forecasting/labour-flows
 */
const createLabourFlow = async (req, res) => {
  const { production_id, title, start_date, end_date } = req.body;

  if (!production_id) return res.status(400).json({ error: 'production_id is required' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
  if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date are required' });
  if (new Date(end_date) < new Date(start_date)) return res.status(400).json({ error: 'end_date must be on or after start_date' });

  const weeks = calculateWeeks(start_date, end_date);
  const numWeeks = weeks.length;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch active bectu rates
    const { rows: bectuRates } = await client.query(
      `SELECT * FROM bectu_rates WHERE effective_to IS NULL ORDER BY trade, rank`
    );

    // 2. Insert header
    const { rows: [flow] } = await client.query(
      `INSERT INTO labour_flows
         (production_id, title, start_date, end_date, num_weeks, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6)
       RETURNING *`,
      [production_id, title.trim(), start_date, end_date, numWeeks, req.user?.id || null]
    );

    // 3. Build & insert default rows
    const defaultRows = buildDefaultLabourFlowRows(bectuRates);
    for (const r of defaultRows) {
      await client.query(
        `INSERT INTO labour_flow_rows
           (labour_flow_id, section, trade, rank, cost_code, bectu_rate_id, weekly_rate, headcounts, row_total_units, row_total_cost, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9)`,
        [flow.id, r.section, r.trade, r.rank, r.cost_code, r.bectu_rate_id, r.weekly_rate, JSON.stringify(r.headcounts), r.sort_order]
      );
    }

    await client.query('COMMIT');

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'forecasting',
      action: 'labour_flow_created',
      entityType: 'labour_flows',
      entityId: flow.id,
      details: `Created Weekly Labour Flow "${flow.title}" (${numWeeks} weeks)`,
    });

    res.status(201).json(flow);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createLabourFlow:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

/**
 * GET /api/forecasting/labour-flows/:id
 * Returns flow header, generated week columns, and matrix rows with computed totals
 */
const getLabourFlowById = async (req, res) => {
  try {
    const { rows: [flow] } = await db.query(
      `SELECT lf.*,
              p.name AS production_name,
              p.production_code AS production_code,
              u.full_name AS created_by_name,
              lu.full_name AS locked_by_name
       FROM labour_flows lf
       JOIN productions p ON lf.production_id = p.id
       LEFT JOIN users u ON lf.created_by = u.id
       LEFT JOIN users lu ON lf.locked_by = lu.id
       WHERE lf.id = $1`,
      [req.params.id]
    );
    if (!flow) return res.status(404).json({ error: 'Weekly Labour Flow not found' });

    const weeks = calculateWeeks(flow.start_date, flow.end_date);
    let { rows: gridRows } = await db.query(
      `SELECT * FROM labour_flow_rows WHERE labour_flow_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );

    // Live sync rates for unlocked flows
    let bectuRates = [];
    if (flow.status !== 'locked') {
      const { rows } = await db.query(
        `SELECT * FROM bectu_rates WHERE effective_to IS NULL`
      );
      bectuRates = rows;
    }

    let grandTotalCost = 0;
    const weekTotals = {};
    const departmentWeeklyTotals = {
      fixed_weekly: {},
      carpenters: {},
      painters: {},
      riggers: {},
      stagehands: {},
    };

    weeks.forEach(w => {
      weekTotals[w.weekNumber] = 0;
      Object.keys(departmentWeeklyTotals).forEach(sec => {
        departmentWeeklyTotals[sec][w.weekNumber] = 0;
      });
    });

    for (const row of gridRows) {
      // Sync rate if unlocked and not a custom fixed cost like box rental
      if (flow.status !== 'locked' && row.bectu_rate_id) {
        const rateInfo = resolveRate(bectuRates, row.trade, row.rank);
        if (rateInfo.weekly_rate > 0 && Math.abs(parseFloat(row.weekly_rate) - rateInfo.weekly_rate) > 0.001) {
          row.weekly_rate = rateInfo.weekly_rate;
          await db.query(
            `UPDATE labour_flow_rows SET weekly_rate = $1 WHERE id = $2`,
            [rateInfo.weekly_rate, row.id]
          );
        }
      }

      const headcounts = typeof row.headcounts === 'string' ? JSON.parse(row.headcounts || '{}') : (row.headcounts || {});
      let rowUnits = 0;
      const rate = parseFloat(row.weekly_rate) || 0;

      weeks.forEach(w => {
        const count = parseInt(headcounts[w.weekNumber] || 0, 10);
        rowUnits += count;
        const weekCost = count * rate;
        weekTotals[w.weekNumber] = (weekTotals[w.weekNumber] || 0) + weekCost;
        if (departmentWeeklyTotals[row.section]) {
          departmentWeeklyTotals[row.section][w.weekNumber] =
            (departmentWeeklyTotals[row.section][w.weekNumber] || 0) + weekCost;
        }
      });

      const rowCost = Number((rowUnits * rate).toFixed(2));
      row.row_total_units = rowUnits;
      row.row_total_cost = rowCost;
      row.headcounts = headcounts;
      grandTotalCost += rowCost;
    }

    // Update grand total in header if changed
    grandTotalCost = Number(grandTotalCost.toFixed(2));
    if (Math.abs(parseFloat(flow.grand_total_cost || 0) - grandTotalCost) > 0.01) {
      flow.grand_total_cost = grandTotalCost;
      await db.query(
        `UPDATE labour_flows SET grand_total_cost = $1 WHERE id = $2`,
        [grandTotalCost, flow.id]
      );
    }

    res.json({
      ...flow,
      weeks,
      rows: gridRows,
      week_totals: weekTotals,
      department_weekly_totals: departmentWeeklyTotals,
      grand_total_cost: grandTotalCost,
    });
  } catch (err) {
    console.error('getLabourFlowById:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * PUT /api/forecasting/labour-flows/:id
 * Batch updates headcounts and recalculates row totals
 */
const updateLabourFlow = async (req, res) => {
  const { title, start_date, end_date, rows: updatedRows } = req.body;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [existing] } = await client.query(
      `SELECT * FROM labour_flows WHERE id = $1`,
      [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Weekly Labour Flow not found' });
    if (existing.status === 'locked') {
      return res.status(400).json({ error: 'Cannot edit a locked labour flow. Create a new revision version.' });
    }

    const newStart = start_date || existing.start_date;
    const newEnd = end_date || existing.end_date;
    const weeks = calculateWeeks(newStart, newEnd);

    await client.query(
      `UPDATE labour_flows
       SET title = COALESCE($1, title),
           start_date = $2,
           end_date = $3,
           num_weeks = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [title ? title.trim() : null, newStart, newEnd, weeks.length, req.params.id]
    );

    let grandTotalCost = 0;
    if (Array.isArray(updatedRows)) {
      for (const r of updatedRows) {
        const headcounts = r.headcounts || {};
        const rate = parseFloat(r.weekly_rate) || 0;
        let rowUnits = 0;

        weeks.forEach(w => {
          rowUnits += parseInt(headcounts[w.weekNumber] || 0, 10);
        });

        const rowCost = Number((rowUnits * rate).toFixed(2));
        grandTotalCost += rowCost;

        await client.query(
          `UPDATE labour_flow_rows
           SET headcounts = $1, row_total_units = $2, row_total_cost = $3
           WHERE id = $4 AND labour_flow_id = $5`,
          [JSON.stringify(headcounts), rowUnits, rowCost, r.id, req.params.id]
        );
      }
    }

    grandTotalCost = Number(grandTotalCost.toFixed(2));
    const { rows: [updated] } = await client.query(
      `UPDATE labour_flows SET grand_total_cost = $1 WHERE id = $2 RETURNING *`,
      [grandTotalCost, req.params.id]
    );

    await client.query('COMMIT');
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('updateLabourFlow:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

/**
 * POST /api/forecasting/labour-flows/:id/lock
 */
const lockLabourFlow = async (req, res) => {
  try {
    const { rows: [flow] } = await db.query(
      `SELECT * FROM labour_flows WHERE id = $1`,
      [req.params.id]
    );
    if (!flow) return res.status(404).json({ error: 'Weekly Labour Flow not found' });
    if (flow.status === 'locked') return res.status(400).json({ error: 'Labour flow is already locked' });

    // Snapshot current active rates
    const { rows: bectuRates } = await db.query(
      `SELECT id, trade, rank, weekly_rate FROM bectu_rates WHERE effective_to IS NULL`
    );

    const snapshot = {
      locked_at: new Date().toISOString(),
      locked_by: req.user?.full_name,
      bectu_rates: bectuRates,
    };

    const { rows: [locked] } = await db.query(
      `UPDATE labour_flows
       SET status = 'locked',
           locked_at = NOW(),
           locked_by = $1,
           rates_snapshot = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [req.user?.id || null, JSON.stringify(snapshot), req.params.id]
    );

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'forecasting',
      action: 'labour_flow_locked',
      entityType: 'labour_flows',
      entityId: flow.id,
      details: `Approved & locked Weekly Labour Flow "${flow.title}" (Grand Total: £${flow.grand_total_cost})`,
    });

    res.json(locked);
  } catch (err) {
    console.error('lockLabourFlow:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/forecasting/labour-flows/:id/version
 * Creates a revised draft clone (v2, v3) from a locked labour flow
 */
const versionLabourFlow = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [original] } = await client.query(
      `SELECT * FROM labour_flows WHERE id = $1`,
      [req.params.id]
    );
    if (!original) return res.status(404).json({ error: 'Original Weekly Labour Flow not found' });
    if (original.status !== 'locked') return res.status(400).json({ error: 'Only locked labour flows can be versioned. Lock this flow first before creating a revision.' });

    const newVersion = (original.version || 1) + 1;
    const newTitle = original.title.includes('(Rev')
      ? original.title.replace(/\(Rev \d+\)/, `(Rev ${newVersion})`)
      : `${original.title} (Rev ${newVersion})`;

    const { rows: [cloned] } = await client.query(
      `INSERT INTO labour_flows
         (production_id, title, start_date, end_date, num_weeks, status, version, parent_flow_id, grand_total_cost, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9)
       RETURNING *`,
      [
        original.production_id,
        newTitle,
        original.start_date,
        original.end_date,
        original.num_weeks,
        newVersion,
        original.id,
        original.grand_total_cost,
        req.user?.id || null
      ]
    );

    // Clone all rows and headcounts
    await client.query(
      `INSERT INTO labour_flow_rows
         (labour_flow_id, section, trade, rank, cost_code, bectu_rate_id, weekly_rate, headcounts, row_total_units, row_total_cost, sort_order)
       SELECT $1, section, trade, rank, cost_code, bectu_rate_id, weekly_rate, headcounts, row_total_units, row_total_cost, sort_order
       FROM labour_flow_rows
       WHERE labour_flow_id = $2`,
      [cloned.id, original.id]
    );

    await client.query('COMMIT');

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'forecasting',
      action: 'labour_flow_versioned',
      entityType: 'labour_flows',
      entityId: cloned.id,
      details: `Created revision ${newVersion} ("${newTitle}") from flow ${original.id}`,
    });

    res.status(201).json(cloned);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('versionLabourFlow:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/forecasting/labour-flows/:id
 */
const deleteLabourFlow = async (req, res) => {
  try {
    const { rows: [deleted] } = await db.query(
      `DELETE FROM labour_flows WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!deleted) return res.status(404).json({ error: 'Weekly Labour Flow not found' });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'forecasting',
      action: 'labour_flow_deleted',
      entityType: 'labour_flows',
      entityId: deleted.id,
      details: `Deleted Weekly Labour Flow "${deleted.title}"`,
    });

    res.json({ message: 'Weekly Labour Flow deleted', id: deleted.id });
  } catch (err) {
    console.error('deleteLabourFlow:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/forecasting/labour-flows/:id/export/csv
 * Generates matrix CSV with department sections, week columns, row totals, and subtotals
 */
const exportLabourFlowCsv = async (req, res) => {
  try {
    const { rows: [flow] } = await db.query(
      `SELECT lf.*, p.name AS production_name
       FROM labour_flows lf
       JOIN productions p ON lf.production_id = p.id
       WHERE lf.id = $1`,
      [req.params.id]
    );
    if (!flow) return res.status(404).json({ error: 'Weekly Labour Flow not found' });

    const weeks = calculateWeeks(flow.start_date, flow.end_date);
    const { rows: gridRows } = await db.query(
      `SELECT * FROM labour_flow_rows WHERE labour_flow_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );

    // CSV header row
    const weekHeaders = weeks.map(w => `"${w.label} (${w.subLabel})"`).join(',');
    let csv = `"${flow.production_name} - ${flow.title}"\n`;
    csv += `"Start: ${flow.start_date} | End: ${flow.end_date} | Status: ${flow.status}"\n\n`;
    csv += `"Department / Grade","Weekly Rate (£)",${weekHeaders},"Total Units","Total Cost (£)"\n`;

    const sectionLabels = {
      fixed_weekly: 'FIXED WEEKLY COSTS',
      carpenters: 'DEPARTMENT — CARPENTERS',
      painters: 'DEPARTMENT — PAINTERS',
      riggers: 'DEPARTMENT — RIGGERS',
      stagehands: 'DEPARTMENT — STAGEHANDS',
    };

    let currentSection = '';
    let grandTotalCost = 0;
    const weekTotals = {};
    weeks.forEach(w => { weekTotals[w.weekNumber] = 0; });

    for (const r of gridRows) {
      if (r.section !== currentSection) {
        currentSection = r.section;
        // Dynamic padding: 1 (grade label) + 1 (rate) + weeks.length (week cells) + 1 (total units) + 1 (total cost) = weeks.length + 4 columns total
        const emptyPad = ','.repeat(weeks.length + 3);
        csv += `\n"${sectionLabels[currentSection] || currentSection}"${emptyPad}\n`;
      }

      const headcounts = typeof r.headcounts === 'string' ? JSON.parse(r.headcounts || '{}') : (r.headcounts || {});
      const rate = parseFloat(r.weekly_rate) || 0;
      let rowUnits = 0;

      const weekCells = weeks.map(w => {
        const count = parseInt(headcounts[w.weekNumber] || 0, 10);
        rowUnits += count;
        weekTotals[w.weekNumber] = (weekTotals[w.weekNumber] || 0) + (count * rate);
        return count > 0 ? count : '';
      }).join(',');

      const rowCost = Number((rowUnits * rate).toFixed(2));
      grandTotalCost += rowCost;

      csv += `"${r.rank}","£${rate.toFixed(2)}",${weekCells},"${rowUnits}","£${rowCost.toFixed(2)}"\n`;
    }

    // Grand totals row
    const grandTotalsCells = weeks.map(w => `"£${(weekTotals[w.weekNumber] || 0).toFixed(2)}"`).join(',');
    csv += `\n"GRAND TOTAL COST",,${grandTotalsCells},,"£${grandTotalCost.toFixed(2)}"\n`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="LabourFlow_${flow.id}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('exportLabourFlowCsv:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  listLabourFlows,
  createLabourFlow,
  getLabourFlowById,
  updateLabourFlow,
  lockLabourFlow,
  versionLabourFlow,
  deleteLabourFlow,
  exportLabourFlowCsv,
};
