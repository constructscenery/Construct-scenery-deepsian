const db            = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');
const { logAudit }         = require('../services/auditService');

// Fields that are encrypted at rest in crew_members
const ENCRYPTED_FIELDS = new Set([
  'home_address', 'account_name', 'account_number',
  'sort_code', 'emergency_contact_phone',
]);

function encryptCrewFields(data) {
  const out = { ...data };
  for (const field of ENCRYPTED_FIELDS) {
    if (out[field] !== undefined && out[field] !== null) {
      out[field] = encrypt(String(out[field]));
    }
  }
  return out;
}

function decryptCrewMember(row) {
  if (!row) return row;
  const out = { ...row };
  for (const field of ENCRYPTED_FIELDS) {
    if (out[field] !== undefined && out[field] !== null) {
      out[field] = decrypt(out[field]);
    }
  }
  return out;
}

// ─── Trade / rank reference data ──────────────────────────────────────────────
const BECTU_TRADES = {
  Carpenters:          ['HOD', 'Supervisor', 'Chargehand', 'Carpenter', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
  Machinists:          ['HOD', 'Supervisor', 'Chargehand', 'Machinist', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
  Stagehands:          ['HOD', 'Supervisor', 'Chargehand', 'Stagehand NVQ/BLSS', 'Stagehand', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
  Riggers:             ['HOD', 'Supervisor', 'Chargehand', 'Rigger', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
  Plasterers:          ['HOD', 'Supervisor', 'Chargehand', 'Plasterer', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
  'Scenic Painters':   ['HOD', 'Supervisor', 'Chargehand', 'Painter', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
  Sculptors:           ['HOD', 'Supervisor', 'Chargehand', 'Sculptor', 'Sculptor Modeller', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
  'Metal Workers':     ['HOD', 'Supervisor', 'Chargehand', 'Metal Worker', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
  'Plasterers Lab':    ['HOD', 'Supervisor', 'Chargehand', 'Lab Worker', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
  'Painters Lab':      ['HOD', 'Supervisor', 'Chargehand', 'Lab Worker', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
  'Sculptors Lab':     ['HOD', 'Supervisor', 'Chargehand', 'Lab Worker', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
  'Metal Workers Lab': ['HOD', 'Supervisor', 'Chargehand', 'Lab Worker', 'Improver Year 4', 'Apprentice Year 3', 'Apprentice Year 2', 'Apprentice Year 1'],
};
const NON_BECTU_ROLES = [
  'Construction Accountant', 'Construction Coordinator', 'Construction Manager', 'Luton Driver',
  'Production Designer', 'Supervising Art Director', 'Art Director', 'Financial Controller', 'Producer', 'Unit Production Manager', 'Line Producer',
];

const generateCrewNumber = async () => {
  const { rows } = await db.query(
    `SELECT MAX(CAST(SUBSTRING(crew_number FROM 5) AS INTEGER)) AS max_num
     FROM crew_members
     WHERE crew_number ~ '^CSC-[0-9]+$'`
  );
  const maxNum = parseInt(rows[0].max_num, 10) || 0;
  return `CSC-${String(maxNum + 1).padStart(4, '0')}`;
};

// ─── GET /api/crew/trades ─────────────────────────────────────────────────────
const getTrades = (req, res) => {
  res.json({ bectu: BECTU_TRADES, non_bectu: NON_BECTU_ROLES });
};

// ─── GET /api/crew ────────────────────────────────────────────────────────────
const getAllCrew = async (req, res) => {
  try {
    const conditions = [];
    const params     = [];
    let   i          = 1;

    if (req.query.is_archived !== undefined) {
      conditions.push(`(cm.is_archived = $${i++})`);
      params.push(req.query.is_archived === 'true');
    }
    if (req.query.is_active !== undefined) {
      conditions.push(`cm.is_active = $${i++}`);
      params.push(req.query.is_active === 'true');
    }
    if (req.query.employment_status) {
      conditions.push(`cm.employment_status = $${i++}`);
      params.push(req.query.employment_status);
    }
    if (req.query.crew_trade) {
      conditions.push(`cm.crew_trade ILIKE $${i++}`);
      params.push(req.query.crew_trade);
    }
    if (req.query.crew_rank) {
      conditions.push(`cm.crew_rank ILIKE $${i++}`);
      params.push(req.query.crew_rank);
    }
    if (req.query.availability_status) {
      if (req.query.availability_status === 'available') {
        conditions.push(`(
          COALESCE(cm.availability_status, 'available') = 'available'
          AND cm.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM production_crew pc
            JOIN productions p ON pc.production_id = p.id
            WHERE pc.crew_member_id = cm.id AND p.status NOT IN ('archived','complete')
          )
        )`);
      } else if (req.query.availability_status === 'booked') {
        conditions.push(`(
          COALESCE(cm.availability_status, 'available') = 'booked'
          OR (
            COALESCE(cm.availability_status, 'available') != 'unavailable'
            AND EXISTS (
              SELECT 1 FROM production_crew pc
              JOIN productions p ON pc.production_id = p.id
              WHERE pc.crew_member_id = cm.id AND p.status NOT IN ('archived','complete')
            )
          )
        )`);
      } else if (req.query.availability_status === 'unavailable') {
        conditions.push(`(
          cm.is_active = false OR cm.availability_status = 'unavailable'
        )`);
      }
    }
    if (req.query.search) {
      conditions.push(
        `(cm.first_name ILIKE $${i} OR cm.last_name ILIKE $${i} OR cm.crew_number ILIKE $${i} OR cm.crew_trade ILIKE $${i} OR cm.crew_rank ILIKE $${i})`
      );
      params.push(`%${req.query.search}%`);
      i++;
    }
    if (req.query.production_id) {
      conditions.push(
        `EXISTS (SELECT 1 FROM production_crew pc WHERE pc.crew_member_id = cm.id AND pc.production_id = $${i++})`
      );
      params.push(req.query.production_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT cm.id, cm.crew_number, cm.first_name, cm.last_name, cm.email, cm.employment_status,
              cm.crew_trade, cm.crew_rank, cm.company_name, cm.is_active, cm.is_archived,
              COALESCE(
                CASE
                  WHEN cm.is_active = false THEN 'unavailable'
                  WHEN cm.availability_status = 'unavailable' THEN 'unavailable'
                  WHEN cm.availability_status = 'booked' THEN 'booked'
                  WHEN EXISTS (
                    SELECT 1 FROM production_crew pc
                    JOIN productions p ON pc.production_id = p.id
                    WHERE pc.crew_member_id = cm.id AND p.status NOT IN ('archived','complete')
                  ) THEN 'booked'
                  ELSE cm.availability_status
                END,
                'available'
              ) AS availability_status,
              COALESCE(
                (SELECT ARRAY_AGG(p.name ORDER BY p.name)
                 FROM production_crew pc
                 JOIN productions p ON pc.production_id = p.id
                 WHERE pc.crew_member_id = cm.id AND p.status NOT IN ('archived','complete')),
                ARRAY[]::text[]
              ) AS active_productions
       FROM crew_members cm ${where}
       ORDER BY cm.last_name`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('getAllCrew:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/crew ───────────────────────────────────────────────────────────
const createCrewMember = async (req, res) => {
  const {
    first_name, last_name, date_of_birth, home_address, email,
    employment_status, crew_trade, crew_rank, paye_withholding_rate,
    company_name, company_registration_number, vat_registration_number,
    account_name, account_number, sort_code,
    emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
    qualifications, company_utr,
  } = req.body;

  if (!first_name || !last_name || !employment_status || !crew_trade || !crew_rank)
    return res.status(400).json({
      error: 'first_name, last_name, employment_status, crew_trade, and crew_rank are required',
    });

  try {
    const crew_number = await generateCrewNumber();
    const { rows } = await db.query(
      `INSERT INTO crew_members
         (crew_number, first_name, last_name, date_of_birth, home_address, email,
          employment_status, crew_trade, crew_rank, paye_withholding_rate,
          company_name, company_registration_number, vat_registration_number,
          account_name, account_number, sort_code,
          emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
          qualifications, company_utr,
          is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,true)
       RETURNING *`,
      [
        crew_number, first_name, last_name, date_of_birth || null,
        encrypt(home_address) || null,
        email || null,
        employment_status, crew_trade, crew_rank,
        parseFloat(paye_withholding_rate || 0),
        company_name, company_registration_number, vat_registration_number,
        encrypt(account_name) || null,
        encrypt(account_number) || null,
        encrypt(sort_code) || null,
        emergency_contact_name, emergency_contact_relationship,
        encrypt(emergency_contact_phone) || null,
        qualifications || [],
        company_utr || null,
      ]
    );
    res.status(201).json(decryptCrewMember(rows[0]));
  } catch (err) {
    console.error('createCrewMember:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/crew/:id ────────────────────────────────────────────────────────
const getCrewById = async (req, res) => {
  try {
    const { rows: [member] } = await db.query(
      'SELECT * FROM crew_members WHERE id = $1',
      [req.params.id]
    );
    if (!member) return res.status(404).json({ error: 'Crew member not found' });

    // Bank details visible to all roles
    const canSeeBankDetails = ['construction_coordinator', 'construction_accountant', 'managing_director'].includes(req.user?.role);
    if (!canSeeBankDetails) {
      delete member.account_name;
      delete member.account_number;
      delete member.sort_code;
    }

    const [{ rows: productionHistory }, { rows: timesheetHistory }, { rows: documents }] =
      await Promise.all([
        db.query(
          `SELECT pc.*, p.id AS prod_id, p.name AS prod_name, p.status AS prod_status
           FROM   production_crew pc
           JOIN   productions p ON pc.production_id = p.id
           WHERE  pc.crew_member_id = $1
           ORDER BY pc.start_date DESC`,
          [req.params.id]
        ),
        db.query(
          `SELECT t.id, t.week_ending_date, t.status, t.grand_total, p.id AS prod_id, p.name AS prod_name
           FROM   timesheets t
           JOIN   productions p ON t.production_id = p.id
           WHERE  t.crew_member_id = $1
           ORDER BY t.week_ending_date DESC`,
          [req.params.id]
        ),
        db.query(
          `SELECT cd.*, p.name AS production_name
           FROM crew_documents cd
           LEFT JOIN productions p ON cd.production_id = p.id
           WHERE cd.crew_member_id = $1
           ORDER BY cd.uploaded_at DESC`,
          [req.params.id]
        ),
      ]);

    res.json({
      ...decryptCrewMember(member),
      production_history:  productionHistory,
      timesheet_history:   timesheetHistory,
      documents,
    });
  } catch (err) {
    console.error('getCrewById:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PUT /api/crew/:id ────────────────────────────────────────────────────────
const updateCrewMember = async (req, res) => {
  const allowed = [
    'first_name', 'last_name', 'date_of_birth', 'home_address', 'email',
    'employment_status', 'crew_trade', 'crew_rank', 'paye_withholding_rate',
    'company_name', 'company_registration_number', 'vat_registration_number',
    'account_name', 'account_number', 'sort_code',
    'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone',
    'qualifications', 'company_utr',
    'is_active',
    'availability_status',
  ];
  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  if (!Object.keys(updates).length)
    return res.status(400).json({ error: 'No updatable fields provided' });

  // Encrypt sensitive fields before building the query
  const encryptedUpdates = encryptCrewFields(updates);

  const fields    = Object.keys(encryptedUpdates);
  const values    = Object.values(encryptedUpdates);
  const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

  try {
    const { rows } = await db.query(
      `UPDATE crew_members SET ${setClause} WHERE id = $${fields.length + 1} RETURNING *`,
      [...values, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Crew member not found' });
    res.json(decryptCrewMember(rows[0]));
  } catch (err) {
    console.error('updateCrewMember:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PATCH /api/crew/:id/availability ─────────────────────────────────────────
const updateAvailability = async (req, res) => {
  const { availability_status } = req.body;
  const valid = ['available', 'booked', 'unavailable'];
  if (!valid.includes(availability_status)) {
    return res.status(400).json({ error: `availability_status must be one of: ${valid.join(', ')}` });
  }

  try {
    const { rows } = await db.query(
      `UPDATE crew_members SET availability_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [availability_status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Crew member not found' });
    res.json(decryptCrewMember(rows[0]));
  } catch (err) {
    console.error('updateAvailability:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/crew/:id/documents ─────────────────────────────────────────────
const addDocument = async (req, res) => {
  const fileStorage = require('../services/fileStorage');
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const { context_type, production_id } = req.body;
  const validContextTypes = ['crew_identity', 'crew_contract'];
  if (!context_type || !validContextTypes.includes(context_type))
    return res.status(400).json({ error: `context_type must be one of: ${validContextTypes.join(', ')}` });
  if (context_type === 'crew_contract' && !production_id)
    return res.status(400).json({ error: 'production_id is required for crew_contract documents' });

  try {
    fileStorage.validate(req.file.mimetype, req.file.size);
    const { url, key, size } = await fileStorage.store(req.file);

    const docType = context_type === 'crew_contract' ? 'contract' : 'government_id';

    const { rows } = await db.query(
      `INSERT INTO crew_documents
         (crew_member_id, document_type, context_type, production_id, file_url, file_key, file_name, file_size, file_mime_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        req.params.id, docType, context_type,
        context_type === 'crew_contract' ? production_id : null,
        url, key, req.file.originalname, size, req.file.mimetype,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
};

// ─── DELETE /api/crew/:id/documents/:docId ────────────────────────────────────
const deleteDocument = async (req, res) => {
  const fileStorage = require('../services/fileStorage');

  // All roles can delete crew documents
  try {
    const { rows: [doc] } = await db.query(
      'SELECT * FROM crew_documents WHERE id = $1 AND crew_member_id = $2',
      [req.params.docId, req.params.id]
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Delete file from storage
    await fileStorage.deleteFile(doc.file_key ?? doc.file_name).catch(e =>
      console.error('fileStorage.deleteFile non-fatal:', e.message)
    );

    await db.query('DELETE FROM crew_documents WHERE id = $1', [req.params.docId]);

    // Get crew member name for audit log
    const { rows: [cm] } = await db.query('SELECT first_name, last_name FROM crew_members WHERE id = $1', [req.params.id]);
    await db.query(
      `INSERT INTO audit_log (user_id, action, metadata) VALUES ($1, 'crew_document_deleted', $2)`,
      [req.user.id, JSON.stringify({
        crew_member:   cm ? `${cm.first_name} ${cm.last_name}` : req.params.id,
        document_type: doc.context_type ?? doc.document_type,
        file_name:     doc.file_name,
        production_id: doc.production_id ?? null,
      })]
    );

    res.json({ message: 'Document deleted' });
  } catch (err) {
    console.error('deleteDocument:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/crew/:id/productions ──────────────────────────────────────────
const linkToProduction = async (req, res) => {
  const { production_id, start_date, end_date, contract_url } = req.body;
  if (!production_id)
    return res.status(400).json({ error: 'production_id is required' });

  try {
    const { rows } = await db.query(
      `INSERT INTO production_crew (crew_member_id, production_id, start_date, end_date, contract_url)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [req.params.id, production_id, start_date, end_date, contract_url]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── DELETE /api/crew/:id (Soft-Delete / Archive OR Permanent Delete) ────────
const deleteCrewMember = async (req, res) => {
  const isPermanent = req.query.permanent === 'true';
  try {
    const { rows: [member] } = await db.query(
      'SELECT id, first_name, last_name, is_active FROM crew_members WHERE id = $1',
      [req.params.id]
    );
    if (!member) return res.status(404).json({ error: 'Crew member not found' });

    if (isPermanent) {
      // Check if crew member has timesheets
      const { rows: [{ tsCount }] } = await db.query(
        'SELECT COUNT(*)::int AS "tsCount" FROM timesheets WHERE crew_member_id = $1',
        [req.params.id]
      );
      if (tsCount > 0) {
        return res.status(409).json({
          error: `Cannot permanently delete ${member.first_name} ${member.last_name} because they have ${tsCount} associated timesheet(s). Please keep them archived to preserve payroll history.`
        });
      }

      // Check if crew member has pay run items
      const { rows: [{ payCount }] } = await db.query(
        'SELECT COUNT(*)::int AS "payCount" FROM pay_run_items WHERE crew_member_id = $1',
        [req.params.id]
      );
      if (payCount > 0) {
        return res.status(409).json({
          error: `Cannot permanently delete ${member.first_name} ${member.last_name} because they have ${payCount} associated pay run item(s).`
        });
      }

      // Permanent deletion (crew_documents and production_crew cascade delete)
      await db.query('DELETE FROM crew_members WHERE id = $1', [req.params.id]);

      try {
        await logAudit({
          userId: req.user?.id,
          userName: req.user?.full_name,
          userRole: req.user?.role,
          category: 'payroll',
          action: 'crew_permanently_deleted',
          entityType: 'crew_member',
          entityId: req.params.id,
          details: `Permanently deleted crew member ${member.first_name} ${member.last_name}`,
          metadata: { member_id: req.params.id, first_name: member.first_name, last_name: member.last_name },
        });
      } catch (auditErr) {
        console.error('Audit log failed for crew permanent delete:', auditErr);
      }

      return res.json({
        message: `${member.first_name} ${member.last_name} has been permanently deleted from the database.`,
        permanently_deleted: true,
      });
    }

    // Soft delete / archive
    await db.query(
      'UPDATE crew_members SET is_active = false, is_archived = true, deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    res.json({
      message: `${member.first_name} ${member.last_name} has been archived successfully.`,
      soft_deleted: true,
    });
  } catch (err) {
    console.error('deleteCrewMember:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PATCH /api/crew/:id/restore ──────────────────────────────────────────────
const restoreCrewMember = async (req, res) => {
  try {
    const { rows: [member] } = await db.query(
      'UPDATE crew_members SET is_active = true, is_archived = false, deleted_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING id, first_name, last_name',
      [req.params.id]
    );
    if (!member) return res.status(404).json({ error: 'Crew member not found' });
    res.json({
      message: `${member.first_name} ${member.last_name} has been restored successfully.`,
      member,
    });
  } catch (err) {
    console.error('restoreCrewMember:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── Crew CSV bulk import ─────────────────────────────────────────────────────

const csvParse = require('csv-parse/sync');

const IMPORT_TEMPLATE_HEADER = [
  'First Name', 'Last Name', 'Email', 'Date of Birth', 'Home Address', 'Employment Status',
  'Crew Trade', 'Crew Rank', 'PAYE Withholding Rate', 'Company/Business Name',
  'Company Registration Number or UTR', 'VAT Registration Number',
  'Account Name', 'Account Number', 'Sort Code',
  'Emergency Contact Name', 'Emergency Contact Relationship', 'Emergency Contact Phone',
].join(',') + '\r\n';

const VALID_EMPLOYMENT_STATUSES = new Set(['paye', 'self_employed']);

// Maps CSV "Employment Status" values to DB values
const normaliseEmploymentStatus = (v) => {
  const l = String(v || '').toLowerCase().trim();
  if (l === 'paye')           return 'paye';
  if (l === 'self-employed' || l === 'self employed') return 'self_employed';
  return null;
};

// Validate a single CSV row — returns array of error strings (empty = valid)
const validateImportRow = (row, idx, knownTrades, knownRanks) => {
  const errors = [];
  const rowNum = idx + 2;
  if (!row['First Name']?.trim())        errors.push(`Row ${rowNum}: First Name is required`);
  if (!row['Last Name']?.trim())         errors.push(`Row ${rowNum}: Last Name is required`);
  if (!row['Employment Status']?.trim()) errors.push(`Row ${rowNum}: Employment Status is required`);
  else if (!normaliseEmploymentStatus(row['Employment Status']))
    errors.push(`Row ${rowNum}: Employment Status must be "PAYE" or "Self-Employed"`);
  if (!row['Crew Trade']?.trim())  errors.push(`Row ${rowNum}: Crew Trade is required`);
  if (!row['Crew Rank']?.trim())   errors.push(`Row ${rowNum}: Crew Rank is required`);
  else if (knownTrades && !knownTrades.has(row['Crew Trade']?.trim()))
    errors.push(`Row ${rowNum}: Crew Trade "${row['Crew Trade']?.trim()}" is not in the BECTU/non-BECTU rate card`);
  return errors;
};

// GET /api/crew/import/template
const getImportTemplate = (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="crew_import_template.csv"');
  res.send(IMPORT_TEMPLATE_HEADER);
};

// POST /api/crew/import/preview — validate CSV, return per-row results. No DB writes.
const previewImport = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file provided' });

  let records;
  try {
    records = csvParse.parse(req.file.buffer.toString(), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` });
  }
  if (!records.length) return res.status(400).json({ error: 'CSV is empty' });

  // Load known trades from BECTU rate card
  const { rows: rateRows } = await db.query('SELECT DISTINCT trade FROM bectu_rates WHERE effective_to IS NULL');
  const knownTrades = new Set(rateRows.map(r => r.trade));

  // Check duplicates in DB (First Name + Last Name + Date of Birth)
  const { rows: existingCrew } = await db.query(
    `SELECT LOWER(first_name) || '|' || LOWER(last_name) || '|' || COALESCE(date_of_birth::text,'') AS key
     FROM crew_members WHERE is_active = true`
  );
  const existingSet = new Set(existingCrew.map(r => r.key));

  const preview = records.map((row, idx) => {
    const errors = validateImportRow(row, idx, knownTrades, null);
    const dob = row['Date of Birth']?.trim() || '';
    const dupKey = `${row['First Name']?.trim().toLowerCase()}|${row['Last Name']?.trim().toLowerCase()}|${dob}`;
    const isDuplicate = existingSet.has(dupKey);
    if (isDuplicate) errors.push(`Potential duplicate: crew member with same name & DOB already exists`);

    return {
      row:       idx + 2,
      first_name: row['First Name']?.trim(),
      last_name:  row['Last Name']?.trim(),
      crew_trade: row['Crew Trade']?.trim(),
      crew_rank:  row['Crew Rank']?.trim(),
      employment_status: normaliseEmploymentStatus(row['Employment Status']),
      is_duplicate: isDuplicate,
      errors,
      valid: errors.length === 0,
    };
  });

  res.json({
    total_rows:   preview.length,
    valid_rows:   preview.filter(r => r.valid).length,
    invalid_rows: preview.filter(r => !r.valid).length,
    preview,
  });
};

// POST /api/crew/import — commit valid rows. Invalid + duplicate rows are skipped.
const importCSV = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file provided' });

  let records;
  try {
    records = csvParse.parse(req.file.buffer.toString(), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: `CSV parse error: ${e.message}` });
  }
  if (!records.length) return res.status(400).json({ error: 'CSV is empty' });

  const { rows: rateRows } = await db.query('SELECT DISTINCT trade FROM bectu_rates WHERE effective_to IS NULL');
  const knownTrades = new Set(rateRows.map(r => r.trade));

  const { rows: existingCrew } = await db.query(
    `SELECT email, account_number FROM crew_members WHERE is_active = true`
  );
  const existingEmails     = new Set(
    existingCrew.map(r => r.email?.toLowerCase()).filter(Boolean)
  );
  const existingAccNumbers = new Set(
    existingCrew
      .map(r => { try { return r.account_number ? decrypt(r.account_number) : null; } catch { return null; } })
      .filter(Boolean)
  );

  const created = [];
  const skipped = [];

  for (let idx = 0; idx < records.length; idx++) {
    const row            = records[idx];
    const errors         = validateImportRow(row, idx, knownTrades, null);
    const dob            = row['Date of Birth']?.trim() || '';
    const rowEmail       = row['Email']?.trim().toLowerCase() || '';
    const rowAccNumber   = row['Account Number']?.trim() || '';

    const isDupEmail     = rowEmail && existingEmails.has(rowEmail);
    const isDupAccNumber = rowAccNumber && existingAccNumbers.has(rowAccNumber);
    if (isDupEmail || isDupAccNumber) {
      const dupFields = [isDupEmail ? 'email' : null, isDupAccNumber ? 'account number' : null].filter(Boolean).join(' & ');
      skipped.push({ row: idx + 2, first_name: row['First Name']?.trim(), last_name: row['Last Name']?.trim(), reason: `Duplicate (${dupFields} already exists)` });
      continue;
    }
    if (errors.length) {
      skipped.push({ row: idx + 2, first_name: row['First Name']?.trim(), last_name: row['Last Name']?.trim(), reason: errors.join('; ') });
      continue;
    }

    try {
      const crew_number = await generateCrewNumber();
      await db.query(
        `INSERT INTO crew_members
           (crew_number, first_name, last_name, email, date_of_birth, home_address,
            employment_status, crew_trade, crew_rank, paye_withholding_rate,
            company_name, company_registration_number, vat_registration_number,
            account_name, account_number, sort_code,
            emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
            is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,true)`,
        [
          crew_number,
          row['First Name']?.trim(),
          row['Last Name']?.trim(),
          row['Email']?.trim() || null,
          dob || null,
          row['Home Address']?.trim() ? encrypt(row['Home Address'].trim()) : null,
          normaliseEmploymentStatus(row['Employment Status']),
          row['Crew Trade']?.trim(),
          row['Crew Rank']?.trim(),
          parseFloat(row['PAYE Withholding Rate'] || 0),
          row['Company/Business Name']?.trim() || null,
          row['Company Registration Number or UTR']?.trim() || null,
          row['VAT Registration Number']?.trim() || null,
          row['Account Name']?.trim() ? encrypt(row['Account Name'].trim()) : null,
          row['Account Number']?.trim() ? encrypt(row['Account Number'].trim()) : null,
          row['Sort Code']?.trim() ? encrypt(row['Sort Code'].trim()) : null,
          row['Emergency Contact Name']?.trim() || null,
          row['Emergency Contact Relationship']?.trim() || null,
          row['Emergency Contact Phone']?.trim() ? encrypt(row['Emergency Contact Phone'].trim()) : null,
        ]
      );
      created.push({ row: idx + 2, crew_number, first_name: row['First Name']?.trim(), last_name: row['Last Name']?.trim() });
      // prevent in-batch duplicates for subsequent rows
      if (rowEmail)     existingEmails.add(rowEmail);
      if (rowAccNumber) existingAccNumbers.add(rowAccNumber);
    } catch (err) {
      skipped.push({ row: idx + 2, first_name: row['First Name']?.trim(), last_name: row['Last Name']?.trim(), reason: `DB error: ${err.message}` });
    }
  }

  res.status(201).json({
    total_rows:  records.length,
    created:     created.length,
    skipped:     skipped.length,
    created_records: created,
    skipped_records: skipped,
  });
};

// ─── GET /api/crew/:id/earnings-report ────────────────────────────────────────
const getCrewEarningsReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, end_date, production_id, status } = req.query;

    const { rows: [member] } = await db.query(
      `SELECT id, crew_number, first_name, last_name, email, employment_status, crew_trade, crew_rank, company_name
       FROM crew_members
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!member) return res.status(404).json({ error: 'Crew member not found' });

    const decrypted = decryptCrewMember(member);

    const conds = ['t.crew_member_id = $1'];
    const params = [id];
    let pIdx = 2;

    if (start_date) {
      conds.push(`t.week_ending_date >= $${pIdx++}::date`);
      params.push(start_date);
    }
    if (end_date) {
      conds.push(`t.week_ending_date <= $${pIdx++}::date`);
      params.push(end_date);
    }
    if (production_id) {
      conds.push(`t.production_id = $${pIdx++}::uuid`);
      params.push(production_id);
    }
    if (status && status !== 'all') {
      conds.push(`t.status = $${pIdx++}`);
      params.push(status);
    }

    const { rows: timesheets } = await db.query(
      `SELECT
         t.id AS timesheet_id,
         t.week_ending_date,
         t.status,
         t.weekly_rate,
         t.sixth_day_payment,
         t.seventh_day_payment,
         t.overtime_amount,
         t.meal_allowance_total,
         t.mileage_and_travel,
         t.vat,
         t.gross_total,
         t.grand_total,
         p.id AS production_id,
         p.name AS production_name,
         COUNT(te.id) FILTER (WHERE te.full_day_worked = true) AS days_worked,
         COALESCE(SUM(te.overtime_hours), 0) AS overtime_hours,
         COALESCE(SUM(te.travel), 0) AS travel_amount,
         COALESCE(SUM(te.mileage), 0) AS mileage_amount,
         COALESCE(SUM(te.per_diem), 0) AS per_diem_amount
       FROM timesheets t
       JOIN productions p ON t.production_id = p.id
       LEFT JOIN timesheet_entries te ON te.timesheet_id = t.id
       WHERE ${conds.join(' AND ')}
       GROUP BY t.id, p.id, p.name
       ORDER BY t.week_ending_date DESC`,
      params
    );

    let totalDaysWorked = 0;
    let totalOvertimeHours = 0;
    let totalBasicPay = 0;
    let totalOvertimePay = 0;
    let totalWeekendPay = 0;
    let totalMealAllowances = 0;
    let totalMileageTravel = 0;
    let totalVat = 0;
    let totalGross = 0;
    let grandTotal = 0;

    const formattedWeeks = timesheets.map((ts) => {
      const daysWorked = parseInt(ts.days_worked || 0, 10);
      const otHours = parseFloat(ts.overtime_hours || 0);
      const basicPay = parseFloat(ts.weekly_rate || 0);
      const otPay = parseFloat(ts.overtime_amount || 0);
      const weekendPay = parseFloat(ts.sixth_day_payment || 0) + parseFloat(ts.seventh_day_payment || 0);
      const meals = parseFloat(ts.meal_allowance_total || 0);
      const travelMileage = parseFloat(ts.mileage_and_travel || 0);
      const vat = parseFloat(ts.vat || 0);
      const gross = parseFloat(ts.gross_total || 0);
      const total = parseFloat(ts.grand_total || 0);

      totalDaysWorked += daysWorked;
      totalOvertimeHours += otHours;
      totalBasicPay += basicPay;
      totalOvertimePay += otPay;
      totalWeekendPay += weekendPay;
      totalMealAllowances += meals;
      totalMileageTravel += travelMileage;
      totalVat += vat;
      totalGross += gross;
      grandTotal += total;

      return {
        timesheet_id: ts.timesheet_id,
        week_ending_date: ts.week_ending_date,
        production_id: ts.production_id,
        production_name: ts.production_name,
        status: ts.status,
        days_worked: daysWorked,
        overtime_hours: otHours,
        basic_pay: basicPay,
        overtime_pay: otPay,
        weekend_pay: weekendPay,
        meal_allowance: meals,
        mileage_travel: travelMileage,
        vat,
        gross_total: gross,
        grand_total: total,
      };
    });

    const crewData = {
      id: decrypted.id,
      name: [decrypted.first_name, decrypted.last_name].filter(Boolean).join(' '),
      first_name: decrypted.first_name,
      last_name: decrypted.last_name,
      crew_number: decrypted.crew_number,
      email: decrypted.email,
      employment_status: decrypted.employment_status,
      trade: decrypted.crew_trade,
      rank: decrypted.crew_rank,
      company_name: decrypted.company_name,
    };

    res.json({
      crew_member: crewData,
      crew: crewData,
      period: {
        start_date: start_date || null,
        end_date: end_date || null,
      },
      summary: {
        total_timesheets: timesheets.length,
        timesheet_count: timesheets.length,
        total_days_worked: totalDaysWorked,
        total_overtime_hours: Number(totalOvertimeHours.toFixed(2)),
        total_basic_pay: Number(totalBasicPay.toFixed(2)),
        total_overtime_pay: Number(totalOvertimePay.toFixed(2)),
        total_weekend_pay: Number(totalWeekendPay.toFixed(2)),
        total_meal_allowances: Number(totalMealAllowances.toFixed(2)),
        total_mileage_travel: Number(totalMileageTravel.toFixed(2)),
        total_vat: Number(totalVat.toFixed(2)),
        total_gross: Number(totalGross.toFixed(2)),
        grand_total: Number(grandTotal.toFixed(2)),
      },
      weeks: formattedWeeks,
      breakdown: formattedWeeks,
    });
  } catch (err) {
    console.error('getCrewEarningsReport error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/crew/:id/earnings-report/send ──────────────────────────────────
const sendCrewEarningsReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, end_date, production_id, status, recipient_email, notes } = req.body || {};

    const { rows: [member] } = await db.query(
      `SELECT id, crew_number, first_name, last_name, email, employment_status, crew_trade, crew_rank, company_name
       FROM crew_members
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!member) return res.status(404).json({ error: 'Crew member not found' });

    const decrypted = decryptCrewMember(member);
    const targetEmail = (recipient_email || decrypted.email || '').trim();
    if (!targetEmail) {
      return res.status(400).json({ error: 'No recipient email address specified or on file for this crew member.' });
    }

    const conds = ['t.crew_member_id = $1'];
    const params = [id];
    let pIdx = 2;

    if (start_date) {
      conds.push(`t.week_ending_date >= $${pIdx++}::date`);
      params.push(start_date);
    }
    if (end_date) {
      conds.push(`t.week_ending_date <= $${pIdx++}::date`);
      params.push(end_date);
    }
    if (production_id) {
      conds.push(`t.production_id = $${pIdx++}::uuid`);
      params.push(production_id);
    }
    if (status && status !== 'all') {
      conds.push(`t.status = $${pIdx++}`);
      params.push(status);
    }

    const { rows: timesheets } = await db.query(
      `SELECT
         t.id AS timesheet_id,
         t.week_ending_date,
         t.status,
         t.weekly_rate,
         t.sixth_day_payment,
         t.seventh_day_payment,
         t.overtime_amount,
         t.meal_allowance_total,
         t.mileage_and_travel,
         t.vat,
         t.gross_total,
         t.grand_total,
         p.name AS production_name,
         COUNT(te.id) FILTER (WHERE te.full_day_worked = true) AS days_worked,
         COALESCE(SUM(te.overtime_hours), 0) AS overtime_hours
       FROM timesheets t
       JOIN productions p ON t.production_id = p.id
       LEFT JOIN timesheet_entries te ON te.timesheet_id = t.id
       WHERE ${conds.join(' AND ')}
       GROUP BY t.id, p.id, p.name
       ORDER BY t.week_ending_date DESC`,
      params
    );

    let totalDaysWorked = 0;
    let totalOvertimeHours = 0;
    let totalGross = 0;
    let grandTotal = 0;

    const rowsHtml = timesheets.map((ts) => {
      const daysWorked = parseInt(ts.days_worked || 0, 10);
      const otHours = parseFloat(ts.overtime_hours || 0);
      const gross = parseFloat(ts.gross_total || 0);
      const total = parseFloat(ts.grand_total || 0);
      totalDaysWorked += daysWorked;
      totalOvertimeHours += otHours;
      totalGross += gross;
      grandTotal += total;

      const dateStr = ts.week_ending_date ? new Date(ts.week_ending_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155">${dateStr}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155">${ts.production_name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;color:#334155">${daysWorked}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;color:#334155">${otHours > 0 ? otHours + 'h' : '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;font-weight:600;color:#0f172a">£${total.toFixed(2)}</td>
      </tr>`;
    }).join('\n');

    const periodStr = start_date && end_date
      ? `${new Date(start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} to ${new Date(end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : 'All Available Timesheets';

    const subject = `Construct Scenery — Earnings Statement (${decrypted.first_name} ${decrypted.last_name})`;

    const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#ffffff">
      <div style="background:#0f172a;padding:20px 24px">
        <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:1px">Construct Scenery</span>
        <span style="color:#94a3b8;font-size:12px;margin-left:12px">Construct Scenery Limited</span>
      </div>
      <div style="padding:28px 24px">
        <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a;font-weight:700">Earnings Summary Statement</h2>
        <p style="margin:0 0 18px;font-size:13px;color:#64748b">Period: <strong>${periodStr}</strong></p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;margin-bottom:22px">
          <p style="margin:0 0 6px;font-size:13px;color:#334155"><strong>Crew Member:</strong> ${decrypted.first_name} ${decrypted.last_name} (${decrypted.crew_number || '—'})</p>
          <p style="margin:0 0 6px;font-size:13px;color:#334155"><strong>Trade / Role:</strong> ${decrypted.crew_trade || 'Crew'}${decrypted.crew_rank ? ` — ${decrypted.crew_rank}` : ''}</p>
          <p style="margin:0;font-size:13px;color:#334155"><strong>Employment Status:</strong> ${decrypted.employment_status === 'self_employed' ? 'Self-Employed' : 'PAYE'}</p>
        </div>

        ${notes ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#1e40af"><strong>Note from office:</strong> ${notes.replace(/</g, '&lt;')}</div>` : ''}

        <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-bottom:20px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
          <thead>
            <tr style="background:#f1f5f9;text-align:left;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.5px">
              <th style="padding:10px 12px;border-bottom:2px solid #cbd5e1">Week Ending</th>
              <th style="padding:10px 12px;border-bottom:2px solid #cbd5e1">Production</th>
              <th style="padding:10px 12px;border-bottom:2px solid #cbd5e1;text-align:center">Days</th>
              <th style="padding:10px 12px;border-bottom:2px solid #cbd5e1;text-align:center">OT</th>
              <th style="padding:10px 12px;border-bottom:2px solid #cbd5e1;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml.length > 0 ? rowsHtml : '<tr><td colspan="5" style="padding:20px;text-align:center;color:#94a3b8;font-size:13px">No timesheets recorded for this period.</td></tr>'}
          </tbody>
          <tfoot>
            <tr style="background:#f8fafc;font-weight:700;color:#0f172a">
              <td style="padding:12px;border-top:2px solid #cbd5e1" colspan="2">TOTALS (${timesheets.length} weeks)</td>
              <td style="padding:12px;border-top:2px solid #cbd5e1;text-align:center">${totalDaysWorked}</td>
              <td style="padding:12px;border-top:2px solid #cbd5e1;text-align:center">${totalOvertimeHours > 0 ? totalOvertimeHours + 'h' : '0'}</td>
              <td style="padding:12px;border-top:2px solid #cbd5e1;text-align:right;font-size:15px;color:#2563eb">£${grandTotal.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        <p style="font-size:12px;color:#64748b;line-height:1.5;margin:20px 0 0">
          This earnings statement has been generated from verified Construct Scenery timesheets. For any queries regarding this breakdown, please reply to this email or contact the accounts team.
        </p>
      </div>
      <div style="background:#f8fafc;padding:14px 24px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center">
        Construct Scenery Limited · Unit 4C Canal Wharf, Station Road, Langley, SL3 6EG
      </div>
    </div>`;

    const text = `Construct Scenery — Earnings Statement
Crew Member: ${decrypted.first_name} ${decrypted.last_name} (${decrypted.crew_number})
Period: ${periodStr}

Total Timesheets: ${timesheets.length}
Total Days Worked: ${totalDaysWorked}
Total Overtime Hours: ${totalOvertimeHours}
Grand Total Earnings: £${grandTotal.toFixed(2)}

Construct Scenery Limited · Unit 4C Canal Wharf, Station Road, Langley, SL3 6EG`;

    const ses = require('../services/emailing/sesSender');
    let emailResult = null;
    try {
      emailResult = await ses.sendEmail({
        fromName: 'Construct Scenery Accounts',
        to: targetEmail,
        subject,
        html,
        text,
      });
    } catch (sendErr) {
      console.warn('SES send warning in sendCrewEarningsReport:', sendErr.message);
    }

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'crew',
      action: 'crew_earnings_report_sent',
      entityType: 'crew_members',
      entityId: id,
      details: `Sent earnings statement for ${decrypted.first_name} ${decrypted.last_name} (${periodStr}) to ${targetEmail}`,
      metadata: { target_email: targetEmail, start_date, end_date, grand_total: grandTotal },
    });

    res.json({
      success: true,
      recipient_email: targetEmail,
      message_id: emailResult?.messageId || null,
      summary: {
        total_timesheets: timesheets.length,
        total_days_worked: totalDaysWorked,
        grand_total: Number(grandTotal.toFixed(2)),
      },
    });
  } catch (err) {
    console.error('sendCrewEarningsReport error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getTrades, getAllCrew, createCrewMember, getCrewById, updateCrewMember, updateAvailability,
  deleteCrewMember, restoreCrewMember, addDocument, deleteDocument, linkToProduction,
  getImportTemplate, previewImport, importCSV,
  getCrewEarningsReport, sendCrewEarningsReport,
};
