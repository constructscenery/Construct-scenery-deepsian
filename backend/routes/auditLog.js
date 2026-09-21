const express = require('express');
const router = express.Router();
const { authenticate } = require('../Middleware/auth');
const ctrl = require('../Controllers/auditLogController');

router.use(authenticate);

router.get('/summary', ctrl.getAuditSummary);
router.get('/export', ctrl.exportAuditCsv);
router.get('/', ctrl.getAuditLogs);

module.exports = router;
