const db = require('../config/db');

/**
 * Audit Logging Service
 * Records an immutable audit log entry into `audit_log`.
 * 
 * @param {Object} entry
 * @param {string} [entry.userId] - ID of user performing the action
 * @param {string} [entry.userName] - Cached name of user
 * @param {string} [entry.userRole] - Cached role of user
 * @param {string} [entry.productionId] - Related production ID (if applicable)
 * @param {'financial' | 'payroll' | 'rate_card' | 'safety_document' | 'role' | 'production' | 'general'} entry.category
 * @param {string} entry.action - Specific action code (e.g. 'po_approved', 'role_changed')
 * @param {string} [entry.entityType] - Target entity type (e.g. 'purchase_order', 'pay_run', 'user')
 * @param {string} [entry.entityId] - Target entity ID
 * @param {string} entry.details - Human-readable summary
 * @param {Object} [entry.metadata] - JSON payload / before-after snapshots / diff
 * @param {Object} [entry.client] - Optional pg client if part of an existing transaction
 */
const logAudit = async ({
  userId = null,
  userName = null,
  userRole = null,
  productionId = null,
  category = 'general',
  action,
  entityType = null,
  entityId = null,
  details = '',
  metadata = {},
  client = null,
}) => {
  const queryRunner = client || db;

  try {
    // If userName / userRole not supplied but userId is, try to fetch user info once
    let finalUserName = userName;
    let finalUserRole = userRole;

    if (userId && (!finalUserName || !finalUserRole)) {
      try {
        const { rows } = await queryRunner.query(
          'SELECT full_name, role FROM users WHERE id = $1',
          [userId]
        );
        if (rows.length) {
          finalUserName = finalUserName || rows[0].full_name;
          finalUserRole = finalUserRole || rows[0].role;
        }
      } catch (err) {
        // Ignore user lookup error
      }
    }

    const { rows } = await queryRunner.query(
      `INSERT INTO audit_log (
        user_id,
        production_id,
        action,
        category,
        entity_type,
        entity_id,
        details,
        user_name,
        user_role,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        userId,
        productionId,
        action,
        category,
        entityType,
        entityId ? String(entityId) : null,
        details,
        finalUserName,
        finalUserRole,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    return rows[0];
  } catch (err) {
    // Fail-safe: log audit write error to stderr but do not throw to protect main flow
    console.error('Failed to write audit_log:', err.message);
    return null;
  }
};

module.exports = { logAudit };
