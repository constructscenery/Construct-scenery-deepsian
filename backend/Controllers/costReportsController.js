const db  = require('../config/db');
const CRS = require('../services/costReportService');
const { generateCostReportPdf }      = require('../services/costReportPdfService');
const { generateCostReportType2Pdf } = require('../services/costReportType2PdfService');

// node-postgres returns `timestamp`/`timestamptz` columns as JS Date objects.
// String(dateObj).split('T')[0] splits on the 'T' in "GMT" and produces garbage like
// "Sun Jun 28 2026 00:00:00 GM". Use this helper everywhere instead.
const toDateStr = (d) => {
  if (!d) return null;
  try {
    const p = new Date(d);
    return isNaN(p.getTime()) ? null : p.toISOString().split('T')[0];
  } catch { return null; }
};

// ─── Helper: build weekly cost summary from supplier + labour entries ──────────
// Groups supplier entries by date (as-of week proxy) and labour entries by
// week_ending_date, then merges into an array sorted chronologically.
const buildWeeklyCostSummary = (supplierEntries, labourEntries) => {
  const weekMap = {};

  supplierEntries.forEach(e => {
    const key = toDateStr(e.date) || 'unknown';
    if (!weekMap[key]) weekMap[key] = { week_or_date: key, supplier_cost: 0, labour_cost: 0, crew_count: 0 };
    weekMap[key].supplier_cost += parseFloat(e.gross_amount || 0);
  });

  labourEntries.forEach(e => {
    const key = toDateStr(e.week_ending_date) || 'unknown';
    if (!weekMap[key]) weekMap[key] = { week_or_date: key, supplier_cost: 0, labour_cost: 0, crew_count: 0 };
    weekMap[key].labour_cost += parseFloat(e.gross_amount || 0);
    weekMap[key].crew_count  += 1;
  });

  return Object.values(weekMap)
    .sort((a, b) => a.week_or_date.localeCompare(b.week_or_date))
    .map(w => ({
      ...w,
      total_cost: w.supplier_cost + w.labour_cost,
    }));
};

// ─── Helper: group labour entries by week — flat crew list per week ───────────
// Returns the shape the frontend cost-report page expects: { week_ending_date, total, crew[] }
const groupLabourByWeekAndTrade = (labourEntries) => {
  const byWeek = {};
  labourEntries.forEach(e => {
    const week = toDateStr(e.week_ending_date) || 'unknown';
    if (!byWeek[week]) byWeek[week] = { week_ending_date: week === 'unknown' ? null : week, total: 0, crew: [] };
    byWeek[week].total += parseFloat(e.gross_amount || 0);
    byWeek[week].crew.push({
      crew_number: e.crew_number || null,
      name:        `${e.first_name || ''} ${e.last_name || ''}`.trim(),
      trade:       e.trade || null,
      rank:        e.rank  || null,
      grand_total: parseFloat(e.gross_amount || 0),
    });
  });
  return Object.values(byWeek)
    .sort((a, b) => b.week_ending_date.localeCompare(a.week_ending_date));
};

// ─── GET /api/cost-reports/:productionId/type1 ───────────────────────────────
// Type 1 (On a Price) full report: Lead Summary, Supplier Costs, Labour Summary,
// Invoiced to Production. Only available for contract_type = 'on_a_price'.
const getType1Report = async (req, res) => {
  const { productionId } = req.params;
  const { as_at_date, set_code, account_code, supplier_name, date_from, date_to } = req.query;

  try {
    const { rows: [production] } = await db.query(
      `SELECT id, name, contract_type, status, target_profit_pct FROM productions WHERE id = $1`,
      [productionId]
    );
    if (!production) return res.status(404).json({ error: 'Production not found' });
    if (production.contract_type !== 'on_a_price')
      return res.status(400).json({
        error:         'Type 1 report is only available for On a Price contracts',
        contract_type: production.contract_type,
        redirect_to:   'type2',
      });

    const supplierFilters = { as_at_date, set_code, account_code, supplier_name, date_from, date_to };
    const labourFilters   = { as_at_date };

    const [supplierEntries, labourEntries, metrics, invoiceRows] = await Promise.all([
      CRS.getSupplierCosts(productionId, supplierFilters, db),
      CRS.getLabourCosts(productionId, labourFilters, db),
      CRS.getSummaryMetrics(productionId, db),
      db.query(
        'SELECT * FROM cost_report_invoices WHERE production_id = $1 ORDER BY date DESC',
        [productionId]
      ).then(r => r.rows),
    ]);

    // Lead summary derived metrics
    const totalCosts      = metrics.total_costs_to_date;
    const totalInvoiced   = metrics.total_invoiced;
    const targetProfitPct = parseFloat(production.target_profit_pct || 0);
    const targetFraction  = targetProfitPct / 100;
    const availableSpend  = totalInvoiced * (1 - targetFraction) - totalCosts;
    const availableSpendPct = totalInvoiced > 0 ? (availableSpend / totalInvoiced) * 100 : 0;

    res.json({
      production: {
        id:                production.id,
        name:              production.name,
        contract_type:     production.contract_type,
        status:            production.status,
        target_profit_pct: targetProfitPct,
      },
      lead_summary: {
        total_costs_to_date:              totalCosts,
        total_supplier_costs:             metrics.total_supplier_costs,
        total_labour_costs:               metrics.total_labour_costs,
        total_hire_costs:                 metrics.total_hire_costs,
        amounts_invoiced_to_production:   totalInvoiced,
        current_profit:                   totalInvoiced - totalCosts,
        profit_pct_of_turnover:           totalInvoiced > 0
          ? ((totalInvoiced - totalCosts) / totalInvoiced) * 100 : 0,
        target_profit_pct:                targetProfitPct,
        available_spend_remaining:        availableSpend,
        available_spend_pct_of_budget:    availableSpendPct,
        last_updated:                     metrics.last_updated,
      },
      weekly_cost_summary:   buildWeeklyCostSummary(supplierEntries, labourEntries),
      supplier_costs:        supplierEntries.map(e => ({
        date:            e.date,
        supplier:        e.supplier_name,
        description:     null,           // not stored in cost_report_entries; use PO join if needed
        po_number:       e.po_number,
        set_code:        e.set_code,
        account_code:    e.account_code,
        cost_ex_vat:     parseFloat(e.net_amount),
        vat:             parseFloat(e.vat),
        total:           parseFloat(e.gross_amount),
        purchase_method: e.payment_method,
      })),
      labour_summary:        groupLabourByWeekAndTrade(labourEntries),
      invoiced_to_production: invoiceRows,
    });
  } catch (err) {
    console.error('getType1Report:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/cost-reports/:productionId ─────────────────────────────────────
// Generic cost report (used by both contract types and existing consumers).
// Now reads from cost_report_entries via CostReportService.
const getCostReport = async (req, res) => {
  const { productionId } = req.params;
  const { as_at_date }   = req.query;

  try {
    const { rows: [production] } = await db.query(
      'SELECT * FROM productions WHERE id = $1', [productionId]
    );
    if (!production) return res.status(404).json({ error: 'Production not found' });

    const filters = { as_at_date };
    const [metrics, supplierEntries, labourEntries, invoiceRows] = await Promise.all([
      as_at_date
        ? CRS.getAsAtSnapshot(productionId, as_at_date, db)
        : CRS.getSummaryMetrics(productionId, db),
      CRS.getSupplierCosts(productionId, filters, db),
      CRS.getLabourCosts(productionId, filters, db),
      db.query(
        'SELECT * FROM cost_report_invoices WHERE production_id = $1 ORDER BY date',
        [productionId]
      ).then(r => r.rows),
    ]);

    res.json({
      production,
      contract_type: production.contract_type,
      as_at_date:    as_at_date || new Date().toISOString().split('T')[0],
      metrics: {
        total_supplier_costs:          metrics.total_supplier_costs,
        total_labour_costs:            metrics.total_labour_costs,
        total_hire_costs:              metrics.total_hire_costs,
        total_costs_to_date:           metrics.total_costs_to_date,
        total_invoiced_to_production:  metrics.total_invoiced ?? null,
        current_profit:                metrics.current_profit ?? null,
        profit_percentage_of_turnover: metrics.profit_pct != null
          ? parseFloat(metrics.profit_pct).toFixed(2) : null,
        last_updated:                  metrics.last_updated || null,
      },
      supplier_costs: supplierEntries.map(e => ({
        date:            e.date,
        supplier:        e.supplier_name,
        po_number:       e.po_number,
        set_code:        e.set_code,
        account_code:    e.account_code,
        cost_ex_vat:     parseFloat(e.net_amount),
        vat:             parseFloat(e.vat),
        total:           parseFloat(e.gross_amount),
        purchase_method: e.payment_method,
      })),
      labour_weekly:          groupLabourByWeekAndTrade(labourEntries),
      invoices_to_production: invoiceRows,
    });
  } catch (err) {
    console.error('getCostReport:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/cost-reports/entries ───────────────────────────────────────────
// Raw entry list — used by integration tests and admin tooling.
// Routed through CostReportService; does not query cost_report_entries directly.
const getCostReportEntries = async (req, res) => {
  const { production_id, type } = req.query;
  if (!production_id) return res.status(400).json({ error: 'production_id is required' });

  try {
    let rows;
    if (!type || type === 'supplier') {
      rows = await CRS.getSupplierCosts(production_id, {}, db);
      if (type === 'labour') rows = [];
    }
    if (type === 'labour') {
      rows = await CRS.getLabourCosts(production_id, {}, db);
    }
    if (!type) {
      // Both types
      const [supplier, labour] = await Promise.all([
        CRS.getSupplierCosts(production_id, {}, db),
        CRS.getLabourCosts(production_id, {}, db),
      ]);
      rows = [...supplier, ...labour].sort((a, b) =>
        String(a.date).localeCompare(String(b.date))
      );
    }
    res.json(rows);
  } catch (err) {
    console.error('getCostReportEntries:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/cost-reports/:productionId/snapshot ────────────────────────────
// Returns cost totals as of a given date — powers date-specific exports.
const getSnapshot = async (req, res) => {
  const { productionId } = req.params;
  const { as_at_date }   = req.query;
  if (!as_at_date) return res.status(400).json({ error: 'as_at_date is required' });
  try {
    const snapshot = await CRS.getAsAtSnapshot(productionId, as_at_date, db);
    res.json(snapshot);
  } catch (err) {
    console.error('getSnapshot:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/cost-reports/:productionId/invoices ───────────────────────────
const addInvoice = async (req, res) => {
  const { invoice_description, po_number, date, invoice_number, amount, notes } = req.body;
  if (!amount) return res.status(400).json({ error: 'amount is required' });

  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO cost_report_invoices
         (production_id, invoice_description, po_number, date, invoice_number, amount, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        req.params.productionId, invoice_description, po_number,
        date || new Date().toISOString().split('T')[0],
        invoice_number, parseFloat(amount), notes,
      ]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── DELETE /api/cost-reports/:productionId/invoices/:invoiceId ──────────────
const deleteInvoice = async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM cost_report_invoices WHERE id = $1 AND production_id = $2',
      [req.params.invoiceId, req.params.productionId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ message: 'Invoice deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/cost-reports/:productionId/cost-plus ───────────────────────────
// Cost Plus (Type 2) report — also refactored to read from cost_report_entries.
const getCostPlus = async (req, res) => {
  const { productionId } = req.params;
  try {
    const { rows: [production] } = await db.query(
      'SELECT * FROM productions WHERE id = $1', [productionId]
    );
    if (!production || production.contract_type !== 'cost_plus')
      return res.status(400).json({ error: 'This production is not a Cost Plus contract' });

    const [budget, budgetLines, supplierEntries, labourEntries] = await Promise.all([
      db.query('SELECT * FROM cost_plus_budgets WHERE production_id = $1', [productionId]).then(r => r.rows[0]),
      db.query(
        `SELECT bl.* FROM cost_plus_budget_lines bl
         JOIN cost_plus_budgets b ON bl.budget_id = b.id
         WHERE b.production_id = $1 ORDER BY bl.sort_order`,
        [productionId]
      ).then(r => r.rows),
      CRS.getSupplierCosts(productionId, {}, db),
      CRS.getLabourCosts(productionId, {}, db),
    ]);

    const margin = parseFloat(budget?.margin_rate || 0.10);

    const materialsToSend = supplierEntries.map(e => ({
      date:                   e.date,
      po_number:              e.po_number,
      supplier:               e.supplier_name,
      account_code:           e.account_code,
      net_amount:             parseFloat(e.net_amount),
      margin_amount:          parseFloat(e.net_amount) * margin,
      recharge_to_production: parseFloat(e.net_amount) * (1 + margin),
    }));

    const labourToSend = labourEntries.map(e => ({
      week_ending_date:   e.week_ending_date,
      crew:               `${e.first_name} ${e.last_name}`,
      trade:              e.trade,
      rank:               e.rank,
      net_amount:         parseFloat(e.net_amount),
      margin_amount:      parseFloat(e.net_amount) * margin,
      cost_to_production: parseFloat(e.net_amount) * (1 + margin),
    }));

    const totalLabourNet    = labourToSend.reduce((s, l) => s + l.net_amount, 0);
    const totalMaterialsNet = materialsToSend.reduce((s, m) => s + m.net_amount, 0);
    const totalNet          = totalLabourNet + totalMaterialsNet;

    res.json({
      production,
      budget:            budget ? { ...budget, budget_lines: budgetLines } : null,
      margin_rate:       margin,
      margin_percentage: `${(margin * 100).toFixed(0)}%`,
      totals: {
        total_labour_net:    totalLabourNet,
        total_materials_net: totalMaterialsNet,
        total_net:           totalNet,
        total_margin:        totalNet * margin,
        total_to_production: totalNet * (1 + margin),
      },
      materials_to_send: materialsToSend,
      labour_to_send:    labourToSend,
    });
  } catch (err) {
    console.error('getCostPlus:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/cost-reports/:productionId/budget ─────────────────────────────
const upsertBudget = async (req, res) => {
  const { margin_rate, contracted_weeks, notes, budget_lines } = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [budget] } = await client.query(
      `INSERT INTO cost_plus_budgets (production_id, margin_rate, contracted_weeks, notes)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (production_id)
       DO UPDATE SET
         margin_rate      = EXCLUDED.margin_rate,
         contracted_weeks = EXCLUDED.contracted_weeks,
         notes            = EXCLUDED.notes,
         updated_at       = NOW()
       RETURNING *`,
      [req.params.productionId, parseFloat(margin_rate || 0.10), parseInt(contracted_weeks || 0, 10), notes ?? null]
    );
    await client.query('DELETE FROM cost_plus_budget_lines WHERE budget_id = $1', [budget.id]);

    const lines = Array.isArray(budget_lines) ? budget_lines : [];
    for (let i = 0; i < lines.length; i++) {
      const line        = lines[i];
      const agreedRate  = parseFloat(line.agreed_rate ?? 0);
      const lineMargin  = line.line_margin_rate != null ? parseFloat(line.line_margin_rate) : null;
      const effectiveMr = lineMargin ?? parseFloat(margin_rate || 0.10);
      // For above-the-line roles: weekly_cost = agreed_rate; total = agreed_rate * (1+margin) * weeks
      // For set lines: weekly_cost is direct input; total = weekly_cost * weeks
      const isAboveLine = line.is_above_line === true || line.line_type === 'above_line';
      const weekly      = isAboveLine ? agreedRate : parseFloat(line.weekly_cost ?? 0);
      const weeks       = parseInt(line.weeks ?? (isAboveLine ? parseInt(contracted_weeks || 0, 10) : 0), 10);
      const total       = isAboveLine
        ? agreedRate * (1 + effectiveMr) * weeks
        : parseFloat(line.total ?? weekly * weeks);
      await client.query(
        `INSERT INTO cost_plus_budget_lines
           (budget_id, account_code, description, weekly_cost, weeks, total, sort_order,
            bectu_rate, agreed_rate, line_margin_rate, is_above_line, set_id, notes, line_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          budget.id,
          line.account_code ?? null,
          line.description ?? '',
          weekly,
          weeks,
          total,
          i,
          line.bectu_rate != null ? parseFloat(line.bectu_rate) : null,
          agreedRate || null,
          lineMargin,
          isAboveLine,
          line.set_id ?? null,
          line.notes ?? null,
          line.line_type ?? (isAboveLine ? 'above_line' : 'set'),
        ]
      );
    }
    await client.query('COMMIT');
    const { rows: savedLines } = await db.query(
      'SELECT * FROM cost_plus_budget_lines WHERE budget_id = $1 ORDER BY sort_order',
      [budget.id]
    );
    res.json({ ...budget, budget_lines: savedLines });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ─── Private helper: build all Type 2 (Cost Plus) report data ─────────────────
// Used by both getType2Report (JSON) and exportCostReportPDF (binary).
const _buildType2Data = async (productionId, filters, db) => {
  const { as_at_date, supplier_name, set_code, account_code, trade, crew_member } = filters || {};

  const { rows: [production] } = await db.query('SELECT * FROM productions WHERE id = $1', [productionId]);
  if (!production) { const e = new Error('Production not found'); e.status = 404; throw e; }
  if (production.contract_type !== 'cost_plus') {
    const e = new Error('Type 2 report is only available for Cost Plus contracts');
    e.status = 400; e.contract_type = production.contract_type; throw e;
  }

  const supplierFilters = { as_at_date, set_code, account_code, supplier_name };
  const labourFilters   = { as_at_date, trade, crew_member };

  const [
    budget, budgetLines, supplierEntries, labourEntries,
    poBilling, omittedRows, marginsRef, weeklyPLRows, invoiceRows, productionSets,
  ] = await Promise.all([
    db.query('SELECT * FROM cost_plus_budgets WHERE production_id = $1', [productionId]).then(r => r.rows[0]),
    db.query(
      `SELECT bl.* FROM cost_plus_budget_lines bl
       JOIN cost_plus_budgets b ON bl.budget_id = b.id
       WHERE b.production_id = $1 ORDER BY bl.sort_order`, [productionId]
    ).then(r => r.rows),
    CRS.getSupplierCosts(productionId, supplierFilters, db),
    CRS.getLabourCosts(productionId, labourFilters, db),
    db.query('SELECT * FROM cost_report_po_billing WHERE production_id = $1', [productionId]).then(r => r.rows),
    db.query('SELECT * FROM cost_report_omitted_entries WHERE production_id = $1 ORDER BY created_at DESC', [productionId]).then(r => r.rows),
    db.query('SELECT * FROM cost_report_margins_reference WHERE production_id = $1', [productionId]).then(r => r.rows[0]),
    db.query('SELECT * FROM cost_report_weekly_pl WHERE production_id = $1 ORDER BY week_ending_date', [productionId]).then(r => r.rows),
    db.query('SELECT * FROM cost_report_invoices WHERE production_id = $1 ORDER BY date', [productionId]).then(r => r.rows),
    db.query('SELECT id, set_number, set_name, shoot_week FROM sets WHERE production_id = $1 ORDER BY set_number', [productionId]).then(r => r.rows),
  ]);

  const margin = parseFloat(budget?.margin_rate || 0.10);

  const billingMap      = Object.fromEntries(poBilling.map(b => [b.source_id, b]));
  const omittedEntryIds = new Set(omittedRows.map(r => r.entry_id));
  const plMap           = Object.fromEntries(weeklyPLRows.map(r => [toDateStr(r.week_ending_date) ?? '', r]));

  const labourByAccount    = {};
  const materialsByAccount = {};
  labourEntries.forEach(e => {
    const key = e.account_code || '__none__';
    labourByAccount[key] = (labourByAccount[key] || 0) + parseFloat(e.gross_amount || 0);
  });
  supplierEntries.forEach(e => {
    const key = e.account_code || '__none__';
    materialsByAccount[key] = (materialsByAccount[key] || 0) + parseFloat(e.gross_amount || 0);
  });

  const mainCostReport = budgetLines.map(bl => {
    const budgetAmt = parseFloat(bl.total || 0);
    const labourCTD = labourByAccount[bl.account_code] || 0;
    const matCTD    = materialsByAccount[bl.account_code] || 0;
    const totalCTD  = labourCTD + matCTD;
    return {
      account_code:            bl.account_code,
      description:             bl.description,
      weekly_cost:             parseFloat(bl.weekly_cost || 0),
      margin_pct:              margin * 100,
      sub_total:               parseFloat(bl.weekly_cost || 0) * (1 + margin),
      weeks:                   bl.weeks,
      budget:                  budgetAmt,
      labour_costs_to_date:    labourCTD,
      materials_costs_to_date: matCTD,
      total_costs_to_date:     totalCTD,
      over_under_budget:       budgetAmt - totalCTD,
    };
  });

  const posAndBilling = supplierEntries.map(e => {
    const bil    = billingMap[e.source_id] || {};
    const invAmt = parseFloat(bil.amount_invoiced || 0);
    return {
      source_id:               e.source_id,
      po_number:               e.po_number,
      cs_invoice_number:       bil.cs_invoice_number || null,
      po_value:                parseFloat(e.gross_amount),
      amount_invoiced:         invAmt,
      amount_still_to_invoice: parseFloat(e.gross_amount) - invAmt,
      is_omitted:              omittedEntryIds.has(e.id),
    };
  });

  const labourToSend = labourEntries.filter(e => !omittedEntryIds.has(e.id)).map(e => {
    const wed = toDateStr(e.week_ending_date);
    return {
      entry_id:                e.id,
      week_ending_date:        wed,
      transaction_description: `Labour — ${[e.trade, e.rank].filter(Boolean).join(' ')}${wed ? ` w/e ${wed}` : ''}`,
      account_code:            e.set_code || e.account_code || null,
      account_description:     [e.trade, e.rank].filter(Boolean).join(' '),
      net_amount_charged:      parseFloat(e.net_amount),
      margin_amount:           parseFloat(e.net_amount) * margin,
      cost_to_production:      parseFloat(e.net_amount) * (1 + margin),
      crew_name:               `${e.first_name} ${e.last_name}`,
      crew_number:             e.crew_number,
    };
  });

  const materialsToSend = supplierEntries.filter(e => !omittedEntryIds.has(e.id)).map(e => ({
    entry_id:                e.id,
    week_ending_date:        toDateStr(e.date),
    po_number:               e.po_number,
    invoice_date:            toDateStr(e.date),
    supplier:                e.supplier_name,
    account_code:            e.account_code,
    account_description:     e.account_code || '',
    transaction_description: e.supplier_name,
    net_amount:              parseFloat(e.net_amount),
    margin_amount:           parseFloat(e.net_amount) * margin,
    recharge_to_production:  parseFloat(e.net_amount) * (1 + margin),
    set_code:                e.set_code,
  }));

  const omittedLabour = labourEntries.filter(e => omittedEntryIds.has(e.id)).map(e => {
    const omitRow = omittedRows.find(r => r.entry_id === e.id) || {};
    return {
      entry_id:           e.id,
      type:               'labour',
      week_ending_date:   toDateStr(e.week_ending_date),
      crew_name:          `${e.first_name} ${e.last_name}`,
      crew_number:        e.crew_number,
      set_code:           e.set_code || null,
      account_code:       e.set_code || null,
      description:        [e.trade, e.rank].filter(Boolean).join(' '),
      net_amount:         parseFloat(e.net_amount),
      margin_amount:      parseFloat(e.net_amount) * margin,
      cost_to_production: parseFloat(e.net_amount) * (1 + margin),
      omit_reason:        omitRow.omit_reason || null,
      created_at:         omitRow.created_at  || null,
    };
  });

  const omittedMaterials = supplierEntries.filter(e => omittedEntryIds.has(e.id)).map(e => {
    const omitRow = omittedRows.find(r => r.entry_id === e.id) || {};
    return {
      entry_id:               e.id,
      type:                   'material',
      week_ending_date:       toDateStr(e.date),
      supplier:               e.supplier_name,
      po_number:              e.po_number,
      set_code:               e.set_code    || null,
      account_code:           e.account_code || null,
      description:            e.supplier_name,
      net_amount:             parseFloat(e.net_amount),
      margin_amount:          parseFloat(e.net_amount) * margin,
      recharge_to_production: parseFloat(e.net_amount) * (1 + margin),
      omit_reason:            omitRow.omit_reason || null,
      created_at:             omitRow.created_at  || null,
    };
  });

  // Build per-week CS invoice map from PO billing data (supplier entries for that week)
  const weekCsInvoiceMap = {};
  supplierEntries.filter(e => !omittedEntryIds.has(e.id)).forEach(e => {
    const w   = toDateStr(e.date);
    const bil = billingMap[e.id];
    if (w && bil?.cs_invoice_number) {
      if (!weekCsInvoiceMap[w]) weekCsInvoiceMap[w] = new Set();
      weekCsInvoiceMap[w].add(bil.cs_invoice_number);
    }
  });

  const weekSumMap = {};
  labourToSend.forEach(l => {
    const w = l.week_ending_date;
    if (!weekSumMap[w]) weekSumMap[w] = { week_ending_date: w, above_line_labour: 0, labour_charged: 0, materials: 0 };
    weekSumMap[w].labour_charged += l.cost_to_production;
  });
  materialsToSend.forEach(m => {
    const w = m.week_ending_date;
    if (!weekSumMap[w]) weekSumMap[w] = { week_ending_date: w, above_line_labour: 0, labour_charged: 0, materials: 0 };
    weekSumMap[w].materials += m.recharge_to_production;
  });
  const weeklyInvoiceSummary = Object.values(weekSumMap)
    .sort((a, b) => (a.week_ending_date || '').localeCompare(b.week_ending_date || ''))
    .map((w, idx) => {
      const plRow    = plMap[w.week_ending_date] || {};
      // CS invoice derived from PO billing for this week; fallback to manually saved value
      const poInvSet = weekCsInvoiceMap[w.week_ending_date];
      const csInv    = poInvSet ? [...poInvSet].join(', ') : (plRow.cs_invoice_number || null);
      return {
        week_number:               idx + 1,
        week_ending_date:          w.week_ending_date,
        above_line_labour_charged: w.above_line_labour,
        labour_charged:            w.labour_charged,
        materials:                 w.materials,
        released_advance:          0,
        charged_so_far:            w.above_line_labour + w.labour_charged + w.materials,
        cs_invoice_number:         csInv,
        po_reference:              plRow.po_reference || null,
      };
    });

  let runningProfit = 0;
  const weeklyPL = weeklyInvoiceSummary.map(w => {
    const row          = plMap[w.week_ending_date] || {};
    const marginEarned = (w.labour_charged + w.materials) * (margin / (1 + margin));
    const salary       = parseFloat(row.warrens_salary || 0);
    const weekProfit   = marginEarned - salary;
    runningProfit     += weekProfit;
    return {
      week_ending_date:            w.week_ending_date,
      margin_from_recharged_costs: marginEarned,
      warrens_salary:              salary,
      weekly_profit:               weekProfit,
      running_total_profit:        runningProfit,
    };
  });

  const totalLabourCTP    = labourToSend.reduce((s, l) => s + l.cost_to_production, 0);
  const totalMaterialsCTP = materialsToSend.reduce((s, m) => s + m.recharge_to_production, 0);
  const totalInvoiced     = invoiceRows.reduce((s, i) => s + parseFloat(i.amount || 0), 0);

  return {
    production, budget, budgetLines,
    mainCostReport, posAndBilling,
    labourToSend, materialsToSend,
    omittedLabour, omittedMaterials,
    weeklyInvoiceSummary, weeklyPL,
    invoiceRows, productionSets,
    omittedRows, marginsRef,
    summary: {
      margin_rate:                  margin,
      margin_pct:                   `${(margin * 100).toFixed(0)}%`,
      total_labour_ctp:             totalLabourCTP,
      total_materials_ctp:          totalMaterialsCTP,
      grand_total_ctp:              totalLabourCTP + totalMaterialsCTP,
      total_invoiced_to_production: totalInvoiced,
    },
  };
};

// ─── GET /api/cost-reports/:productionId/type2 ────────────────────────────────
// Full Type 2 (Cost Plus) report with all nine sections.
// Only available for contract_type = 'cost_plus'.
const getType2Report = async (req, res) => {
  const { productionId } = req.params;
  const { as_at_date, supplier_name, set_code, account_code, trade, crew_member } = req.query;
  try {
    const d = await _buildType2Data(productionId, { as_at_date, supplier_name, set_code, account_code, trade, crew_member }, db);
    res.json({
      production:             { id: d.production.id, name: d.production.name, contract_type: d.production.contract_type, status: d.production.status },
      budget:                 d.budget ? { ...d.budget, budget_lines: d.budgetLines } : null,
      main_cost_report:       d.mainCostReport,
      summary:                d.summary,
      pos_and_billing:        d.posAndBilling,
      weekly_invoice_summary: d.weeklyInvoiceSummary,
      labour_to_send:         d.labourToSend,
      materials_to_send:      d.materialsToSend,
      omitted_entries:        d.omittedRows,
      omitted_labour:         d.omittedLabour,
      omitted_materials:      d.omittedMaterials,
      production_sets:        d.productionSets,
      margins_reference:      d.marginsRef || { production_id: productionId, items: [], notes: null },
      weekly_pl:              d.weeklyPL,
      invoices_to_production: d.invoiceRows,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, contract_type: err.contract_type, redirect_to: err.status === 400 ? 'type1' : undefined });
    console.error('getType2Report:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PATCH /api/cost-reports/:productionId/po-billing/:sourceId ───────────────
// Upserts the CS Invoice Number and Amount Invoiced for a PO entry.
const updatePoBilling = async (req, res) => {
  const { productionId, sourceId } = req.params;
  const { cs_invoice_number, amount_invoiced, notes } = req.body;
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO cost_report_po_billing
         (production_id, source_id, cs_invoice_number, amount_invoiced, notes, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (production_id, source_id) DO UPDATE SET
         cs_invoice_number = EXCLUDED.cs_invoice_number,
         amount_invoiced   = EXCLUDED.amount_invoiced,
         notes             = EXCLUDED.notes,
         updated_by        = EXCLUDED.updated_by,
         updated_at        = NOW()
       RETURNING *`,
      [productionId, sourceId, cs_invoice_number || null, parseFloat(amount_invoiced || 0), notes || null, req.user.id]
    );
    res.json(row);
  } catch (err) {
    console.error('updatePoBilling:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── POST /api/cost-reports/:productionId/omit-entry ─────────────────────────
// Marks a cost_report_entry as "omit this week" — excluded from that week's submission.
const omitEntry = async (req, res) => {
  const { productionId } = req.params;
  const { entry_id, week_ending_date, omit_reason } = req.body;
  if (!entry_id || !week_ending_date)
    return res.status(400).json({ error: 'entry_id and week_ending_date are required' });
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO cost_report_omitted_entries
         (production_id, entry_id, week_ending_date, omit_reason, omitted_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (entry_id, week_ending_date) DO NOTHING
       RETURNING *`,
      [productionId, entry_id, week_ending_date, omit_reason || null, req.user.id]
    );
    res.status(201).json(row || { message: 'Already omitted for this week' });
  } catch (err) {
    console.error('omitEntry:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── DELETE /api/cost-reports/:productionId/omit-entry/:entryId ──────────────
// Removes an omit flag — restores the entry to the current week's submission.
const unomitEntry = async (req, res) => {
  const { productionId, entryId } = req.params;
  const { week_ending_date } = req.query;
  try {
    const conditions = ['production_id = $1', 'entry_id = $2'];
    const params     = [productionId, entryId];
    if (week_ending_date) { conditions.push(`week_ending_date = $3`); params.push(week_ending_date); }

    const { rowCount } = await db.query(
      `DELETE FROM cost_report_omitted_entries WHERE ${conditions.join(' AND ')}`, params
    );
    if (!rowCount) return res.status(404).json({ error: 'Omitted entry not found' });
    res.json({ message: 'Entry restored to submission' });
  } catch (err) {
    console.error('unomitEntry:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PUT /api/cost-reports/:productionId/margins-reference ───────────────────
// Updates the Margins Reference Sheet. Editable by MD only (enforced by policy).
const updateMarginsReference = async (req, res) => {
  const { productionId } = req.params;
  const { items, notes } = req.body;
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO cost_report_margins_reference (production_id, items, notes, updated_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (production_id) DO UPDATE SET
         items      = EXCLUDED.items,
         notes      = EXCLUDED.notes,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING *`,
      [productionId, Array.isArray(items) ? items : [], notes || null, req.user.id]
    );
    res.json(row);
  } catch (err) {
    console.error('updateMarginsReference:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── PUT /api/cost-reports/:productionId/weekly-pl/:weekEndingDate ────────────
// Upserts Warren's Salary, Luton uplift, Box Rental uplift, and notes for a week.
const upsertWeeklyPL = async (req, res) => {
  const { productionId, weekEndingDate } = req.params;
  const { warrens_salary, luton_uplift, box_rental_uplift, notes, cs_invoice_number, po_reference } = req.body;
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO cost_report_weekly_pl
         (production_id, week_ending_date, warrens_salary, luton_uplift, box_rental_uplift, notes, cs_invoice_number, po_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (production_id, week_ending_date) DO UPDATE SET
         warrens_salary    = EXCLUDED.warrens_salary,
         luton_uplift      = EXCLUDED.luton_uplift,
         box_rental_uplift = EXCLUDED.box_rental_uplift,
         notes             = EXCLUDED.notes,
         cs_invoice_number = EXCLUDED.cs_invoice_number,
         po_reference      = EXCLUDED.po_reference
       RETURNING *`,
      [
        productionId, weekEndingDate,
        parseFloat(warrens_salary || 0),
        parseFloat(luton_uplift || 0),
        parseFloat(box_rental_uplift || 0),
        notes || null,
        cs_invoice_number || null,
        po_reference      || null,
      ]
    );
    res.json(row);
  } catch (err) {
    console.error('upsertWeeklyPL:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/cost-reports/:productionId/export/csv ──────────────────────────
// Exports supplier or labour data as a bank-ready CSV (no £, raw decimals).
// cost_type=supplier (default) or cost_type=labour
// report_type=cost_plus → Type 2 export (supplier CSV adds Description column)
const exportCostReportCSV = async (req, res) => {
  const { productionId } = req.params;
  const {
    cost_type   = 'supplier',
    report_type,
    as_at_date, set_code, account_code, supplier_name,
    trade, crew_member, date_from, date_to,
  } = req.query;

  try {
    const { rows: [production] } = await db.query(
      'SELECT name FROM productions WHERE id = $1', [productionId]
    );
    if (!production) return res.status(404).json({ error: 'Production not found' });

    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const dateSuffix = new Date().toISOString().split('T')[0];
    const safeName   = (production.name || 'Production').replace(/[^a-zA-Z0-9]+/g, '_');

    // ── Labour CSV (same columns for both Type 1 and Type 2) ─────────────────
    if (cost_type === 'labour') {
      const entries = await CRS.getLabourCosts(productionId, { as_at_date, trade, crew_member, date_from, date_to }, db);
      const header  = [
        'Employee Number', 'Name', 'Trade', 'Rank', 'Week Ending',
        'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
        'Total Days', 'OT Hours', 'Daily Rate', 'OT Rate', 'Net Total', 'VAT', 'Gross',
      ];
      const lines = [header.join(',')];
      const byTrade = {};
      entries.forEach(e => { const t = e.trade || 'Unknown'; if (!byTrade[t]) byTrade[t] = []; byTrade[t].push(e); });
      Object.keys(byTrade).sort().forEach(tr => {
        byTrade[tr].forEach(e => {
          lines.push([
            e.crew_number,
            `${e.first_name} ${e.last_name}`,
            e.trade, e.rank,
            toDateStr(e.week_ending_date) || '',
            e.day_monday    ? 1 : 0, e.day_tuesday  ? 1 : 0, e.day_wednesday ? 1 : 0,
            e.day_thursday  ? 1 : 0, e.day_friday   ? 1 : 0, e.day_saturday  ? 1 : 0, e.day_sunday ? 1 : 0,
            e.total_days || 0,
            parseFloat(e.ot_hours   || 0).toFixed(1),
            parseFloat(e.daily_rate || 0).toFixed(2),
            parseFloat(e.ot_rate    || 0).toFixed(2),
            parseFloat(e.net_amount || 0).toFixed(2),
            parseFloat(e.vat        || 0).toFixed(2),
            parseFloat(e.gross_amount || 0).toFixed(2),
          ].map(esc).join(','));
        });
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="LabourCosts_${safeName}_${dateSuffix}.csv"`);
      return res.send(lines.join('\r\n'));
    }

    // ── Type 2 supplier CSV — adds Description column from purchase_orders ───
    if (report_type === 'cost_plus') {
      const conds  = [`cre.production_id = $1`, `cre.entry_type = 'supplier'`, `cre.deleted_at IS NULL`];
      const params = [productionId];
      let   i      = 2;
      if (as_at_date)    { conds.push(`cre.date <= $${i++}`);             params.push(as_at_date); }
      if (set_code)      { conds.push(`cre.set_code = $${i++}`);          params.push(set_code); }
      if (account_code)  { conds.push(`cre.account_code = $${i++}`);      params.push(account_code); }
      if (supplier_name) { conds.push(`cre.supplier_name ILIKE $${i++}`); params.push(`%${supplier_name}%`); }
      if (date_from)     { conds.push(`cre.date >= $${i++}`);             params.push(date_from); }
      if (date_to)       { conds.push(`cre.date <= $${i++}`);             params.push(date_to); }
      const { rows: entries } = await db.query(
        `SELECT cre.*, po.description AS po_description
         FROM   cost_report_entries cre
         LEFT JOIN purchase_orders po ON po.id = cre.source_id
                                     AND cre.source_type = 'purchase_order'
         WHERE  ${conds.join(' AND ')}
         ORDER  BY cre.date DESC, cre.created_at DESC`,
        params
      );
      const header = ['Date', 'PO Number', 'Supplier', 'Description', 'Set Code', 'Account Code', 'Net', 'VAT', 'Gross', 'Payment Method'];
      const lines  = [header.join(',')];
      entries.forEach(e => {
        lines.push([
          toDateStr(e.date) || '',
          e.po_number,
          e.supplier_name,
          e.po_description || '',
          e.set_code,
          e.account_code,
          parseFloat(e.net_amount).toFixed(2),
          parseFloat(e.vat || 0).toFixed(2),
          parseFloat(e.gross_amount).toFixed(2),
          e.payment_method,
        ].map(esc).join(','));
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="SupplierCosts_CostPlus_${safeName}_${dateSuffix}.csv"`);
      return res.send(lines.join('\r\n'));
    }

    // ── Type 1 (default) supplier CSV ────────────────────────────────────────
    const entries = await CRS.getSupplierCosts(productionId, { as_at_date, set_code, account_code, supplier_name, date_from, date_to }, db);
    const header  = ['Date', 'PO Number', 'Supplier', 'Set Code', 'Account Code', 'Net', 'VAT', 'Gross', 'Payment Method'];
    const lines   = [header.join(',')];
    entries.forEach(e => {
      lines.push([
        toDateStr(e.date) || '',
        e.po_number, e.supplier_name, e.set_code, e.account_code,
        parseFloat(e.net_amount).toFixed(2),
        parseFloat(e.vat || 0).toFixed(2),
        parseFloat(e.gross_amount).toFixed(2),
        e.payment_method,
      ].map(esc).join(','));
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="SupplierCosts_${safeName}_${dateSuffix}.csv"`);
    return res.send(lines.join('\r\n'));
  } catch (err) {
    console.error('exportCostReportCSV:', err);
    res.status(500).json({ error: err.message });
  }
};

const buildFinalCostReportPdf = async (productionId, client = db) => {
  const { rows: [production] } = await client.query('SELECT * FROM productions WHERE id = $1', [productionId]);
  if (!production) throw Object.assign(new Error('Production not found'), { status: 404 });
  // ContractType.COST_PLUS / ContractType.ON_A_PRICE
  if (production.contract_type === 'cost_plus') {
    const data = await _buildType2Data(productionId, {}, client);
    return generateCostReportType2Pdf(data);
  }
  if (production.contract_type !== 'on_a_price') throw new Error('Unsupported cost report contract type');
  const [supplierEntries, labourEntries, metrics] = await Promise.all([
    CRS.getSupplierCosts(productionId, {}, client),
    CRS.getLabourCosts(productionId, {}, client),
    CRS.getSummaryMetrics(productionId, client),
  ]);
  return generateCostReportPdf({ production, supplierEntries, labourEntries, metrics });
};

// ─── GET /api/cost-reports/:productionId/export/pdf ──────────────────────────
// report_type=cost_plus → 9-chapter Cost Plus PDF
// (default) → Type 1 supplier/labour summary PDF
const exportCostReportPDF = async (req, res) => {
  const { productionId } = req.params;
  const { report_type, as_at_date, set_code, account_code, supplier_name, trade, crew_member, date_from, date_to } = req.query;

  try {
    const date = new Date().toISOString().split('T')[0];

    // ── Type 2 (Cost Plus) ────────────────────────────────────────────────────
    if (report_type === 'cost_plus') {
      const d = await _buildType2Data(productionId, { as_at_date, supplier_name, set_code, account_code, trade, crew_member }, db);

      const filterParts = [];
      if (supplier_name) filterParts.push(`Supplier: ${supplier_name}`);
      if (set_code)      filterParts.push(`Set: ${set_code}`);
      if (account_code)  filterParts.push(`Account: ${account_code}`);
      if (trade)         filterParts.push(`Trade: ${trade}`);
      if (as_at_date)    filterParts.push(`As at: ${as_at_date}`);
      const filterSummary = filterParts.length ? filterParts.join('  ·  ') : null;

      const pdfBuffer = await generateCostReportType2Pdf({
        production:           d.production,
        summary:              d.summary,
        mainCostReport:       d.mainCostReport,
        posAndBilling:        d.posAndBilling,
        labourToSend:         d.labourToSend,
        materialsToSend:      d.materialsToSend,
        omittedLabour:        d.omittedLabour,
        omittedMaterials:     d.omittedMaterials,
        weeklyInvoiceSummary: d.weeklyInvoiceSummary,
        weeklyPL:             d.weeklyPL,
        as_at_date,
        filterSummary,
      });

      const name = (d.production.name || 'Production').replace(/[^a-zA-Z0-9]+/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="CostReport_CostPlus_${name}_${date}.pdf"`);
      return res.send(pdfBuffer);
    }

    // ── Type 1 (On a Price) ───────────────────────────────────────────────────
    const { rows: [production] } = await db.query(
      'SELECT name, contract_type FROM productions WHERE id = $1', [productionId]
    );
    if (!production) return res.status(404).json({ error: 'Production not found' });

    const [supplierEntries, labourEntries, metrics] = await Promise.all([
      CRS.getSupplierCosts(productionId, { as_at_date, set_code, account_code, supplier_name, date_from, date_to }, db),
      CRS.getLabourCosts(productionId, { as_at_date, trade, crew_member, date_from, date_to }, db),
      as_at_date
        ? CRS.getAsAtSnapshot(productionId, as_at_date, db)
        : CRS.getSummaryMetrics(productionId, db),
    ]);

    const filterParts = [];
    if (supplier_name) filterParts.push(`Supplier: ${supplier_name}`);
    if (set_code)      filterParts.push(`Set: ${set_code}`);
    if (account_code)  filterParts.push(`Account: ${account_code}`);
    if (trade)         filterParts.push(`Trade: ${trade}`);
    if (date_from || date_to) filterParts.push(`Date: ${date_from || '*'} → ${date_to || '*'}`);
    if (as_at_date)    filterParts.push(`As at: ${as_at_date}`);
    const filterSummary = filterParts.length ? filterParts.join('  ·  ') : null;

    const pdfBuffer = await generateCostReportPdf({
      production, metrics, supplierEntries, labourEntries, filterSummary, as_at_date,
    });

    const name = (production.name || 'Production').replace(/[^a-zA-Z0-9]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="CostReport_${name}_${date}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('exportCostReportPDF:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/cost-reports/:productionId/next-invoice-number ─────────────────
// Returns the next sequential CS invoice number for this production.
// Scans cs_invoice_number across cost_report_po_billing and cost_report_weekly_pl,
// finds the highest CS-NNN value, and returns CS-(N+1) zero-padded to 3 digits.
const getNextInvoiceNumber = async (req, res) => {
  const { productionId } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT cs_invoice_number FROM cost_report_po_billing WHERE production_id = $1 AND cs_invoice_number IS NOT NULL
       UNION ALL
       SELECT cs_invoice_number FROM cost_report_weekly_pl  WHERE production_id = $1 AND cs_invoice_number IS NOT NULL`,
      [productionId]
    );
    const maxNum = rows.reduce((max, r) => {
      const m = (r.cs_invoice_number || '').match(/^CS-(\d+)$/i);
      if (m) { const n = parseInt(m[1], 10); return n > max ? n : max; }
      return max;
    }, 0);
    res.json({ next_invoice_number: `CS-${String(maxNum + 1).padStart(3, '0')}` });
  } catch (err) {
    console.error('getNextInvoiceNumber:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getType1Report, getType2Report, getCostReport, getSnapshot,
  getCostReportEntries, addInvoice, deleteInvoice,
  getCostPlus, upsertBudget,
  updatePoBilling, omitEntry, unomitEntry,
  updateMarginsReference, upsertWeeklyPL,
  getNextInvoiceNumber,
  exportCostReportCSV, exportCostReportPDF,
  buildFinalCostReportPdf,
};
