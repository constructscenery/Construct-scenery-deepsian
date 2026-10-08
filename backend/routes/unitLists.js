const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/unitListsController');
const { pdfUpload } = require('../Middleware/upload');
const { requireRole } = require('../Middleware/requireRole');

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

router.get('/', ctrl.listUnitLists);
router.get('/:id', ctrl.getUnitListById);
router.get('/:id/view', ctrl.viewUnitList);
router.post('/', requireRole(...ALL_ROLES), pdfUpload.single('file'), ctrl.createUnitList);
router.put('/:id', requireRole(...ALL_ROLES), pdfUpload.single('file'), ctrl.updateUnitList);
router.delete('/:id', requireRole(...ALL_ROLES), ctrl.deleteUnitList);

module.exports = router;
