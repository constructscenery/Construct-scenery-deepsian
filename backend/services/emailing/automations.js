/**
 * Automated crew reminders. Each run is repeat-safe: idempotency keys are scoped
 * to the stage + week, so re-running (cron overlap, restart, manual "run now")
 * never sends a second copy to the same person for the same week.
 *
 * Every automation is OFF by default (email_settings) and, while live sending is
 * off, only reaches addresses in the internal test group.
 */
const { MESSAGE_TYPES } = require('./constants');
const { getSettings } = require('./settings');
const { timesheetMissing, invoiceMissing } = require('./recipients');
const { sendMessages } = require('./composer');
const { londonToday, weekEndingFor, previousWeekEnding, isSunday } = require('./dates');

const AUTOMATIONS = {
  timesheet_reminders: {
    settingKey: 'automation_timesheet_reminders',
    label: 'Timesheet reminder (Sunday 16:00)',
    defaultWeek: () => weekEndingFor(londonToday()),
  },
  timesheet_followups: {
    settingKey: 'automation_timesheet_followups',
    label: 'Timesheet follow-up (Monday 10:00)',
    defaultWeek: () => previousWeekEnding(londonToday()),
  },
  invoice_requests: {
    settingKey: 'automation_invoice_requests',
    label: 'Invoice request (Tuesday 10:00)',
    defaultWeek: () => previousWeekEnding(londonToday()),
  },
};

const toRecipient = (row) => ({
  crewMemberId: row.id,
  productionId: row.production_id,
  weekEndingDate: row.week_ending_date || null,
  amount: row.grand_total != null ? Number(row.grand_total) : undefined,
  relatedRecordType: row.timesheet_id ? 'timesheet' : undefined,
  relatedRecordId: row.timesheet_id || undefined,
});

/**
 * Runs (or previews) one automation.
 * @param {string} type  key of AUTOMATIONS
 * @param {object} opts
 * @param {string} [opts.weekEndingDate]  defaults to the automation's natural week
 * @param {boolean} [opts.dryRun]         list who would be emailed, send nothing
 * @param {boolean} [opts.scheduled]      true from cron → respects the on/off setting
 * @param {string} [opts.userId]
 */
async function runAutomation(type, { weekEndingDate, dryRun = false, scheduled = false, userId = null } = {}) {
  const def = AUTOMATIONS[type];
  if (!def) throw Object.assign(new Error(`Unknown automation: ${type}`), { status: 400 });

  const settings = await getSettings({ fresh: true });
  if (scheduled && !settings[def.settingKey]) return { type, skipped: 'disabled' };

  const week = weekEndingDate || def.defaultWeek();
  if (!isSunday(week)) throw Object.assign(new Error('week_ending_date must be a Sunday (YYYY-MM-DD)'), { status: 400 });

  let rows;
  let messageType;
  let templateKey;
  let stage;
  if (type === 'invoice_requests') {
    rows = (await invoiceMissing({ weekEndingDate: week })).map((r) => ({ ...r, week_ending_date: week }));
    messageType = MESSAGE_TYPES.INVOICE_REQUEST;
    templateKey = 'invoice_request_default';
    stage = 'auto-invoice';
  } else {
    rows = (await timesheetMissing({ weekEndingDate: week })).map((r) => ({ ...r, week_ending_date: week }));
    messageType = MESSAGE_TYPES.TIMESHEET_REMINDER;
    templateKey = type === 'timesheet_followups' ? 'timesheet_reminder_followup' : 'timesheet_reminder_default';
    stage = type === 'timesheet_followups' ? 'auto-followup' : 'auto-initial';
  }

  const preview = rows.map((r) => ({
    crew_member_id: r.id,
    name: `${r.first_name} ${r.last_name}`,
    email: r.email,
    production_id: r.production_id,
    production_name: r.production_name,
    week_ending_date: week,
    suppressed: !!r.suppression_reason,
  }));

  if (dryRun || !rows.length) {
    return { type, week_ending_date: week, dry_run: dryRun, live_sending_enabled: settings.live_sending_enabled, count: rows.length, recipients: preview };
  }

  const result = await sendMessages({
    messageType,
    templateKey,
    recipients: rows.map(toRecipient),
    userId,
    isAutomated: true,
    idempotencyScope: stage,
  });
  return { type, week_ending_date: week, dry_run: false, count: rows.length, ...result };
}

module.exports = { AUTOMATIONS, runAutomation };
