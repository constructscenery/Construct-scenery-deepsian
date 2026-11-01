const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/materialsInventoryController');
const { upload } = require('../Middleware/upload');

router.get('/', ctrl.getInventory);
router.get('/summary', ctrl.getInventorySummary);
router.post('/', ctrl.createInventory);
router.post('/:id/restock', ctrl.restockInventory);
router.get('/:id/photo', ctrl.viewInventoryPhoto);
router.post('/:id/photo', upload.single('photo'), ctrl.uploadInventoryPhoto);
router.delete('/:id/photo', ctrl.deleteInventoryPhoto);
router.put('/:id', ctrl.updateInventory);
router.delete('/:id', ctrl.deleteInventory);

module.exports = router;