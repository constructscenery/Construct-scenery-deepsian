const express        = require('express');
const router         = express.Router();
const ctrl           = require('../Controllers/productionsController');
const { upload, documentUpload } = require('../Middleware/upload');
const { requireRole } = require('../Middleware/requireRole');

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

// Static routes before /:id to avoid route conflict
router.get('/audit-log',                ctrl.getAuditLog);
router.post('/handover-alerts',         requireRole(...ALL_ROLES), ctrl.sendHandoverAlerts);

// Productions
router.get('/',                         ctrl.getAllProductions);
router.post('/',                        requireRole(...ALL_ROLES), ctrl.createProduction);
router.get('/:id',                      ctrl.getProductionById);
router.put('/:id',                      requireRole(...ALL_ROLES), ctrl.updateProduction);
router.post('/:id/transition',          requireRole(...ALL_ROLES), ctrl.transitionStatus);
router.get('/:id/archive-preview',      ctrl.getArchivePreview);
router.post('/:id/archive',             requireRole(...ALL_ROLES), ctrl.archiveProduction);
router.post('/:id/unarchive',           requireRole(...ALL_ROLES), ctrl.unarchiveProduction);
router.get('/:id/forecast-variance',    ctrl.getForecastVariance);

// Sets (set tracker)
router.get('/:id/sets',            ctrl.getSets);
router.post('/:id/sets',           requireRole(...ALL_ROLES), ctrl.createSet);
router.put('/:id/sets/:setId',     requireRole(...ALL_ROLES), ctrl.updateSet);
router.patch('/:id/sets/:setId',   requireRole(...ALL_ROLES), ctrl.patchSet);
router.delete('/:id/sets/:setId',  requireRole(...ALL_ROLES), ctrl.deleteSet);

// Documents
router.get('/:id/documents',                  ctrl.getDocuments);
router.get('/:id/documents/:docId/download',  ctrl.downloadDocument);
router.post('/:id/documents',                 documentUpload.single('file'), requireRole(...ALL_ROLES), ctrl.uploadDocument);
router.delete('/:id/documents/:docId',        requireRole(...ALL_ROLES), ctrl.deleteDocument);

module.exports = router;
