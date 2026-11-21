const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const ctrl    = require('../Controllers/setCodesController');
const { requireRole } = require('../Middleware/requireRole');

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// CS-03 — set codes shared by every production (e.g. management / above-the-line). Deactivate, never delete.
router.get('/',          ctrl.listUniversal);
router.post('/import',   csvUpload.single('csv'), requireRole(...ALL_ROLES), ctrl.importUniversal);
router.post('/',         requireRole(...ALL_ROLES), ctrl.createUniversal);
router.patch('/:id',     requireRole(...ALL_ROLES), ctrl.updateUniversal);

module.exports = router;
