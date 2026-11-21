const db = require('../config/db');
const csvParse = require('csv-parse/sync');
const { logAudit } = require('../services/auditService');

/**
 * CS-03 — set codes.
 *
 *   GET    /api/set-codes?production_id=           production sets + active universal codes (dropdown source, CS-04)
 *   GET    /api/universal-set-codes                universal codes (?include_inactive=true for Settings)
 *   POST   /api/universal-set-codes                { code, name }
 *   PATCH  /api/universal-set-codes/:id            { code?, name?, is_active? }   (deactivate, never delete)
 *   POST   /api/universal-set-codes/import         CSV: code, name
 *   GET    /api/productions/sets/import/template   CSV template
 *   POST   /api/productions/:id/sets/import/preview
 *   POST   /api/productions/:id/sets/import
 *
 * Set codes are matched to timesheet_entries.set_number and purchase_orders.set_code by trimmed,
 * case-insensitive text (ADR-02). Importing never deletes sets that are not in the file.
 */

const SET_COMPLETION_STATUSES = ['not_started', 'in_progress', 'nearing_completion', 'complete', 'handed_over']; // SetCompletionStatus
const SET_CODE_CATEGORY_MANAGEMENT = 'management'; // SetCodeCategory.MANAGEMENT
const MAX_IMPORT_ROWS = 2000;

const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const norm = v => String(v ?? '').trim().toLowerCase();

/** CSV cells: trim, and strip a leading formula character so values can't execute when re-exported to Excel. */
const cleanCell = v => {
  const s = String(v ?? '').trim();
  return /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? s.replace(/^[=+\-@]+/, '').trim() : s;
};

/** YYYY-MM-DD or DD/MM/YYYY → YYYY-MM-DD; '' → null; invalid → undefined. */
const parseDate = raw => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let y, m, d;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) [, y, m, d] = match;
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [, d, m, y] = match;
  else return undefined;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : undefined;
};

/** Parse CSV; header names are normalised ("Set Number" → "set_number") so either style works. */
const parseCsv = buffer => csvParse.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''), {
  columns: true,
  skip_empty_lines: true,
  trim: true,
  relax_column_count: true,
}).map(record => Object.fromEntries(
  Object.entries(record).map(([k, v]) => [String(k).trim().toLowerCase().replace(/\s+/g, '_'), v])
));

// ─── GET /api/set-codes?production_id= ────────────────────────────────────────
const getSetCodes = async (req, res) => {
  const { production_id: productionId } = req.query;
  if (productionId && !validId(productionId)) return res.status(400).json({ error: 'Invalid production ID' });
  try {
    const [{ rows: sets }, { rows: universal }] = await Promise.all([
      productionId
        ? db.query(
          `SELECT set_number, set_name FROM sets
           WHERE production_id = $1 AND set_number IS NOT NULL AND TRIM(set_number) <> ''
           ORDER BY set_number`,
          [productionId]
        )
        : Promise.resolve({ rows: [] }),
      db.query(
        `SELECT code, name, category FROM universal_set_codes WHERE is_active = TRUE ORDER BY code`
      ),
    ]);
    const seen = new Set();
    const out = [];
    for (const s of sets) {
      const key = norm(s.set_number);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ code: String(s.set_number).trim(), name: s.set_name, source: 'production', category: 'production' });
    }
    for (const u of universal) {
      const key = norm(u.code);
      if (seen.has(key)) continue; // a production's own set wins over a universal code with the same text
      seen.add(key);
      out.push({ code: String(u.code).trim(), name: u.name, source: 'universal', category: u.category });
    }
    res.json(out);
  } catch (err) {
    console.error('getSetCodes:', err);
    res.status(500).json({ error: 'Unable to load set codes' });
  }
};

// ─── Universal set codes ──────────────────────────────────────────────────────
const listUniversal = async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const { rows } = await db.query(
      `SELECT id, code, name, category, is_active, created_at, updated_at
       FROM universal_set_codes
       ${includeInactive ? '' : 'WHERE is_active = TRUE'}
       ORDER BY is_active DESC, code`
    );
    res.json(rows);
  } catch (err) {
    console.error('listUniversal:', err);
    res.status(500).json({ error: 'Unable to load universal set codes' });
  }
};

const DUPLICATE_CODE = 'A universal set code with this code already exists.';

const createUniversal = async (req, res) => {
  const code = cleanCell(req.body?.code);
  const name = cleanCell(req.body?.name);
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
  if (code.length > 50) return res.status(400).json({ error: 'code must be 50 characters or fewer' });
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO universal_set_codes (code, name, category, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, code, name, category, is_active, created_at, updated_at`,
      [code, name, SET_CODE_CATEGORY_MANAGEMENT, req.user.id]
    );
    await logAudit({
      userId: req.user.id, userName: req.user.full_name, userRole: req.user.role,
      category: 'general', action: 'universal_set_code_created', entityType: 'universal_set_code', entityId: row.id,
      details: `Added universal set code ${code} — ${name}`,
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: DUPLICATE_CODE });
    console.error('createUniversal:', err);
    res.status(500).json({ error: 'Unable to create universal set code' });
  }
};

const updateUniversal = async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const updates = {};
  if (req.body?.code !== undefined) updates.code = cleanCell(req.body.code);
  if (req.body?.name !== undefined) updates.name = cleanCell(req.body.name);
  if (req.body?.is_active !== undefined) {
    if (typeof req.body.is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be true or false' });
    updates.is_active = req.body.is_active;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No updatable fields provided' });
  if (updates.code === '' || updates.name === '') return res.status(400).json({ error: 'code and name cannot be blank' });
  if (updates.code && updates.code.length > 50) return res.status(400).json({ error: 'code must be 50 characters or fewer' });

  const fields = Object.keys(updates);
  const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  try {
    const { rows: [row] } = await db.query(
      `UPDATE universal_set_codes SET ${setClause}, updated_at = NOW()
       WHERE id = $${fields.length + 1}
       RETURNING id, code, name, category, is_active, created_at, updated_at`,
      [...Object.values(updates), req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Universal set code not found' });
    await logAudit({
      userId: req.user.id, userName: req.user.full_name, userRole: req.user.role,
      category: 'general', action: 'universal_set_code_updated', entityType: 'universal_set_code', entityId: row.id,
      details: `Updated universal set code ${row.code}`, metadata: updates,
    });
    res.json(row);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: DUPLICATE_CODE });
    console.error('updateUniversal:', err);
    res.status(500).json({ error: 'Unable to update universal set code' });
  }
};

/** CSV: code, name. Existing codes get their name updated (and are re-activated); new codes are added. */
const importUniversal = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
  let records;
  try { records = parseCsv(req.file.buffer); } catch (e) { return res.status(400).json({ error: `Could not read CSV: ${e.message}` }); }
  if (!records.length) return res.status(400).json({ error: 'CSV is empty' });
  if (records.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: `CSV has more than ${MAX_IMPORT_ROWS} rows` });

  const errors = [];
  const rows = [];
  const seen = new Set();
  records.forEach((r, i) => {
    const rowNum = i + 2;
    const code = cleanCell(r.code);
    const name = cleanCell(r.name);
    if (!code || !name) { errors.push({ row: rowNum, error: 'code and name are required' }); return; }
    if (code.length > 50) { errors.push({ row: rowNum, error: 'code must be 50 characters or fewer' }); return; }
    if (seen.has(norm(code))) { errors.push({ row: rowNum, error: `Duplicate code ${code} in file` }); return; }
    seen.add(norm(code));
    rows.push({ code, name });
  });

  const client = await db.connect();
  let created = 0, updated = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const { rows: [existing] } = await client.query(
        'SELECT id FROM universal_set_codes WHERE LOWER(TRIM(code)) = LOWER(TRIM($1)) FOR UPDATE', [r.code]
      );
      if (existing) {
        await client.query('UPDATE universal_set_codes SET name = $1, is_active = TRUE, updated_at = NOW() WHERE id = $2', [r.name, existing.id]);
        updated++;
      } else {
        await client.query(
          'INSERT INTO universal_set_codes (code, name, category, created_by) VALUES ($1, $2, $3, $4)',
          [r.code, r.name, SET_CODE_CATEGORY_MANAGEMENT, req.user.id]
        );
        created++;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('importUniversal:', err);
    return res.status(500).json({ error: 'Unable to import universal set codes' });
  } finally {
    client.release();
  }
  await logAudit({
    userId: req.user.id, userName: req.user.full_name, userRole: req.user.role,
    category: 'general', action: 'universal_set_codes_imported', entityType: 'universal_set_code',
    details: `Imported universal set codes: ${created} added, ${updated} updated, ${errors.length} rows skipped`,
  });
  res.json({ created, updated, errors });
};

// ─── Production set import ────────────────────────────────────────────────────
const SET_TEMPLATE_HEADER = 'set_number,set_name,shoot_week,handover_date,completion_status,notes';

const getSetImportTemplate = (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sets-import-template.csv"');
  res.send(`${SET_TEMPLATE_HEADER}\r\n100,Kitchen,Week 1,2026-12-04,not_started,\r\n101,Hallway,Week 2,11/12/2026,,Paint by Friday\r\n`);
};

/** Validate the CSV and work out what an import would do. */
const buildSetImportPlan = async (productionId, buffer) => {
  let records;
  try { records = parseCsv(buffer); } catch (e) { return { error: `Could not read CSV: ${e.message}` }; }
  if (!records.length) return { error: 'CSV is empty' };
  if (records.length > MAX_IMPORT_ROWS) return { error: `CSV has more than ${MAX_IMPORT_ROWS} rows` };

  const { rows: existing } = await db.query(
    'SELECT id, set_number, set_name FROM sets WHERE production_id = $1 AND set_number IS NOT NULL', [productionId]
  );
  const byKey = new Map(existing.map(s => [norm(s.set_number), s]));

  const seen = new Set();
  const rows = records.map((r, i) => {
    const rowNum = i + 2;
    const errors = [];
    const setNumber = cleanCell(r.set_number);
    const setName = cleanCell(r.set_name);
    const shootWeek = cleanCell(r.shoot_week) || null;
    const notes = cleanCell(r.notes) || null;
    const handover = parseDate(r.handover_date);
    const statusRaw = norm(r.completion_status).replace(/\s+/g, '_');
    if (!setNumber) errors.push('set_number is required');
    if (!setName) errors.push('set_name is required');
    if (handover === undefined) errors.push('handover_date must be YYYY-MM-DD or DD/MM/YYYY');
    if (statusRaw && !SET_COMPLETION_STATUSES.includes(statusRaw))
      errors.push(`completion_status must be one of: ${SET_COMPLETION_STATUSES.join(', ')}`);
    if (setNumber && seen.has(norm(setNumber))) errors.push(`set_number ${setNumber} appears more than once in the file`);
    if (setNumber) seen.add(norm(setNumber));
    const match = setNumber ? byKey.get(norm(setNumber)) : null;
    return {
      row: rowNum,
      valid: errors.length === 0,
      errors,
      action: match ? 'update' : 'create',
      existing_set_id: match?.id ?? null,
      set_number: setNumber,
      set_name: setName,
      shoot_week: shootWeek,
      handover_date: handover ?? null,
      completion_status: statusRaw || null,
      notes,
    };
  });
  return {
    rows,
    summary: {
      total_rows: rows.length,
      create: rows.filter(r => r.valid && r.action === 'create').length,
      update: rows.filter(r => r.valid && r.action === 'update').length,
      invalid: rows.filter(r => !r.valid).length,
    },
  };
};

const previewSetImport = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
  try {
    const plan = await buildSetImportPlan(req.params.id, req.file.buffer);
    if (plan.error) return res.status(400).json({ error: plan.error });
    res.json(plan);
  } catch (err) {
    console.error('previewSetImport:', err);
    res.status(500).json({ error: 'Unable to preview set import' });
  }
};

const importSets = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
  let plan;
  try {
    plan = await buildSetImportPlan(req.params.id, req.file.buffer);
  } catch (err) {
    console.error('importSets plan:', err);
    return res.status(500).json({ error: 'Unable to import sets' });
  }
  if (plan.error) return res.status(400).json({ error: plan.error });

  const valid = plan.rows.filter(r => r.valid);
  const client = await db.connect();
  let created = 0, updated = 0;
  try {
    await client.query('BEGIN');
    for (const r of valid) {
      // Re-check under lock: another import or an edit may have added the same set number meanwhile.
      const { rows: [current] } = await client.query(
        `SELECT id FROM sets WHERE production_id = $1 AND LOWER(TRIM(set_number)) = LOWER(TRIM($2)) FOR UPDATE`,
        [req.params.id, r.set_number]
      );
      if (current) {
        // Only overwrite optional fields the file actually fills in.
        await client.query(
          `UPDATE sets SET
             set_name          = $1,
             shoot_week        = COALESCE($2, shoot_week),
             handover_date     = COALESCE($3::date, handover_date),
             completion_status = COALESCE($4, completion_status),
             notes             = COALESCE($5, notes)
           WHERE id = $6`,
          [r.set_name, r.shoot_week, r.handover_date, r.completion_status, r.notes, current.id]
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO sets (production_id, set_number, set_name, shoot_week, handover_date, completion_status, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.params.id, r.set_number, r.set_name, r.shoot_week, r.handover_date, r.completion_status || 'not_started', r.notes]
        );
        created++;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('importSets:', err);
    return res.status(500).json({ error: 'Unable to import sets' });
  } finally {
    client.release();
  }

  await logAudit({
    userId: req.user.id, userName: req.user.full_name, userRole: req.user.role, productionId: req.params.id,
    category: 'production', action: 'sets_imported', entityType: 'production', entityId: req.params.id,
    details: `Imported sets: ${created} added, ${updated} updated, ${plan.summary.invalid} rows skipped`,
  });
  res.json({ created, updated, errors: plan.rows.filter(r => !r.valid).map(r => ({ row: r.row, errors: r.errors })) });
};

module.exports = {
  getSetCodes,
  listUniversal, createUniversal, updateUniversal, importUniversal,
  getSetImportTemplate, previewSetImport, importSets,
  // for tests
  _parseDate: parseDate, _cleanCell: cleanCell,
};
