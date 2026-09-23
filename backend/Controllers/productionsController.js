const db          = require('../config/db');
const { withFinalCostReport } = require('../services/historicalCostReportService');

// ─── Helper ───────────────────────────────────────────────────────────────────
const calcSetCountdown = (sets = []) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return sets.map(set => {
    const days = set.handover_date
      ? Math.ceil((new Date(set.handover_date) - today) / 86400000)
      : null;

    let countdown_colour = null;
    if (days !== null) {
      if      (days > 14) countdown_colour = 'green';
      else if (days >= 7) countdown_colour = 'amber'; // 7–14 days
      else                countdown_colour = 'red';   // <7 days or overdue
    }
    return { ...set, days_until_handover: days, countdown_colour };
  });
};

// ─── Productions ──────────────────────────────────────────────────────────────

// GET /api/productions
const getAllProductions = async (req, res) => {
  try {
    const conditions = ['p.deleted_at IS NULL'];
    const params     = [];
    let   i          = 1;

    if (req.query.include_archived !== 'true') {
      conditions.push(`status != $${i++}`);
      params.push('archived');
    }
    if (req.query.status) {
      conditions.push(`status = $${i++}`);
      params.push(req.query.status);
    }
    if (req.query.contract_type) {
      conditions.push(`contract_type = $${i++}`);
      params.push(req.query.contract_type);
    }
    if (req.query.search) {
      conditions.push(`(
        p.name ILIKE $${i} OR
        p.production_company ILIKE $${i} OR
        p.production_designer ILIKE $${i} OR
        p.production_type ILIKE $${i} OR
        p.supervising_art_director ILIKE $${i} OR
        p.supervising_art_director_mobile ILIKE $${i} OR
        p.supervising_art_director_email ILIKE $${i} OR
        p.financial_controller ILIKE $${i} OR
        p.financial_controller_mobile ILIKE $${i} OR
        p.financial_controller_email ILIKE $${i} OR
        p.art_dept_coordinator ILIKE $${i} OR
        p.art_dept_coordinator_mobile ILIKE $${i} OR
        p.art_dept_coordinator_email ILIKE $${i} OR
        p.notes ILIKE $${i++}
      )`);
      params.push(`%${req.query.search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT p.*,
         COALESCE(sc.total_sets, 0)::int     AS total_sets,
         COALESCE(sc.completed_sets, 0)::int AS completed_sets
       FROM productions p
       LEFT JOIN (
         SELECT production_id,
           COUNT(*)::int AS total_sets,
           COUNT(CASE WHEN completion_status IN ('complete','handed_over') THEN 1 END)::int AS completed_sets
         FROM sets
         GROUP BY production_id
       ) sc ON sc.production_id = p.id
       ${where}
       ORDER BY p.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('getAllProductions:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/productions
const deleteProduction = async (req, res) => {
  try {
    // ProductionStatus.ARCHIVED
    const { rows } = await db.query("UPDATE productions SET deleted_at = NOW() WHERE id = $1 AND status = 'archived' AND deleted_at IS NULL RETURNING id", [req.params.id]);
    if (!rows.length) return res.status(409).json({ error: 'Only an archived, undeleted production can be deleted. Refresh and try again.' });
    res.status(204).end();
  } catch { res.status(500).json({ error: 'Unable to delete production' }); }
};

const createProduction = async (req, res) => {
  const {
    name, production_company, production_designer, production_type,
    start_date, end_date, contract_type, status,
    supervising_art_director, supervising_art_director_mobile, supervising_art_director_email,
    financial_controller, financial_controller_mobile, financial_controller_email,
    art_dept_coordinator, art_dept_coordinator_mobile, art_dept_coordinator_email,
    notes,
  } = req.body;

  if (!name || !contract_type)
    return res.status(400).json({ error: 'name and contract_type are required' });

  // ProductionStatus.PRE_PRODUCTION / ProductionStatus.ACTIVE_BUILD
  const initialStatus = status ?? 'pre_production';
  if (!['pre_production', 'active_build'].includes(initialStatus))
    return res.status(400).json({ error: 'Initial status must be pre_production or active_build. Use the transition and archive actions for later statuses.' });

  try {
    const { rows } = await db.query(
      `INSERT INTO productions
         (name, production_company, production_designer, production_type,
          start_date, end_date, contract_type, status, created_by,
          supervising_art_director, supervising_art_director_mobile, supervising_art_director_email,
          financial_controller, financial_controller_mobile, financial_controller_email,
          art_dept_coordinator, art_dept_coordinator_mobile, art_dept_coordinator_email,
          notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        name, production_company || null, production_designer || null, production_type || null,
        start_date || null, end_date || null, contract_type,
        initialStatus,
        req.user.id,
        supervising_art_director || null, supervising_art_director_mobile || null, supervising_art_director_email || null,
        financial_controller || null, financial_controller_mobile || null, financial_controller_email || null,
        art_dept_coordinator || null, art_dept_coordinator_mobile || null, art_dept_coordinator_email || null,
        notes || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createProduction:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/productions/:id
const getProductionById = async (req, res) => {
  try {
    const { rows: [production] } = await db.query(
      `SELECT p.*,
              EXISTS(SELECT 1 FROM purchase_orders WHERE production_id = p.id) AS has_linked_pos,
              EXISTS(SELECT 1 FROM timesheets      WHERE production_id = p.id) AS has_linked_timesheets
       FROM   productions p
       WHERE  p.id = $1`,
      [req.params.id]
    );
    if (!production) return res.status(404).json({ error: 'Production not found' });

    const [{ rows: sets }, { rows: documents }] = await Promise.all([
      db.query('SELECT * FROM sets WHERE production_id = $1 ORDER BY shoot_week', [req.params.id]),
      db.query('SELECT * FROM production_documents WHERE production_id = $1 ORDER BY uploaded_at DESC', [req.params.id]),
    ]);

    production.sets               = calcSetCountdown(sets);
    production.production_documents = documents;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const handoverDates = production.sets.filter(s => s.handover_date).map(s => new Date(s.handover_date));
    production.days_remaining    = handoverDates.length
      ? Math.ceil((Math.max(...handoverDates) - today) / 86400000)
      : null;
    production.sets_outstanding = production.sets
      .filter(s => !['complete', 'handed_over'].includes(s.completion_status)).length;
    production.completed_sets = production.sets
      .filter(s => ['complete', 'handed_over'].includes(s.completion_status)).length;
    production.total_sets = production.sets.length;

    res.json(production);
  } catch (err) {
    console.error('getProductionById:', err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/productions/:id  (status is NOT a free-edit field — use /transition)
const updateProduction = async (req, res) => {
  const allowed = [
    'name', 'production_company', 'production_designer', 'production_type',
    'start_date', 'end_date', 'contract_type',
    'supervising_art_director', 'supervising_art_director_mobile', 'supervising_art_director_email',
    'financial_controller', 'financial_controller_mobile', 'financial_controller_email',
    'art_dept_coordinator', 'art_dept_coordinator_mobile', 'art_dept_coordinator_email',
    'notes',
  ];
  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'No updatable fields provided' });

  try {
    // Contract type lock: block change if linked POs or timesheets exist
    if (updates.contract_type !== undefined) {
      const { rows: [curr] } = await db.query(
        'SELECT contract_type FROM productions WHERE id = $1', [req.params.id]
      );
      if (curr && curr.contract_type !== updates.contract_type) {
        const { rows: [linked] } = await db.query(
          `SELECT EXISTS(
             SELECT 1 FROM purchase_orders WHERE production_id = $1
             UNION ALL
             SELECT 1 FROM timesheets WHERE production_id = $1
             LIMIT 1
           ) AS has_linked`,
          [req.params.id]
        );
        if (linked?.has_linked)
          return res.status(400).json({
            error: 'Contract type cannot be changed once a purchase order or timesheet has been linked to this production.'
          });
      }
    }

    const fields     = Object.keys(updates);
    const values     = Object.values(updates);
    const setClause  = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

    const { rows } = await db.query(
      `UPDATE productions SET ${setClause} WHERE id = $${fields.length + 1} RETURNING *`,
      [...values, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Production not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('updateProduction:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── Status Lifecycle ─────────────────────────────────────────────────────────

const STATUS_ORDER = ['pre_production', 'active_build', 'strike', 'complete'];

// Which roles may trigger each forward transition
const ALL_ROLES = ['managing_director', 'construction_coordinator', 'construction_accountant'];
const FORWARD_ROLES = {
  'pre_production→active_build': ALL_ROLES,
  'active_build→strike':         ALL_ROLES,
  'strike→complete':             ALL_ROLES,
};

// POST /api/productions/:id/transition
const transitionStatus = async (req, res) => {
  const { to_status, is_rollback, reason, checklist_confirmed } = req.body;
  const role = req.user?.role;

  if (!to_status) return res.status(400).json({ error: 'to_status is required' });
  if (!STATUS_ORDER.includes(to_status))
    return res.status(400).json({ error: `Invalid status: ${to_status}` });

  try {
    const { rows: [production] } = await db.query(
      'SELECT id, name, status FROM productions WHERE id = $1',
      [req.params.id]
    );
    if (!production) return res.status(404).json({ error: 'Production not found' });
    if (['archived'].includes(production.status))
      return res.status(400).json({ error: 'Archived productions cannot be transitioned' });

    const fromIdx = STATUS_ORDER.indexOf(production.status);
    const toIdx   = STATUS_ORDER.indexOf(to_status);

    // ── Rollback path ──────────────────────────────────────────────────────────
    if (is_rollback || toIdx < fromIdx) {
      if (!['managing_director', 'construction_coordinator', 'construction_accountant'].includes(role))
        return res.status(403).json({ error: 'Unauthorized to roll back production status' });
      if (!reason || reason.trim().length < 20)
        return res.status(400).json({ error: 'Rollback requires a reason of at least 20 characters' });
      if (fromIdx - toIdx !== 1)
        return res.status(400).json({ error: 'Can only roll back one step at a time' });

      const { rows: [updated] } = await db.query(
        `UPDATE productions SET status = $1, rollback_notice = $2 WHERE id = $3 RETURNING *`,
        [to_status, reason.trim(), req.params.id]
      );
      await db.query(
        `INSERT INTO audit_log (user_id, production_id, action, metadata) VALUES ($1, $2, 'status_transition', $3)`,
        [req.user.id, req.params.id, JSON.stringify({
          from_status: production.status, to_status, is_rollback: true, reason: reason.trim()
        })]
      );
      return res.json({ message: `Status rolled back to ${to_status}`, production: updated });
    }

    // ── Forward path ───────────────────────────────────────────────────────────
    if (toIdx !== fromIdx + 1)
      return res.status(400).json({ error: `Cannot skip from ${production.status} to ${to_status}` });

    const key = `${production.status}→${to_status}`;
    const allowedRoles = FORWARD_ROLES[key] ?? [];
    if (!allowedRoles.includes(role))
      return res.status(403).json({ error: `Your role (${role}) cannot make this transition` });

    // Strike → Complete requires checklist
    if (production.status === 'strike' && to_status === 'complete') {
      if (!checklist_confirmed)
        return res.status(400).json({ error: 'Strike → Complete requires checklist confirmation' });
    }

    const advance = async client => {
      const { rows: [updated] } = await client.query(
        `UPDATE productions SET status = $1, rollback_notice = NULL WHERE id = $2 RETURNING *`,
        [to_status, req.params.id]
      );
      await client.query(
        `INSERT INTO audit_log (user_id, production_id, action, metadata) VALUES ($1, $2, 'status_transition', $3)`,
        [req.user.id, req.params.id, JSON.stringify({ from_status: production.status, to_status, is_rollback: false })]
      );
      return updated;
    };
    // ProductionStatus.COMPLETE
    const updated = to_status === 'complete'
      ? await withFinalCostReport(req.params.id, req.user.id, production.status, advance)
      : await advance(db);

    // Trigger Percentometer when moving to Complete
    if (to_status === 'complete') {
      setImmediate(() => runPostProductionPercentometer(req.params.id));
    }

    return res.json({ message: `Status advanced to ${to_status}`, production: updated });
  } catch (err) {
    console.error('transitionStatus:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

// ─── Percentometer background job ─────────────────────────────────────────────
const runPostProductionPercentometer = async (productionId, attempt = 1) => {
  try {
    // Seed a single "processing" sentinel row so GET actuals returns processing state immediately
    await db.query(
      `INSERT INTO percentometer_actuals (production_id, status)
       VALUES ($1, 'processing')
       ON CONFLICT DO NOTHING`,
      [productionId]
    );
    // Also keep legacy JSONB field for backward compat
    await db.query(
      `UPDATE productions SET post_production_percentometer = $1 WHERE id = $2`,
      [JSON.stringify({ status: 'processing' }), productionId]
    );

    // Pull data from cost_report_entries (source of truth since Cost Report module)
    const [{ rows: labourRows }, { rows: supplierRows }, { rows: ratioRows }] = await Promise.all([
      db.query(
        `SELECT cre.trade, SUM(cre.gross_amount) AS total
         FROM cost_report_entries cre
         WHERE cre.production_id = $1 AND cre.entry_type = 'labour' AND cre.deleted_at IS NULL
         GROUP BY cre.trade`,
        [productionId]
      ),
      db.query(
        `SELECT COALESCE(SUM(gross_amount), 0) AS total
         FROM cost_report_entries
         WHERE production_id = $1 AND entry_type = 'supplier' AND deleted_at IS NULL`,
        [productionId]
      ),
      db.query(
        `SELECT cost_type, percentage FROM percentometer_ratios WHERE effective_to IS NULL`
      ),
    ]);

    const materialsTotal = parseFloat(supplierRows[0]?.total || 0);
    const labourByTrade  = Object.fromEntries(
      labourRows.map(r => [r.trade, parseFloat(r.total || 0)])
    );
    const grandTotal = materialsTotal + Object.values(labourByTrade).reduce((s, v) => s + v, 0);

    // Map ratios
    const ratioMap        = Object.fromEntries(ratioRows.map(r => [r.cost_type, parseFloat(r.percentage)]));
    const tradeCostTypes  = new Set(['Carpenters', 'Painters', 'Stagehands', 'Riggers', 'Sculptors', 'Metalwork']);
    const matRatioSum     = ratioRows
      .filter(r => !tradeCostTypes.has(r.cost_type))
      .reduce((s, r) => s + parseFloat(r.percentage), 0);

    // Remove processing sentinel, write per-cost-type rows
    await db.query('DELETE FROM percentometer_actuals WHERE production_id = $1', [productionId]);

    for (const r of ratioRows) {
      let actualAmount;
      if (tradeCostTypes.has(r.cost_type)) {
        // Match labour trade by name (case-insensitive)
        const matchKey = Object.keys(labourByTrade).find(
          t => t?.toLowerCase() === r.cost_type.toLowerCase()
        );
        actualAmount = matchKey ? labourByTrade[matchKey] : 0;
      } else {
        // Distribute materials proportionally among material cost types
        actualAmount = matRatioSum > 0
          ? materialsTotal * (parseFloat(r.percentage) / matRatioSum)
          : 0;
      }
      const actualPct = grandTotal > 0 ? (actualAmount / grandTotal) * 100 : 0;
      await db.query(
        `INSERT INTO percentometer_actuals
           (production_id, status, cost_type, actual_amount, actual_percentage, grand_total)
         VALUES ($1,'complete',$2,$3,$4,$5)`,
        [productionId, r.cost_type, actualAmount, actualPct, grandTotal]
      );
    }

    // Legacy JSONB field
    await db.query(
      `UPDATE productions SET post_production_percentometer = $1 WHERE id = $2`,
      [JSON.stringify({ status: 'complete', grand_total: grandTotal, computed_at: new Date().toISOString() }), productionId]
    );
  } catch (err) {
    console.error(`Percentometer job attempt ${attempt} failed for ${productionId}:`, err.message);
    if (attempt < 3) {
      setTimeout(() => runPostProductionPercentometer(productionId, attempt + 1), 5000 * attempt);
    } else {
      await db.query('DELETE FROM percentometer_actuals WHERE production_id = $1', [productionId]).catch(() => {});
      await db.query(
        `INSERT INTO percentometer_actuals (production_id, status, error_message) VALUES ($1,'failed',$2)`,
        [productionId, err.message]
      ).catch(() => {});
      await db.query(
        `UPDATE productions SET post_production_percentometer = $1 WHERE id = $2`,
        [JSON.stringify({ status: 'failed', error: err.message }), productionId]
      ).catch(() => {});
    }
  }
};

// GET /api/productions/:id/archive-preview
const getArchivePreview = async (req, res) => {
  try {
    const { rows: [production] } = await db.query(
      'SELECT id, name, status FROM productions WHERE id = $1',
      [req.params.id]
    );
    if (!production) return res.status(404).json({ error: 'Production not found' });
    if (production.status !== 'complete')
      return res.status(400).json({ error: 'Only complete productions can be archived' });

    const [
      { rows: poRows },
      { rows: weekRows },
      { rows: crewRows },
    ] = await Promise.all([
      db.query(
        'SELECT COUNT(*) AS cnt FROM purchase_orders WHERE production_id = $1',
        [req.params.id]
      ),
      db.query(
        `SELECT COUNT(DISTINCT week_ending_date) AS cnt FROM timesheets WHERE production_id = $1`,
        [req.params.id]
      ),
      db.query(
        `SELECT COUNT(DISTINCT crew_member_id) AS cnt FROM timesheets WHERE production_id = $1`,
        [req.params.id]
      ),
    ]);

    res.json({
      production_name:  production.name,
      po_count:         parseInt(poRows[0].cnt, 10),
      timesheet_weeks:  parseInt(weekRows[0].cnt, 10),
      crew_count:       parseInt(crewRows[0].cnt, 10),
    });
  } catch (err) {
    console.error('getArchivePreview:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/productions/:id/archive
const archiveProduction = async (req, res) => {
  const role = req.user?.role;
  if (!['managing_director', 'construction_accountant', 'construction_coordinator'].includes(role))
    return res.status(403).json({ error: 'Unauthorized to archive productions' });

  try {
    const { rows: [existing] } = await db.query(
      'SELECT id, name, status FROM productions WHERE id = $1',
      [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Production not found' });
    if (existing.status !== 'complete')
      return res.status(400).json({ error: 'Only complete productions can be archived' });

    const production = await withFinalCostReport(req.params.id, req.user.id, existing.status, async client => {
      const { rows: [archived] } = await client.query(
        `UPDATE productions
           SET status = 'archived', archived_at = NOW(), archived_by = $2
         WHERE id = $1
         RETURNING *`,
        [req.params.id, req.user.id]
      );
      await client.query(
        `INSERT INTO audit_log (user_id, production_id, action, metadata)
         VALUES ($1, $2, 'archived', $3)`,
        [req.user.id, req.params.id, JSON.stringify({ production_name: existing.name })]
      );
      return archived;
    });

    // Fire Percentometer review asynchronously — does not block response
    setImmediate(() => runPostProductionPercentometer(req.params.id));

    res.json({ message: 'Production archived successfully', production });
  } catch (err) {
    console.error('archiveProduction:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

// POST /api/productions/:id/unarchive
const unarchiveProduction = async (req, res) => {
  if (!['managing_director', 'construction_accountant', 'construction_coordinator'].includes(req.user?.role))
    return res.status(403).json({ error: 'Unauthorized to unarchive productions' });

  try {
    const { rows: [existing] } = await db.query(
      'SELECT id, name, status FROM productions WHERE id = $1',
      [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Production not found' });
    if (existing.status !== 'archived')
      return res.status(400).json({ error: 'Production is not archived' });

    const { rows: [production] } = await db.query(
      `UPDATE productions
         SET status = 'complete', archived_at = NULL
       WHERE id = $1 AND deleted_at IS NULL AND status = 'archived'
       RETURNING *`,
      [req.params.id]
    );

    if (!production) return res.status(409).json({ error: 'Production changed or was deleted. Refresh and try again.' });
    await db.query(
      `INSERT INTO audit_log (user_id, production_id, action, metadata)
       VALUES ($1, $2, 'unarchived', $3)`,
      [req.user.id, req.params.id, JSON.stringify({ production_name: existing.name })]
    );

    res.json({ message: 'Production unarchived successfully', production });
  } catch (err) {
    console.error('unarchiveProduction:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── Sets ──────────────────────────────────────────────────────────────────────

// GET /api/productions/:id/sets
const getSets = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.*,
              COALESCE(po_links.cnt, 0)::int AS linked_po_count
       FROM   sets s
       LEFT JOIN (
         SELECT set_code, COUNT(*)::int AS cnt
         FROM   purchase_orders
         WHERE  production_id = $1 AND set_code IS NOT NULL
         GROUP  BY set_code
       ) po_links ON po_links.set_code = s.set_number
       WHERE  s.production_id = $1
       ORDER  BY s.shoot_week NULLS LAST, s.handover_date ASC NULLS LAST`,
      [req.params.id]
    );
    res.json(calcSetCountdown(rows));
  } catch (err) {
    console.error('getSets:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/productions/:id/sets
const createSet = async (req, res) => {
  const { set_number, set_name, shoot_week, handover_date, completion_status, notes } = req.body;
  if (!set_name) return res.status(400).json({ error: 'set_name is required' });

  try {
    const { rows } = await db.query(
      `INSERT INTO sets
         (production_id, set_number, set_name, shoot_week, handover_date, completion_status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [req.params.id, set_number, set_name, shoot_week, handover_date, completion_status || 'not_started', notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createSet:', err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/productions/:id/sets/:setId
const updateSet = async (req, res) => {
  const allowed = ['set_number', 'set_name', 'shoot_week', 'handover_date', 'completion_status', 'notes'];
  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'No updatable fields provided' });

  const fields    = Object.keys(updates);
  const values    = Object.values(updates);
  const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

  try {
    const { rows } = await db.query(
      `UPDATE sets SET ${setClause}
       WHERE id = $${fields.length + 1} AND production_id = $${fields.length + 2}
       RETURNING *`,
      [...values, req.params.setId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Set not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('updateSet:', err);
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/productions/:id/sets/:setId  (inline completion_status update)
const patchSet = async (req, res) => {
  const { completion_status } = req.body;
  if (!completion_status) return res.status(400).json({ error: 'completion_status is required' });
  try {
    const { rows } = await db.query(
      `UPDATE sets SET completion_status = $1 WHERE id = $2 AND production_id = $3 RETURNING *`,
      [completion_status, req.params.setId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Set not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('patchSet:', err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/productions/:id/sets/:setId
const deleteSet = async (req, res) => {
  try {
    // Guard: check linked purchase orders
    const { rows: [setRow] } = await db.query(
      'SELECT set_number FROM sets WHERE id = $1 AND production_id = $2',
      [req.params.setId, req.params.id]
    );
    if (!setRow) return res.status(404).json({ error: 'Set not found' });

    if (setRow.set_number) {
      const { rows: [linked] } = await db.query(
        'SELECT COUNT(*) AS cnt FROM purchase_orders WHERE production_id = $1 AND set_code = $2',
        [req.params.id, setRow.set_number]
      );
      if (parseInt(linked.cnt, 10) > 0)
        return res.status(400).json({
          error: 'This set has linked purchase orders or timesheet entries.'
        });
    }

    await db.query(
      'DELETE FROM sets WHERE id = $1 AND production_id = $2',
      [req.params.setId, req.params.id]
    );
    res.json({ message: 'Set deleted successfully' });
  } catch (err) {
    console.error('deleteSet:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── Production Documents ──────────────────────────────────────────────────────

const fileStorage = require('../services/fileStorage');

// GET /api/productions/:id/documents
const getDocuments = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM production_documents WHERE production_id = $1 ORDER BY uploaded_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/productions/:id/documents
const uploadDocument = async (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: 'No file provided' });

  try {
    // Server-side validation (mime type + size already checked by documentUpload multer)
    fileStorage.validate(req.file.mimetype, req.file.size);

    const { url, key, size } = await fileStorage.store(req.file);

    const { rows } = await db.query(
      `INSERT INTO production_documents
         (production_id, document_type, file_url, file_key, file_name, file_size, file_mime_type, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.params.id,
        req.body.document_type || 'other',
        url, key,
        req.file.originalname,
        size,
        req.file.mimetype,
        req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('uploadDocument:', err);
    res.status(err.status ?? 500).json({ error: err.message });
  }
};

// DELETE /api/productions/:id/documents/:docId
const deleteDocument = async (req, res) => {
  try {
    const { rows: [doc] } = await db.query(
      'SELECT * FROM production_documents WHERE id = $1 AND production_id = $2',
      [req.params.docId, req.params.id]
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // RBAC: allowed for all authorized roles
    if (!['managing_director', 'construction_accountant', 'construction_coordinator'].includes(req.user?.role))
      return res.status(403).json({ error: 'Unauthorized to delete documents' });

    // Delete from storage (non-fatal if file already gone)
    await fileStorage.deleteFile(doc.file_key ?? doc.file_name).catch(e =>
      console.error('fileStorage.deleteFile failed (non-fatal):', e.message)
    );

    await db.query('DELETE FROM production_documents WHERE id = $1', [req.params.docId]);

    await db.query(
      `INSERT INTO audit_log (user_id, production_id, action, metadata)
       VALUES ($1, $2, 'document_deleted', $3)`,
      [req.user.id, req.params.id, JSON.stringify({ file_name: doc.file_name })]
    );

    res.json({ message: 'Document deleted' });
  } catch (err) {
    console.error('deleteDocument:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/productions/audit-log
const getAuditLog = async (req, res) => {
  if (!['managing_director', 'construction_accountant', 'construction_coordinator'].includes(req.user?.role))
    return res.status(403).json({ error: 'Unauthorized to view the audit log' });
  try {
    const { rows } = await db.query(
      `SELECT al.id, al.action, al.created_at,
              al.metadata,
              u.full_name AS performed_by,
              p.name AS production_name
       FROM audit_log al
       JOIN users u ON al.user_id = u.id
       LEFT JOIN productions p ON al.production_id = p.id
       WHERE al.action IN ('archived', 'unarchived')
       ORDER BY al.created_at DESC
       LIMIT 200`,
      []
    );
    res.json(rows);
  } catch (err) {
    console.error('getAuditLog:', err);
    res.status(500).json({ error: err.message });
  }
};

// Core handover alert logic — called by the daily cron job AND the POST route.
const runHandoverAlerts = async () => {
  const { sendEmail, templates } = require('../config/email');

  const { rows: [settingRow] } = await db.query(
    `SELECT value FROM app_settings WHERE key = 'handover_alert_days'`
  );
  const alertDays = Array.isArray(settingRow?.value) ? settingRow.value : [14, 7];

  const allAlerts = [];
  for (const days of alertDays) {
    const { rows: sets } = await db.query(
      `SELECT s.*, p.name AS production_name, p.production_company, p.production_designer, p.id AS prod_id
       FROM sets s
       JOIN productions p ON s.production_id = p.id
       WHERE s.handover_date = CURRENT_DATE + ($1 || ' days')::interval
         AND s.completion_status != 'handed_over'`,
      [days]
    );
    sets.forEach(s => allAlerts.push({ set: s, days }));
  }

  if (!allAlerts.length) return { message: 'No handover alerts due today', sent: 0, skipped: 0 };

  const { rows: recipientUsers } = await db.query(
    `SELECT email FROM users
     WHERE role IN ('construction_coordinator', 'managing_director', 'construction_accountant')
       AND email IS NOT NULL`
  );
  const recipients = recipientUsers.map(u => u.email).filter(Boolean);

  if (!recipients.length) return { message: 'No recipients configured', sent: 0, skipped: 0 };

  let sent = 0; let skipped = 0;

  for (const { set, days } of allAlerts) {
    const { rows: [existing] } = await db.query(
      `SELECT 1 FROM handover_alerts_sent WHERE set_id = $1 AND days_mark = $2 AND sent_date = CURRENT_DATE`,
      [set.id, days]
    );
    if (existing) { skipped++; continue; }

    const { subject, html } = templates.handoverAlert(set, days);
    try {
      await sendEmail({ to: recipients, subject, html });
      await db.query(
        `INSERT INTO handover_alerts_sent (set_id, days_mark, sent_date) VALUES ($1, $2, CURRENT_DATE)
         ON CONFLICT DO NOTHING`,
        [set.id, days]
      );
      sent++;
    } catch (emailErr) {
      console.error(`Handover alert email failed for set ${set.id}:`, emailErr.message);
    }
  }

  return { message: 'Handover alerts processed', sent, skipped, total: allAlerts.length };
};

// POST /api/productions/handover-alerts  (called by cron/scheduler — daily)
const sendHandoverAlerts = async (req, res) => {
  try {
    const result = await runHandoverAlerts();
    res.json(result);
  } catch (err) {
    console.error('sendHandoverAlerts:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/productions/:id/forecast-variance ───────────────────────────────
// Returns live forecast vs actual panel data for a production detail page.
// Uses the production's primary linked forecast and live cost_report_entries.
const getForecastVariance = async (req, res) => {
  const { id } = req.params;
  try {
    const [{ rows: [production] }, { rows: [primaryForecast] }] = await Promise.all([
      db.query('SELECT id, name, contract_type FROM productions WHERE id = $1', [id]),
      db.query(
        `SELECT id, name AS scenario_name, total_forecast_cost AS forecast_total
         FROM forecasts
         WHERE production_id = $1 AND is_primary = true AND deleted_at IS NULL
         LIMIT 1`,
        [id]
      ),
    ]);

    if (!production) return res.status(404).json({ error: 'Production not found' });

    if (!primaryForecast) {
      return res.json({ linked: false, message: 'No forecast linked — add a forecast to track variance.' });
    }

    const { rows: [costs] } = await db.query(
      `SELECT COALESCE(SUM(gross_amount), 0) AS total
       FROM cost_report_entries
       WHERE production_id = $1 AND deleted_at IS NULL`,
      [id]
    );

    const forecastTotal  = parseFloat(primaryForecast.forecast_total || 0);
    const actualTotal    = parseFloat(costs.total || 0);
    const varianceAmount = actualTotal - forecastTotal;
    const variancePct    = forecastTotal > 0 ? (varianceAmount / forecastTotal) * 100 : null;

    res.json({
      linked:           true,
      production_id:    production.id,
      production_name:  production.name,
      forecast_id:      primaryForecast.id,
      scenario_name:    primaryForecast.scenario_name,
      forecast_total:   forecastTotal,
      actual_total:     actualTotal,
      variance_amount:  parseFloat(varianceAmount.toFixed(2)),
      variance_pct:     variancePct !== null ? parseFloat(variancePct.toFixed(2)) : null,
      status:           varianceAmount > 0 ? 'over_forecast' : varianceAmount < 0 ? 'under_forecast' : 'on_track',
    });
  } catch (err) {
    console.error('getForecastVariance:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/productions/:id/documents/:docId/download
const downloadDocument = async (req, res) => {
  try {
    const { rows: [doc] } = await db.query(
      'SELECT * FROM production_documents WHERE id = $1 AND production_id = $2',
      [req.params.docId, req.params.id]
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await fileStorage.streamToResponse(
      doc.file_key || doc.file_url,
      res,
      doc.file_name,
      doc.file_mime_type
    );
  } catch (err) {
    console.error('downloadDocument error:', err);
    if (!res.headersSent) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  }
};

module.exports = {
  deleteProduction,
  getAllProductions, createProduction, getProductionById, updateProduction,
  transitionStatus,
  getArchivePreview, archiveProduction, unarchiveProduction, getAuditLog,
  getSets, createSet, updateSet, patchSet, deleteSet,
  sendHandoverAlerts, runHandoverAlerts,
  getDocuments, uploadDocument, deleteDocument, downloadDocument,
  getForecastVariance,
};
