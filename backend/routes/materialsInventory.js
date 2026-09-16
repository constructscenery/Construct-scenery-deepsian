const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/materialsInventoryController');

router.get('/', ctrl.getInventory);
router.get('/summary', ctrl.getInventorySummary);
router.post('/', ctrl.createInventory);
router.post('/:id/restock', ctrl.restockInventory);
router.put('/:id', ctrl.updateInventory);
router.delete('/:id', ctrl.deleteInventory);

module.exports = router;