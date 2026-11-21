const express = require('express');
const router  = express.Router();
const ctrl    = require('../Controllers/setCodesController');

// CS-03/CS-04 — dropdown source: a production's sets + active universal codes. Read-only.
router.get('/', ctrl.getSetCodes);

module.exports = router;
