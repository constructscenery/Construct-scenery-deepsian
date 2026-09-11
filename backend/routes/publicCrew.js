const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/publicCrewController');

// ─── Public routes (no authentication required) ──────────────────────────────
router.get('/trades', ctrl.getTrades);
router.post('/register', ctrl.registerCrew);

module.exports = router;
