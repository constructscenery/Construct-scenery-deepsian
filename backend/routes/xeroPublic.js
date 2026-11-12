const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/xeroController');

// Xero sends the browser back here after the consent screen. No app token is present on this
// redirect; the signed `state` (issued by GET /api/xero/connect) identifies the Administrator.
router.get('/callback', ctrl.handleCallback);

module.exports = router;
