const db = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');

// FreelancerCallPriority
const CALL_PRIORITY = { FIRST_CALL: 'first_call', BACKUP: 'backup', NEVER_CALL: 'never_call' };
const ENCRYPTED_FIELDS = ['phone', 'notes'];
const TEXT_LIMITS = { full_name: 200, email: 254, phone: 80, skills: 500, notes: 10000 };
const validId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const decode = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, ENCRYPTED_FIELDS.includes(key) ? decrypt(value) : value]));

function validate(body, creating = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'A contact object is required';
  if ((creating || Object.hasOwn(body, 'full_name')) && (typeof body.full_name !== 'string' || !body.full_name.trim())) return 'Name is required';
  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    if (body[field] !== undefined && body[field] !== null && (typeof body[field] !== 'string' || body[field].length > limit)) return `${field} must be text up to ${limit} characters`;
  }
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) return 'Enter a valid email address';
  if (body.phone && !/^[+\d\s().#-]+$/.test(body.phone.trim())) return 'Enter a valid phone number';
  if (body.call_priority !== undefined && !Object.values(CALL_PRIORITY).includes(body.call_priority)) return 'Invalid call priority';
  if (body.is_favourite !== undefined && typeof body.is_favourite !== 'boolean') return 'Favourite must be true or false';
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
  for (const field of ['is_favourite', 'call_priority']) {
    if (Object.hasOwn(body, field)) fields[field] = body[field];
  }
  return fields;
}

const listFreelancers = async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM freelancer_contacts ORDER BY is_favourite DESC, full_name ASC, id ASC');
    res.json(rows.map(decode));
  } catch {
    res.status(500).json({ error: 'Unable to load freelancers' });
  }
};

const createFreelancer = async (req, res) => {
  const error = validate(req.body, true);
  if (error) return res.status(400).json({ error });
  try {
    const fields = fieldsFrom(req.body);
    const columns = Object.keys(fields);
    const { rows: [row] } = await db.query(`INSERT INTO freelancer_contacts (${columns.join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING *`, Object.values(fields));
    res.status(201).json(decode(row));
  } catch {
    res.status(500).json({ error: 'Unable to save freelancer' });
  }
};

const updateFreelancer = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid freelancer ID' });
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const fields = fieldsFrom(req.body);
    const columns = Object.keys(fields);
    if (!columns.length) return res.status(400).json({ error: 'No contact changes supplied' });
    const values = [...Object.values(fields), req.params.id];
    const { rows: [row] } = await db.query(`UPDATE freelancer_contacts SET ${columns.map((column, index) => `${column} = $${index + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values);
    if (!row) return res.status(404).json({ error: 'Freelancer not found' });
    res.json(decode(row));
  } catch {
    res.status(500).json({ error: 'Unable to update freelancer' });
  }
};

const deleteFreelancer = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid freelancer ID' });
  try {
    const { rowCount } = await db.query('DELETE FROM freelancer_contacts WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Freelancer not found' });
    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'Unable to delete freelancer' });
  }
};

module.exports = { listFreelancers, createFreelancer, updateFreelancer, deleteFreelancer };