const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/crewRoleContactsController');
const docsCtrl = require('../Controllers/attachedDocumentsController').role_contacts;
const { upload } = require('../Middleware/upload');
const { requireRole } = require('../Middleware/requireRole');

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

router.get('/', ctrl.listRoleContacts);
router.get('/:id', ctrl.getRoleContactById);
router.post('/', requireRole(...ALL_ROLES), ctrl.createRoleContact);
router.put('/:id', requireRole(...ALL_ROLES), ctrl.updateRoleContact);
router.patch('/:id', requireRole(...ALL_ROLES), ctrl.updateRoleContact);
router.delete('/:id', requireRole(...ALL_ROLES), ctrl.deleteRoleContact);

// Documents
router.get('/:id/documents', requireRole(...ALL_ROLES), docsCtrl.list);
router.post('/:id/documents', requireRole(...ALL_ROLES), upload.single('file'), docsCtrl.upload);
router.get('/:id/documents/:docId/view', requireRole(...ALL_ROLES), docsCtrl.view);
router.delete('/:id/documents/:docId', requireRole(...ALL_ROLES), docsCtrl.delete);

module.exports = router;
