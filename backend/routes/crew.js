const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const ctrl       = require('../Controllers/crewController');
const { upload } = require('../Middleware/upload');
const { requireRole } = require('../Middleware/requireRole');

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

// ── Import (specific paths before /:id) ───────────────────────────────────────
router.get('/import/template',                                ctrl.getImportTemplate);
router.post('/import/preview', csvUpload.single('csv'),       requireRole(...ALL_ROLES), ctrl.previewImport);
router.post('/import',         csvUpload.single('csv'),       requireRole(...ALL_ROLES), ctrl.importCSV);

router.get('/trades',                  ctrl.getTrades);
router.get('/',                        ctrl.getAllCrew);
router.post('/',                       requireRole(...ALL_ROLES), ctrl.createCrewMember);
router.get('/:id',                     ctrl.getCrewById);
router.put('/:id',                     requireRole(...ALL_ROLES), ctrl.updateCrewMember);
router.delete('/:id',                  requireRole(...ALL_ROLES), ctrl.deleteCrewMember);
router.post('/:id/documents',          upload.single('file'), requireRole(...ALL_ROLES), ctrl.addDocument);
router.delete('/:id/documents/:docId', requireRole(...ALL_ROLES), ctrl.deleteDocument);
router.post('/:id/productions',        requireRole(...ALL_ROLES), ctrl.linkToProduction);

module.exports = router;
