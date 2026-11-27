/**
 * Generates a branded A4 landscape cost report PDF for export.
 * Sections: Summary metrics, Supplier Costs table, Labour Summary table.
 * If as_at_date is set, a "Showing data as at [date]" banner appears in the header.
 */

const PDFDocument = require('pdfkit');
const path        = require('path');

const LOGO_PATH = path.join(__dirname, '../assets/construct scenery logo.png');

const fmt     = (n) => `£${parseFloat(n || 0).toFixed(2)}`;
const fmtN    = (n) => parseFloat(n || 0).toFixed(2);
const fmtDate = (d) => {
  if (!d) return '—';
  const s = String(d).split('T')[0];
  const [y, m, day] = s.split('-');
  return new Date(Date.UTC(+y, +m - 1, +day))
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const generateCostReportPdf = ({ production, metrics, supplierEntries, labourEntries, filterSummary, as_at_date }) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data',  c  => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L      = 30;
    const W      = 781.89;  // 841.89 - 2×30
    const PAGE_H = 595.28;
    const BOTTOM = 40;
    let   pageNum = 1;

    const drawPageHeader = (title) => {
      try { doc.image(LOGO_PATH, L, 24, { width: 28, height: 28 }); } catch (e) { console.error('Cost report PDF logo load failed:', e.message); }
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#0f172a').text('Construct Scenery', L + 33, 28);
      doc.fontSize(7.5).font('Helvetica').fillColor('#64748b').text('Construct Scenery Limited', L + 33, 46);
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#0f172a')
         .text(`COST REPORT — ${(production.name || '').toUpperCase()}`, L, 28, { align: 'right', width: W });
      doc.fontSize(7.5).font('Helvetica').fillColor('#475569')
         .text(`Generated: ${fmtDate(new Date())}`, L, 48, { align: 'right', width: W });

      let sepY = 62;
      if (as_at_date) {
        doc.rect(L, sepY, W, 14).fill('#fef9c3');
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#92400e')
           .text(`Showing data as at ${fmtDate(as_at_date)} — not current.`, L + 4, sepY + 3);
        sepY += 16;
      }
      if (filterSummary) {
        doc.fontSize(7).font('Helvetica').fillColor('#64748b').text(`Filters: ${filterSummary}`, L, sepY, { width: W });
        sepY += 11;
      }
      doc.moveTo(L, sepY).lineTo(L + W, sepY).strokeColor('#e2e8f0').lineWidth(1).stroke();

      if (title) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text(title, L, sepY + 5);
        sepY += 18;
      }
      return sepY + 6;
    };

    const drawFooter = () => {
      const fy = PAGE_H - 16;
      doc.moveTo(L, fy).lineTo(L + W, fy).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
         .text(`Construct Scenery Limited  ·  Confidential  ·  Page ${pageNum}`, L, fy + 3, { align: 'center', width: W });
      pageNum++;
    };

    const newPage = (title) => {
      drawFooter();
      doc.addPage({ size: 'A4', layout: 'landscape', margin: 30 });
      return drawPageHeader(title);
    };

    const tableHeader = (cols, y) => {
      doc.rect(L, y, W, 16).fill('#f1f5f9');
      let x = L;
      cols.forEach(c => {
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#475569')
           .text(c.label, x + 2, y + 4, { width: c.w - 4, align: c.right ? 'right' : 'left', lineBreak: false });
        x += c.w;
      });
      return y + 16;
    };

    const tableRow = (cols, values, y, odd) => {
      if (odd) doc.rect(L, y, W, 13).fill('#f8fafc');
      let x = L;
      cols.forEach((c, i) => {
        doc.fontSize(6.5).font('Helvetica').fillColor('#1e293b')
           .text(String(values[i] ?? '—'), x + 2, y + 3,
             { width: c.w - 4, align: c.right ? 'right' : 'left', lineBreak: false, ellipsis: true });
        x += c.w;
      });
      return y + 13;
    };

    // ── Page 1: Summary metrics ────────────────────────────────────────────────
    let y = drawPageHeader(null);

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text('SUMMARY (ex VAT)', L, y);
    y += 14;

    const metricBox = (label, value, x, bw) => {
      doc.rect(x, y, bw, 36).fill('#f8fafc');
      doc.moveTo(x, y).lineTo(x, y + 36).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.fontSize(7).font('Helvetica').fillColor('#64748b').text(label, x + 8, y + 6, { width: bw - 16, lineBreak: false });
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#0f172a').text(fmt(value || 0), x + 8, y + 17, { width: bw - 16, lineBreak: false });
    };

    const mW = Math.floor(W / 4);
    metricBox('Total Supplier Costs',   metrics.total_supplier_costs,  L,         mW);
    metricBox('Total Labour Costs',     metrics.total_labour_costs,    L + mW,    mW);
    metricBox('Total Costs to Date',    metrics.total_costs_to_date,   L + mW*2,  mW);
    if (metrics.total_invoiced !== undefined) {
      metricBox('Invoiced to Production', metrics.total_invoiced,      L + mW*3,  mW);
    }
    doc.rect(L, y, W, 36).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 48;

    if (metrics.current_profit !== undefined) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#475569')
         .text(`Current Profit: ${fmt(metrics.current_profit)}`, L, y)
         .text(`Profit %: ${metrics.profit_pct == null ? '—' : `${parseFloat(metrics.profit_pct).toFixed(1)}%`}`, L + 160, y);
      if (metrics.last_updated) {
        doc.text(`Last updated: ${fmtDate(metrics.last_updated)}`, L + 320, y);
      }
      y += 16;
    }

    // ── Supplier costs table ───────────────────────────────────────────────────
    y += 6;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text('SUPPLIER COSTS', L, y);
    y += 14;

    const sCols = [
      { label: 'Date',            w: 60,  right: false, fmt: fmtDate },
      { label: 'PO Number',       w: 65,  right: false },
      { label: 'Supplier',        w: 120, right: false },
      { label: 'Set Code',        w: 55,  right: false },
      { label: 'Account Code',    w: 65,  right: false },
      { label: 'Net',             w: 68,  right: true,  fmt: fmtN },
      { label: 'VAT',             w: 55,  right: true,  fmt: fmtN },
      { label: 'Gross',           w: 70,  right: true,  fmt: fmtN },
      { label: 'Pmt Method',      w: 0,   right: false, fmt: v => (v || '—').replace(/_/g, ' ') },
    ];
    const sUsedW = sCols.slice(0, -1).reduce((s, c) => s + c.w, 0);
    sCols[sCols.length - 1].w = W - sUsedW;

    y = tableHeader(sCols, y);

    supplierEntries.forEach((e, idx) => {
      if (y + 13 > PAGE_H - BOTTOM) y = newPage('SUPPLIER COSTS (continued)');
      const vals = sCols.map(c => {
        const v = e[c.label === 'Date' ? 'date' : c.label === 'PO Number' ? 'po_number' : c.label === 'Supplier' ? 'supplier_name' : c.label === 'Set Code' ? 'set_code' : c.label === 'Account Code' ? 'account_code' : c.label === 'Net' ? 'net_amount' : c.label === 'VAT' ? 'vat' : c.label === 'Gross' ? 'gross_amount' : 'payment_method'];
        return c.fmt ? c.fmt(v) : (v ?? '—');
      });
      y = tableRow(sCols, vals, y, idx % 2 === 1);
    });

    // Supplier totals
    if (supplierEntries.length) {
      doc.moveTo(L, y).lineTo(L + W, y).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
      y += 2;
      doc.rect(L, y, W, 14).fill('#e2e8f0');
      const netColX  = sCols.slice(0, 5).reduce((s, c) => s + c.w, 0) + L;
      const vatColX  = netColX + sCols[5].w;
      const grossColX = vatColX + sCols[6].w;
      const totalNet   = supplierEntries.reduce((s, e) => s + parseFloat(e.net_amount || 0), 0);
      const totalVat   = supplierEntries.reduce((s, e) => s + parseFloat(e.vat || 0), 0);
      const totalGross = supplierEntries.reduce((s, e) => s + parseFloat(e.gross_amount || 0), 0);
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#0f172a')
         .text(`TOTAL (${supplierEntries.length})`, L + 2, y + 3);
      doc.text(fmtN(totalNet),   netColX + 2, y + 3, { width: sCols[5].w - 4, align: 'right' });
      doc.text(fmtN(totalVat),   vatColX + 2, y + 3, { width: sCols[6].w - 4, align: 'right' });
      doc.text(fmtN(totalGross), grossColX + 2, y + 3, { width: sCols[7].w - 4, align: 'right' });
      y += 16;
    }

    // ── Labour summary (new page) ──────────────────────────────────────────────
    if (labourEntries.length) {
      y = newPage('LABOUR SUMMARY');

      const lCols = [
        { label: 'Crew No.',     field: 'crew_number',       w: 52,  right: false },
        { label: 'Name',         field: '_name',              w: 90,  right: false },
        { label: 'Trade',        field: 'trade',              w: 70,  right: false },
        { label: 'Rank',         field: 'rank',               w: 65,  right: false },
        { label: 'Week Ending',  field: 'week_ending_date',   w: 62,  right: false, fmt: fmtDate },
        { label: 'Days',         field: 'total_days',         w: 30,  right: true  },
        { label: 'OT Hrs',       field: 'ot_hours',           w: 38,  right: true,  fmt: v => parseFloat(v || 0).toFixed(1) },
        { label: 'Daily Rate',   field: 'daily_rate',         w: 58,  right: true,  fmt: fmtN },
        { label: 'OT Rate',      field: 'ot_rate',            w: 50,  right: true,  fmt: fmtN },
        { label: 'Net',          field: 'net_amount',         w: 60,  right: true,  fmt: fmtN },
        { label: 'VAT',          field: 'vat',                w: 48,  right: true,  fmt: fmtN },
        { label: 'Gross',        field: 'gross_amount',       w: 0,   right: true,  fmt: fmtN },
      ];
      const lUsedW = lCols.slice(0, -1).reduce((s, c) => s + c.w, 0);
      lCols[lCols.length - 1].w = W - lUsedW;

      // Group by trade
      const byTrade = {};
      labourEntries.forEach(e => {
        const t = e.trade || 'Unknown';
        if (!byTrade[t]) byTrade[t] = [];
        byTrade[t].push(e);
      });

      Object.keys(byTrade).sort().forEach(trade => {
        // Trade header
        if (y + 16 > PAGE_H - BOTTOM) y = newPage('LABOUR SUMMARY (continued)');
        doc.rect(L, y, W, 13).fill('#e2e8f0');
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#0f172a').text(trade.toUpperCase(), L + 4, y + 3);
        y += 13;
        y = tableHeader(lCols, y);

        byTrade[trade].forEach((e, idx) => {
          if (y + 13 > PAGE_H - BOTTOM) y = newPage('LABOUR SUMMARY (continued)');
          const vals = lCols.map(c => {
            const raw = c.field === '_name' ? `${e.first_name} ${e.last_name}` : e[c.field];
            return c.fmt ? c.fmt(raw) : (raw ?? '—');
          });
          y = tableRow(lCols, vals, y, idx % 2 === 1);
        });

        // Trade subtotal
        const sub = byTrade[trade].reduce((s, e) => s + parseFloat(e.gross_amount || 0), 0);
        doc.moveTo(L, y).lineTo(L + W, y).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#475569')
           .text(`${trade} subtotal: ${fmtN(sub)}`, L + 2, y + 2);
        y += 12;
      });
    }

    drawFooter();
    doc.end();
  });
};

module.exports = { generateCostReportPdf };
