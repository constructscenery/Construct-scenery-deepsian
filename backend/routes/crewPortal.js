const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/crewPortalController');
const { documentUpload } = require('../Middleware/upload');

// ─── Simple in-memory rate limiter (per IP) ──────────────────────────────────
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return res.status(429).json({ error: 'Too many requests — please wait a minute and try again.' });
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    next();
  };
}
const readLimit = rateLimit({ windowMs: 60_000, max: 120 });
const writeLimit = rateLimit({ windowMs: 60_000, max: 15 });

// Turn multer errors (wrong type / too large) into friendly 400s for crew.
const invoiceUpload = (req, res, next) => documentUpload.single('file')(req, res, (err) => {
  if (!err) return next();
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large. Maximum size is 25 MB.' : 'Upload a PDF, JPEG or PNG file.';
  return res.status(400).json({ error: message });
});

// ─── Public crew portal (secure link token, no login) ────────────────────────
router.get('/:token', readLimit, ctrl.loadPortal, ctrl.getPortal);
router.get('/:token/timesheets', readLimit, ctrl.loadPortal, ctrl.listTimesheets);
router.get('/:token/timesheets/week', readLimit, ctrl.loadPortal, ctrl.getTimesheetWeek);
router.post('/:token/timesheets', writeLimit, ctrl.loadPortal, ctrl.submitTimesheet);
router.get('/:token/invoices', readLimit, ctrl.loadPortal, ctrl.listInvoices);
router.post('/:token/invoices', writeLimit, ctrl.loadPortal, invoiceUpload, ctrl.uploadInvoice);
router.get('/:token/availability', readLimit, ctrl.loadPortal, ctrl.listAvailability);
router.post('/:token/availability/:pollId', writeLimit, ctrl.loadPortal, ctrl.respondAvailability);

module.exports = router;
