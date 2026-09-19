const crypto = require('crypto');
const db = require('../config/db');
const fileStorage = require('../services/fileStorage');

// SafetyHealthDocumentType
const TYPES = new Set(['risk_template', 'risk_assessment', 'coshh', 'insurance']);
const selectColumns = `d.id, d.document_type, d.file_name, d.file_size, d.file_mime_type,
  d.assessment_date, d.expiry_date, d.reminder_enabled, d.reminder_days, d.location, d.production_id, p.name AS production_name,
  d.tags, d.status, d.public_token, d.uploaded_by, d.uploaded_at`;

const validateInsuranceSettings = (body) => {
  if (body.expiry_date) {
    const date = new Date(body.expiry_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.expiry_date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.expiry_date) {
      return 'Expiry date must be a valid YYYY-MM-DD date';
    }
  }
  if (body.reminder_enabled !== undefined && ![true, false, 'true', 'false'].includes(body.reminder_enabled)) return 'Email alert must be true or false';
  if (body.reminder_days !== undefined && (String(body.reminder_days).trim() === '' || !Number.isInteger(Number(body.reminder_days)) || Number(body.reminder_days) < 0 || Number(body.reminder_days) > 365)) return 'Reminder days must be an integer between 0 and 365';
  return null;
};

const isPdf = (file) => file?.mimetype === 'application/pdf';
const isWord = (file) => file?.mimetype === 'application/msword' || file?.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const validateDocumentFile = (type, file) => {
  if (!file) return 'A document file is required';
  if (type === 'risk_template' && !isWord(file)) return 'Risk assessment templates must be Word documents';
  if (type !== 'risk_template' && !isPdf(file)) return 'This document type requires a PDF file';
  return null;
};

const keyFromUrl = (url) => {
  if (!url) return null;
  if (url.includes('.amazonaws.com/')) return decodeURIComponent(url.split('.amazonaws.com/')[1]);
  return url.startsWith('/') ? url.slice(1) : null;
};

const parseProductionIds = (value) => {
  if (!value) return [];
  try { return Array.isArray(value) ? value : JSON.parse(value); } catch { return String(value).split(',').map(id => id.trim()).filter(Boolean); }
};

const validateProductionIds = async (productionIds) => {
  const ids = [...new Set(productionIds.filter(Boolean))];
  if (!ids.length) return ids;
  const { rows } = await db.query('SELECT id FROM productions WHERE id = ANY($1::uuid[])', [ids]);
  if (rows.length !== ids.length) throw Object.assign(new Error('One or more selected productions were not found'), { status: 400 });
  return ids;
};

const syncProductionLinks = async (documentId, productionIds) => {
  const ids = await validateProductionIds(productionIds);
  await db.query('DELETE FROM safety_health_document_productions WHERE document_id = $1', [documentId]);
  if (ids.length) await db.query('INSERT INTO safety_health_document_productions (document_id, production_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING', [documentId, ids]);
  await db.query('UPDATE safety_health_documents SET production_id = $1 WHERE id = $2', [ids[0] || null, documentId]);
  return ids;
};

const listDocuments = async (req, res) => {
  try {
    const conditions = ['1=1'];
    const params = [];
    let i = 1;
    const type = req.query.document_type;
    if (type && TYPES.has(type)) { conditions.push(`d.document_type = $${i++}`); params.push(type); }
    if (req.query.status === 'active' || req.query.status === 'pending_alteration') { conditions.push(`d.status = $${i++}`); params.push(req.query.status); }
    if (req.query.search) { conditions.push(`(d.file_name ILIKE $${i} OR d.location ILIKE $${i} OR p.name ILIKE $${i} OR EXISTS (SELECT 1 FROM unnest(d.tags) tag WHERE tag ILIKE $${i}))`); params.push(`%${req.query.search}%`); i++; }
    if (req.query.date_from) { conditions.push(`d.assessment_date >= $${i++}`); params.push(req.query.date_from); }
    if (req.query.date_to) { conditions.push(`d.assessment_date <= $${i++}`); params.push(req.query.date_to); }
    if (req.query.location) { conditions.push(`d.location ILIKE $${i++}`); params.push(`%${req.query.location}%`); }
    if (req.query.production_id) { conditions.push(`(d.production_id = $${i} OR EXISTS (SELECT 1 FROM safety_health_document_productions shdpf WHERE shdpf.document_id = d.id AND shdpf.production_id = $${i}))`); params.push(req.query.production_id); i++; }
      const { rows } = await db.query(`SELECT ${selectColumns}, COALESCE((SELECT array_agg(shdp.production_id) FROM safety_health_document_productions shdp WHERE shdp.document_id = d.id), ARRAY[]::uuid[]) AS production_ids, COALESCE((SELECT json_agg(json_build_object('id', p2.id, 'name', p2.name) ORDER BY p2.name) FROM safety_health_document_productions shdp2 JOIN productions p2 ON p2.id = shdp2.production_id WHERE shdp2.document_id = d.id), '[]'::json) AS productions FROM safety_health_documents d LEFT JOIN productions p ON p.id = d.production_id WHERE ${conditions.join(' AND ')} ORDER BY d.assessment_date DESC NULLS LAST, d.uploaded_at DESC`, params);
    res.json(rows);
  } catch (err) { console.error('listSafetyHealth:', err); res.status(500).json({ error: err.message }); }
};

const listPublicDocuments = async (req, res) => {
  try {
    const conditions = ["d.document_type IN ('coshh', 'insurance')", "d.status = 'active'", 'd.public_token IS NOT NULL'];
    const params = [];
    let i = 1;
    if (req.query.document_type === 'coshh' || req.query.document_type === 'insurance') {
      conditions.push(`d.document_type = $${i++}`);
      params.push(req.query.document_type);
    }
    if (req.query.search) {
      conditions.push(`(d.file_name ILIKE $${i} OR d.location ILIKE $${i} OR p.name ILIKE $${i} OR EXISTS (SELECT 1 FROM unnest(d.tags) tag WHERE tag ILIKE $${i}))`);
      params.push(`%${req.query.search}%`);
      i++;
    }
    const { rows } = await db.query(`
      SELECT d.id, d.document_type, d.file_name, d.file_size, d.file_mime_type,
             d.assessment_date, d.expiry_date, d.location, d.tags, d.public_token,
             COALESCE((SELECT json_agg(json_build_object('id', p2.id, 'name', p2.name) ORDER BY p2.name)
                       FROM safety_health_document_productions link
                       JOIN productions p2 ON p2.id = link.production_id
                       WHERE link.document_id = d.id), '[]'::json) AS productions
      FROM safety_health_documents d
      LEFT JOIN productions p ON p.id = d.production_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.document_type, d.file_name
    `, params);
    res.json(rows);
  } catch (err) {
    console.error('listPublicSafetyHealth:', err);
    res.status(500).json({ error: 'Unable to load public certificates' });
  }
};

const uploadDocument = async (req, res) => {
  const type = req.body.document_type;
  if (!TYPES.has(type)) return res.status(400).json({ error: 'Invalid Health & Safety document type' });
  const fileError = validateDocumentFile(type, req.file);
  if (fileError) return res.status(400).json({ error: fileError });
  const settingsError = validateInsuranceSettings(req.body);
  if (settingsError) return res.status(400).json({ error: settingsError });
  try {
    const stored = await fileStorage.store(req.file);
    const tags = String(req.body.tags || '').split(',').map(tag => tag.trim()).filter(Boolean);
    const token = type === 'coshh' || type === 'insurance' ? crypto.randomBytes(24).toString('hex') : null;
    const status = req.body.status === 'pending_alteration' ? 'pending_alteration' : 'active';
    const productionIds = await validateProductionIds(parseProductionIds(req.body.production_ids || req.body.production_id));
    const { rows: [row] } = await db.query(`INSERT INTO safety_health_documents (document_type, file_url, file_key, file_name, file_size, file_mime_type, assessment_date, location, production_id, tags, status, public_token, uploaded_by, expiry_date, reminder_enabled, reminder_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id, document_type, file_name, file_size, file_mime_type, assessment_date, location, production_id, tags, status, public_token, uploaded_by, uploaded_at, expiry_date, reminder_enabled, reminder_days`, [type, stored.url, stored.key, req.file.originalname, req.file.size, req.file.mimetype, req.body.assessment_date || null, req.body.location || null, productionIds[0] || null, tags, status, token, req.user.id, type === 'insurance' ? req.body.expiry_date || null : null, ![false, 'false'].includes(req.body.reminder_enabled), Number(req.body.reminder_days ?? 30)]);
    await syncProductionLinks(row.id, productionIds);
    res.status(201).json(row);
  } catch (err) { console.error('uploadSafetyHealth:', err); res.status(err.status || 500).json({ error: err.message }); }
};

const replaceDocument = async (req, res) => {
  try {
    const { rows: [existing] } = await db.query('SELECT * FROM safety_health_documents WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Document not found' });
    const settingsError = validateInsuranceSettings(req.body);
    if (settingsError) return res.status(400).json({ error: settingsError });
    if (req.file) {
      const fileError = validateDocumentFile(existing.document_type, req.file);
      if (fileError) return res.status(400).json({ error: fileError });
    }

    const productionIds = req.body.production_ids !== undefined || req.body.production_id !== undefined
      ? parseProductionIds(req.body.production_ids || req.body.production_id)
      : null;
    if (productionIds) await validateProductionIds(productionIds);
    const stored = req.file ? await fileStorage.store(req.file) : null;
    try {
      const updates = [];
      const values = [];
      const addUpdate = (column, value) => { updates.push(`${column} = $${values.length + 1}`); values.push(value); };
      if (stored) {
        addUpdate('file_url', stored.url);
        addUpdate('file_key', stored.key);
        addUpdate('file_name', req.file.originalname);
        addUpdate('file_size', req.file.size);
        addUpdate('file_mime_type', req.file.mimetype);
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'assessment_date')) addUpdate('assessment_date', req.body.assessment_date || null);
      if (existing.document_type === 'insurance') {
        if (Object.prototype.hasOwnProperty.call(req.body, 'expiry_date')) addUpdate('expiry_date', req.body.expiry_date || null);
        if (Object.prototype.hasOwnProperty.call(req.body, 'reminder_enabled')) addUpdate('reminder_enabled', ![false, 'false'].includes(req.body.reminder_enabled));
        if (Object.prototype.hasOwnProperty.call(req.body, 'reminder_days')) addUpdate('reminder_days', Number(req.body.reminder_days));
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'location')) addUpdate('location', req.body.location?.trim() || null);
      if (Object.prototype.hasOwnProperty.call(req.body, 'tags')) addUpdate('tags', String(req.body.tags).split(',').map(tag => tag.trim()).filter(Boolean));
      if (Object.prototype.hasOwnProperty.call(req.body, 'status')) addUpdate('status', req.body.status || 'active');
      values.push(req.params.id);
      const { rows: [updated] } = await db.query(`
        UPDATE safety_health_documents
        SET ${updates.join(', ')}
        WHERE id = $${values.length}
        RETURNING id, document_type, file_name, file_size, file_mime_type, assessment_date, location, production_id, tags, status, public_token, uploaded_by, uploaded_at, expiry_date, reminder_enabled, reminder_days
      `, values);
      if (productionIds) await syncProductionLinks(req.params.id, productionIds);
      if (stored) await fileStorage.deleteFile(existing.file_key || keyFromUrl(existing.file_url));
      res.json(updated);
    } catch (err) {
      if (stored) await fileStorage.deleteFile(stored.key);
      throw err;
    }
  } catch (err) {
    console.error('replaceSafetyHealth:', err);
    res.status(err.status || 500).json({ error: err.message || 'Unable to replace document' });
  }
};

const deleteDocument = async (req, res) => {
  try {
    const { rows: [existing] } = await db.query('SELECT file_key, file_url FROM safety_health_documents WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Document not found' });
    await fileStorage.deleteFile(existing.file_key || keyFromUrl(existing.file_url));
    await db.query('DELETE FROM safety_health_documents WHERE id = $1', [req.params.id]);
    res.json({ message: 'Document deleted' });
  } catch (err) {
    console.error('deleteSafetyHealth:', err);
    res.status(500).json({ error: 'Unable to delete document' });
  }
};

const downloadDocument = async (req, res) => {
  try {
    const { rows: [row] } = await db.query('SELECT file_url, file_name, file_mime_type FROM safety_health_documents WHERE id = $1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Document not found' });
    await fileStorage.streamToResponse(row.file_url, res, row.file_name, row.file_mime_type);
  } catch (err) { res.status(500).json({ error: 'Unable to download document' }); }
};

const publicDocument = async (req, res) => {
  try {
    const { rows: [row] } = await db.query("SELECT file_url, file_name, file_mime_type FROM safety_health_documents WHERE public_token = $1 AND status = 'active' AND document_type IN ('coshh', 'insurance')", [req.params.token]);
    if (!row) return res.status(404).json({ error: 'Public certificate not found' });
    await fileStorage.streamToResponse(row.file_url, res, row.file_name, row.file_mime_type);
  } catch (err) { res.status(500).json({ error: 'Unable to open public certificate' }); }
};

module.exports = { listDocuments, listPublicDocuments, uploadDocument, replaceDocument, deleteDocument, downloadDocument, publicDocument };
