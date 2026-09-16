const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/safetyHealthController');

router.get('/', ctrl.listPublicDocuments);
router.get('/:token', ctrl.publicDocument);

module.exports = router;
