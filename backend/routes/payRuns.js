const express = require('express');
const router  = express.Router();
const ctrl = require('../Controllers/payRunsController');
const { requireRole } = require('../Middleware/requireRole');

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

// Specific paths before /:id
router.get('/available-weeks', requireRole(...ALL_ROLES), ctrl.getAvailableWeeks);
router.get('/preview',         requireRole(...ALL_ROLES), ctrl.getPayRunPreview);

router.get('/',               requireRole(...ALL_ROLES), ctrl.getAllPayRuns);
router.post('/',              requireRole(...ALL_ROLES),  ctrl.createPayRun);
router.get('/:id',            requireRole(...ALL_ROLES), ctrl.getPayRunById);
router.post('/:id/process',     requireRole(...ALL_ROLES), ctrl.processPayRun);
router.post('/:id/sync-labour', requireRole(...ALL_ROLES), ctrl.syncLabourCosts);
router.get('/:id/export-csv',   requireRole(...ALL_ROLES), ctrl.exportCsv);

module.exports = router;
