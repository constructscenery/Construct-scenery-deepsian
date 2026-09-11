const db = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');
const { sendEmail, templates } = require('../config/email');
const { ensureRequestsTable } = require('./publicCrewController');

const ENCRYPTED_FIELDS = new Set([
  'home_address', 'account_name', 'account_number',
  'sort_code', 'emergency_contact_phone',
]);

function decryptRequest(row) {
  if (!row) return row;
  const out = { ...row };
  for (const field of ENCRYPTED_FIELDS) {
    if (out[field] !== undefined && out[field] !== null) {
      out[field] = decrypt(out[field]);
    }
  }
  return out;
}

const generateCrewNumber = async () => {
  const { rows } = await db.query(
    `SELECT MAX(CAST(SUBSTRING(crew_number FROM 5) AS INTEGER)) AS max_num
     FROM crew_members
     WHERE crew_number ~ '^CSC-[0-9]+$'`
  );
  const maxNum = parseInt(rows[0]?.max_num, 10) || 0;
  return `CSC-${String(maxNum + 1).padStart(4, '0')}`;
};

// ─── POST /api/crew/send-invite ───────────────────────────────────────────────
const sendInvite = async (req, res) => {
  const { email, name, message } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  try {
    // Determine public URL for the crew registration form
    const origin = req.headers.origin || req.headers.referer;
    let baseUrl = process.env.FRONTEND_URL || (origin ? new URL(origin).origin : 'http://localhost:3000');
    baseUrl = baseUrl.replace(/\/$/, '');

    const params = new URLSearchParams();
    if (email) params.set('email', email.trim());
    if (name) params.set('name', name.trim());
    const inviteUrl = `${baseUrl}/crew-registration?${params.toString()}`;

    // Send email via SES
    await sendEmail({
      to: email.trim(),
      ...templates.crewInvite({
        inviteeName: name?.trim(),
        inviteUrl,
        senderName: req.user?.full_name || 'Construct Scenery Management',
        customMessage: message?.trim(),
        to: email.trim(),
      }),
    });

    res.json({
      message: `Registration invitation successfully sent to ${email}`,
      inviteUrl,
    });
  } catch (err) {
    console.error('sendInvite error:', err);
    res.status(500).json({ error: 'Failed to send invitation email. ' + err.message });
  }
};

// ─── GET /api/crew/requests ───────────────────────────────────────────────────
const listRequests = async (req, res) => {
  await ensureRequestsTable();
  const statusFilter = req.query.status || 'pending'; // 'pending' | 'approved' | 'rejected' | 'all'

  try {
    const conditions = [];
    const params = [];

    if (statusFilter !== 'all') {
      conditions.push(`r.status = $1`);
      params.push(statusFilter);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [{ rows: requests }, { rows: countsRows }] = await Promise.all([
      db.query(
        `SELECT r.*, u.full_name AS reviewed_by_name, cm.crew_number AS created_crew_number
         FROM crew_registration_requests r
         LEFT JOIN users u ON r.reviewed_by = u.id
         LEFT JOIN crew_members cm ON r.created_crew_member_id = cm.id
         ${whereClause}
         ORDER BY r.created_at DESC`,
        params
      ),
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
           COUNT(*) FILTER (WHERE status = 'approved') AS approved,
           COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
           COUNT(*) AS total
         FROM crew_registration_requests`
      ),
    ]);

    const counts = {
      pending: parseInt(countsRows[0]?.pending || 0, 10),
      approved: parseInt(countsRows[0]?.approved || 0, 10),
      rejected: parseInt(countsRows[0]?.rejected || 0, 10),
      total: parseInt(countsRows[0]?.total || 0, 10),
    };

    res.json({
      requests: requests.map(decryptRequest),
      counts,
    });
  } catch (err) {
    console.error('listRequests error:', err);
    res.status(500).json({ error: 'Failed to retrieve registration requests.' });
  }
};

// ─── GET /api/crew/requests/:id ───────────────────────────────────────────────
const getRequestById = async (req, res) => {
  await ensureRequestsTable();
  try {
    const { rows } = await db.query(
      `SELECT r.*, u.full_name AS reviewed_by_name, cm.crew_number AS created_crew_number
       FROM crew_registration_requests r
       LEFT JOIN users u ON r.reviewed_by = u.id
       LEFT JOIN crew_members cm ON r.created_crew_member_id = cm.id
       WHERE r.id = $1`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Registration request not found.' });
    }

    res.json(decryptRequest(rows[0]));
  } catch (err) {
    console.error('getRequestById error:', err);
    res.status(500).json({ error: 'Failed to retrieve registration request.' });
  }
};

// ─── POST /api/crew/requests/:id/approve ──────────────────────────────────────
const approveRequest = async (req, res) => {
  await ensureRequestsTable();
  const { id } = req.params;
  const { crew_rank, paye_withholding_rate } = req.body;

  if (!crew_rank) {
    return res.status(400).json({ error: 'Crew rank is required to approve registration.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM crew_registration_requests WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Registration request not found.' });
    }

    const request = rows[0];
    if (request.status === 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This registration request has already been approved.' });
    }

    // Generate unique CSC-XXXX number
    const crew_number = await generateCrewNumber();

    // Default rate if not provided: 20% for PAYE, 0% for self_employed
    const withholdingRate = paye_withholding_rate !== undefined
      ? parseFloat(paye_withholding_rate)
      : (request.employment_status === 'paye' ? 20.00 : 0.00);

    // Insert into crew_members
    // Notice sensitive fields in request are already encrypted at rest
    const insertSql = `
      INSERT INTO crew_members
        (crew_number, first_name, last_name, date_of_birth, home_address, email,
         employment_status, crew_trade, crew_rank, paye_withholding_rate,
         company_name, company_registration_number, vat_registration_number, company_utr,
         account_name, account_number, sort_code,
         emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
         qualifications, is_active)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, true)
      RETURNING *
    `;

    const { rows: memberRows } = await client.query(insertSql, [
      crew_number,
      request.first_name,
      request.last_name,
      request.date_of_birth,
      request.home_address, // already encrypted
      request.email,
      request.employment_status,
      request.crew_trade,
      crew_rank.trim(),
      withholdingRate,
      request.company_name,
      request.company_registration_number,
      request.vat_registration_number,
      request.company_utr,
      request.account_name, // already encrypted
      request.account_number, // already encrypted
      request.sort_code, // already encrypted
      request.emergency_contact_name,
      request.emergency_contact_relationship,
      request.emergency_contact_phone, // already encrypted
      request.qualifications || [],
    ]);

    const createdMember = memberRows[0];

    // Mark request as approved
    await client.query(
      `UPDATE crew_registration_requests
       SET status = 'approved',
           reviewed_by = $1,
           reviewed_at = NOW(),
           created_crew_member_id = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [req.user.id, createdMember.id, id]
    );

    await client.query('COMMIT');

    // Notify candidate via email if email exists
    if (request.email) {
      sendEmail({
        to: request.email,
        ...templates.crewApproved({
          name: `${request.first_name} ${request.last_name}`.trim(),
          crewNumber: crew_number,
          trade: request.crew_trade,
          rank: crew_rank,
          to: request.email,
        }),
      }).catch(err => console.warn('Could not send crew approval email:', err.message));
    }

    res.status(201).json({
      message: 'Candidate approved and added to Crew Database.',
      crew_member: decryptRequest(createdMember),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('approveRequest error:', err);
    res.status(500).json({ error: 'Failed to approve crew request: ' + err.message });
  } finally {
    client.release();
  }
};

// ─── POST /api/crew/requests/:id/reject ───────────────────────────────────────
const rejectRequest = async (req, res) => {
  await ensureRequestsTable();
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const { rows } = await db.query(
      `UPDATE crew_registration_requests
       SET status = 'rejected',
           rejection_reason = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [reason?.trim() || 'Declined by company management', req.user.id, id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Registration request not found.' });
    }

    res.json({
      message: 'Registration request rejected.',
      request: decryptRequest(rows[0]),
    });
  } catch (err) {
    console.error('rejectRequest error:', err);
    res.status(500).json({ error: 'Failed to reject registration request.' });
  }
};

// ─── DELETE /api/crew/requests/:id ───────────────────────────────────────────
const deleteRequest = async (req, res) => {
  await ensureRequestsTable();
  const { id } = req.params;

  try {
    const { rowCount } = await db.query(
      'DELETE FROM crew_registration_requests WHERE id = $1',
      [id]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'Registration request not found.' });
    }

    res.json({ message: 'Registration request deleted successfully.' });
  } catch (err) {
    console.error('deleteRequest error:', err);
    res.status(500).json({ error: 'Failed to delete registration request.' });
  }
};

module.exports = {
  sendInvite,
  listRequests,
  getRequestById,
  approveRequest,
  rejectRequest,
  deleteRequest,
  decryptRequest,
};
