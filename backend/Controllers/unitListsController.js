const db = require('../config/db');
const fileStorage = require('../services/fileStorage');
const { logAudit } = require('../services/auditService');
const path = require('path');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/unit-lists
 * List unit lists with filtering by date, name of pdf, name, email, number, company name, production
 */
const listUnitLists = async (req, res) => {
  try {
    const {
      search,
      file_name,
      name,
      email,
      number,
      phone_number,
      company_name,
      production_id,
      date,
      date_from,
      date_to,
    } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    // Production filter
    if (production_id && UUID_REGEX.test(production_id)) {
      conditions.push(`ul.production_id = $${idx++}`);
      params.push(production_id);
    }

    // Specific field filters
    if (file_name && file_name.trim()) {
      conditions.push(`ul.file_name ILIKE $${idx++}`);
      params.push(`%${file_name.trim()}%`);
    }

    if (name && name.trim()) {
      conditions.push(`ul.name ILIKE $${idx++}`);
      params.push(`%${name.trim()}%`);
    }

    if (email && email.trim()) {
      conditions.push(`ul.email ILIKE $${idx++}`);
      params.push(`%${email.trim()}%`);
    }

    const phoneFilter = (phone_number || number || '').trim();
    if (phoneFilter) {
      conditions.push(`ul.phone_number ILIKE $${idx++}`);
      params.push(`%${phoneFilter}%`);
    }

    if (company_name && company_name.trim()) {
      conditions.push(`ul.company_name ILIKE $${idx++}`);
      params.push(`%${company_name.trim()}%`);
    }

    // Date filters
    if (date && date.trim()) {
      conditions.push(`ul.date = $${idx++}`);
      params.push(date.trim());
    }

    if (date_from && date_from.trim()) {
      conditions.push(`ul.date >= $${idx++}`);
      params.push(date_from.trim());
    }

    if (date_to && date_to.trim()) {
      conditions.push(`ul.date <= $${idx++}`);
      params.push(date_to.trim());
    }

    // Global quick search
    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      conditions.push(`(
        ul.file_name ILIKE $${idx} OR
        ul.name ILIKE $${idx} OR
        ul.email ILIKE $${idx} OR
        ul.phone_number ILIKE $${idx} OR
        ul.company_name ILIKE $${idx} OR
        ul.notes ILIKE $${idx} OR
        p.name ILIKE $${idx}
      )`);
      params.push(s);
      idx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT ul.*,
             p.name AS production_name,
             p.production_code AS production_code,
             u.full_name AS uploaded_by_name
      FROM unit_lists ul
      LEFT JOIN productions p ON ul.production_id = p.id
      LEFT JOIN users u ON ul.uploaded_by = u.id
      ${whereClause}
      ORDER BY ul.date DESC NULLS LAST, ul.created_at DESC
    `;

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('listUnitLists error:', err);
    res.status(500).json({ error: 'Failed to list unit lists' });
  }
};

/**
 * GET /api/unit-lists/:id
 */
const getUnitListById = async (req, res) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'Invalid unit list ID' });
  }

  try {
    const { rows } = await db.query(
      `SELECT ul.*,
              p.name AS production_name,
              p.production_code AS production_code,
              u.full_name AS uploaded_by_name
       FROM unit_lists ul
       LEFT JOIN productions p ON ul.production_id = p.id
       LEFT JOIN users u ON ul.uploaded_by = u.id
       WHERE ul.id = $1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Unit list not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('getUnitListById error:', err);
    res.status(500).json({ error: 'Failed to retrieve unit list' });
  }
};

/**
 * POST /api/unit-lists
 * Upload a new Unit List PDF with optional contact & production details
 */
const createUnitList = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please select a PDF file to upload' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext !== '.pdf' && req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ error: 'Only PDF files are allowed for Unit Lists' });
    }

    fileStorage.validate('application/pdf', req.file.size);

    const {
      production_id,
      date,
      name,
      email,
      number,
      phone_number,
      company_name,
      notes,
    } = req.body;

    const prodId = production_id && UUID_REGEX.test(production_id) ? production_id : null;
    const listDate = date && date.trim() ? date.trim() : new Date().toISOString().split('T')[0];
    const phone = (phone_number || number || '').trim() || null;

    // Store in S3
    const stored = await fileStorage.store(req.file);

    const { rows: [created] } = await db.query(
      `INSERT INTO unit_lists (
        production_id,
        file_name,
        file_url,
        file_key,
        file_size,
        file_mime_type,
        date,
        name,
        email,
        phone_number,
        company_name,
        notes,
        uploaded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        prodId,
        req.file.originalname,
        stored.url,
        stored.key,
        stored.size,
        'application/pdf',
        listDate,
        (name || '').trim() || null,
        (email || '').trim() || null,
        phone,
        (company_name || '').trim() || null,
        (notes || '').trim() || null,
        req.user?.id || null,
      ]
    );

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'unit_lists',
      action: 'unit_list_uploaded',
      entityType: 'unit_lists',
      entityId: created.id,
      details: `Uploaded Unit List PDF "${created.file_name}" (Date: ${created.date})`,
    });

    res.status(201).json(created);
  } catch (err) {
    console.error('createUnitList error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to upload unit list' });
  }
};

/**
 * PUT /api/unit-lists/:id
 * Update metadata (or optionally replace PDF)
 */
const updateUnitList = async (req, res) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'Invalid unit list ID' });
  }

  try {
    const { rows: [existing] } = await db.query(
      `SELECT * FROM unit_lists WHERE id = $1`,
      [id]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Unit list not found' });
    }

    const {
      production_id,
      date,
      name,
      email,
      number,
      phone_number,
      company_name,
      notes,
    } = req.body;

    let fileUrl = existing.file_url;
    let fileKey = existing.file_key;
    let fileName = existing.file_name;
    let fileSize = existing.file_size;

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext !== '.pdf' && req.file.mimetype !== 'application/pdf') {
        return res.status(400).json({ error: 'Only PDF files are allowed' });
      }
      fileStorage.validate('application/pdf', req.file.size);
      const stored = await fileStorage.store(req.file);
      if (existing.file_key) {
        await fileStorage.deleteFile(existing.file_key).catch(() => {});
      }
      fileUrl = stored.url;
      fileKey = stored.key;
      fileName = req.file.originalname;
      fileSize = stored.size;
    }

    const prodId = production_id !== undefined
      ? (production_id && UUID_REGEX.test(production_id) ? production_id : null)
      : existing.production_id;

    const listDate = date !== undefined
      ? (date && date.trim() ? date.trim() : null)
      : existing.date;

    const contactName = name !== undefined ? ((name || '').trim() || null) : existing.name;
    const contactEmail = email !== undefined ? ((email || '').trim() || null) : existing.email;
    const contactPhone = (phone_number !== undefined || number !== undefined)
      ? (((phone_number || number || '').trim()) || null)
      : existing.phone_number;
    const compName = company_name !== undefined ? ((company_name || '').trim() || null) : existing.company_name;
    const contactNotes = notes !== undefined ? ((notes || '').trim() || null) : existing.notes;

    const { rows: [updated] } = await db.query(
      `UPDATE unit_lists
       SET production_id = $1,
           file_name = $2,
           file_url = $3,
           file_key = $4,
           file_size = $5,
           date = $6,
           name = $7,
           email = $8,
           phone_number = $9,
           company_name = $10,
           notes = $11,
           updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [
        prodId,
        fileName,
        fileUrl,
        fileKey,
        fileSize,
        listDate,
        contactName,
        contactEmail,
        contactPhone,
        compName,
        contactNotes,
        id,
      ]
    );

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'unit_lists',
      action: 'unit_list_updated',
      entityType: 'unit_lists',
      entityId: updated.id,
      details: `Updated Unit List "${updated.file_name}"`,
    });

    res.json(updated);
  } catch (err) {
    console.error('updateUnitList error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update unit list' });
  }
};

/**
 * GET /api/unit-lists/:id/view
 * Stream PDF to browser
 */
const viewUnitList = async (req, res) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'Invalid unit list ID' });
  }

  try {
    const { rows: [unitList] } = await db.query(
      `SELECT file_key, file_url, file_name, file_mime_type FROM unit_lists WHERE id = $1`,
      [id]
    );

    if (!unitList) {
      return res.status(404).json({ error: 'Unit list not found' });
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    await fileStorage.streamToResponse(
      unitList.file_key || unitList.file_url,
      res,
      unitList.file_name,
      unitList.file_mime_type || 'application/pdf'
    );
  } catch (err) {
    console.error('viewUnitList error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Unable to stream unit list document' });
    }
  }
};

/**
 * DELETE /api/unit-lists/:id
 */
const deleteUnitList = async (req, res) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'Invalid unit list ID' });
  }

  try {
    const { rows: [unitList] } = await db.query(
      `SELECT * FROM unit_lists WHERE id = $1`,
      [id]
    );

    if (!unitList) {
      return res.status(404).json({ error: 'Unit list not found' });
    }

    if (unitList.file_key) {
      await fileStorage.deleteFile(unitList.file_key).catch(() => {});
    }

    await db.query(`DELETE FROM unit_lists WHERE id = $1`, [id]);

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.full_name,
      userRole: req.user?.role,
      category: 'unit_lists',
      action: 'unit_list_deleted',
      entityType: 'unit_lists',
      entityId: unitList.id,
      details: `Deleted Unit List "${unitList.file_name}"`,
    });

    res.json({ message: 'Unit list deleted successfully', id });
  } catch (err) {
    console.error('deleteUnitList error:', err);
    res.status(500).json({ error: 'Failed to delete unit list' });
  }
};

module.exports = {
  listUnitLists,
  getUnitListById,
  createUnitList,
  updateUnitList,
  viewUnitList,
  deleteUnitList,
};
