const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/xeroController');
const { requireRole } = require('../Middleware/requireRole');

// Addendum 6 §2 / §11 — the Xero connection is set up by an Administrator (Managing Director).
const ADMIN = 'managing_director';
const STAFF_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

router.get('/status', ctrl.getStatus);
router.get('/connect', requireRole(ADMIN), ctrl.getConnectUrl);
router.post('/sync', requireRole(...STAFF_ROLES), ctrl.sync);
router.delete('/connection', requireRole(ADMIN), ctrl.disconnect);

module.exports = router;
