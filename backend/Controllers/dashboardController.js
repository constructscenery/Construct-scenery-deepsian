const db = require('../config/db');

const pad = (n) => String(n).padStart(2, '0');
const toLocalISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Fallback only when no timesheet has been sent out yet: latest completed Mon–Sun week.
const defaultWeekEnd = () => {
  const d = new Date();
  d.setDate(d.getDate() - (d.getDay() === 0 ? 7 : d.getDay()));
  return toLocalISO(d);
};

// TimesheetStatus.DISTRIBUTED / AMENDMENT_REQUESTED / FINALISED — a week counts once its timesheets are sent out
const SENT_OUT_TIMESHEET_STATUSES = ['distributed', 'amendment_requested', 'finalised'];

const parseWeekParam = (raw) => {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime()) || toLocalISO(d) !== raw) return null;
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return toLocalISO(d);
};

// ?week_ending=YYYY-MM-DD (snapped to that week's Sunday) or, by default, the latest
// week whose timesheets have been sent out — so it moves on as soon as a new week is distributed.
const resolveWeek = async (query = {}) => {
  let weekEnd = parseWeekParam(query.week_ending);
  if (!weekEnd) {
    // Capped at the current week so a mistyped future week ending can't take over the dashboard
    const thisSunday = new Date();
    thisSunday.setDate(thisSunday.getDate() + ((7 - thisSunday.getDay()) % 7));
    const { rows: [row] } = await db.query(
      `SELECT TO_CHAR(MAX(week_ending_date), 'YYYY-MM-DD') AS week_ending
       FROM timesheets WHERE status = ANY($1::text[]) AND week_ending_date <= $2`,
      [SENT_OUT_TIMESHEET_STATUSES, toLocalISO(thisSunday)]
    );
    weekEnd = row?.week_ending || defaultWeekEnd();
  }
  const start = new Date(`${weekEnd}T12:00:00`);
  start.setDate(start.getDate() - 6);
  return { weekStart: toLocalISO(start), weekEnd };
};

const ACTIVE_PRODUCTION_STATUSES = ['pre_production', 'active_build', 'strike'];

// ─── Sub-aggregators ──────────────────────────────────────────────────────────

const getPOSpend = async (today, weekStart, weekEnd) => {
  const [{ rows: todayPOs }, { rows: weekPOs }] = await Promise.all([
    db.query(
      `SELECT po.gross_amount, po.production_id, p.name AS prod_name
       FROM purchase_orders po
       JOIN productions p ON po.production_id = p.id
       WHERE po.status = 'approved' AND po.date_of_po = $1`,
      [today]
    ),
    db.query(
      `SELECT po.gross_amount, po.production_id, p.name AS prod_name
       FROM purchase_orders po
       JOIN productions p ON po.production_id = p.id
       WHERE po.status = 'approved' AND po.date_of_po BETWEEN $1 AND $2`,
      [weekStart, weekEnd]
    ),
  ]);

  const byProd = {};
  weekPOs.forEach(po => {
    const name = po.prod_name || 'Unknown';
    byProd[name] = (byProd[name] || 0) + parseFloat(po.gross_amount || 0);
  });

  return {
    today_total:   todayPOs.reduce((s, po) => s + parseFloat(po.gross_amount || 0), 0),
    week_total:    weekPOs.reduce((s, po) => s + parseFloat(po.gross_amount || 0), 0),
    by_production: Object.entries(byProd).map(([production, total]) => ({ production, total })),
  };
};

const getCurrentWeekLabour = async (weekEnd) => {
  const { rows } = await db.query(
    `SELECT t.grand_total, t.status, p.name AS prod_name
     FROM timesheets t
     JOIN productions p ON t.production_id = p.id
     WHERE t.week_ending_date = $1 AND t.status = ANY($2::text[])`,
    [weekEnd, SENT_OUT_TIMESHEET_STATUSES]
  );

  const byProd = {};
  rows.forEach(ts => {
    const name = ts.prod_name || 'Unknown';
    if (!byProd[name]) byProd[name] = { production: name, total: 0, pending: 0, approved: 0 };
    const amt = parseFloat(ts.grand_total || 0);
    byProd[name].total += amt;
    if (ts.status === 'finalised') byProd[name].approved += amt;  // TimesheetStatus.FINALISED
    else                          byProd[name].pending  += amt;
  });

  return {
    week_ending:   weekEnd,
    total:         rows.reduce((s, ts) => s + parseFloat(ts.grand_total || 0), 0),
    by_production: Object.values(byProd),
  };
};

const getActiveProductionsSummary = async () => {
  const { rows: productions } = await db.query(
    `SELECT id, name, contract_type, start_date, end_date, status
     FROM productions
     WHERE status IN ('pre_production', 'active_build', 'strike')`
  );
  if (!productions.length) return [];

  return Promise.all(productions.map(async prod => {
    const [{ rows: pos }, { rows: timesheets }, { rows: [budget] }] = await Promise.all([
      db.query(
        `SELECT net_amount FROM purchase_orders WHERE production_id = $1 AND status = 'approved'`,
        [prod.id]
      ),
      db.query(
        `SELECT grand_total FROM timesheets WHERE production_id = $1 AND status = 'finalised'`,
        [prod.id]
      ),
      db.query(
        `SELECT total_budget FROM cost_plus_budgets WHERE production_id = $1`,
        [prod.id]
      ),
    ]);

    const totalCosts      = [
      ...pos.map(p => parseFloat(p.net_amount || 0)),
      ...timesheets.map(t => parseFloat(t.grand_total || 0)),
    ].reduce((s, v) => s + v, 0);
    const totalBudget     = budget?.total_budget ? parseFloat(budget.total_budget) : null;
    const amountRemaining = totalBudget ? totalBudget - totalCosts : null;
    const pctRemaining    = totalBudget ? (amountRemaining / totalBudget) * 100 : null;

    let rag_status = 'unknown';
    if (pctRemaining !== null) {
      if      (pctRemaining > 20) rag_status = 'green';
      else if (pctRemaining > 5)  rag_status = 'amber';
      else                        rag_status = 'red';
    }

    return {
      id:                  prod.id,
      name:                prod.name,
      status:              prod.status,
      contract_type:       prod.contract_type,
      total_budget:        totalBudget,
      total_costs_to_date: totalCosts,
      amount_remaining:    amountRemaining,
      percent_remaining:   pctRemaining?.toFixed(1) || null,
      rag_status,
    };
  }));
};

// Crew on site = distinct crew with a sent-out timesheet for the given week
const getWeeklyCrewHeadcount = async (weekEnd) => {
  const [{ rows: [{ cnt }] }, { rows }] = await Promise.all([
    db.query(
      `SELECT COUNT(DISTINCT crew_member_id)::int AS cnt FROM timesheets
       WHERE week_ending_date = $1 AND status = ANY($2::text[])`,
      [weekEnd, SENT_OUT_TIMESHEET_STATUSES]
    ),
    db.query(
      `SELECT p.id AS production_id, p.name AS production, COUNT(DISTINCT t.crew_member_id)::int AS headcount
       FROM timesheets t
       JOIN productions p ON p.id = t.production_id
       WHERE t.week_ending_date = $1 AND t.status = ANY($2::text[])
       GROUP BY p.id, p.name
       ORDER BY headcount DESC, p.name`,
      [weekEnd, SENT_OUT_TIMESHEET_STATUSES]
    ),
  ]);
  return { week_ending: weekEnd, total: cnt || 0, by_production: rows };
};

const getForecastingVariance = async () => {
  // 1. Legacy forecasts (from percentometer)
  const { rows: forecasts } = await db.query(
    `SELECT f.*, p.name AS prod_name
     FROM forecasts f
     JOIN productions p ON f.production_id = p.id
     WHERE f.production_id IS NOT NULL AND f.deleted_at IS NULL`
  );

  // 2. Modern Cost Forecasts & Labour Flows (Addendum 4)
  const { rows: modernProds } = await db.query(
    `SELECT DISTINCT p.id AS production_id, p.name AS prod_name
     FROM productions p
     WHERE p.id IN (
       SELECT production_id FROM cost_forecasts WHERE production_id IS NOT NULL
       UNION
       SELECT production_id FROM labour_flows WHERE production_id IS NOT NULL
     )`
  );

  const legacyProdIds = new Set(forecasts.map(f => f.production_id));

  const legacyItems = await Promise.all(forecasts.map(async f => {
    const [{ rows: pos }, { rows: tss }] = await Promise.all([
      db.query(
        `SELECT net_amount FROM purchase_orders WHERE production_id = $1 AND status = 'approved'`,
        [f.production_id]
      ),
      db.query(
        `SELECT grand_total FROM timesheets WHERE production_id = $1 AND status != 'rejected' AND grand_total > 0`,
        [f.production_id]
      ),
    ]);
    const actual_materials = pos.map(p => parseFloat(p.net_amount || 0)).reduce((s, v) => s + v, 0);
    const actual_labour    = tss.map(t => parseFloat(t.grand_total || 0)).reduce((s, v) => s + v, 0);
    const actual          = actual_materials + actual_labour;
    const forecastTotal   = parseFloat(f.total_forecast_cost || 0);
    const variance        = actual - forecastTotal;
    return {
      forecast_name:       f.name,
      production:          f.prod_name,
      production_id:       f.production_id,
      forecast_total:      forecastTotal,
      forecast_labour:     parseFloat(f.total_labour_cost || 0),
      forecast_materials:  parseFloat(f.total_materials_cost || 0),
      actual_cost:         actual,
      actual_labour:       actual_labour,
      actual_materials:    actual_materials,
      variance_gbp:        variance,
      variance_percentage: (forecastTotal > 0 ? (variance / forecastTotal) * 100 : 0).toFixed(1),
      status: variance > 0 ? 'over_forecast' : variance < 0 ? 'under_forecast' : 'on_track',
    };
  }));

  // Add modern forecast items for productions not already covered in legacy forecasts
  const modernItems = await Promise.all(
    modernProds
      .filter(p => !legacyProdIds.has(p.production_id))
      .map(async p => {
        const [{ rows: cf }, { rows: lf }, { rows: pos }, { rows: tss }] = await Promise.all([
          db.query(
            `SELECT * FROM cost_forecasts WHERE production_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [p.production_id]
          ),
          db.query(
            `SELECT * FROM labour_flows WHERE production_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [p.production_id]
          ),
          db.query(
            `SELECT net_amount FROM purchase_orders WHERE production_id = $1 AND status = 'approved'`,
            [p.production_id]
          ),
          db.query(
            `SELECT grand_total FROM timesheets WHERE production_id = $1 AND status != 'rejected' AND grand_total > 0`,
            [p.production_id]
          ),
        ]);

        const latestCf = cf[0];
        const latestLf = lf[0];

        const forecast_labour = latestLf
          ? parseFloat(latestLf.grand_total_cost || 0)
          : (latestCf ? parseFloat(latestCf.total_crew_cost || 0) : 0);
        const forecast_materials = latestCf ? parseFloat(latestCf.total_non_labour_cost || 0) : 0;
        const forecastTotal = forecast_labour + forecast_materials;

        const actual_materials = pos.map(po => parseFloat(po.net_amount || 0)).reduce((s, v) => s + v, 0);
        const actual_labour = tss.map(t => parseFloat(t.grand_total || 0)).reduce((s, v) => s + v, 0);
        const actual = actual_materials + actual_labour;
        const variance = actual - forecastTotal;

        const name = latestLf?.title || latestCf?.title || p.prod_name;

        return {
          forecast_name:       name,
          production:          p.prod_name,
          production_id:       p.production_id,
          forecast_total:      forecastTotal,
          forecast_labour:     forecast_labour,
          forecast_materials:  forecast_materials,
          actual_cost:         actual,
          actual_labour:       actual_labour,
          actual_materials:    actual_materials,
          variance_gbp:        variance,
          variance_percentage: (forecastTotal > 0 ? (variance / forecastTotal) * 100 : 0).toFixed(1),
          status: variance > 0 ? 'over_forecast' : variance < 0 ? 'under_forecast' : 'on_track',
        };
      })
  );

  return [...legacyItems, ...modernItems];
};

const getProductionPipeline = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { rows } = await db.query(
    `SELECT id, name, start_date, end_date, status, contract_type
     FROM productions
     WHERE status = ANY($1::text[])
     ORDER BY start_date NULLS LAST, name`,
    [ACTIVE_PRODUCTION_STATUSES]
  );
  return rows.map(p => ({
    id:           p.id,
    name:         p.name,
    start_date:   p.start_date,
    end_date:     p.end_date,
    current_phase: p.status,
    days_remaining: p.end_date
      ? Math.ceil((new Date(p.end_date) - today) / 86400000)
      : null,
  }));
};

const getPendingApprovals = async () => {
  const [{ rows: [pos] }, { rows: [tss] }] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS cnt FROM purchase_orders WHERE status IN ('submitted', 'invoice_received') AND deleted_at IS NULL AND is_archived = false`),
    db.query(`SELECT COUNT(*)::int AS cnt FROM timesheets WHERE status IN ('distributed', 'amendment_requested')`),
  ]);
  return {
    purchase_orders: pos.cnt,
    timesheets:      tss.cnt,
    total:           pos.cnt + tss.cnt,
  };
};

// ─── GET /api/dashboard/accountant-overview ──────────────────────────────────
// Accountant has full Cost Report + Timesheets&PayRun access, so cost-RAG and
// labour-cost figures are appropriate here (unlike the MD-only base route).
const getAccountantOverview = async (req, res) => {
  try {
    const { weekEnd } = await resolveWeek(req.query);
    const [currentWeekLabour, activeProductions] = await Promise.all([
      getCurrentWeekLabour(weekEnd),
      getActiveProductionsSummary(),
    ]);
    res.json({ current_week_labour: currentWeekLabour, active_productions: activeProductions });
  } catch (err) {
    console.error('getAccountantOverview:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/dashboard/coordinator-overview ─────────────────────────────────
// Coordinator has no Cost Report or Forecasting access — this response is
// deliberately stripped of RAG/budget/labour-cost figures, returning only
// operational counts and the production pipeline.
const getCoordinatorOverview = async (req, res) => {
  try {
    const { weekEnd } = await resolveWeek(req.query);
    const [activeProductions, crewHeadcount, pendingApprovals, pipeline] = await Promise.all([
      getActiveProductionsSummary(),
      getWeeklyCrewHeadcount(weekEnd),
      getPendingApprovals(),
      getProductionPipeline(),
    ]);
    res.json({
      active_count:        activeProductions.length,
      crew_headcount:      crewHeadcount,
      open_po_count:       pendingApprovals.purchase_orders,
      production_pipeline: pipeline,
    });
  } catch (err) {
    console.error('getCoordinatorOverview:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/dashboard ───────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  const today     = toLocalISO(new Date());

  try {
    const { weekStart, weekEnd } = await resolveWeek(req.query);
    const [poSpend, labourCosts, activeProductions, crewHeadcount, forecastingVariance, pipeline, pendingApprovals] =
      await Promise.all([
        getPOSpend(today, weekStart, weekEnd),
        getCurrentWeekLabour(weekEnd),
        getActiveProductionsSummary(),
        getWeeklyCrewHeadcount(weekEnd),
        getForecastingVariance(),
        getProductionPipeline(),
        getPendingApprovals(),
      ]);

    res.json({
      generated_at:         new Date().toISOString(),
      current_week:         { start: weekStart, end: weekEnd },
      po_spend:             poSpend,
      current_week_labour:  labourCosts,
      active_productions:   activeProductions,
      crew_headcount:       crewHeadcount,
      forecasting_variance: forecastingVariance,
      production_pipeline:  pipeline,
      pending_approvals:    pendingApprovals,
      cash_flow: {
        note: 'Xero integration pending — to be quoted separately.',
        data: null,
      },
    });
  } catch (err) {
    console.error('getDashboard:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/dashboard/po-spend  (MD only)
const getDashboardPOSpend = async (req, res) => {
  const today = toLocalISO(new Date());
  try {
    const { weekStart, weekEnd } = await resolveWeek(req.query);
    const raw = await getPOSpend(today, weekStart, weekEnd);
    res.json({
      week_start:               weekStart,
      week_ending:              weekEnd,
      total_approved_today:     raw.today_total,
      total_approved_this_week: raw.week_total,
      breakdown: raw.by_production.map(p => ({ production_name: p.production, amount: p.total })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/dashboard/productions
const getDashboardProductions = async (req, res) => {
  try {
    res.json(await getActiveProductionsSummary());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/dashboard/labour-costs  (MD only) ───────────────────────────────
// Returns the selected week's labour cost by production (default: latest sent-out timesheet week).
// status = 'approved' if all timesheets for that production are finalised; 'pending' otherwise.
const getLabourCosts = async (req, res) => {
  try {
    const { weekEnd } = await resolveWeek(req.query);
    const { rows } = await db.query(
      `SELECT t.grand_total, t.status, t.crew_member_id, p.id AS prod_id, p.name AS prod_name
       FROM timesheets t
       JOIN productions p ON t.production_id = p.id
       WHERE t.week_ending_date = $1 AND t.status = ANY($2::text[])`,
      [weekEnd, SENT_OUT_TIMESHEET_STATUSES]
    );

    const byProd = {};
    rows.forEach(ts => {
      if (!byProd[ts.prod_id]) byProd[ts.prod_id] = { production_id: ts.prod_id, production_name: ts.prod_name || 'Unknown', amount: 0, all_finalised: true, crew: new Set() };
      const p = byProd[ts.prod_id];
      p.amount += parseFloat(ts.grand_total || 0);
      p.crew.add(ts.crew_member_id);
      if (ts.status !== 'finalised') p.all_finalised = false;
    });

    const breakdown = Object.values(byProd).map(p => ({
      production_id:   p.production_id,
      production_name: p.production_name,
      amount:          parseFloat(p.amount.toFixed(2)),
      crew_count:      p.crew.size,
      status:          p.all_finalised ? 'approved' : 'pending',
    }));

    res.json({
      current_week_ending:   weekEnd,
      total_labour_this_week: parseFloat(breakdown.reduce((s, p) => s + p.amount, 0).toFixed(2)),
      breakdown,
    });
  } catch (err) {
    console.error('getLabourCosts:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/dashboard/crew-headcount  (MD only) ────────────────────────────
// Crew = distinct crew members with a timesheet in the selected week.
const getCrewHeadcount = async (req, res) => {
  try {
    const { weekEnd } = await resolveWeek(req.query);
    const crew = await getWeeklyCrewHeadcount(weekEnd);
    res.json({
      week_ending:       weekEnd,
      total_active_crew: crew.total,
      breakdown:         crew.by_production.map(r => ({ production_id: r.production_id, production_name: r.production, crew_count: r.headcount })),
    });
  } catch (err) {
    console.error('getCrewHeadcount:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/dashboard/forecast-variance  (MD only) ─────────────────────────
// Per active production with a primary linked forecast: live variance vs actual costs.
const getDashboardForecastVariance = async (req, res) => {
  try {
    const { rows: linked } = await db.query(
      `SELECT f.id AS forecast_id,
              f.name AS scenario_name,
              f.total_forecast_cost AS forecast_total,
              f.production_id,
              p.name AS production_name
       FROM forecasts f
       JOIN productions p ON p.id = f.production_id
       WHERE f.is_primary = true
         AND f.deleted_at IS NULL
         AND p.status IN ('pre_production', 'active_build', 'strike')`
    );

    const result = await Promise.all(linked.map(async f => {
      const { rows: [costs] } = await db.query(
        `SELECT COALESCE(SUM(gross_amount), 0) AS total
         FROM cost_report_entries
         WHERE production_id = $1 AND deleted_at IS NULL`,
        [f.production_id]
      );
      const forecastTotal  = parseFloat(f.forecast_total || 0);
      const actualTotal    = parseFloat(costs.total || 0);
      const varianceAmount = actualTotal - forecastTotal;
      const variancePct    = forecastTotal > 0 ? (varianceAmount / forecastTotal) * 100 : null;

      return {
        production_id:   f.production_id,
        production_name: f.production_name,
        forecast_total:  forecastTotal,
        actual_total:    actualTotal,
        variance_amount: parseFloat(varianceAmount.toFixed(2)),
        variance_pct:    variancePct !== null ? parseFloat(variancePct.toFixed(2)) : null,
      };
    }));

    res.json(result);
  } catch (err) {
    console.error('getDashboardForecastVariance:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/dashboard/cost-summary  (MD only) ───────────────────────────────
// Returns live budget-health summary for every active (non-archived, non-complete)
// production.  total_budget comes from cost_plus_budget_lines sum (Cost Plus) or
// productions.agreed_price (On a Price).  total_costs_to_date from cost_report_entries.
const getCostSummary = async (req, res) => {
  try {
    const { rows: productions } = await db.query(
      `SELECT id, name, contract_type, agreed_price
       FROM productions
       WHERE status IN ('pre_production', 'active_build', 'strike')`
    );

    const summaries = await Promise.all(productions.map(async prod => {
      const [{ rows: [costs] }, budgetRow] = await Promise.all([
        db.query(
          `SELECT COALESCE(SUM(gross_amount), 0) AS total
           FROM cost_report_entries
           WHERE production_id = $1 AND deleted_at IS NULL`,
          [prod.id]
        ),
        prod.contract_type === 'cost_plus'
          ? db.query(
              `SELECT COALESCE(SUM(bl.total), 0) AS total_budget
               FROM cost_plus_budget_lines bl
               JOIN cost_plus_budgets b ON bl.budget_id = b.id
               WHERE b.production_id = $1`,
              [prod.id]
            ).then(r => r.rows[0])
          : Promise.resolve({ total_budget: prod.agreed_price }),
      ]);

      const totalCosts  = parseFloat(costs.total);
      const totalBudget = budgetRow?.total_budget ? parseFloat(budgetRow.total_budget) : null;
      const remaining   = totalBudget !== null ? totalBudget - totalCosts : null;
      const utilPct     = totalBudget > 0 ? (totalCosts / totalBudget) * 100 : null;

      let rag_status = 'unknown';
      if (utilPct !== null) {
        if      (utilPct < 75) rag_status = 'green';
        else if (utilPct <= 90) rag_status = 'amber';
        else                    rag_status = 'red';
      }

      return {
        production_id:          prod.id,
        production_name:        prod.name,
        contract_type:          prod.contract_type,
        total_budget:           totalBudget,
        total_costs_to_date:    totalCosts,
        amount_remaining:       remaining,
        budget_utilisation_pct: utilPct !== null ? parseFloat(utilPct.toFixed(2)) : null,
        rag_status,
      };
    }));

    res.json(summaries);
  } catch (err) {
    console.error('getCostSummary:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/dashboard/weekly-pl  (MD only) ─────────────────────────────────
// Returns Warren's Weekly P&L for every active Cost Plus production.
// margin_earned is derived from cost_report_entries for each week.
// warrens_salary, luton_uplift, box_rental_uplift come from cost_report_weekly_pl.
const getWeeklyPL = async (req, res) => {
  try {
    const { rows: productions } = await db.query(
      `SELECT p.id, p.name
       FROM productions p
       JOIN cost_plus_budgets b ON b.production_id = p.id
       WHERE p.status IN ('pre_production', 'active_build', 'strike')
         AND p.contract_type = 'cost_plus'`
    );

    const result = await Promise.all(productions.map(async prod => {
      const [{ rows: budgetRows }, { rows: entries }, { rows: plRows }] = await Promise.all([
        db.query('SELECT margin_rate FROM cost_plus_budgets WHERE production_id = $1', [prod.id]),
        db.query(
          `SELECT entry_type, week_ending_date, date, gross_amount
           FROM cost_report_entries
           WHERE production_id = $1 AND deleted_at IS NULL`,
          [prod.id]
        ),
        db.query(
          `SELECT week_ending_date, warrens_salary, luton_uplift, box_rental_uplift
           FROM cost_report_weekly_pl
           WHERE production_id = $1
           ORDER BY week_ending_date`,
          [prod.id]
        ),
      ]);

      const margin = parseFloat(budgetRows[0]?.margin_rate || 0.10);
      const plMap  = Object.fromEntries(
        plRows.map(r => [String(r.week_ending_date).split('T')[0], r])
      );

      // Group labour by week_ending_date; supplier by date (week proxy)
      const weekCosts = {};
      entries.forEach(e => {
        const key = e.entry_type === 'labour'
          ? String(e.week_ending_date).split('T')[0]
          : String(e.date).split('T')[0];
        if (!weekCosts[key]) weekCosts[key] = 0;
        weekCosts[key] += parseFloat(e.gross_amount || 0);
      });

      let runningTotal = 0;
      const weeks = Object.keys(weekCosts).sort().map(week => {
        const totalCost   = weekCosts[week];
        const marginEarned = totalCost * (margin / (1 + margin));
        const pl          = plMap[week] || {};
        const salary      = parseFloat(pl.warrens_salary || 0);
        const luton       = parseFloat(pl.luton_uplift || 0);
        const boxRental   = parseFloat(pl.box_rental_uplift || 0);
        const weeklyProfit = marginEarned - salary - luton - boxRental;
        runningTotal += weeklyProfit;

        return {
          week_ending_date:    week,
          margin_earned:       parseFloat(marginEarned.toFixed(2)),
          warrens_salary:      salary,
          luton_uplift:        luton,
          box_rental_uplift:   boxRental,
          weekly_profit:       parseFloat(weeklyProfit.toFixed(2)),
          running_total_profit: parseFloat(runningTotal.toFixed(2)),
        };
      });

      return { production_id: prod.id, production_name: prod.name, weeks };
    }));

    res.json(result);
  } catch (err) {
    console.error('getWeeklyPL:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getDashboard, getDashboardPOSpend, getDashboardProductions,
  getCostSummary, getWeeklyPL,
  getLabourCosts, getCrewHeadcount, getDashboardForecastVariance,
  getAccountantOverview, getCoordinatorOverview,
};
