const express = require('express');
const router = express.Router();
const multer = require('multer');
const ctrl = require('../Controllers/safetyHealthController');
const { requireRole } = require('../Middleware/requireRole');

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = file.mimetype === 'application/pdf' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.mimetype === 'application/msword';
    cb(allowed ? null : new Error('Only PDF or Word documents are allowed'), allowed);
  },
});

router.get('/', ctrl.listDocuments);
router.get('/:id/download', ctrl.downloadDocument);
router.post('/upload', upload.single('file'), ctrl.uploadDocument);
router.put('/:id', upload.single('file'), requireRole(...ALL_ROLES), ctrl.replaceDocument);
router.delete('/:id', requireRole(...ALL_ROLES), ctrl.deleteDocument);

module.exports = router;
