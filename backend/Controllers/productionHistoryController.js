const db = require('../config/db');
const {
  LABOUR_CTES, LIVE_PO_STATUSES, weekEndingSql,
  getLiveLabour, getLivePurchaseOrders, buildProductionPL,
} = require('../services/liveCostService');

/**
 * CS-05 — production history (read-only; see ADR-04).
 *
 *   GET /api/productions/:id/history                       five-heading P&L + one row per week
 *   GET /api/productions/:id/history/weeks/:weekEnding     who worked that week + POs dated that week
 *   GET /api/productions/:id/set-costs                     labour + materials per set code
 *
 * All money is live and ex VAT, from services/liveCostService — the same numbers as the dashboard.
 * Weeks run Monday–Sunday and are keyed by the Sunday (week ending), like timesheets.
 */

const r2 = n => Math.round(n * 100) / 100;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const validDate = d => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

// ─── GET /api/productions/:id/history ─────────────────────────────────────────
const getHistory = async (req, res) => {
  const id = req.params.id;
  try {
    const { rows: [production] } = await db.query(
      'SELECT id, name, production_code, status, contract_type FROM productions WHERE id = $1', [id]
    );
    if (!production) return res.status(404).json({ error: 'Production not found' });

    const [[summary], labourWeeks, poWeeks] = await Promise.all([
      buildProductionPL(db, [production]),
      getLiveLabour(db, [id], { byWeek: true }),
      getLivePurchaseOrders(db, [id], { byWeek: true }),
    ]);

    const weeks = new Map();
    const week = key => {
      if (!weeks.has(key)) {
        weeks.set(key, {
          week_ending_date: key, labour_total: 0, labour_management: 0, crew_count: 0, timesheet_count: 0,
          draft_count: 0, po_total: 0, po_management: 0, po_count: 0,
        });
      }
      return weeks.get(key);
    };
    for (const l of labourWeeks) {
      if (!l.week_ending_date) continue;
      Object.assign(week(l.week_ending_date), {
        labour_total: l.labour_total, labour_management: l.labour_management, crew_count: l.crew_count,
        timesheet_count: l.timesheet_count, draft_count: l.draft_count,
      });
    }
    for (const p of poWeeks) {
      if (!p.week_ending_date) continue;
      Object.assign(week(p.week_ending_date), { po_total: p.po_total, po_management: p.po_management, po_count: p.po_count });
    }
    const rows = [...weeks.values()]
      .map(w => ({ ...w, total: r2(w.labour_total + w.po_total) }))
      .sort((a, b) => (a.week_ending_date < b.week_ending_date ? 1 : -1)); // newest first

    res.json({ production, summary, weeks: rows });
  } catch (err) {
    console.error('getHistory:', err);
    res.status(500).json({ error: 'Unable to load production history' });
  }
};

// ─── GET /api/productions/:id/history/weeks/:weekEnding ──────────────────────
const getHistoryWeek = async (req, res) => {
  const { id, weekEnding } = req.params;
  if (!validDate(weekEnding)) return res.status(400).json({ error: 'weekEnding must be a date (YYYY-MM-DD)' });
  try {
    const [{ rows: timesheets }, { rows: purchaseOrders }] = await Promise.all([
      db.query(
        `WITH ${LABOUR_CTES}
         SELECT lab.timesheet_id AS id, lab.status, lab.is_booked, lab.net, lab.mgmt_share,
                cm.first_name, cm.last_name, cm.crew_number, cm.crew_trade,
                COALESCE(t.rank_override, cm.crew_rank) AS crew_rank,
                (SELECT COUNT(*) FROM timesheet_entries te WHERE te.timesheet_id = lab.timesheet_id AND te.full_day_worked)::int AS days_worked,
                (SELECT COALESCE(SUM(te.overtime_hours), 0) FROM timesheet_entries te WHERE te.timesheet_id = lab.timesheet_id) AS overtime_hours,
                (SELECT STRING_AGG(DISTINCT TRIM(te.set_number), ', ')
                   FROM timesheet_entries te
                  WHERE te.timesheet_id = lab.timesheet_id AND te.full_day_worked
                    AND te.set_number IS NOT NULL AND TRIM(te.set_number) <> '') AS sets
         FROM lab
         LEFT JOIN timesheets t ON t.id = lab.timesheet_id
         LEFT JOIN crew_members cm ON cm.id = lab.crew_member_id
         WHERE lab.week_ending_date = $2
         ORDER BY cm.crew_trade NULLS LAST, cm.last_name NULLS LAST, cm.first_name`,
        [[id], weekEnding]
      ),
      db.query(
        `SELECT po.id, po.po_number, po.supplier_name, po.title, po.description, po.set_code, po.date_of_po,
                po.status, po.net_amount, (po.status = ANY($3::text[])) AS counts_in_costs
         FROM purchase_orders po
         WHERE po.production_id = $1
           AND ${weekEndingSql('po.date_of_po')} = $2::date
           AND po.status <> 'voided'   -- PurchaseOrderStatus.VOIDED
         ORDER BY po.date_of_po, po.po_number`,
        [id, weekEnding, LIVE_PO_STATUSES]
      ),
    ]);

    const people = timesheets.map(t => ({
      timesheet_id: t.id,
      name: [t.first_name, t.last_name].filter(Boolean).join(' ') || 'Unknown',
      crew_number: t.crew_number, trade: t.crew_trade, rank: t.crew_rank,
      status: t.status, paid: t.is_booked,
      days_worked: t.days_worked, overtime_hours: num(t.overtime_hours),
      sets: t.sets || null,
      net: r2(num(t.net)),
      management_share: num(t.mgmt_share),
    }));
    const pos = purchaseOrders.map(p => ({ ...p, net_amount: r2(num(p.net_amount)) }));
    res.json({
      week_ending_date: weekEnding,
      timesheets: people,
      purchase_orders: pos,
      totals: {
        labour: r2(people.reduce((s, p) => s + p.net, 0)),
        purchase_orders: r2(pos.filter(p => p.counts_in_costs).reduce((s, p) => s + p.net_amount, 0)),
      },
    });
  } catch (err) {
    console.error('getHistoryWeek:', err);
    res.status(500).json({ error: 'Unable to load that week' });
  }
};

// ─── GET /api/productions/:id/set-costs ───────────────────────────────────────
// Labour is split across sets by the days worked on each set that week (OT follows the same split);
// days with no set, and timesheets with no worked days, go to "Unassigned". Materials by PO set code.
const getSetCosts = async (req, res) => {
  const id = req.params.id;
  try {
    const [{ rows: labour }, { rows: materials }, { rows: sets }, { rows: universal }] = await Promise.all([
      db.query(
        `WITH ${LABOUR_CTES},
         day_sets AS (
           SELECT te.timesheet_id, NULLIF(LOWER(TRIM(te.set_number)), '') AS set_key,
                  MIN(TRIM(te.set_number)) AS label, COUNT(*) AS n
           FROM timesheet_entries te JOIN lab ON lab.timesheet_id = te.timesheet_id
           WHERE te.full_day_worked
           GROUP BY te.timesheet_id, NULLIF(LOWER(TRIM(te.set_number)), '')
         ),
         day_totals AS (SELECT timesheet_id, SUM(n) AS total FROM day_sets GROUP BY timesheet_id),
         alloc AS (
           SELECT d.set_key, d.label, lab.net * d.n / t.total AS amount
           FROM day_sets d
           JOIN day_totals t ON t.timesheet_id = d.timesheet_id
           JOIN lab ON lab.timesheet_id = d.timesheet_id
           UNION ALL
           SELECT NULL, NULL, lab.net FROM lab
           WHERE NOT EXISTS (SELECT 1 FROM day_totals t WHERE t.timesheet_id = lab.timesheet_id)
         )
         SELECT set_key, MIN(label) AS label, SUM(amount) AS labour FROM alloc GROUP BY set_key`,
        [[id]]
      ),
      db.query(
        `SELECT NULLIF(LOWER(TRIM(set_code)), '') AS set_key, MIN(TRIM(set_code)) AS label, SUM(net_amount) AS materials
         FROM purchase_orders
         WHERE production_id = $1 AND status = ANY($2::text[])
         GROUP BY NULLIF(LOWER(TRIM(set_code)), '')`,
        [id, LIVE_PO_STATUSES]
      ),
      db.query(
        `SELECT set_number, set_name FROM sets WHERE production_id = $1 AND set_number IS NOT NULL AND TRIM(set_number) <> ''`,
        [id]
      ),
      db.query(`SELECT code, name FROM universal_set_codes`),
    ]);

    const setNames = new Map(sets.map(s => [String(s.set_number).trim().toLowerCase(), { code: String(s.set_number).trim(), name: s.set_name }]));
    const mgmtNames = new Map(universal.map(u => [String(u.code).trim().toLowerCase(), { code: String(u.code).trim(), name: u.name }]));

    const rows = new Map();
    const row = (key, label) => {
      const k = key ?? '__unassigned__';
      if (!rows.has(k)) {
        let info;
        if (key == null) info = { set_code: null, set_name: 'Unassigned', source: 'unassigned' };
        else if (setNames.has(key)) info = { set_code: setNames.get(key).code, set_name: setNames.get(key).name, source: 'production' };
        else if (mgmtNames.has(key)) info = { set_code: mgmtNames.get(key).code, set_name: mgmtNames.get(key).name, source: 'management' };
        else info = { set_code: label, set_name: 'Not in set list', source: 'unknown' };
        rows.set(k, { ...info, labour: 0, materials: 0 });
      }
      return rows.get(k);
    };
    for (const l of labour) row(l.set_key, l.label).labour += num(l.labour);
    for (const m of materials) row(m.set_key, m.label).materials += num(m.materials);
    // Show every production set, even with no costs yet
    for (const [key, s] of setNames) row(key, s.code);

    const order = { production: 0, unknown: 1, management: 2, unassigned: 3 };
    const out = [...rows.values()]
      .map(r => ({ ...r, labour: r2(r.labour), materials: r2(r.materials), total: r2(r.labour + r.materials) }))
      .sort((a, b) => order[a.source] - order[b.source] || String(a.set_code).localeCompare(String(b.set_code), 'en', { numeric: true }));
    const totals = out.reduce((t, r) => ({ labour: r2(t.labour + r.labour), materials: r2(t.materials + r.materials), total: r2(t.total + r.total) }), { labour: 0, materials: 0, total: 0 });
    res.json({ rows: out, totals });
  } catch (err) {
    console.error('getSetCosts:', err);
    res.status(500).json({ error: 'Unable to load set costs' });
  }
};

module.exports = { getHistory, getHistoryWeek, getSetCosts };
