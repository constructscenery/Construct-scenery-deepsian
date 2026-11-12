const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/salesController');
const { requireRole } = require('../Middleware/requireRole');

// Addendum 6 — Sales. Read-only view of Xero sales invoices; only allocation writes.
const WRITE_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

router.get('/invoices', ctrl.getInvoices);
router.get('/invoices/export', ctrl.exportInvoicesCsv);
router.get('/invoices/:id', ctrl.getInvoiceById);
router.get('/invoices/:id/notes', ctrl.getInvoiceComments);
router.patch('/invoices/:id/allocation', requireRole(...WRITE_ROLES), ctrl.allocateInvoice);
router.get('/summary', ctrl.getSummary);
router.get('/unallocated-reminder', ctrl.getUnallocatedReminder);

module.exports = router;
