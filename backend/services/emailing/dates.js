/**
 * Date helpers for week-ending (Sunday) logic. All dates are ISO YYYY-MM-DD strings
 * interpreted as UTC calendar dates, matching how timesheets.week_ending_date is handled.
 */
const { WEEK_DAYS } = require('./constants');

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso  = (d) => d.toISOString().split('T')[0];

function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const d = toDate(value);
  return !Number.isNaN(d.getTime()) && toIso(d) === value;
}

function isSunday(iso) {
  return isIsoDate(iso) && toDate(iso).getUTCDay() === 0;
}

function addDays(iso, days) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** The 7 days (Mon → Sun) of the week ending on `weekEndingIso`. */
function weekDays(weekEndingIso) {
  return WEEK_DAYS.map((day, idx) => ({ day_of_week: day, date: addDays(weekEndingIso, idx - 6) }));
}

/** Today's calendar date in Europe/London (the business timezone). */
function londonToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The Sunday on or after `iso`. */
function weekEndingFor(iso) {
  const dow = toDate(iso).getUTCDay();
  return dow === 0 ? iso : addDays(iso, 7 - dow);
}

/** The most recent Sunday on or before `iso`. */
function previousWeekEnding(iso) {
  const dow = toDate(iso).getUTCDay();
  return addDays(iso, -dow);
}

/** Week-ending options offered on the crew portal: current week plus the previous `count - 1`. */
function recentWeekEndings(count = 6, now = new Date()) {
  const current = weekEndingFor(londonToday(now));
  return Array.from({ length: count }, (_, i) => addDays(current, -7 * i));
}

function formatUkDate(iso) {
  if (!isIsoDate(iso)) return iso || '';
  return toDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

module.exports = {
  isIsoDate, isSunday, addDays, weekDays, londonToday, weekEndingFor,
  previousWeekEnding, recentWeekEndings, formatUkDate,
};
