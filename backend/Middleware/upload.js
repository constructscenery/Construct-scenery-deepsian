/**
 * Multer upload middleware — in-memory storage.
 * Files are held in req.file.buffer and then uploaded to S3 by fileStorage.store().
 * No files are written to local disk.
 */

const multer = require('multer');
const path   = require('path');

const ALLOWED_EXTS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.gif',
  '.doc', '.docx', '.xls', '.xlsx', '.csv',
  '.zip', '.txt',
]);

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTS.has(ext)) cb(null, true);
  else cb(new Error(`File type "${ext}" is not allowed`));
};

// General-purpose upload (invoices, any document type in ALLOWED_EXTS)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 25 * 1024 * 1024 },
  fileFilter,
});

// Restricted upload for crew/production documents: PDF, JPEG, PNG only
const DOCUMENT_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (DOCUMENT_MIME_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF, JPEG, and PNG files are allowed for documents'));
  },
});

// PDF-only upload for Unit Lists
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype === 'application/pdf' || ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed for Unit Lists'));
    }
  },
});

module.exports = { upload, documentUpload, pdfUpload };
