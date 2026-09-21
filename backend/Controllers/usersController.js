const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');
const { logAudit } = require('../services/auditService');

const VALID_ROLES = [
  'managing_director',
  'construction_accountant',
  'construction_coordinator',
  'guest',
];

// ─── GET /api/users — list all accounts with visible decrypted passwords (MD only) ──
const listUsers = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, email, full_name, role, is_active, display_password, created_at, updated_at
       FROM users
       ORDER BY full_name`
    );

    const users = rows.map((u) => ({
      ...u,
      display_password: u.display_password ? decrypt(u.display_password) : null,
    }));

    res.json(users);
  } catch (err) {
    console.error('listUsers:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/users — create a new account (MD only) ─────────────────────────
const createUser = async (req, res) => {
  const { email, password, full_name, role } = req.body;

  if (!email || !password || !full_name || !role)
    return res.status(400).json({ error: 'email, password, full_name, and role are required' });

  if (!VALID_ROLES.includes(role))
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });

  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const { rows: existing } = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (existing.length) return res.status(409).json({ error: 'Email already registered' });

    const password_hash = await bcrypt.hash(password, 12);
    const display_password = encrypt(password);

    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, display_password, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, role, is_active, created_at`,
      [email.toLowerCase().trim(), password_hash, display_password, full_name, role]
    );

    res.status(201).json({
      message: 'User account created',
      user: {
        ...rows[0],
        display_password: password,
      },
    });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'role',
      action: 'user_created',
      entityType: 'user',
      entityId: rows[0].id,
      details: `Created user account for ${rows[0].full_name} (${rows[0].email}) with role "${rows[0].role}"`,
      metadata: { created_user_id: rows[0].id, email: rows[0].email, role: rows[0].role, full_name: rows[0].full_name },
    });
  } catch (err) {
    console.error('createUser:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PATCH /api/users/:id — update role / name / active status (MD only) ──────
const updateUser = async (req, res) => {
  const { full_name, role, is_active } = req.body;

  if (role !== undefined && !VALID_ROLES.includes(role))
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });

  if (full_name === undefined && role === undefined && is_active === undefined)
    return res.status(400).json({ error: 'No updatable fields provided' });

  // Prevent Warren from locking himself out by deactivating/demoting his own only-MD account
  if (req.user.id === req.params.id && (role !== undefined && role !== 'managing_director'))
    return res.status(400).json({ error: 'You cannot change your own role away from Managing Director' });
  if (req.user.id === req.params.id && is_active === false)
    return res.status(400).json({ error: 'You cannot deactivate your own account' });

  try {
    const { rows: [existing] } = await db.query('SELECT id, email, full_name, role, is_active FROM users WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const fields = [];
    const params = [];
    let i = 1;
    if (full_name !== undefined) { fields.push(`full_name = $${i++}`); params.push(full_name); }
    if (role      !== undefined) { fields.push(`role = $${i++}`);      params.push(role); }
    if (is_active !== undefined) { fields.push(`is_active = $${i++}`); params.push(is_active); }
    fields.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const { rows: [updated] } = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, email, full_name, role, is_active, display_password, created_at, updated_at`,
      params
    );

    res.json({
      message: 'User updated',
      user: {
        ...updated,
        display_password: updated.display_password ? decrypt(updated.display_password) : null,
      },
    });

    const isRoleChanged = role !== undefined && role !== existing.role;
    const isStatusChanged = is_active !== undefined && is_active !== existing.is_active;
    const detailParts = [];
    if (isRoleChanged) detailParts.push(`Role changed from "${existing.role}" to "${role}"`);
    if (isStatusChanged) detailParts.push(`Status changed from ${existing.is_active ? 'Active' : 'Inactive'} to ${is_active ? 'Active' : 'Inactive'}`);
    if (full_name && full_name !== existing.full_name) detailParts.push(`Name changed to "${full_name}"`);

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'role',
      action: isRoleChanged ? 'role_changed' : (isStatusChanged ? 'user_status_changed' : 'user_updated'),
      entityType: 'user',
      entityId: existing.id,
      details: `Updated user ${existing.full_name}: ${detailParts.join('; ') || 'Details modified'}`,
      metadata: {
        previous: { role: existing.role, is_active: existing.is_active, full_name: existing.full_name },
        updated: { role: updated.role, is_active: updated.is_active, full_name: updated.full_name },
      },
    });
  } catch (err) {
    console.error('updateUser:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PATCH /api/users/:id/password — change user password (MD only) ───────────
const changePassword = async (req, res) => {
  const { password } = req.body;

  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const { rows: [existing] } = await db.query('SELECT id, email, full_name FROM users WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const password_hash = await bcrypt.hash(password, 12);
    const display_password = encrypt(password);

    await db.query(
      `UPDATE users 
       SET password_hash = $1, display_password = $2, updated_at = NOW() 
       WHERE id = $3`,
      [password_hash, display_password, req.params.id]
    );

    res.json({
      message: `Password for ${existing.full_name} updated successfully`,
      display_password: password,
    });

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'role',
      action: 'user_password_changed',
      entityType: 'user',
      entityId: existing.id,
      details: `Updated password for ${existing.full_name} (${existing.email})`,
      metadata: { target_user_id: existing.id, email: existing.email },
    });
  } catch (err) {
    console.error('changePassword:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── DELETE /api/users/:id — permanently delete account (MD only) ─────────────
const deleteUser = async (req, res) => {
  const { id } = req.params;

  if (req.user.id === id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  try {
    const { rows: [existing] } = await db.query('SELECT id, full_name FROM users WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    // Clean up foreign references in a transaction before deleting user
    await db.query('BEGIN');

    await db.query('UPDATE productions SET created_by = NULL WHERE created_by = $1', [id]);
    await db.query('UPDATE purchase_orders SET created_by = NULL WHERE created_by = $1', [id]);
    await db.query('UPDATE purchase_orders SET approved_by = NULL WHERE approved_by = $1', [id]);
    await db.query('UPDATE timesheets SET created_by = NULL WHERE created_by = $1', [id]);
    await db.query('UPDATE pay_runs SET created_by = NULL WHERE created_by = $1', [id]);
    await db.query('UPDATE forecasts SET created_by = NULL WHERE created_by = $1', [id]);
    await db.query('UPDATE production_documents SET uploaded_by = NULL WHERE uploaded_by = $1', [id]);
    await db.query('UPDATE app_settings SET updated_by = NULL WHERE updated_by = $1', [id]);
    await db.query('UPDATE cost_report_po_billing SET updated_by = NULL WHERE updated_by = $1', [id]);
    await db.query('UPDATE cost_report_margins_reference SET updated_by = NULL WHERE updated_by = $1', [id]);
    await db.query('UPDATE cost_report_omitted_entries SET omitted_by = NULL WHERE omitted_by = $1', [id]);
    await db.query('UPDATE crew_registration_requests SET reviewed_by = NULL WHERE reviewed_by = $1', [id]);
    await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [id]);
    await db.query('DELETE FROM audit_log WHERE user_id = $1', [id]);

    await db.query('DELETE FROM users WHERE id = $1', [id]);

    await db.query('COMMIT');

    res.json({ message: `User ${existing.full_name} permanently deleted` });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('deleteUser:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  listUsers,
  createUser,
  updateUser,
  changePassword,
  deleteUser,
};
