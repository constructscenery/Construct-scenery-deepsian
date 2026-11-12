const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/quotesController');
const { requireRole } = require('../Middleware/requireRole');

// Addendum 6 — Quotes. All three staff roles have full access (CLAUDE.md access policy);
// role-specific limits from Addendum 6 §11 wait on client question 1.
const WRITE_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

router.get('/', ctrl.getQuotes);
router.post('/', requireRole(...WRITE_ROLES), ctrl.createQuote);
router.get('/:id', ctrl.getQuoteById);
router.patch('/:id', requireRole(...WRITE_ROLES), ctrl.updateQuote);
router.delete('/:id', requireRole(...WRITE_ROLES), ctrl.deleteQuote);

router.put('/:id/lines/reorder', requireRole(...WRITE_ROLES), ctrl.reorderLines);
router.post('/:id/lines', requireRole(...WRITE_ROLES), ctrl.addLine);
router.patch('/:id/lines/:lineId', requireRole(...WRITE_ROLES), ctrl.updateLine);
router.delete('/:id/lines/:lineId', requireRole(...WRITE_ROLES), ctrl.deleteLine);

router.post('/:id/status', requireRole(...WRITE_ROLES), ctrl.changeStatus);
router.post('/:id/send', requireRole(...WRITE_ROLES), ctrl.sendQuote);
router.post('/:id/revise', requireRole(...WRITE_ROLES), ctrl.reviseQuote);
router.get('/:id/pdf', ctrl.getQuotePdf);

module.exports = router;
