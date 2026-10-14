const db = require('../config/db');
const { logAudit } = require('../services/auditService');

const VALID_STATUSES = ['available', 'on_hire', 'in_use', 'maintenance', 'decommissioned'];
const VALID_OWNERSHIP = ['owned', 'hired'];
const VALID_CONDITIONS = ['good', 'fair', 'damaged', 'needs_repair'];

const validId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// GET /api/containers
const getContainers = async (req, res) => {
  try {
    const { search, status, ownership_status, production_id, include_archived } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (include_archived !== 'true') {
      conditions.push('c.is_archived = false');
    }

    if (status && status !== 'all') {
      conditions.push(`c.status = $${idx++}`);
      params.push(status);
    }

    if (ownership_status && ownership_status !== 'all') {
      conditions.push(`c.ownership_status = $${idx++}`);
      params.push(ownership_status);
    }

    if (production_id) {
      conditions.push(`c.assigned_production_id = $${idx++}`);
      params.push(production_id);
    }

    if (search) {
      conditions.push(`(
        c.container_number ILIKE $${idx} OR
        c.container_type ILIKE $${idx} OR
        c.location ILIKE $${idx} OR
        c.supplier ILIKE $${idx} OR
        c.contents_description ILIKE $${idx} OR
        c.notes ILIKE $${idx} OR
        p.name ILIKE $${idx}
      )`);
      params.push(`%${search.trim()}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT c.*, p.name AS production_name, p.production_code
      FROM containers c
      LEFT JOIN productions p ON c.assigned_production_id = p.id
      ${where}
      ORDER BY c.container_number ASC, c.created_at DESC
    `;

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('getContainers error:', err);
    res.status(500).json({ error: 'Unable to load containers' });
  }
};

// GET /api/containers/:id
const getContainerById = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid container ID' });
  try {
    const query = `
      SELECT c.*, p.name AS production_name, p.production_code
      FROM containers c
      LEFT JOIN productions p ON c.assigned_production_id = p.id
      WHERE c.id = $1
    `;
    const { rows: [container] } = await db.query(query, [req.params.id]);
    if (!container) return res.status(404).json({ error: 'Container not found' });
    res.json(container);
  } catch (err) {
    console.error('getContainerById error:', err);
    res.status(500).json({ error: 'Unable to load container' });
  }
};

// POST /api/containers
const createContainer = async (req, res) => {
  const {
    container_number,
    container_type = '20ft Storage Container',
    size,
    status = 'available',
    ownership_status = 'owned',
    location,
    assigned_production_id,
    supplier,
    hire_start_date,
    hire_end_date,
    weekly_cost,
    condition = 'good',
    contents_description,
    notes,
  } = req.body || {};

  if (!container_number || typeof container_number !== 'string' || !container_number.trim()) {
    return res.status(400).json({ error: 'Container number is required' });
  }

  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  if (ownership_status && !VALID_OWNERSHIP.includes(ownership_status)) {
    return res.status(400).json({ error: `Invalid ownership status. Must be one of: ${VALID_OWNERSHIP.join(', ')}` });
  }

  if (condition && !VALID_CONDITIONS.includes(condition)) {
    return res.status(400).json({ error: `Invalid condition. Must be one of: ${VALID_CONDITIONS.join(', ')}` });
  }

  try {
    const { rows: [created] } = await db.query(
      `INSERT INTO containers (
        container_number, container_type, size, status, ownership_status,
        location, assigned_production_id, supplier, hire_start_date, hire_end_date,
        weekly_cost, condition, contents_description, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        container_number.trim(),
        container_type?.trim() || '20ft Storage Container',
        size?.trim() || null,
        status,
        ownership_status,
        location?.trim() || null,
        assigned_production_id && validId(assigned_production_id) ? assigned_production_id : null,
        supplier?.trim() || null,
        hire_start_date || null,
        hire_end_date || null,
        weekly_cost !== undefined && weekly_cost !== '' && !isNaN(Number(weekly_cost)) ? Number(weekly_cost) : null,
        condition,
        contents_description?.trim() || null,
        notes?.trim() || null,
      ]
    );

    if (req.user) {
      await logAudit({
        userId: req.user.id,
        productionId: assigned_production_id && validId(assigned_production_id) ? assigned_production_id : null,
        category: 'assets',
        action: 'create_container',
        entityType: 'container',
        entityId: created.id,
        details: `Created container: ${created.container_number} (${created.container_type})`,
      }).catch(() => {});
    }

    res.status(201).json(created);
  } catch (err) {
    console.error('createContainer error:', err);
    res.status(500).json({ error: 'Unable to create container' });
  }
};

// PUT or PATCH /api/containers/:id
const updateContainer = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid container ID' });
  const b = req.body || {};

  const allowedCols = [
    'container_number', 'container_type', 'size', 'status', 'ownership_status',
    'location', 'assigned_production_id', 'supplier', 'hire_start_date', 'hire_end_date',
    'weekly_cost', 'condition', 'contents_description', 'notes', 'is_archived',
  ];

  const updates = [];
  const values = [];
  let idx = 1;

  for (const col of allowedCols) {
    if (Object.hasOwn(b, col)) {
      let val = b[col];
      if (col === 'container_number') {
        if (!val || typeof val !== 'string' || !val.trim()) {
          return res.status(400).json({ error: 'Container number cannot be empty' });
        }
        val = val.trim();
      }
      if (col === 'weekly_cost') {
        val = val !== null && val !== '' && !isNaN(Number(val)) ? Number(val) : null;
      }
      if (col === 'assigned_production_id') {
        val = val && validId(val) ? val : null;
      }
      if (col === 'status' && !VALID_STATUSES.includes(val)) {
        return res.status(400).json({ error: `Invalid status: ${val}` });
      }
      if (col === 'ownership_status' && !VALID_OWNERSHIP.includes(val)) {
        return res.status(400).json({ error: `Invalid ownership status: ${val}` });
      }
      if (col === 'condition' && !VALID_CONDITIONS.includes(val)) {
        return res.status(400).json({ error: `Invalid condition: ${val}` });
      }

      updates.push(`${col} = $${idx++}`);
      values.push(val);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields provided to update' });
  }

  values.push(req.params.id);
  const query = `
    UPDATE containers
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = $${idx}
    RETURNING *
  `;

  try {
    const { rows: [updated] } = await db.query(query, values);
    if (!updated) return res.status(404).json({ error: 'Container not found' });

    if (req.user) {
      await logAudit({
        userId: req.user.id,
        productionId: updated.assigned_production_id || null,
        category: 'assets',
        action: 'update_container',
        entityType: 'container',
        entityId: updated.id,
        details: `Updated container: ${updated.container_number}`,
      }).catch(() => {});
    }

    res.json(updated);
  } catch (err) {
    console.error('updateContainer error:', err);
    res.status(500).json({ error: 'Unable to update container' });
  }
};

// DELETE /api/containers/:id
const deleteContainer = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid container ID' });
  const { hard } = req.query;

  try {
    if (hard === 'true') {
      const { rowCount } = await db.query('DELETE FROM containers WHERE id = $1', [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: 'Container not found' });
      return res.status(204).end();
    }

    // Default to archiving
    const { rows: [archived] } = await db.query(
      'UPDATE containers SET is_archived = true, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!archived) return res.status(404).json({ error: 'Container not found' });

    if (req.user) {
      await logAudit({
        userId: req.user.id,
        category: 'assets',
        action: 'archive_container',
        entityType: 'container',
        entityId: req.params.id,
        details: `Archived container: ${archived.container_number}`,
      }).catch(() => {});
    }

    res.status(204).end();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Delete attached documents before deleting this container' });
    }
    console.error('deleteContainer error:', err);
    res.status(500).json({ error: 'Unable to delete container' });
  }
};

// PATCH /api/containers/:id/restore
const restoreContainer = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid container ID' });
  try {
    const { rows: [restored] } = await db.query(
      'UPDATE containers SET is_archived = false, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!restored) return res.status(404).json({ error: 'Container not found' });

    if (req.user) {
      await logAudit({
        userId: req.user.id,
        category: 'assets',
        action: 'restore_container',
        entityType: 'container',
        entityId: req.params.id,
        details: `Restored container: ${restored.container_number}`,
      }).catch(() => {});
    }

    res.json(restored);
  } catch (err) {
    console.error('restoreContainer error:', err);
    res.status(500).json({ error: 'Unable to restore container' });
  }
};

module.exports = {
  getContainers,
  getContainerById,
  createContainer,
  updateContainer,
  deleteContainer,
  restoreContainer,
};
