/**
 * Background jobs for crew emailing (registered from server.js):
 *   - queue worker: every minute (plus an immediate kick after each enqueue)
 *   - automations:  Sunday 16:00, Monday 10:00, Tuesday 10:00 (Europe/London),
 *                   each a no-op unless switched on in Emailing → Settings.
 *
 * Set EMAIL_WORKER_ENABLED=false on any extra instance that should not send.
 */
const db = require('../../config/db');
const { processQueue } = require('./queue');
const { runAutomation } = require('./automations');

async function tablesReady() {
  try {
    const { rows: [row] } = await db.query(`SELECT to_regclass('public.crew_portal_links') AS t, to_regclass('public.email_settings') AS s`);
    return !!(row && row.t && row.s);
  } catch {
    return false;
  }
}

function start(cron) {
  if (process.env.EMAIL_WORKER_ENABLED === 'false') {
    console.log('ℹ️  Crew emailing worker disabled (EMAIL_WORKER_ENABLED=false)');
    return;
  }

  let ready = null;
  const guard = async () => {
    if (ready) return true;
    ready = await tablesReady();
    if (!ready) console.warn('⚠️  Crew emailing tables missing — run `npm run migration:run`. Worker idle.');
    return ready;
  };

  cron.schedule('* * * * *', async () => {
    if (!(await guard())) return;
    try {
      const { processed } = await processQueue();
      if (processed) console.log(`[CRON] Email queue: processed ${processed}`);
    } catch (err) {
      console.error('[CRON] Email queue failed:', err.message);
    }
  }, { timezone: 'UTC' });

  const schedule = (expr, type) => cron.schedule(expr, async () => {
    if (!(await guard())) return;
    try {
      const result = await runAutomation(type, { scheduled: true });
      if (result.skipped) return;
      console.log(`[CRON] ${type}: week ${result.week_ending_date}, ${result.count} recipient(s)`, result.summary || '');
    } catch (err) {
      console.error(`[CRON] ${type} failed:`, err.message);
    }
  }, { timezone: 'Europe/London' });

  schedule('0 16 * * 0', 'timesheet_reminders');
  schedule('0 10 * * 1', 'timesheet_followups');
  schedule('0 10 * * 2', 'invoice_requests');

  console.log('✅ Cron: crew emailing queue (every minute) + reminder automations (Europe/London) scheduled');
}

module.exports = { start };
