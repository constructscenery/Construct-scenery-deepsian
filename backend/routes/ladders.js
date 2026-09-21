const express = require('express');
const router = express.Router();
const laddersController = require('../Controllers/laddersController');

router.get('/', laddersController.getLadders);
router.get('/:id', laddersController.getLadderById);
router.post('/', laddersController.createLadder);
router.put('/:id', laddersController.updateLadder);
router.patch('/:id', laddersController.updateLadder);
router.delete('/:id', laddersController.deleteLadder);
router.patch('/:id/restore', laddersController.restoreLadder);

module.exports = router;
