const express = require('express');
const router  = express.Router();
const ctrl = require('../Controllers/forecastingController');
const costForecastsCtrl = require('../Controllers/costForecastsController');
const labourFlowsCtrl = require('../Controllers/labourFlowsController');
const weeklyEstimatorCtrl = require('../Controllers/weeklyEstimatorController');
const { requireRole } = require('../Middleware/requireRole');

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator', 'guest'];
const STAFF_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

// ─── TOOL 1: COST FORECASTS (Addendum 4) ──────────────────────────────────────
router.get('/cost-forecasts',              costForecastsCtrl.listCostForecasts);
router.post('/cost-forecasts',             requireRole(...ALL_ROLES), costForecastsCtrl.createCostForecast);
router.get('/cost-forecasts/:id',          costForecastsCtrl.getCostForecastById);
router.put('/cost-forecasts/:id',          requireRole(...ALL_ROLES), costForecastsCtrl.updateCostForecast);
router.post('/cost-forecasts/:id/lock',    requireRole(...ALL_ROLES), costForecastsCtrl.lockCostForecast);
router.post('/cost-forecasts/:id/version', requireRole(...ALL_ROLES), costForecastsCtrl.versionCostForecast);
router.delete('/cost-forecasts/:id',       requireRole(...ALL_ROLES), costForecastsCtrl.deleteCostForecast);

// ─── TOOL 2: WEEKLY LABOUR FLOWS (Addendum 4) ────────────────────────────────
router.get('/labour-flows/burn-rate',     labourFlowsCtrl.getLabourBurnRate);
router.get('/labour-flows',              labourFlowsCtrl.listLabourFlows);
router.post('/labour-flows',             requireRole(...ALL_ROLES), labourFlowsCtrl.createLabourFlow);
router.get('/labour-flows/:id/burn-rate', labourFlowsCtrl.getLabourBurnRate);
router.get('/labour-flows/:id',          labourFlowsCtrl.getLabourFlowById);
router.put('/labour-flows/:id',          requireRole(...ALL_ROLES), labourFlowsCtrl.updateLabourFlow);
router.post('/labour-flows/:id/lock',    requireRole(...ALL_ROLES), labourFlowsCtrl.lockLabourFlow);
router.post('/labour-flows/:id/version', requireRole(...ALL_ROLES), labourFlowsCtrl.versionLabourFlow);
router.delete('/labour-flows/:id',       requireRole(...ALL_ROLES), labourFlowsCtrl.deleteLabourFlow);
router.get('/labour-flows/:id/export/csv', labourFlowsCtrl.exportLabourFlowCsv);

// ─── TOOL 3: WEEKLY CUSTOM ESTIMATOR (Warren's Multi-Week Estimator) ────────
router.get('/weekly-custom-estimates/rates/lookup', weeklyEstimatorCtrl.getRatesLookup);
router.get('/weekly-custom-estimates',              weeklyEstimatorCtrl.listEstimates);
router.post('/weekly-custom-estimates',             requireRole(...STAFF_ROLES), weeklyEstimatorCtrl.createEstimate);
router.get('/weekly-custom-estimates/:id',          weeklyEstimatorCtrl.getEstimateById);
router.put('/weekly-custom-estimates/:id',          requireRole(...STAFF_ROLES), weeklyEstimatorCtrl.updateEstimate);
router.delete('/weekly-custom-estimates/:id',       requireRole(...STAFF_ROLES), weeklyEstimatorCtrl.deleteEstimate);

// ─── LEGACY / AUXILIARY FORECASTING & PERCENTOMETER ───────────────────────────
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

// Supplier/Materials Catalogue
router.get('/catalogue',        ctrl.getCatalogue);
router.post('/catalogue',       requireRole(...ALL_ROLES), ctrl.createCatalogueItem);
router.put('/catalogue/:id',    requireRole(...ALL_ROLES), ctrl.updateCatalogueItem);
router.delete('/catalogue/:id', requireRole(...ALL_ROLES), ctrl.deleteCatalogueItem);

// BECTU Rates
router.get('/bectu-rates',      ctrl.getBectuRates);

module.exports = router;
