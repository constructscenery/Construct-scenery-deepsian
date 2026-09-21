const express      = require('express');
const router       = express.Router();
const ctrl         = require('../Controllers/purchaseOrdersController');
const importCtrl   = require('../Controllers/purchaseOrdersImportController');
const { upload }   = require('../Middleware/upload');
const { requireRole } = require('../Middleware/requireRole');
const multer       = require('multer');

const csvUpload    = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

router.get('/',                          ctrl.getAllPOs);
router.get('/export/csv',                ctrl.exportCSV);
router.get('/export/pdf',                ctrl.exportPDFList);
router.get('/:id/pdf',                   ctrl.downloadPdf);
router.get('/account-codes',             ctrl.getAccountCodes);
router.get('/import/template',           importCtrl.getImportTemplate);
router.post('/import',                   csvUpload.single('csv'), requireRole(...ALL_ROLES), importCtrl.importCSV);
router.post('/',                         requireRole(...ALL_ROLES), ctrl.createPO);
router.get('/:id',                       ctrl.getPOById);
router.put('/:id',                       requireRole(...ALL_ROLES), ctrl.updatePO);
router.patch('/:id',                     requireRole(...ALL_ROLES), ctrl.updatePO);
router.delete('/:id',                    requireRole(...ALL_ROLES), ctrl.deletePO);
router.patch('/:id/restore',             requireRole(...ALL_ROLES), ctrl.restorePO);
router.post('/:id/issue',                requireRole(...ALL_ROLES), ctrl.issuePO);
router.post('/:id/submit',               requireRole(...ALL_ROLES), ctrl.submitPO);
router.post('/:id/attach-invoice',       upload.single('invoice'), requireRole(...ALL_ROLES), ctrl.attachInvoice);
router.post('/:id/attach-confirmation',  upload.single('confirmation'), requireRole(...ALL_ROLES), ctrl.attachConfirmation);
router.get('/:id/confirmation/download',   ctrl.downloadConfirmation);
router.get('/:id/invoice/download',      ctrl.downloadInvoice);
router.delete('/:id/invoice',            requireRole(...ALL_ROLES), ctrl.deleteInvoice);
router.post('/:id/approve',              requireRole(...ALL_ROLES), ctrl.approvePO);

module.exports = router;
