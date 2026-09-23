const express = require('express');
const router  = express.Router();
const { listExpenditureTypes } = require('../Controllers/expenditureTypesController');

// GET /api/expenditure-types
router.get('/', listExpenditureTypes);

module.exports = router;
