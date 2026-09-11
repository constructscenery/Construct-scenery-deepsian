const express    = require('express');
const router     = express.Router();
const ctrl       = require('../Controllers/timesheetsController');
const { upload } = require('../Middleware/upload');
const { requireRole } = require('../Middleware/requireRole');

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

// ─── Export rate limiter: 10 exports per minute per user ─────────────────────
const exportCounts = new Map(); // userId → [timestamp, ...]
const exportRateLimit = (req, res, next) => {
  const userId = req.user?.id;
  if (!userId) return next();
  const now    = Date.now();
  const window = (exportCounts.get(userId) || []).filter(t => now - t < 60_000);
  if (window.length >= 10)
    return res.status(429).json({ error: 'Export rate limit exceeded — maximum 10 exports per minute.' });
  window.push(now);
  exportCounts.set(userId, window);
  next();
};

// NOTE: specific paths BEFORE /:id to avoid Express matching them as IDs
router.post('/bulk-distribute',   requireRole(...ALL_ROLES), ctrl.bulkDistribute);
router.post('/chase-invoices',    requireRole(...ALL_ROLES), ctrl.chaseInvoices);
router.post('/verification-pack', requireRole(...ALL_ROLES), ctrl.generateVerificationPackPdf);
router.post('/verification-pack-pdf', requireRole(...ALL_ROLES), ctrl.generateVerificationPackCombinedPdf);
router.get('/verification-pack/:weekEndingDate/:productionId', requireRole(...ALL_ROLES), ctrl.getVerificationPack);
router.get('/:id/verification-pack', requireRole(...ALL_ROLES), ctrl.getTimesheetVerificationPack);
router.get('/:id/draft-pdf',      requireRole(...ALL_ROLES), ctrl.getDraftPdf);
router.get('/export/csv',         exportRateLimit, ctrl.exportTimesheetsCSV);
router.get('/export/pdf',         exportRateLimit, ctrl.exportTimesheetsPDF);

router.get('/',                  ctrl.getAllTimesheets);
router.post('/',                 requireRole(...ALL_ROLES), ctrl.createTimesheet);
router.get('/:id',               ctrl.getTimesheetById);
router.patch('/:id',             requireRole(...ALL_ROLES), ctrl.patchTimesheet);
router.put('/:id/entries',       requireRole(...ALL_ROLES), ctrl.saveEntries);
router.post('/:id/resend',       requireRole(...ALL_ROLES), ctrl.resendTimesheet);
router.post('/:id/send',         requireRole(...ALL_ROLES), ctrl.sendSingleTimesheet);
router.post('/:id/submit',       requireRole(...ALL_ROLES), ctrl.submitTimesheet);
router.post('/:id/attach-invoice', upload.single('invoice'), requireRole(...ALL_ROLES), ctrl.attachInvoice);
router.post('/:id/verify',       requireRole(...ALL_ROLES), ctrl.verifyTimesheet);

module.exports = router;
