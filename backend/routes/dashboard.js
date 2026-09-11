const express = require('express');
const router  = express.Router();
const ctrl = require('../Controllers/dashboardController');
const { requireRole } = require('../Middleware/requireRole');

const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];

// Scoped, role-appropriate overview widgets for the other two roles' /overview page.
router.get('/accountant-overview',  requireRole(...ALL_ROLES), ctrl.getAccountantOverview);
router.get('/coordinator-overview', requireRole(...ALL_ROLES), ctrl.getCoordinatorOverview);

router.get('/',              requireRole(...ALL_ROLES), ctrl.getDashboard);
router.get('/po-spend',      requireRole(...ALL_ROLES), ctrl.getDashboardPOSpend);
router.get('/productions',   requireRole(...ALL_ROLES), ctrl.getDashboardProductions);
router.get('/cost-summary',       requireRole(...ALL_ROLES), ctrl.getCostSummary);
router.get('/weekly-pl',          requireRole(...ALL_ROLES), ctrl.getWeeklyPL);
router.get('/labour-costs',       requireRole(...ALL_ROLES), ctrl.getLabourCosts);
router.get('/crew-headcount',     requireRole(...ALL_ROLES), ctrl.getCrewHeadcount);
router.get('/forecast-variance',  requireRole(...ALL_ROLES), ctrl.getDashboardForecastVariance);

module.exports = router;
