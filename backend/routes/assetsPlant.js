const express = require('express');
const router = express.Router();
const assetsPlantController = require('../Controllers/assetsPlantController');
const { requireRole } = require('../Middleware/roleCheck');

// Uses the roles defined in policies.json under '/assets-plant'
router.get('/', assetsPlantController.getAssets);
router.get('/:id', assetsPlantController.getAssetById);
router.post('/', assetsPlantController.createAsset);
router.put('/:id', assetsPlantController.updateAsset);
router.delete('/:id', assetsPlantController.deleteAsset);

module.exports = router;
