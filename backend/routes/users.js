const express = require('express');
const router  = express.Router();
const ctrl    = require('../Controllers/usersController');
const { requireRole } = require('../Middleware/requireRole');

// User account administration — exclusive to Managing Director.
const MD = 'managing_director';

router.get('/',               requireRole(MD), ctrl.listUsers);
router.post('/',              requireRole(MD), ctrl.createUser);
router.patch('/:id',          requireRole(MD), ctrl.updateUser);
router.patch('/:id/password', requireRole(MD), ctrl.changePassword);
router.delete('/:id',         requireRole(MD), ctrl.deleteUser);

module.exports = router;
