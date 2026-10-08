const express = require('express');
const router = express.Router();
const { handleSnsRequest } = require('../services/emailing/sesEvents');

// SNS posts JSON with Content-Type text/plain — read the raw body for signature verification.
router.post('/ses', express.text({ type: '*/*', limit: '256kb' }), async (req, res) => {
  try {
    const { status, body } = await handleSnsRequest(req.body);
    res.status(status).json(body);
  } catch (err) {
    // 500 makes SNS retry the notification later.
    console.error('[ses-events] webhook failed:', err);
    res.status(500).json({ error: 'Failed to process event' });
  }
});

module.exports = router;
