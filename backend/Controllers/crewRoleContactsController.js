const db = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');
const { logAudit } = require('../services/auditService');

const VALID_ROLE_TYPES = [
  'designer',
  'supv_art',
  'art_dir',
  'fin_control',
  'producer',
  'upm',
  'line_prod',
];

const CALL_PRIORITIES = ['first_call', 'backup', 'never_call'];
const ENCRYPTED_FIELDS = ['phone', 'notes'];
const TEXT_LIMITS = {
  full_name: 200,
  email: 254,
  phone: 80,
  company_or_production: 200,
  notes: 10000,
};

const validId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const decode = row => {
  if (!row) return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      ENCRYPTED_FIELDS.includes(key) ? decrypt(value) : value,
    ])
  );
};

function validate(body, creating = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'A contact object is required';
  }
  if (creating) {
    if (!body.role_type || !VALID_ROLE_TYPES.includes(body.role_type)) {
      return `Valid role_type is required: ${VALID_ROLE_TYPES.join(', ')}`;
    }
    if (!body.full_name || typeof body.full_name !== 'string' || !body.full_name.trim()) {
      return 'Full name is required';
    }
  }
  if (body.role_type !== undefined && !VALID_ROLE_TYPES.includes(body.role_type)) {
    return `Invalid role_type. Must be one of: ${VALID_ROLE_TYPES.join(', ')}`;
  }
  if (body.full_name !== undefined && (typeof body.full_name !== 'string' || !body.full_name.trim())) {
    return 'Full name cannot be empty';
  }
  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    if (body[field] !== undefined && body[field] !== null && (typeof body[field] !== 'string' || body[field].length > limit)) {
      return `${field} must be text up to ${limit} characters`;
    }
  }
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
    return 'Enter a valid email address';
  }
  if (body.phone && !/^[+\d\s().#-]+$/.test(body.phone.trim())) {
    return 'Enter a valid phone number';
  }
  if (body.call_priority !== undefined && !CALL_PRIORITIES.includes(body.call_priority)) {
    return 'Invalid call priority';
  }
  if (body.is_favourite !== undefined && typeof body.is_favourite !== 'boolean') {
    return 'Favourite must be true or false';
  }
  return null;
}

function fieldsFrom(body) {
  const fields = {};
  for (const field of Object.keys(TEXT_LIMITS)) {
    if (Object.hasOwn(body, field)) {
      const value = body[field]?.trim() || null;
      fields[field] = ENCRYPTED_FIELDS.includes(field) ? encrypt(value) : value;
    }
  }
  for (const field of ['role_type', 'is_favourite', 'call_priority']) {
    if (Object.hasOwn(body, field)) {
      fields[field] = body[field];
    }
  }
  return fields;
}

// GET /api/crew/role-contacts
const listRoleContacts = async (req, res) => {
  try {
    const { role_type, search, call_priority, is_favourite } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role_type) {
      conditions.push(`role_type = $${idx++}`);
      params.push(role_type);
    }
    if (call_priority) {
      conditions.push(`call_priority = $${idx++}`);
      params.push(call_priority);
    }
    if (is_favourite !== undefined) {
      conditions.push(`is_favourite = $${idx++}`);
      params.push(is_favourite === 'true');
    }
    if (search) {
      conditions.push(`(full_name ILIKE $${idx} OR email ILIKE $${idx} OR company_or_production ILIKE $${idx})`);
      params.push(`%${search.trim()}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT * FROM crew_role_contacts ${where} ORDER BY is_favourite DESC, created_at DESC, full_name ASC`,
      params
    );

    res.json(rows.map(decode));
  } catch (err) {
    console.error('listRoleContacts error:', err);
    res.status(500).json({ error: 'Unable to load role contacts' });
  }
};

// GET /api/crew/role-contacts/:id
const getRoleContactById = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid contact ID' });
  try {
    const { rows: [row] } = await db.query('SELECT * FROM crew_role_contacts WHERE id = $1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Contact not found' });
    res.json(decode(row));
  } catch (err) {
    console.error('getRoleContactById error:', err);
    res.status(500).json({ error: 'Unable to load contact' });
  }
};

// POST /api/crew/role-contacts
const createRoleContact = async (req, res) => {
  const error = validate(req.body, true);
  if (error) return res.status(400).json({ error });
  try {
    const fields = fieldsFrom(req.body);
    const columns = Object.keys(fields);
    const { rows: [row] } = await db.query(
      `INSERT INTO crew_role_contacts (${columns.join(', ')})
       VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})
       RETURNING *`,
      Object.values(fields)
    );

    if (req.user) {
      await logAudit({
        userId: req.user.id,
        category: 'crew',
        action: 'create_role_contact',
        entityType: 'crew_role_contact',
        entityId: row.id,
        details: `Created ${row.role_type} contact: ${row.full_name}`,
      }).catch(() => {});
    }

    res.status(201).json(decode(row));
  } catch (err) {
    console.error('createRoleContact error:', err);
    res.status(500).json({ error: 'Unable to save role contact' });
  }
};

// PUT or PATCH /api/crew/role-contacts/:id
const updateRoleContact = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid contact ID' });
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const fields = fieldsFrom(req.body);
    const columns = Object.keys(fields);
    if (!columns.length) return res.status(400).json({ error: 'No contact changes supplied' });

    const values = [...Object.values(fields), req.params.id];
    const { rows: [row] } = await db.query(
      `UPDATE crew_role_contacts
       SET ${columns.map((col, idx) => `${col} = $${idx + 1}`).join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    if (!row) return res.status(404).json({ error: 'Role contact not found' });

    if (req.user) {
      await logAudit({
        userId: req.user.id,
        category: 'crew',
        action: 'update_role_contact',
        entityType: 'crew_role_contact',
        entityId: row.id,
        details: `Updated ${row.role_type} contact: ${row.full_name}`,
      }).catch(() => {});
    }

    res.json(decode(row));
  } catch (err) {
    console.error('updateRoleContact error:', err);
    res.status(500).json({ error: 'Unable to update role contact' });
  }
};

// DELETE /api/crew/role-contacts/:id
const deleteRoleContact = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid contact ID' });
  try {
    const { rows: [existing] } = await db.query('SELECT * FROM crew_role_contacts WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Role contact not found' });

    const { rowCount } = await db.query('DELETE FROM crew_role_contacts WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Role contact not found' });

    if (req.user) {
      await logAudit({
        userId: req.user.id,
        category: 'crew',
        action: 'delete_role_contact',
        entityType: 'crew_role_contact',
        entityId: req.params.id,
        details: `Deleted ${existing.role_type} contact: ${existing.full_name}`,
      }).catch(() => {});
    }

    res.status(204).end();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Delete attached documents before deleting this contact' });
    }
    console.error('deleteRoleContact error:', err);
    res.status(500).json({ error: 'Unable to delete role contact' });
  }
};

module.exports = {
  VALID_ROLE_TYPES,
  listRoleContacts,
  getRoleContactById,
  createRoleContact,
  updateRoleContact,
  deleteRoleContact,
};
