const express = require('express');
const router = express.Router();
const controller = require('../Controllers/dataSyncController');

router.post('/trigger', controller.triggerSync);
router.get('/history', controller.getHistory);
router.get('/status', controller.getStatus);
router.get('/download/:id', controller.downloadSync);

module.exports = router;
