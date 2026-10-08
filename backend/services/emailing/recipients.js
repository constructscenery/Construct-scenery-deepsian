/**
 * Recipient lookup, eligibility and suggested groups for crew emailing.
 */
const db = require('../../config/db');
const { isValidEmail } = require('./settings');
const { TIMESHEET_PRODUCTION_STATUSES } = require('./constants');
const { addDays } = require('./dates');

const CREW_COLUMNS = `
  cm.id, cm.crew_number, cm.first_name, cm.last_name, cm.email, cm.employment_status,
  cm.crew_trade, cm.crew_rank, cm.is_active, cm.availability_status,
  sup.reason AS suppression_reason, sup.created_at AS suppressed_at`;

const SUPPRESSION_JOIN = `
  LEFT JOIN LATERAL (
    SELECT s.reason, s.created_at FROM email_suppressions s
    WHERE LOWER(s.email) = LOWER(cm.email) AND s.cleared_at IS NULL
    LIMIT 1
  ) sup ON true`;

const LIVE_CREW = `cm.deleted_at IS NULL AND COALESCE(cm.is_archived, false) = false`;

/**
 * Explains whether a crew member can receive email right now.
 * @returns {{ eligible: boolean, reason: string|null }}
 */
function eligibility(crew, policy) {
  if (!crew) return { eligible: false, reason: 'not_found' };
  if (crew.is_active === false) return { eligible: false, reason: 'inactive' };
  if (!crew.email) return { eligible: false, reason: 'no_email' };
  if (!isValidEmail(crew.email)) return { eligible: false, reason: 'invalid_email' };
  if (crew.suppression_reason) return { eligible: false, reason: 'suppressed' };
  if (policy && !policy.allows(crew.email)) return { eligible: false, reason: 'live_sending_disabled' };
  return { eligible: true, reason: null };
}

const REASON_LABELS = {
  not_found: 'Crew member not found',
  inactive: 'Crew member is deactivated',
  no_email: 'No email address on file',
  invalid_email: 'Email address looks invalid',
  suppressed: 'Address suppressed after a bounce or complaint',
  live_sending_disabled: 'Live sending is off and this address is not in the internal test group',
};

async function loadCrewByIds(ids) {
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT ${CREW_COLUMNS}
     FROM crew_members cm
     ${SUPPRESSION_JOIN}
     WHERE cm.id = ANY($1::uuid[]) AND ${LIVE_CREW}`,
    [ids]
  );
  return rows;
}

/** Crew picker for the compose screen. */
async function searchCrew({ search, productionId, limit = 300 }) {
  const params = [];
  const where = [LIVE_CREW];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(cm.first_name ILIKE $${params.length} OR cm.last_name ILIKE $${params.length}
      OR (cm.first_name || ' ' || cm.last_name) ILIKE $${params.length}
      OR cm.email ILIKE $${params.length} OR cm.crew_number ILIKE $${params.length})`);
  }
  if (productionId) {
    params.push(productionId);
    where.push(`(EXISTS (SELECT 1 FROM production_crew pc WHERE pc.crew_member_id = cm.id AND pc.production_id = $${params.length})
      OR EXISTS (SELECT 1 FROM timesheets t WHERE t.crew_member_id = cm.id AND t.production_id = $${params.length}))`);
  }
  params.push(Math.min(Math.max(parseInt(limit, 10) || 300, 1), 1000));
  const { rows } = await db.query(
    `SELECT ${CREW_COLUMNS},
            last_msg.status AS last_email_status, last_msg.created_at AS last_emailed_at
     FROM crew_members cm
     ${SUPPRESSION_JOIN}
     LEFT JOIN LATERAL (
       SELECT el.status, el.created_at FROM email_log el
       WHERE el.crew_member_id = cm.id ORDER BY el.created_at DESC LIMIT 1
     ) last_msg ON true
     WHERE ${where.join(' AND ')}
     ORDER BY cm.is_active DESC, cm.last_name, cm.first_name
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

/**
 * Crew who owe a timesheet for `weekEndingDate`: linked to an active production
 * (production_crew dates overlapping the week, or a timesheet on that production
 * in the previous three weeks) with no submitted/approved crew submission and no
 * finalised timesheet for that week.
 * @returns rows of { crew..., production_id, production_name }
 */
async function timesheetMissing({ weekEndingDate, productionId = null }) {
  const weekStart = addDays(weekEndingDate, -6);
  const params = [weekEndingDate, weekStart, addDays(weekEndingDate, -21), TIMESHEET_PRODUCTION_STATUSES];
  let prodFilter = '';
  if (productionId) { params.push(productionId); prodFilter = `AND p.id = $${params.length}`; }

  const { rows } = await db.query(
    `WITH candidates AS (
       SELECT pc.crew_member_id, pc.production_id
       FROM production_crew pc
       WHERE (pc.start_date IS NULL OR pc.start_date <= $1::date)
         AND (pc.end_date IS NULL OR pc.end_date >= $2::date)
       UNION
       SELECT t.crew_member_id, t.production_id
       FROM timesheets t
       WHERE t.week_ending_date >= $3::date AND t.week_ending_date < $1::date
     )
     SELECT ${CREW_COLUMNS}, p.id AS production_id, p.name AS production_name
     FROM candidates c
     JOIN crew_members cm ON cm.id = c.crew_member_id
     JOIN productions p ON p.id = c.production_id
     ${SUPPRESSION_JOIN}
     WHERE ${LIVE_CREW} AND cm.is_active = true
       AND p.status = ANY($4::text[]) ${prodFilter}
       AND NOT EXISTS (
         SELECT 1 FROM crew_timesheet_submissions s
         WHERE s.crew_member_id = cm.id AND s.production_id = p.id
           AND s.week_ending_date = $1::date AND s.status IN ('submitted', 'approved')
       )
       AND NOT EXISTS (
         SELECT 1 FROM timesheets t2
         WHERE t2.crew_member_id = cm.id AND t2.production_id = p.id
           AND t2.week_ending_date = $1::date AND t2.status = 'finalised'
       )
     ORDER BY p.name, cm.last_name, cm.first_name`,
    params
  );
  return rows;
}

/**
 * Self-employed crew whose timesheet for the week is in the CMS (distributed or
 * amendment requested — i.e. not yet finalised) with no invoice attached and no
 * invoice waiting for review. Mirrors the existing chase-invoices rule.
 */
async function invoiceMissing({ weekEndingDate = null, productionId = null }) {
  const params = [];
  const where = [
    LIVE_CREW, 'cm.is_active = true',
    "cm.employment_status = 'self_employed'",
    "t.status IN ('distributed', 'amendment_requested')",
    't.invoice_attachment_url IS NULL',
    `NOT EXISTS (
       SELECT 1 FROM crew_invoice_submissions i
       WHERE i.crew_member_id = t.crew_member_id AND i.production_id = t.production_id
         AND i.week_ending_date = t.week_ending_date AND i.status IN ('submitted', 'approved')
     )`,
  ];
  if (weekEndingDate) { params.push(weekEndingDate); where.push(`t.week_ending_date = $${params.length}::date`); }
  if (productionId) { params.push(productionId); where.push(`t.production_id = $${params.length}`); }

  const { rows } = await db.query(
    `SELECT ${CREW_COLUMNS}, p.id AS production_id, p.name AS production_name,
            t.id AS timesheet_id, t.week_ending_date, t.grand_total
     FROM timesheets t
     JOIN crew_members cm ON cm.id = t.crew_member_id
     JOIN productions p ON p.id = t.production_id
     ${SUPPRESSION_JOIN}
     WHERE ${where.join(' AND ')}
     ORDER BY t.week_ending_date DESC, p.name, cm.last_name`,
    params
  );
  return rows;
}

/** Poll recipients who have not responded yet. */
async function pollNonResponders(pollId) {
  const { rows } = await db.query(
    `SELECT ${CREW_COLUMNS}
     FROM availability_poll_recipients r
     JOIN crew_members cm ON cm.id = r.crew_member_id
     ${SUPPRESSION_JOIN}
     WHERE r.poll_id = $1 AND r.response IS NULL AND ${LIVE_CREW}
     ORDER BY cm.last_name, cm.first_name`,
    [pollId]
  );
  return rows;
}

module.exports = {
  eligibility, REASON_LABELS, loadCrewByIds, searchCrew,
  timesheetMissing, invoiceMissing, pollNonResponders,
};
