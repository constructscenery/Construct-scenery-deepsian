const express = require('express');
const router = express.Router();
const buildingsController = require('../Controllers/buildingsController');
const { requireRole } = require('../Middleware/roleCheck');

// Uses the roles defined in policies.json globally via checkPolicy
router.get('/', buildingsController.getBuildings);
router.get('/:id', buildingsController.getBuildingById);
router.post('/', buildingsController.createBuilding);
router.put('/:id', buildingsController.updateBuilding);
router.delete('/:id', buildingsController.deleteBuilding);

module.exports = router;
