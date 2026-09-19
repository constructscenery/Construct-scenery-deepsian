const express = require('express');
const router  = express.Router();
const ctrl    = require('../Controllers/costReportsController');
const historical = require('../Controllers/historicalCostReportsController');
const { upload } = require('../Middleware/upload');
const { requireRole } = require('../Middleware/requireRole');

// Cost Report: full read/write = MD + Accountant. Coordinator has none
// (already excluded entirely in policies.json — this is the explicit
// per-route annotation required for the write actions).
const MD         = 'managing_director';
const ACCOUNTANT = 'construction_accountant';
const WRITERS    = [MD, ACCOUNTANT];

// ─── Export rate limiter: 10 per minute per user ──────────────────────────────
const exportCounts = new Map();
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

// ── Specific paths before /:productionId ──────────────────────────────────────
router.get('/entries', ctrl.getCostReportEntries);
router.get('/historical', historical.listReports);
router.post('/historical/upload', upload.single('file'), historical.uploadReport);
router.get('/historical/:reportId/view', historical.viewReport);
router.delete('/historical/:reportId', historical.deleteReport);

// ── Per-production report endpoints ──────────────────────────────────────────
router.get('/:productionId/type1',                              ctrl.getType1Report);
router.get('/:productionId/type2',                              ctrl.getType2Report);
router.get('/:productionId/snapshot',                           ctrl.getSnapshot);
router.get('/:productionId/cost-plus',                          ctrl.getCostPlus);
router.get('/:productionId/next-invoice-number',                requireRole(...WRITERS), ctrl.getNextInvoiceNumber);
router.get('/:productionId/export/csv',  exportRateLimit,       ctrl.exportCostReportCSV);
router.get('/:productionId/export/pdf',  exportRateLimit,       ctrl.exportCostReportPDF);
router.get('/:productionId',                                    ctrl.getCostReport);

// ── Mutations (MD + Accountant only) ───────────────────────────────────────────
router.post('/:productionId/invoices',                          requireRole(...WRITERS), ctrl.addInvoice);
router.delete('/:productionId/invoices/:invoiceId',             requireRole(...WRITERS), ctrl.deleteInvoice);
router.post('/:productionId/budget',                            requireRole(...WRITERS), ctrl.upsertBudget);
router.patch('/:productionId/po-billing/:sourceId',             requireRole(...WRITERS), ctrl.updatePoBilling);
router.post('/:productionId/omit-entry',                        requireRole(...WRITERS), ctrl.omitEntry);
router.delete('/:productionId/omit-entry/:entryId',             requireRole(...WRITERS), ctrl.unomitEntry);
router.put('/:productionId/margins-reference',                  requireRole(...WRITERS), ctrl.updateMarginsReference);
router.put('/:productionId/weekly-pl/:weekEndingDate',          requireRole(...WRITERS), ctrl.upsertWeeklyPL);

module.exports = router;
