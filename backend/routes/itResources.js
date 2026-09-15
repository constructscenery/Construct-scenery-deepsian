const express = require('express');
const router = express.Router();
const itResourcesController = require('../Controllers/itResourcesController');
const { requireRole } = require('../Middleware/roleCheck');

// Uses the roles defined in policies.json under '/it-resources'
router.get('/', itResourcesController.getITResources);
router.get('/:id', itResourcesController.getITResourceById);
router.get('/:id/credentials', itResourcesController.getITResourceCredentials);
router.post('/', itResourcesController.createITResource);
router.put('/:id', itResourcesController.updateITResource);
router.delete('/:id', itResourcesController.deleteITResource);

module.exports = router;
