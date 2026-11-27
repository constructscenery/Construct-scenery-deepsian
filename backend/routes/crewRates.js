const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const ctrl    = require('../Controllers/crewRatesController');

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// Specific paths before /:id
router.get('/history',   ctrl.getHistory);                         // version history
router.post('/preview',  csvUpload.single('csv'), ctrl.previewCSV); // diff preview before import
router.post('/import',   csvUpload.single('csv'), ctrl.importCSV);  // commit new rate card year

router.get('/',          ctrl.getRates);
router.get('/:id/versions', ctrl.getVersions);                     // RC-03: every version of this grade
router.patch('/:id',     ctrl.updateRate);

module.exports = router;
