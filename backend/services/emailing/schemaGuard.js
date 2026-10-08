/**
 * Startup schema guard for crew emailing.
 *
 * Applies the same statements as the CrewEmailingAndPortal migration
 * (services/emailing/emailingSchema.js — all IF NOT EXISTS), so the Emailing tab
 * works even if `npm run migration:run` has not been run on this database yet.
 */
const db = require('../../config/db');
const { UP_STATEMENTS } = require('./emailingSchema');

async function ensureEmailingTables() {
  try {
    const { rows: [row] } = await db.query(
      `SELECT to_regclass('public.crew_submission_reviews') AS last_table,
              (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_name = 'email_log' AND column_name = 'idempotency_key') AS has_col`
    );
    if (row && row.last_table && Number(row.has_col) > 0) {
      console.log('✅ Schema guard: crew emailing tables present');
      return true;
    }
    for (const sql of UP_STATEMENTS) await db.query(sql);
    console.log('✅ Schema guard: crew emailing tables created');
    return true;
  } catch (err) {
    console.error('⚠️  Schema guard failed (crew emailing):', err.message);
    return false;
  }
}

module.exports = { ensureEmailingTables };
