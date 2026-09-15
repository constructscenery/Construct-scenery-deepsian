const db = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');

// GET /api/it-resources
const getITResources = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, type, vendor, subscription_start, renewal_date, cost, billing_cycle, reminder_enabled, reminder_days, notes, created_at, updated_at
       FROM it_resources ORDER BY name ASC`
    );
    res.json({ it_resources: rows });
  } catch (err) {
    console.error('getITResources error:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/it-resources/:id
const getITResourceById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT id, name, type, vendor, subscription_start, renewal_date, cost, billing_cycle, reminder_enabled, reminder_days, notes, created_at, updated_at
       FROM it_resources WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'IT Resource not found' });
    res.json({ it_resource: rows[0] });
  } catch (err) {
    console.error('getITResourceById error:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/it-resources/:id/credentials
const getITResourceCredentials = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT credentials FROM it_resources WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'IT Resource not found' });

    const decryptedCredentials = decrypt(rows[0].credentials);
    res.json({ credentials: decryptedCredentials });
  } catch (err) {
    console.error('getITResourceCredentials error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/it-resources
const createITResource = async (req, res) => {
  // Accept both camelCase and snake_case
  const {
    name,
    type,
    vendor,
    subscription_start, subscriptionStart,
    renewal_date, renewalDate,
    cost,
    billing_cycle, reminder_enabled, reminder_days,
    credentials,
    notes,
  } = req.body;

  const resolvedSubscriptionStart = subscription_start ?? subscriptionStart;
  const resolvedRenewalDate       = renewal_date       ?? renewalDate;

  if (!name) {
    return res.status(400).json({ error: 'IT Resource name is required' });
  }

  try {
    const encryptedCredentials = credentials ? encrypt(credentials) : null;

    const { rows } = await db.query(
      `INSERT INTO it_resources (
        name, type, vendor, subscription_start, renewal_date, cost, billing_cycle, reminder_enabled, reminder_days, credentials, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, name, type, vendor, subscription_start, renewal_date, cost, billing_cycle, reminder_enabled, reminder_days, notes, created_at, updated_at`,
      [
        name.trim(),
        type ? type.trim() : null,
        vendor ? vendor.trim() : null,
        resolvedSubscriptionStart || null,
        resolvedRenewalDate || null,
        cost !== undefined && cost !== null ? parseFloat(cost) : null,
        billing_cycle || 'annual',
        reminder_enabled !== undefined ? reminder_enabled : true,
        reminder_days !== undefined && reminder_days !== null ? parseInt(reminder_days, 10) : 30,
        encryptedCredentials,
        notes ? notes.trim() : null,
      ]
    );

    res.status(201).json({ message: 'IT Resource created successfully', it_resource: rows[0] });
  } catch (err) {
    console.error('createITResource error:', err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/it-resources/:id
const updateITResource = async (req, res) => {
  const { id } = req.params;
  // Accept both camelCase and snake_case
  const {
    name,
    type,
    vendor,
    subscription_start, subscriptionStart,
    renewal_date, renewalDate,
    cost,
    billing_cycle, reminder_enabled, reminder_days,
    credentials,
    notes,
  } = req.body;

  const resolvedSubscriptionStart = subscription_start !== undefined ? subscription_start : subscriptionStart;
  const resolvedRenewalDate       = renewal_date       !== undefined ? renewal_date       : renewalDate;

  try {
    let query = `UPDATE it_resources SET
        name = COALESCE($1, name),
        type = $2,
        vendor = $3,
        subscription_start = $4,
        renewal_date = $5,
        cost = $6,
        billing_cycle = $7,
        reminder_enabled = $8,
        reminder_days = $9,
        notes = $10,
        updated_at = NOW()`;

    let params = [
      name?.trim(),
      type !== undefined ? type : undefined,
      vendor !== undefined ? vendor : undefined,
      resolvedSubscriptionStart !== undefined ? resolvedSubscriptionStart : undefined,
      resolvedRenewalDate !== undefined ? resolvedRenewalDate : undefined,
      cost !== undefined ? (cost !== null ? parseFloat(cost) : null) : undefined,
      billing_cycle !== undefined ? billing_cycle : undefined,
      reminder_enabled !== undefined ? reminder_enabled : undefined,
      reminder_days !== undefined ? parseInt(reminder_days, 10) : undefined,
      notes !== undefined ? notes : undefined,
    ];

    if (credentials !== undefined) {
      query += `, credentials = $11 WHERE id = $12`;
      params.push(credentials ? encrypt(credentials) : null, id);
    } else {
      query += ` WHERE id = $11`;
      params.push(id);
    }

    query += ` RETURNING id, name, type, vendor, subscription_start, renewal_date, cost, billing_cycle, reminder_enabled, reminder_days, notes, created_at, updated_at`;

    const { rows } = await db.query(query, params);

    if (!rows.length) return res.status(404).json({ error: 'IT Resource not found' });
    res.json({ message: 'IT Resource updated successfully', it_resource: rows[0] });
  } catch (err) {
    console.error('updateITResource error:', err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/it-resources/:id
const deleteITResource = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await db.query('DELETE FROM it_resources WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'IT Resource not found' });
    res.json({ message: 'IT Resource deleted successfully' });
  } catch (err) {
    console.error('deleteITResource error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getITResources,
  getITResourceById,
  getITResourceCredentials,
  createITResource,
  updateITResource,
  deleteITResource,
};
