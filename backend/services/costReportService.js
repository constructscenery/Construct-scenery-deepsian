/**
 * CostReportService — the single access point for all cost_report_entries reads
 * and the write operations triggered on PO approval and pay run processing.
 *
 * No controller or module should query cost_report_entries directly.
 * All read methods accept a `db` argument (pool or pg client).
 *
 * entry_type = 'supplier' → written on PO approval (recordSupplierCost)
 * entry_type = 'labour'   → written on pay run processing (recordWeeklyLabour)
 * deleted_at IS NOT NULL  → soft-deleted; excluded from all live reads
 */

// ─── Write: PO approval ───────────────────────────────────────────────────────
const recordSupplierCost = async (po, client) => {
  await client.query(
    `INSERT INTO cost_report_entries
       (production_id, entry_type, source_id, source_type,
        set_code, account_code, date, net_amount, vat, gross_amount,
        supplier_name, po_number, payment_method)
     VALUES ($1,'supplier',$2,'purchase_order',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      po.production_id,
      po.id,
      po.set_code     || null,
      po.account_code || null,
      po.date_of_po,
      parseFloat(po.net_amount),
      parseFloat(po.vat || 0),
      parseFloat(po.gross_amount),
      po.supplier_name,
      po.po_number,
      po.paid_from    || null,
    ]
  );
};

// ─── Write: soft-delete on PO approval revert (MD edge case) ─────────────────
const softDeleteEntry = async (poId, client) => {
  await client.query(
    `UPDATE cost_report_entries
     SET deleted_at = NOW()
     WHERE source_id = $1 AND source_type = 'purchase_order' AND deleted_at IS NULL`,
    [poId]
  );
};

// ─── Read: supplier cost entries ──────────────────────────────────────────────
// Optional filters: as_at_date, set_code, account_code, supplier_name,
//                   date_from, date_to.
const getSupplierCosts = async (productionId, filters = {}, db) => {
  const conds  = [`cre.production_id = $1`, `cre.entry_type = 'supplier'`, `cre.deleted_at IS NULL`];
  const params = [productionId];
  let i = 2;

  if (filters.as_at_date)    { conds.push(`cre.date <= $${i++}`);             params.push(filters.as_at_date); }
  if (filters.set_code)      { conds.push(`cre.set_code = $${i++}`);           params.push(filters.set_code); }
  if (filters.account_code)  { conds.push(`cre.account_code = $${i++}`);       params.push(filters.account_code); }
  if (filters.supplier_name) { conds.push(`cre.supplier_name ILIKE $${i++}`);  params.push(`%${filters.supplier_name}%`); }
  if (filters.date_from)     { conds.push(`cre.date >= $${i++}`);              params.push(filters.date_from); }
  if (filters.date_to)       { conds.push(`cre.date <= $${i++}`);              params.push(filters.date_to); }

  const { rows } = await db.query(
    `SELECT cre.*
     FROM   cost_report_entries cre
     WHERE  ${conds.join(' AND ')}
     ORDER  BY cre.date DESC, cre.created_at DESC`,
    params
  );
  return rows;
};

// ─── Read: labour cost entries ────────────────────────────────────────────────
// Joined with crew_members for name and initials.
// Optional filters: as_at_date, week_ending_date, trade, crew_member_id.
const getLabourCosts = async (productionId, filters = {}, db) => {
  const conds  = [`cre.production_id = $1`, `cre.entry_type = 'labour'`, `cre.deleted_at IS NULL`];
  const params = [productionId];
  let i = 2;

  if (filters.as_at_date)       { conds.push(`cre.date <= $${i++}`);                                              params.push(filters.as_at_date); }
  if (filters.week_ending_date) { conds.push(`cre.week_ending_date = $${i++}`);                                  params.push(filters.week_ending_date); }
  if (filters.date_from)        { conds.push(`cre.week_ending_date >= $${i++}`);                                 params.push(filters.date_from); }
  if (filters.date_to)          { conds.push(`cre.week_ending_date <= $${i++}`);                                 params.push(filters.date_to); }
  if (filters.trade)            { conds.push(`cre.trade = $${i++}`);                                             params.push(filters.trade); }
  if (filters.crew_member_id)   { conds.push(`cre.crew_member_id = $${i++}`);                                   params.push(filters.crew_member_id); }
  if (filters.crew_member)      { conds.push(`(cm.first_name || ' ' || cm.last_name) ILIKE $${i++}`);           params.push(`%${filters.crew_member}%`); }

  const { rows } = await db.query(
    `SELECT cre.*,
            cm.crew_number,
            cm.first_name,
            cm.last_name,
            UPPER(LEFT(cm.first_name, 1) || LEFT(cm.last_name, 1)) AS initials
     FROM   cost_report_entries cre
     LEFT JOIN crew_members cm ON cm.id = cre.crew_member_id
     WHERE  ${conds.join(' AND ')}
     ORDER  BY cre.week_ending_date DESC, cre.trade, cm.last_name, cm.first_name`,
    params
  );
  return rows;
};

// ─── Read: hire equipment costs ──────────────────────────────────────────────
const getHireCosts = async (productionId, db) => {
  const { rows } = await db.query(
    `SELECT * FROM hire_equipment WHERE production_id = $1 ORDER BY hire_start_date DESC`,
    [productionId]
  );
  return rows.map(calcHireItem);
};

/** Cost of one hire_equipment row to date (weekly rate × whole weeks, min 1). Shared with liveCostService. */
const calcHireItem = item => {
  const start = new Date(item.hire_start_date);
  const end = item.return_date ? new Date(item.return_date) : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diffDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const weeksHired = diffDays === 0 ? 1 : Math.ceil(diffDays / 7);
  const rate = parseFloat(item.weekly_hire_rate || 0);
  const totalCost = Number((rate * weeksHired).toFixed(2));
  return {
    ...item,
    days_hired: diffDays,
    weeks_hired: weeksHired,
    total_cost: totalCost,
  };
};

// ─── Read: amounts invoiced to production (FB-01 / ADR-05) ───────────────────
// One list, two sources:
//   • Xero sales invoices allocated to the production — authorised or paid, connected organisation
//     only (the same rule as the dashboard P&L, liveCostService.getBudgetRevenue). Amount = sub_total
//     (ex VAT). Read-only here: allocation is managed on the Sales page.
//   • Manual cost_report_invoices rows (entered ex VAT). A manual row whose invoice number matches a
//     counted Xero invoice on the same production is returned with duplicate_of_xero = true and is
//     NOT counted, so an invoice keyed in both places is never double counted.
// Optional asAtDate keeps invoices dated on or before that day (undated rows fall back to created_at).
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const normInvoiceNo = s => (s == null ? '' : String(s).trim().toLowerCase());

const invoicedToProduction = async (productionId, { asAtDate } = {}, db) => {
  const params = asAtDate ? [productionId, asAtDate] : [productionId];
  const [{ rows: xero }, { rows: manual }] = await Promise.all([
    db.query(
      `SELECT xi.id, xi.invoice_number, xi.contact_name, xi.reference, xi.invoice_date,
              xi.sub_total, xi.total_tax, xi.total, xi.xero_status
       FROM xero_invoices xi
       JOIN xero_connection xc ON xc.singleton = true AND xc.tenant_id = xi.tenant_id
       WHERE xi.production_id = $1
         AND xi.xero_status IN ('authorised', 'paid') -- XeroInvoiceStatus.AUTHORISED / PAID
         ${asAtDate ? 'AND COALESCE(xi.invoice_date, xi.created_at::date) <= $2' : ''}
       ORDER BY xi.invoice_date NULLS LAST, xi.invoice_number`,
      params
    ),
    db.query(
      `SELECT * FROM cost_report_invoices
       WHERE production_id = $1
         ${asAtDate ? 'AND COALESCE(date, created_at::date) <= $2' : ''}
       ORDER BY date NULLS LAST, created_at`,
      params
    ),
  ]);

  const xeroNumbers = new Set(xero.map(x => normInvoiceNo(x.invoice_number)).filter(Boolean));
  const rows = [
    ...xero.map(x => ({
      id:                  x.id,
      source:              'xero',
      invoice_description: x.reference || x.contact_name || null,
      contact_name:        x.contact_name,
      po_number:           null,
      date:                x.invoice_date,
      invoice_number:      x.invoice_number,
      amount:              r2(x.sub_total),   // ex VAT
      vat:                 r2(x.total_tax),
      gross:               r2(x.total),
      xero_status:         x.xero_status,
      notes:               null,
      duplicate_of_xero:   false,
      counted:             true,
    })),
    ...manual.map(m => {
      const dup = xeroNumbers.has(normInvoiceNo(m.invoice_number));
      return { ...m, source: 'manual', amount: r2(m.amount), duplicate_of_xero: dup, counted: !dup };
    }),
  ].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  const xeroTotal   = r2(rows.filter(r => r.source === 'xero').reduce((s, r) => s + r.amount, 0));
  const manualTotal = r2(rows.filter(r => r.source === 'manual' && r.counted).reduce((s, r) => s + r.amount, 0));
  return { rows, xero_total: xeroTotal, manual_total: manualTotal, total: r2(xeroTotal + manualTotal) };
};

// ─── Read: aggregated summary metrics ────────────────────────────────────────
// Supplier + labour + hire equipment totals and invoiced-to-production total.
// FB-01 / ADR-06: every figure is EX VAT (supplier = PO net; labour = timesheet total before VAT),
// matching the dashboard P&L and Xero sub-totals. Tables still carry net / VAT / gross per line.
const getSummaryMetrics = async (productionId, db) => {
  const [{ rows: [costs] }, invoiced, hireItems] = await Promise.all([
    db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'supplier' THEN net_amount ELSE 0 END), 0) AS total_supplier,
         COALESCE(SUM(CASE WHEN entry_type = 'labour'   THEN net_amount ELSE 0 END), 0) AS total_labour,
         COALESCE(SUM(net_amount), 0)                                                    AS total_costs,
         MAX(created_at)                                                                 AS last_updated
       FROM cost_report_entries
       WHERE production_id = $1 AND deleted_at IS NULL`,
      [productionId]
    ),
    invoicedToProduction(productionId, {}, db),
    getHireCosts(productionId, db),
  ]);

  const totalHireCosts = hireItems.reduce((acc, h) => acc + h.total_cost, 0);
  const totalCosts     = parseFloat(costs.total_costs) + totalHireCosts;
  const totalInvoiced  = invoiced.total;
  const profit         = totalInvoiced - totalCosts;

  return {
    vat_basis:            'ex_vat',
    total_supplier_costs: parseFloat(costs.total_supplier),
    total_labour_costs:   parseFloat(costs.total_labour),
    total_hire_costs:     Number(totalHireCosts.toFixed(2)),
    total_costs_to_date:  Number(totalCosts.toFixed(2)),
    total_invoiced:       totalInvoiced,
    invoiced_xero:        invoiced.xero_total,
    invoiced_manual:      invoiced.manual_total,
    current_profit:       Number(profit.toFixed(2)),
    // No turnover → no meaningful percentage (was 0, which read as "break-even").
    profit_pct:           totalInvoiced > 0 ? (profit / totalInvoiced) * 100 : null,
    last_updated:         costs.last_updated,
  };
};

// ─── Read: as-at-date snapshot ────────────────────────────────────────────────
// Returns cost totals as of asAtDate — identical to a live query run that day.
// Powers the date-specific export feature across both report types. Ex VAT (ADR-06);
// invoiced/profit are now included so "As at" views show them too (FB-01).
const getAsAtSnapshot = async (productionId, asAtDate, db) => {
  const [{ rows: [snap] }, invoiced, hireItems] = await Promise.all([
    db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'supplier' THEN net_amount ELSE 0 END), 0) AS total_supplier,
         COALESCE(SUM(CASE WHEN entry_type = 'labour'   THEN net_amount ELSE 0 END), 0) AS total_labour,
         COALESCE(SUM(net_amount), 0)                                                    AS total_costs
       FROM cost_report_entries
       WHERE production_id = $1
         AND date          <= $2
         AND deleted_at    IS NULL`,
      [productionId, asAtDate]
    ),
    invoicedToProduction(productionId, { asAtDate }, db),
    getHireCosts(productionId, db),
  ]);

  // Filter hires that started on or before asAtDate
  const totalHireCosts = hireItems
    .filter(h => h.hire_start_date <= asAtDate)
    .reduce((acc, h) => acc + h.total_cost, 0);

  const totalCosts    = parseFloat(snap.total_costs) + totalHireCosts;
  const totalInvoiced = invoiced.total;
  const profit        = totalInvoiced - totalCosts;

  return {
    vat_basis:            'ex_vat',
    as_at_date:           asAtDate,
    total_supplier_costs: parseFloat(snap.total_supplier),
    total_labour_costs:   parseFloat(snap.total_labour),
    total_hire_costs:     Number(totalHireCosts.toFixed(2)),
    total_costs_to_date:  Number(totalCosts.toFixed(2)),
    total_invoiced:       totalInvoiced,
    invoiced_xero:        invoiced.xero_total,
    invoiced_manual:      invoiced.manual_total,
    current_profit:       Number(profit.toFixed(2)),
    profit_pct:           totalInvoiced > 0 ? (profit / totalInvoiced) * 100 : null,
  };
};

module.exports = {
  recordSupplierCost, softDeleteEntry,
  getSupplierCosts, getLabourCosts, getHireCosts, getSummaryMetrics, getAsAtSnapshot,
  invoicedToProduction,
  calcHireItem,
};
