const express = require('express');
const router  = express.Router();
const ctrl = require('../Controllers/forecastingController');
const { requireRole } = require('../Middleware/requireRole');

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

// Forecasts
router.get('/forecasts',        ctrl.getAllForecasts);
router.post('/forecasts',       requireRole(...ALL_ROLES), ctrl.createForecast);
router.get('/forecasts/:id',    ctrl.getForecastById);
router.patch('/forecasts/:id',       requireRole(...ALL_ROLES), ctrl.updateForecast);
router.patch('/forecasts/:id/link',  requireRole(...ALL_ROLES), ctrl.linkForecast);
router.delete('/forecasts/:id', requireRole(...ALL_ROLES), ctrl.deleteForecast);

// Percentometer
router.get('/percentometer/ratios',     ctrl.getRatios);
router.post('/percentometer/calculate', ctrl.calculatePercentometer);
router.put('/percentometer/ratios',     requireRole(...ALL_ROLES), ctrl.updateRatios);

// Supplier/Materials Catalogue (forecasting pricing data)
router.get('/catalogue',        ctrl.getCatalogue);
router.post('/catalogue',       requireRole(...ALL_ROLES), ctrl.createCatalogueItem);
router.put('/catalogue/:id',    requireRole(...ALL_ROLES), ctrl.updateCatalogueItem);
router.delete('/catalogue/:id', requireRole(...ALL_ROLES), ctrl.deleteCatalogueItem);

// BECTU Rates
router.get('/bectu-rates',      ctrl.getBectuRates);

module.exports = router;
