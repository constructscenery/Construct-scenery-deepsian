const express = require('express');
const router  = express.Router();
const ctrl    = require('../Controllers/suppliersController');

// Specific paths before /:id
router.get('/names', ctrl.getSupplierNames); // distinct active supplier names — autocomplete
router.get('/history', ctrl.getAllSupplierHistory);

router.get('/',       ctrl.getSuppliers);
router.post('/',      ctrl.createSupplier);
router.get('/:id/history', ctrl.getSupplierHistory);
router.get('/:id',    ctrl.getSupplierById);
router.put('/:id',    ctrl.updateSupplier);
router.delete('/:id', ctrl.deleteSupplier);

module.exports = router;
