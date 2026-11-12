const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/quotesController');

// Secure preview link for a sent quote (Addendum 6 §8.2 "Copy Link"). No login: the
// unguessable token in the URL is the access check.
router.get('/:token', ctrl.getSharedQuotePdf);

module.exports = router;
