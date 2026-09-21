const db = require('../config/db');
const { logAudit } = require('../services/auditService');

// Helper: compute reminder status based on next_inspection_due and reminder_days
const computeReminderStatus = (nextDue, reminderDays = 14) => {
  if (!nextDue) return { status: 'unknown', label: 'Unknown', is_overdue: false, is_due_soon: false, days_until: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextDue);
  due.setHours(0, 0, 0, 0);

  const diffMs = due.getTime() - today.getTime();
  const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (daysUntil < 0) {
    return {
      status: 'overdue',
      label: `Overdue by ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'}`,
      is_overdue: true,
      is_due_soon: false,
      days_until: daysUntil,
    };
  }
  if (daysUntil <= reminderDays) {
    return {
      status: 'due_soon',
      label: daysUntil === 0 ? 'Due Today' : `Due in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
      is_overdue: false,
      is_due_soon: true,
      days_until: daysUntil,
    };
  }
  return {
    status: 'valid',
    label: `Next due in ${daysUntil} days`,
    is_overdue: false,
    is_due_soon: false,
    days_until: daysUntil,
  };
};

// GET /api/ladders
const getLadders = async (req, res) => {
  try {
    const { include_archived, search, condition, status } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (include_archived !== 'true') {
      conditions.push('is_archived = false');
    }

    if (search) {
      conditions.push(`(barcode ILIKE $${idx} OR ladder_type ILIKE $${idx} OR location ILIKE $${idx} OR notes ILIKE $${idx})`);
      params.push(`%${search.trim()}%`);
      idx++;
    }

    if (condition && condition !== 'all') {
      conditions.push(`condition = $${idx}`);
      params.push(condition);
      idx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT *
      FROM ladders
      ${whereClause}
      ORDER BY next_inspection_due ASC, barcode ASC
    `;

    const { rows } = await db.query(query, params);

    const enriched = rows.map(r => {
      const reminder = computeReminderStatus(r.next_inspection_due, r.reminder_days || 14);
      return {
        ...r,
        reminder,
      };
    });

    let filtered = enriched;
    if (status && status !== 'all') {
      filtered = enriched.filter(r => r.reminder.status === status);
    }

    res.json({ ladders: filtered });
  } catch (err) {
    console.error('getLadders error:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/ladders/:id
const getLadderById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM ladders WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Ladder not found' });
    const reminder = computeReminderStatus(rows[0].next_inspection_due, rows[0].reminder_days || 14);
    res.json({ ladder: { ...rows[0], reminder } });
  } catch (err) {
    console.error('getLadderById error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/ladders
const createLadder = async (req, res) => {
  const {
    barcode,
    ladder_type,
    inspection_date,
    condition = 'Good',
    next_inspection_due,
    location,
    inspector_name,
    reminder_days = 14,
    notes,
  } = req.body;

  if (!barcode || !String(barcode).trim()) {
    return res.status(400).json({ error: 'Ladder barcode / ID is required (e.g. 100987)' });
  }

  if (!inspection_date) {
    return res.status(400).json({ error: 'Inspection date is required' });
  }

  // Calculate default next inspection due (+6 months) if not supplied
  let nextDue = next_inspection_due;
  if (!nextDue) {
    const d = new Date(inspection_date);
    d.setMonth(d.getMonth() + 6);
    nextDue = d.toISOString().split('T')[0];
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO ladders (
        barcode, ladder_type, inspection_date, condition, next_inspection_due,
        location, inspector_name, reminder_days, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        String(barcode).trim(),
        ladder_type ? String(ladder_type).trim() : 'Step Ladder',
        inspection_date,
        condition || 'Good',
        nextDue,
        location ? String(location).trim() : null,
        inspector_name ? String(inspector_name).trim() : null,
        parseInt(reminder_days, 10) || 14,
        notes ? String(notes).trim() : null,
      ]
    );

    const reminder = computeReminderStatus(rows[0].next_inspection_due, rows[0].reminder_days);
    res.status(201).json({ ladder: { ...rows[0], reminder } });
  } catch (err) {
    console.error('createLadder error:', err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/ladders/:id
const updateLadder = async (req, res) => {
  const { id } = req.params;
  const allowed = [
    'barcode',
    'ladder_type',
    'inspection_date',
    'condition',
    'next_inspection_due',
    'location',
    'inspector_name',
    'reminder_days',
    'notes',
    'is_archived',
  ];

  const updates = {};
  allowed.forEach(f => {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  });

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  try {
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

    const { rows } = await db.query(
      `UPDATE ladders SET ${setClause}, updated_at = NOW() WHERE id = $${fields.length + 1} RETURNING *`,
      [...values, id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Ladder not found' });
    const reminder = computeReminderStatus(rows[0].next_inspection_due, rows[0].reminder_days);
    res.json({ ladder: { ...rows[0], reminder } });
  } catch (err) {
    console.error('updateLadder error:', err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/ladders/:id (Soft delete / archive OR permanent delete)
const deleteLadder = async (req, res) => {
  const { id } = req.params;
  const isPermanent = req.query.permanent === 'true';

  try {
    if (isPermanent) {
      const { rows } = await db.query('SELECT * FROM ladders WHERE id = $1', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Ladder not found' });
      const ladder = rows[0];

      await db.query('DELETE FROM ladders WHERE id = $1', [id]);

      try {
        await logAudit({
          userId: req.user?.id,
          userName: req.user?.full_name,
          userRole: req.user?.role,
          category: 'safety_document',
          action: 'ladder_permanently_deleted',
          entityType: 'ladder',
          entityId: id,
          details: `Permanently deleted ladder barcode ${ladder.barcode} (${ladder.ladder_type || 'Step Ladder'})`,
          metadata: { barcode: ladder.barcode, ladder_type: ladder.ladder_type },
        });
      } catch (auditErr) {
        console.error('Audit log failed for permanent delete ladder:', auditErr);
      }

      return res.json({ message: 'Ladder permanently deleted successfully', permanently_deleted: true });
    }

    const { rows } = await db.query(
      'UPDATE ladders SET is_archived = true, deleted_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ladder not found' });
    res.json({ message: 'Ladder archived successfully', soft_deleted: true, ladder: rows[0] });
  } catch (err) {
    console.error('deleteLadder error:', err);
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/ladders/:id/restore
const restoreLadder = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      'UPDATE ladders SET is_archived = false, deleted_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ladder not found' });
    const reminder = computeReminderStatus(rows[0].next_inspection_due, rows[0].reminder_days);
    res.json({ message: 'Ladder restored successfully', ladder: { ...rows[0], reminder } });
  } catch (err) {
    console.error('restoreLadder error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getLadders,
  getLadderById,
  createLadder,
  updateLadder,
  deleteLadder,
  restoreLadder,
};
