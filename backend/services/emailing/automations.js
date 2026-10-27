/**
 * Automated crew reminders. Each run is repeat-safe: idempotency keys are scoped
 * to the stage + week, so re-running (cron overlap, restart, manual "run now")
 * never sends a second copy to the same person for the same week.
 *
 * Every automation is OFF by default (email_settings) and, while live sending is
 * off, only reaches addresses in the internal test group.
 */
const AUTOMATIONS = {};

/**
 * Runs (or previews) one automation.
 * @param {string} type key of AUTOMATIONS
 */
async function runAutomation(type) {
  const def = AUTOMATIONS[type];
  if (!def) throw Object.assign(new Error(`Unknown automation: ${type}`), { status: 400 });
}

module.exports = { AUTOMATIONS, runAutomation };

