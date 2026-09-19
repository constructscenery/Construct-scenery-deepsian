const db = require('../config/db');
const fileStorage = require('../services/fileStorage');

const columns = 'id, file_name, file_size, file_mime_type, uploaded_by, uploaded_at';
const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function createDocumentController(table, parentTable, parentColumn) {
  const validateIds = (req, res) => {
    if (!validId(req.params.id) || (req.params.docId && !validId(req.params.docId))) {
      res.status(400).json({ error: 'Invalid document or parent ID' });
      return false;
    }
    return true;
  };

  return {
    list: async (req, res) => {
      if (!validateIds(req, res)) return;
      try {
        const { rows: parents } = await db.query(`SELECT id FROM ${parentTable} WHERE id = $1`, [req.params.id]);
        if (!parents.length) return res.status(404).json({ error: 'Record not found' });
        const { rows } = await db.query(`SELECT ${columns} FROM ${table} WHERE ${parentColumn} = $1 ORDER BY uploaded_at DESC, id DESC`, [req.params.id]);
        res.json(rows);
      } catch { res.status(500).json({ error: 'Unable to load documents' }); }
    },

    upload: async (req, res) => {
      if (!validateIds(req, res)) return;
      if (!req.file) return res.status(400).json({ error: 'Choose a document first' });
      let stored;
      try {
        fileStorage.validate(req.file.mimetype, req.file.size);
        const { rows: parents } = await db.query(`SELECT id FROM ${parentTable} WHERE id = $1`, [req.params.id]);
        if (!parents.length) return res.status(404).json({ error: 'Record not found' });
        stored = await fileStorage.store(req.file);
        const { rows: [document] } = await db.query(`INSERT INTO ${table} (${parentColumn}, file_key, file_name, file_size, file_mime_type, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${columns}`, [req.params.id, stored.key, req.file.originalname, stored.size, req.file.mimetype, req.user.id]);
        res.status(201).json(document);
      } catch (err) {
        if (stored) await fileStorage.deleteFile(stored.key).catch(() => {});
        res.status(err.status || 500).json({ error: err.status === 400 ? err.message : 'Unable to upload document' });
      }
    },

    view: async (req, res) => {
      if (!validateIds(req, res)) return;
      try {
        const { rows: [document] } = await db.query(`SELECT file_key, file_name, file_mime_type FROM ${table} WHERE id = $1 AND ${parentColumn} = $2`, [req.params.docId, req.params.id]);
        if (!document) return res.status(404).json({ error: 'Document not found' });
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        await fileStorage.streamToResponse(document.file_key, res, document.file_name, document.file_mime_type);
      } catch {
        if (!res.headersSent) res.status(500).json({ error: 'Unable to open document' });
      }
    },

    delete: async (req, res) => {
      if (!validateIds(req, res)) return;
      try {
        const { rows: [document] } = await db.query(`SELECT file_key FROM ${table} WHERE id = $1 AND ${parentColumn} = $2`, [req.params.docId, req.params.id]);
        if (!document) return res.status(404).json({ error: 'Document not found' });
        await fileStorage.deleteFile(document.file_key, { strict: true });
        await db.query(`DELETE FROM ${table} WHERE id = $1 AND ${parentColumn} = $2`, [req.params.docId, req.params.id]);
        res.status(204).end();
      } catch { res.status(500).json({ error: 'Unable to delete document. Please retry.' }); }
    },
  };
}

module.exports = {
  buildings: createDocumentController('building_documents', 'buildings', 'building_id'),
  freelancers: createDocumentController('freelancer_documents', 'freelancer_contacts', 'freelancer_id'),
};