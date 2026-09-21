const db = require('../config/db');

// ─── GET /api/audit-log ───────────────────────────────────────────────────────
const getAuditLogs = async (req, res) => {
  try {
    const {
      category,
      search,
      date_from,
      date_to,
      entity_type,
      entity_id,
      limit = 100,
      offset = 0,
    } = req.query;

    const conditions = [];
    const params = [];
    let i = 1;

    if (category && category !== 'all') {
      conditions.push(`al.category = $${i++}`);
      params.push(category);
    }

    if (entity_type) {
      conditions.push(`al.entity_type = $${i++}`);
      params.push(entity_type);
    }

    if (entity_id) {
      conditions.push(`al.entity_id = $${i++}`);
      params.push(String(entity_id));
    }

    if (date_from) {
      conditions.push(`al.created_at >= $${i++}`);
      params.push(date_from);
    }

    if (date_to) {
      conditions.push(`al.created_at <= $${i++}::timestamptz + INTERVAL '1 day'`);
      params.push(date_to);
    }

    if (search) {
      conditions.push(`(
        al.details ILIKE $${i} OR
        al.action ILIKE $${i} OR
        al.user_name ILIKE $${i} OR
        al.entity_id ILIKE $${i} OR
        u.full_name ILIKE $${i} OR
        p.name ILIKE $${i}
      )`);
      params.push(`%${search}%`);
      i++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count query
    const countRes = await db.query(
      `SELECT COUNT(*) AS total
       FROM audit_log al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN productions p ON al.production_id = p.id
       ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    // Fetch records
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const { rows } = await db.query(
      `SELECT 
        al.id,
        al.user_id,
        al.production_id,
        al.action,
        COALESCE(al.category, 'general') AS category,
        al.entity_type,
        al.entity_id,
        al.details,
        COALESCE(al.user_name, u.full_name, 'System') AS user_name,
        COALESCE(al.user_role, u.role, 'system') AS user_role,
        al.metadata,
        al.created_at,
        p.name AS production_name
       FROM audit_log al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN productions p ON al.production_id = p.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, parsedLimit, parsedOffset]
    );

    res.json({
      total,
      limit: parsedLimit,
      offset: parsedOffset,
      logs: rows,
    });
  } catch (err) {
    console.error('getAuditLogs error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/audit-log/summary ───────────────────────────────────────────────
const getAuditSummary = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE category = 'financial') AS financial_count,
        COUNT(*) FILTER (WHERE category = 'payroll') AS payroll_count,
        COUNT(*) FILTER (WHERE category = 'rate_card') AS rate_card_count,
        COUNT(*) FILTER (WHERE category = 'safety_document') AS safety_count,
        COUNT(*) FILTER (WHERE category = 'role') AS role_count,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h_count,
        MAX(created_at) AS last_event_at
      FROM audit_log
    `);

    res.json({
      summary: {
        total: parseInt(rows[0]?.total || 0, 10),
        financial: parseInt(rows[0]?.financial_count || 0, 10),
        payroll: parseInt(rows[0]?.payroll_count || 0, 10),
        rate_card: parseInt(rows[0]?.rate_card_count || 0, 10),
        safety_document: parseInt(rows[0]?.safety_count || 0, 10),
        role: parseInt(rows[0]?.role_count || 0, 10),
        last_24h: parseInt(rows[0]?.last_24h_count || 0, 10),
        last_event_at: rows[0]?.last_event_at || null,
      },
    });
  } catch (err) {
    console.error('getAuditSummary error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/audit-log/export ────────────────────────────────────────────────
const exportAuditCsv = async (req, res) => {
  try {
    const { category, search, date_from, date_to } = req.query;

    const conditions = [];
    const params = [];
    let i = 1;

    if (category && category !== 'all') {
      conditions.push(`al.category = $${i++}`);
      params.push(category);
    }
    if (date_from) {
      conditions.push(`al.created_at >= $${i++}`);
      params.push(date_from);
    }
    if (date_to) {
      conditions.push(`al.created_at <= $${i++}::timestamptz + INTERVAL '1 day'`);
      params.push(date_to);
    }
    if (search) {
      conditions.push(`(
        al.details ILIKE $${i} OR
        al.action ILIKE $${i} OR
        al.user_name ILIKE $${i} OR
        al.entity_id ILIKE $${i}
      )`);
      params.push(`%${search}%`);
      i++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT 
        al.created_at,
        COALESCE(al.category, 'general') AS category,
        al.action,
        al.details,
        al.entity_type,
        al.entity_id,
        COALESCE(al.user_name, u.full_name, 'System') AS user_name,
        COALESCE(al.user_role, u.role, 'system') AS user_role,
        p.name AS production_name
       FROM audit_log al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN productions p ON al.production_id = p.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT 2000`,
      params
    );

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const header = ['Timestamp', 'Category', 'Action', 'Details', 'Entity Type', 'Entity ID', 'User Name', 'User Role', 'Production'];
    const lines = [header.join(',')];

    for (const r of rows) {
      lines.push([
        escapeCsv(new Date(r.created_at).toISOString()),
        escapeCsv(r.category),
        escapeCsv(r.action),
        escapeCsv(r.details),
        escapeCsv(r.entity_type),
        escapeCsv(r.entity_id),
        escapeCsv(r.user_name),
        escapeCsv(r.user_role),
        escapeCsv(r.production_name),
      ].join(','));
    }

    const filename = `Audit_Log_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('exportAuditCsv error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getAuditLogs,
  getAuditSummary,
  exportAuditCsv,
};
