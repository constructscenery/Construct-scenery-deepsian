/**
 * CS-02 — Live production costs (read-model). See ADR-01 in DASHBOARD_PRODUCTION_REPORTING_IMPLEMENTATION_PLAN.md.
 *
 * Nothing here writes. cost_report_entries, pay runs and historical reports are untouched: the Cost
 * Report stays the "booked" view, this is the "live" view used by the dashboard P&L (CS-01) and the
 * production history (CS-05).
 *
 * Labour (ex VAT):
 *   a timesheet that has a live (non-deleted) labour cost_report_entry   → that entry's net_amount
 *   any other timesheet, whatever its status (draft included)            → timesheets.gross_total
 *   (gross_total is the pre-VAT pay amount; labourCostService books it as net_amount)
 *   When the MD re-opens a pay run its entries are soft-deleted, so those timesheets fall back to
 *   the live figure automatically. Nothing is counted twice.
 *
 * Materials (ex VAT): purchase_orders.net_amount for POs that have gone to the supplier
 *   (issued, invoice_received, pending_approval, approved) + hire equipment cost to date.
 *   Draft, submitted and voided POs are excluded.
 *
 * Management costs: labour days and POs tagged with a universal management set code (CS-03) are
 *   reported separately and excluded from the production's Profit / Loss (client question Q6).
 *   A code that is also one of the production's own sets counts as a production set.
 */
const { calcHireItem } = require('./costReportService');

// PurchaseOrderStatus.ISSUED / INVOICE_RECEIVED / PENDING_APPROVAL / APPROVED
const LIVE_PO_STATUSES = ['issued', 'invoice_received', 'pending_approval', 'approved'];
// ProductionStatus.PRE_PRODUCTION / ACTIVE_BUILD / STRIKE
const ACTIVE_PRODUCTION_STATUSES = ['pre_production', 'active_build', 'strike'];

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = n => Math.round(n * 100) / 100;

/** SQL: is set code `codeExpr` a management code for production `prodExpr`? */
const isManagementCodeSql = (codeExpr, prodExpr) => `(
  ${codeExpr} IS NOT NULL AND TRIM(${codeExpr}) <> ''
  AND EXISTS (SELECT 1 FROM universal_set_codes u
              WHERE u.category = 'management' AND LOWER(TRIM(u.code)) = LOWER(TRIM(${codeExpr})))
  AND NOT EXISTS (SELECT 1 FROM sets s
                  WHERE s.production_id = ${prodExpr} AND LOWER(TRIM(s.set_number)) = LOWER(TRIM(${codeExpr})))
)`;

/**
 * Per-timesheet live labour CTEs, shared by every labour query below.
 * Produces `lab` with: timesheet_id, production_id, week_ending_date, status, crew_member_id,
 * net, is_booked, mgmt_share (0–1 share of worked days on management codes).
 */
const LABOUR_CTES = `
  booked AS (
    SELECT source_id AS timesheet_id, production_id, MAX(week_ending_date) AS week_ending_date,
           SUM(net_amount) AS net
    FROM cost_report_entries
    WHERE entry_type = 'labour' AND source_type = 'timesheet' AND deleted_at IS NULL
      AND production_id = ANY($1::uuid[])
    GROUP BY source_id, production_id
  ),
  lab_base AS (
    SELECT t.id AS timesheet_id, t.production_id, t.week_ending_date, t.status, t.crew_member_id,
           COALESCE(b.net, t.gross_total, 0) AS net, (b.timesheet_id IS NOT NULL) AS is_booked
    FROM timesheets t
    LEFT JOIN booked b ON b.timesheet_id = t.id
    WHERE t.production_id = ANY($1::uuid[])
    UNION ALL
    -- booked labour whose timesheet no longer exists (defensive: processed timesheets can't be deleted)
    SELECT b.timesheet_id, b.production_id, b.week_ending_date, 'finalised', NULL, b.net, true
    FROM booked b
    WHERE NOT EXISTS (SELECT 1 FROM timesheets t WHERE t.id = b.timesheet_id)
  ),
  lab_share AS (
    SELECT te.timesheet_id,
           (COUNT(*) FILTER (WHERE ${isManagementCodeSql('te.set_number', 'lb.production_id')}))::numeric
             / NULLIF(COUNT(*), 0) AS mgmt_share
    FROM timesheet_entries te
    JOIN lab_base lb ON lb.timesheet_id = te.timesheet_id
    WHERE te.full_day_worked
    GROUP BY te.timesheet_id
  ),
  lab AS (
    SELECT lb.*, COALESCE(ls.mgmt_share, 0) AS mgmt_share
    FROM lab_base lb LEFT JOIN lab_share ls ON ls.timesheet_id = lb.timesheet_id
  )`;

/** Live labour per production (optionally per production + week ending). */
const getLiveLabour = async (db, productionIds, { byWeek = false } = {}) => {
  if (!productionIds.length) return [];
  const groupCols = byWeek ? 'production_id, week_ending_date' : 'production_id';
  const { rows } = await db.query(
    `WITH ${LABOUR_CTES}
     SELECT ${groupCols},
            SUM(net)                                                  AS labour_total,
            SUM(net * mgmt_share)                                     AS labour_management,
            SUM(CASE WHEN is_booked THEN net ELSE 0 END)              AS labour_booked,
            SUM(CASE WHEN is_booked THEN 0 ELSE net END)              AS labour_unbooked,
            COUNT(*) FILTER (WHERE status = 'draft')::int             AS draft_count,  -- TimesheetStatus.DRAFT
            COUNT(*)::int                                             AS timesheet_count,
            COUNT(DISTINCT crew_member_id)::int                       AS crew_count
     FROM lab
     GROUP BY ${groupCols}
     ORDER BY ${groupCols}`,
    [productionIds]
  );
  return rows.map(r => ({
    production_id:     r.production_id,
    ...(byWeek ? { week_ending_date: r.week_ending_date } : {}),
    labour_total:      r2(num(r.labour_total)),
    labour_management: r2(num(r.labour_management)),
    labour_booked:     r2(num(r.labour_booked)),
    labour_unbooked:   r2(num(r.labour_unbooked)),
    draft_count:       r.draft_count,
    timesheet_count:   r.timesheet_count,
    crew_count:        r.crew_count,
  }));
};

/** SQL: Sunday week ending for a date column (Mon–Sun weeks, like timesheets). */
const weekEndingSql = col => `(${col} + ((7 - EXTRACT(ISODOW FROM ${col})::int) % 7))::date`;

/** Live PO materials per production (optionally per production + week ending of date_of_po). */
const getLivePurchaseOrders = async (db, productionIds, { byWeek = false } = {}) => {
  if (!productionIds.length) return [];
  const weekCol = byWeek ? `, ${weekEndingSql('po.date_of_po')} AS week_ending_date` : '';
  const groupCols = byWeek ? 'po.production_id, 2' : 'po.production_id';
  const { rows } = await db.query(
    `SELECT po.production_id${weekCol},
            SUM(po.net_amount)                                                       AS po_total,
            SUM(CASE WHEN ${isManagementCodeSql('po.set_code', 'po.production_id')} THEN po.net_amount ELSE 0 END) AS po_management,
            SUM(CASE WHEN po.status = 'approved' THEN po.net_amount ELSE 0 END)      AS po_approved,
            COUNT(*)::int                                                            AS po_count
     FROM purchase_orders po
     WHERE po.production_id = ANY($1::uuid[])
       AND po.status = ANY($2::text[])
     GROUP BY ${groupCols}
     ORDER BY ${groupCols}`,
    [productionIds, LIVE_PO_STATUSES]
  );
  return rows.map(r => ({
    production_id: r.production_id,
    ...(byWeek ? { week_ending_date: r.week_ending_date } : {}),
    po_total:      r2(num(r.po_total)),
    po_management: r2(num(r.po_management)),
    po_approved:   r2(num(r.po_approved)),
    po_committed:  r2(num(r.po_total) - num(r.po_approved)),
    po_count:      r.po_count,
  }));
};

/** Hire equipment cost to date per production (same formula as the Cost Report). */
const getLiveHire = async (db, productionIds) => {
  if (!productionIds.length) return [];
  const { rows } = await db.query(
    `SELECT production_id, hire_start_date, return_date, weekly_hire_rate
     FROM hire_equipment WHERE production_id = ANY($1::uuid[])`,
    [productionIds]
  );
  const byProd = new Map();
  for (const row of rows) {
    if (!row.hire_start_date) continue;
    byProd.set(row.production_id, (byProd.get(row.production_id) || 0) + calcHireItem(row).total_cost);
  }
  return [...byProd.entries()].map(([production_id, hire_total]) => ({ production_id, hire_total: r2(hire_total) }));
};

/**
 * Budget / revenue per production (ex VAT): On a Price → productions.agreed_price,
 * Cost Plus → Σ cost_plus_budget_lines.total. null when no budget has been set.
 * Also invoiced_to_date: Σ sub_total (ex VAT) of Xero invoices allocated in Sales.
 */
const getBudgetRevenue = async (db, productionIds) => {
  if (!productionIds.length) return [];
  const { rows } = await db.query(
    `SELECT p.id AS production_id, p.contract_type,
            CASE WHEN p.contract_type = 'cost_plus' THEN bl.total ELSE p.agreed_price END AS budget_revenue, -- ContractType.COST_PLUS
            inv.invoiced AS invoiced_to_date
     FROM productions p
     LEFT JOIN (
       SELECT b.production_id, SUM(l.total) AS total
       FROM cost_plus_budgets b JOIN cost_plus_budget_lines l ON l.budget_id = b.id
       WHERE b.production_id = ANY($1::uuid[])
       GROUP BY b.production_id
     ) bl ON bl.production_id = p.id
     LEFT JOIN (
       SELECT xi.production_id, SUM(xi.sub_total) AS invoiced
       FROM xero_invoices xi
       JOIN xero_connection xc ON xc.singleton = true AND xc.tenant_id = xi.tenant_id
       WHERE xi.production_id = ANY($1::uuid[]) AND xi.xero_status IN ('authorised', 'paid') -- XeroInvoiceStatus
       GROUP BY xi.production_id
     ) inv ON inv.production_id = p.id
     WHERE p.id = ANY($1::uuid[])`,
    [productionIds]
  );
  return rows.map(r => ({
    production_id:    r.production_id,
    contract_type:    r.contract_type,
    budget_revenue:   r.budget_revenue == null ? null : r2(num(r.budget_revenue)),
    invoiced_to_date: r2(num(r.invoiced_to_date)),
  }));
};

/**
 * The five-heading P&L for each production (CS-01), plus breakdowns for tooltips.
 *   labour_charged    = live labour − management labour
 *   materials_charged = live PO materials − management POs + hire
 *   profit_loss       = budget_revenue − labour_charged − materials_charged  (null without a budget)
 */
const buildProductionPL = async (db, productions) => {
  const ids = productions.map(p => p.id);
  const [labour, pos, hire, budget] = await Promise.all([
    getLiveLabour(db, ids),
    getLivePurchaseOrders(db, ids),
    getLiveHire(db, ids),
    getBudgetRevenue(db, ids),
  ]);
  const index = rows => new Map(rows.map(r => [r.production_id, r]));
  const L = index(labour), P = index(pos), H = index(hire), B = index(budget);

  return productions.map(p => {
    const l = L.get(p.id) || {};
    const po = P.get(p.id) || {};
    const h = H.get(p.id) || {};
    const b = B.get(p.id) || {};
    const labourCharged    = r2(num(l.labour_total) - num(l.labour_management));
    const materialsPo      = r2(num(po.po_total) - num(po.po_management));
    const materialsHire    = r2(num(h.hire_total));
    const materialsCharged = r2(materialsPo + materialsHire);
    const budgetRevenue    = b.budget_revenue ?? null;
    const profitLoss       = budgetRevenue == null ? null : r2(budgetRevenue - labourCharged - materialsCharged);
    return {
      production_id:      p.id,
      production_name:    p.name,
      production_code:    p.production_code ?? null,
      status:             p.status,
      contract_type:      p.contract_type,
      budget_revenue:     budgetRevenue,
      invoiced_to_date:   b.invoiced_to_date ?? 0,
      labour_charged:     labourCharged,
      labour_booked:      num(l.labour_booked),
      labour_unbooked:    num(l.labour_unbooked),
      draft_timesheets:   l.draft_count || 0,
      materials_charged:  materialsCharged,
      materials_po:       materialsPo,
      materials_po_approved: num(po.po_approved),
      materials_hire:     materialsHire,
      management_costs:   r2(num(l.labour_management) + num(po.po_management)),
      profit_loss:        profitLoss,
      profit_pct:         budgetRevenue ? r2((profitLoss / budgetRevenue) * 100) : null,
    };
  });
};

const sumPL = rows => {
  const t = { budget_revenue: 0, labour_charged: 0, materials_charged: 0, profit_loss: 0, management_costs: 0 };
  for (const r of rows) {
    t.labour_charged += r.labour_charged;
    t.materials_charged += r.materials_charged;
    t.management_costs += r.management_costs;
    if (r.budget_revenue != null) { t.budget_revenue += r.budget_revenue; t.profit_loss += r.profit_loss; }
  }
  Object.keys(t).forEach(k => { t[k] = r2(t[k]); });
  // FB-03 (F-F): with no budgeted production there is no profit to total — report null ("—"),
  // not a green £0 that reads as break-even.
  t.budgeted_count = rows.filter(r => r.budget_revenue != null).length;
  if (t.budgeted_count === 0) { t.budget_revenue = null; t.profit_loss = null; }
  return t;
};

module.exports = {
  LIVE_PO_STATUSES, ACTIVE_PRODUCTION_STATUSES,
  isManagementCodeSql, weekEndingSql, LABOUR_CTES,
  getLiveLabour, getLivePurchaseOrders, getLiveHire, getBudgetRevenue, buildProductionPL, sumPL,
};
