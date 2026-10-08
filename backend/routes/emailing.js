const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/emailingController');
const { requireRole } = require('../Middleware/requireRole');

// Sending messages, reviewing submissions and changing settings follow the existing
// role model: all three application roles (CLAUDE.md access policy). Guest is read-only
// and is limited by policies.json to the GET history/overview routes.
const ALL_ROLES = ['managing_director', 'construction_accountant', 'construction_coordinator'];
const staff = requireRole(...ALL_ROLES);

router.get('/overview', ctrl.getOverview);

router.get('/settings', ctrl.getSettings);
router.put('/settings', staff, ctrl.updateSettings);
router.get('/settings/test-recipients', ctrl.listTestRecipients);
router.post('/settings/test-recipients', staff, ctrl.addTestRecipient);
router.delete('/settings/test-recipients/:id', staff, ctrl.removeTestRecipient);
router.get('/provider-status', ctrl.getProviderStatus);

router.get('/templates', ctrl.listTemplates);
router.post('/templates', staff, ctrl.createTemplate);
router.put('/templates/:id', staff, ctrl.updateTemplate);
router.delete('/templates/:id', staff, ctrl.deleteTemplate);
router.post('/templates/:id/reset', staff, ctrl.resetTemplate);

router.get('/recipients', staff, ctrl.listRecipients);
router.get('/recipient-groups', staff, ctrl.getRecipientGroup);
router.post('/preview', staff, ctrl.preview);
router.post('/send', staff, ctrl.send);

router.get('/messages', ctrl.listMessages);
router.get('/messages/:id', ctrl.getMessage);
router.post('/messages/:id/retry', staff, ctrl.retryMessage);
router.post('/messages/:id/cancel', staff, ctrl.cancelMessage);
router.post('/queue/process', staff, ctrl.processQueueNow);

router.get('/suppressions', ctrl.listSuppressions);
router.post('/suppressions', staff, ctrl.addSuppression);
router.delete('/suppressions/:id', staff, ctrl.clearSuppression);

router.get('/submissions/timesheets', ctrl.listTimesheetSubmissions);
router.get('/submissions/timesheets/:id', ctrl.getTimesheetSubmission);
router.post('/submissions/timesheets/:id/approve', staff, ctrl.approveTimesheetSubmission);
router.post('/submissions/timesheets/:id/return', staff, ctrl.returnTimesheetSubmission);
router.post('/submissions/timesheets/:id/decline', staff, ctrl.declineTimesheetSubmission);

router.get('/submissions/invoices', ctrl.listInvoiceSubmissions);
router.get('/submissions/invoices/:id', ctrl.getInvoiceSubmission);
router.get('/submissions/invoices/:id/file', staff, ctrl.getInvoiceFile);
router.post('/submissions/invoices/:id/approve', staff, ctrl.approveInvoiceSubmission);
router.post('/submissions/invoices/:id/return', staff, ctrl.returnInvoiceSubmission);
router.post('/submissions/invoices/:id/decline', staff, ctrl.declineInvoiceSubmission);

router.get('/polls', ctrl.listPolls);
router.post('/polls', staff, ctrl.createPoll);
router.get('/polls/:id', ctrl.getPoll);
router.post('/polls/:id/close', staff, ctrl.closePoll);
router.post('/polls/:id/recipients/:recipientId/apply', staff, ctrl.applyPollResponse);

router.get('/portal-links/:crewId', staff, ctrl.getPortalLink);
router.post('/portal-links/:crewId/rotate', staff, ctrl.rotatePortalLink);
router.post('/portal-links/:crewId/revoke', staff, ctrl.revokePortalLink);

router.post('/automations/:type/run', staff, ctrl.runAutomationNow);

module.exports = router;
