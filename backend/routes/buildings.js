const express = require('express');
const router = express.Router();
const buildingsController = require('../Controllers/buildingsController');
const documents = require('../Controllers/attachedDocumentsController').buildings;
const { upload } = require('../Middleware/upload');
const { requireRole } = require('../Middleware/roleCheck');

// Uses the roles defined in policies.json globally via checkPolicy
router.get('/', buildingsController.getBuildings);
router.get('/:id/documents', documents.list);
router.post('/:id/documents', upload.single('file'), documents.upload);
router.get('/:id/documents/:docId/view', documents.view);
router.delete('/:id/documents/:docId', documents.delete);
router.get('/:id', buildingsController.getBuildingById);
router.post('/', buildingsController.createBuilding);
router.put('/:id', buildingsController.updateBuilding);
router.delete('/:id', buildingsController.deleteBuilding);

module.exports = router;
