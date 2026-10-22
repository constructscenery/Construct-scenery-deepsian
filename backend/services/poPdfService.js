/**
 * Generates a PO PDF as a Buffer using PDFKit.
 * Stored temporarily for email attachment — not persisted to disk.
 */

const PDFDocument = require('pdfkit');
const path        = require('path');

const LOGO_PATH = path.join(__dirname, '../assets/construct scenery logo.png');

const fmt = (n) => `£${parseFloat(n || 0).toFixed(2)}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const generatePoPdf = (po, productionName) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({
      margins: { top: 36, bottom: 20, left: 40, right: 40 },
      size: 'A4',
      bufferPages: true,
    });
    const chunks = [];

    doc.on('data',  (c) => chunks.push(c));
    doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 40;
    const R = 555;
    const W = 515;

    // ── Header ──────────────────────────────────────────────────────────────────
    try {
      doc.image(LOGO_PATH, L, 40, { width: 42, height: 42 });
    } catch (e) {
      console.error('PO PDF logo load failed:', e.message);
    }

    // Company Info (Left)
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a').text('Construct Scenery', L + 50, 40);
    doc.fontSize(8.5).font('Helvetica').fillColor('#64748b')
       .text('Construct Scenery Limited', L + 50, 58)
       .text('Unit 4C Canal Wharf, Station Road, Langley, SL3 6EG', L + 50, 70)
       .text('General: info@constructscenery.co.uk  ·  Invoices: invoice@constructscenery.co.uk', L + 50, 82);

    // Document Meta (Right)
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#0f172a')
       .text('PURCHASE ORDER', 320, 40, { align: 'right', width: 235 });

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#2563eb')
       .text(`PO Number: ${po.po_number}`, 320, 62, { align: 'right', width: 235 });

    doc.fontSize(8.5).font('Helvetica').fillColor('#475569')
       .text(`Date: ${fmtDate(po.date_of_po)}`, 320, 76, { align: 'right', width: 235 })
       .text(`Status: ${(po.status || 'draft').toUpperCase()}`, 320, 88, { align: 'right', width: 235 });

    // Header Divider
    doc.moveTo(L, 102).lineTo(R, 102).strokeColor('#cbd5e1').lineWidth(1).stroke();

    // ── Two Columns: Supplier vs Invoice & Delivery ─────────────────────────────
    const boxY   = 112;
    const boxW   = 250;
    const boxPad = 10;

    // Build supplier address and contact lines
    const supLines = [];
    if (po.supplier_contact_name) supLines.push(`Attn: ${po.supplier_contact_name}`);
    if (po.street_name) {
      supLines.push(po.street_name);
    } else if (po.supplier_address) {
      supLines.push(po.supplier_address);
    }

    const cityCounty = [po.city, po.county].filter(Boolean).join(', ');
    if (cityCounty) supLines.push(cityCounty);
    if (po.zip_code) supLines.push(po.zip_code);
    if (po.supplier_phone || po.phone) supLines.push(`Tel: ${po.supplier_phone || po.phone}`);
    if (po.supplier_email || po.email) supLines.push(`Email: ${po.supplier_email || po.email}`);
    if (po.supplier_account_number || po.supplier_code || po.account_number) {
      supLines.push(`Account Ref: ${po.supplier_account_number || po.supplier_code || po.account_number}`);
    }

    // Dynamic box height based on address lines
    const leftContentH  = 24 + (Math.max(supLines.length, 1) * 12);
    const rightContentH = 24 + (5 * 12);
    const boxH          = Math.max(leftContentH, rightContentH, 95) + 14;

    // Left Box - Vendor / Supplier
    doc.roundedRect(L, boxY, boxW, boxH, 4).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b')
       .text('VENDOR / SUPPLIER', L + boxPad, boxY + boxPad);
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a')
       .text(po.supplier_name || '—', L + boxPad, boxY + boxPad + 13, { width: boxW - (boxPad * 2) });

    let sy = boxY + boxPad + 28;
    doc.fontSize(8).font('Helvetica').fillColor('#334155');
    if (supLines.length === 0) {
      doc.text('No address details on file', L + boxPad, sy);
    } else {
      supLines.forEach((line) => {
        doc.text(line, L + boxPad, sy, { width: boxW - (boxPad * 2) });
        sy += 12;
      });
    }

    // Right Box - Invoice To & Production
    const rightX = L + W - boxW;
    doc.roundedRect(rightX, boxY, boxW, boxH, 4).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b')
       .text('INVOICE TO & PRODUCTION', rightX + boxPad, boxY + boxPad);
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a')
       .text('Construct Scenery Limited', rightX + boxPad, boxY + boxPad + 13, { width: boxW - (boxPad * 2) });

    const ry = boxY + boxPad + 28;
    doc.fontSize(8).font('Helvetica').fillColor('#334155')
       .text('Unit 4C Canal Wharf, Station Road', rightX + boxPad, ry)
       .text('Langley, Berkshire, SL3 6EG', rightX + boxPad, ry + 12);

    doc.font('Helvetica-Bold').fillColor('#2563eb')
       .text('Send Invoices: invoice@constructscenery.co.uk', rightX + boxPad, ry + 25);

    doc.font('Helvetica').fillColor('#475569')
       .text(`Production: ${productionName || '—'}`, rightX + boxPad, ry + 38, { width: boxW - (boxPad * 2) });
    if (po.created_by_name) {
      doc.text(`Raised By: ${po.created_by_name}`, rightX + boxPad, ry + 50, { width: boxW - (boxPad * 2) });
    }

    // ── Order Coding Table ───────────────────────────────────────────────────────
    let curY = boxY + boxH + 12;
    doc.roundedRect(L, curY, W, 38, 4).fillAndStroke('#f1f5f9', '#cbd5e1');

    const colW = W / 4;
    const c1 = L + 12;
    const c2 = L + colW + 6;
    const c3 = L + (colW * 2) + 6;
    const c4 = L + (colW * 3) + 6;

    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#64748b')
       .text('SET CODE', c1, curY + 6)
       .text('ACCOUNT CODE', c2, curY + 6)
       .text('DEPARTMENT', c3, curY + 6)
       .text('PAYMENT METHOD', c4, curY + 6);

    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a')
       .text(po.set_code || '—', c1, curY + 19)
       .text(po.account_code || '—', c2, curY + 19)
       .text(po.department || '—', c3, curY + 19)
       .text((po.paid_from || '—').replace(/_/g, ' ').toUpperCase(), c4, curY + 19);

    curY += 50;

    // ── Items / Description Table ───────────────────────────────────────────────
    doc.rect(L, curY, W, 20).fill('#0f172a');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff')
       .text('ITEM / DESCRIPTION', L + 12, curY + 6)
       .text('NET AMOUNT', R - 75, curY + 6, { align: 'right', width: 65 });

    curY += 20;

    const descTopY = curY;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a')
       .text(po.title || 'Order Line Item', L + 12, curY + 10, { width: 380 });

    const textY = doc.y + 4;
    if (po.description) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#334155')
         .text(po.description, L + 12, textY, { width: 380, lineGap: 2 });
    }

    const descBottomY = Math.max(doc.y + 12, descTopY + 50);

    // Border around description row
    doc.rect(L, descTopY, W, descBottomY - descTopY).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

    // Net amount on right of row
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a')
       .text(fmt(po.net_amount), R - 75, descTopY + 10, { align: 'right', width: 65 });

    curY = descBottomY + 10;

    // ── Financial Summary Box ───────────────────────────────────────────────────
    const sumW = 200;
    const sumX = R - sumW;
    let sumY = curY;

    const row = (label, val, bold = false, isTotal = false) => {
      if (isTotal) {
        doc.rect(sumX, sumY, sumW, 24).fill('#0f172a');
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
           .text(label, sumX + 10, sumY + 7);
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff')
           .text(val, sumX + 100, sumY + 7, { align: 'right', width: 90 });
        sumY += 24;
      } else {
        doc.fontSize(8.5).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#475569')
           .text(label, sumX + 10, sumY + 4);
        doc.fontSize(8.5).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#0f172a')
           .text(val, sumX + 100, sumY + 4, { align: 'right', width: 90 });
        sumY += 16;
      }
    };

    doc.rect(sumX, sumY, sumW, 36).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    row('Net Subtotal:', fmt(po.net_amount));
    row('VAT (20%):', fmt(po.vat));
    row('Total Gross:', fmt(po.gross_amount), true, true);

    curY = sumY + 12;

    // Check if instructions box fits on current page (needs ~68pt before footer line at 788)
    if (curY + 68 > 780) {
      doc.addPage();
      curY = 40;
    }

    // ── Invoicing Instructions Box ──────────────────────────────────────────────
    const noteBoxH = 64;
    const noteBoxY = curY;
    doc.roundedRect(L, noteBoxY, W, noteBoxH, 4).fillAndStroke('#eff6ff', '#bfdbfe');

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e40af')
       .text('INVOICING INSTRUCTIONS & SUBMISSION', L + 10, noteBoxY + 7, { lineBreak: false });

    let iy = noteBoxY + 20;
    doc.fontSize(7.5).font('Helvetica').fillColor('#1e3a8a')
       .text('• Send PDF Invoices To: ', L + 10, iy, { continued: true })
       .font('Helvetica-Bold').fillColor('#1d4ed8').text('invoice@constructscenery.co.uk', { continued: true })
       .font('Helvetica').fillColor('#1e3a8a').text(`  |  Mandatory PO Reference: `, { continued: true })
       .font('Helvetica-Bold').fillColor('#0f172a').text(po.po_number || '—', { lineBreak: false });

    iy += 13;
    doc.font('Helvetica').fillColor('#1e3a8a')
       .text('• Invoice Address: Construct Scenery Limited, Unit 4C Canal Wharf, Station Road, Langley, Berkshire, SL3 6EG.', L + 10, iy, { lineBreak: false });

    iy += 13;
    doc.font('Helvetica').fillColor('#1e3a8a')
       .text('• Payment Terms: Please ensure company bank details (sort code & account number) and VAT number are stated on all invoices.', L + 10, iy, { lineBreak: false });

    // ── Footers on all pages ────────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = 788;
      doc.moveTo(L, footerY).lineTo(R, footerY).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
      doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
         .text(
           'Construct Scenery Limited  ·  Unit 4C Canal Wharf, Station Road, Langley, SL3 6EG  ·  invoice@constructscenery.co.uk',
           L, footerY + 5, { align: 'left', width: W - 70, lineBreak: false }
         );
      doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
         .text(
           `Page ${i + 1} of ${range.count}`,
           R - 65, footerY + 5, { align: 'right', width: 65, lineBreak: false }
         );
    }

    doc.end();
  });
};

// ─── PO List PDF — A4 landscape, for CSV/PDF export ─────────────────────────
const generatePoListPdf = (pos, filterSummary) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data',  c  => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L      = 30;
    const W      = 781.89; // 841.89 - 2*30
    const PAGE_H = 595.28;
    const BOTTOM = 45;

    const cols = [
      { label: 'PO Number',   field: 'po_number',       w: 62,  right: false },
      { label: 'Date',        field: 'date_of_po',       w: 55,  right: false, fmt: fmtDate },
      { label: 'Supplier',    field: 'supplier_name',    w: 90,  right: false },
      { label: 'Dept',        field: 'department',       w: 45,  right: false, fmt: v => v || '—' },
      { label: 'Description', field: 'description',      w: 80,  right: false },
      { label: 'Set',         field: 'set_code',         w: 38,  right: false },
      { label: 'Acct Code',   field: 'account_code',     w: 55,  right: false },
      { label: 'Net',         field: 'net_amount',       w: 52,  right: true,  fmt: fmt },
      { label: 'VAT',         field: 'vat',              w: 42,  right: true,  fmt: fmt },
      { label: 'Gross',       field: 'gross_amount',     w: 52,  right: true,  fmt: fmt },
      { label: 'Pmt Method',  field: 'paid_from',        w: 74,  right: false, fmt: v => (v || '—').replace(/_/g, ' ') },
      { label: 'Status',      field: 'status',           w: 58,  right: false },
      { label: 'Approved By', field: 'approved_by_name', w: 0,   right: false },
    ];
    // Assign remaining width to last column
    const usedW = cols.slice(0, -1).reduce((s, c) => s + c.w, 0);
    cols[cols.length - 1].w = W - usedW;
    // Pre-compute x offsets
    let xAcc = L;
    cols.forEach(c => { c.x = xAcc; xAcc += c.w; });

    const HEADER_H = 18;
    const ROW_H    = 13;

    const drawTableHeader = (y) => {
      doc.rect(L, y, W, HEADER_H).fill('#f1f5f9');
      cols.forEach(c => {
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#475569')
           .text(c.label, c.x + 2, y + 5, { width: c.w - 4, align: c.right ? 'right' : 'left', lineBreak: false });
      });
      return y + HEADER_H;
    };

    const drawFooter = () => {
      const fy = PAGE_H - 18;
      doc.moveTo(L, fy).lineTo(L + W, fy).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
         .text('Construct Scenery Limited  ·  Confidential', L, fy + 4, { align: 'center', width: W });
    };

    // ── Page 1 header ──────────────────────────────────────────────────────────
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#0f172a').text('DEEPSIAN', L, 32);
    doc.fontSize(7.5).font('Helvetica').fillColor('#64748b').text('Construct Scenery Limited', L, 54);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0f172a').text('PURCHASE ORDERS', L, 32, { align: 'right', width: W });
    doc.fontSize(7.5).font('Helvetica').fillColor('#475569')
       .text(`Generated: ${fmtDate(new Date())}`, L, 52, { align: 'right', width: W });

    let sepY = 68;
    if (filterSummary) {
      doc.fontSize(7).font('Helvetica').fillColor('#64748b')
         .text(`Filters applied: ${filterSummary}`, L, 68, { width: W });
      sepY = 80;
    }
    doc.moveTo(L, sepY).lineTo(L + W, sepY).strokeColor('#e2e8f0').lineWidth(1).stroke();

    let y = drawTableHeader(sepY + 6);

    // ── Rows ──────────────────────────────────────────────────────────────────
    pos.forEach((po, idx) => {
      if (y + ROW_H > PAGE_H - BOTTOM) {
        drawFooter();
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 30 });
        y = drawTableHeader(30);
      }
      if (idx % 2 === 1) doc.rect(L, y, W, ROW_H).fill('#f8fafc');

      cols.forEach(c => {
        const raw = po[c.field];
        const val = c.fmt ? c.fmt(raw) : (raw ?? '—');
        doc.fontSize(6.5).font('Helvetica').fillColor('#1e293b')
           .text(String(val), c.x + 2, y + 3,
             { width: c.w - 4, align: c.right ? 'right' : 'left', lineBreak: false, ellipsis: true });
      });
      y += ROW_H;
    });

    // ── Totals row ────────────────────────────────────────────────────────────
    if (pos.length) {
      doc.moveTo(L, y).lineTo(L + W, y).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
      y += 2;
      if (y + HEADER_H > PAGE_H - BOTTOM) {
        drawFooter();
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 30 });
        y = 30;
      }
      doc.rect(L, y, W, HEADER_H).fill('#e2e8f0');

      const totalNet   = pos.reduce((s, p) => s + parseFloat(p.net_amount   || 0), 0);
      const totalVat   = pos.reduce((s, p) => s + parseFloat(p.vat          || 0), 0);
      const totalGross = pos.reduce((s, p) => s + parseFloat(p.gross_amount || 0), 0);

      doc.fontSize(7).font('Helvetica-Bold').fillColor('#0f172a')
         .text(`TOTAL (${pos.length} PO${pos.length !== 1 ? 's' : ''})`, L + 2, y + 5);

      const netC   = cols.find(c => c.field === 'net_amount');
      const vatC   = cols.find(c => c.field === 'vat');
      const grossC = cols.find(c => c.field === 'gross_amount');
      doc.text(fmt(totalNet),   netC.x   + 2, y + 5, { width: netC.w   - 4, align: 'right' });
      doc.text(fmt(totalVat),   vatC.x   + 2, y + 5, { width: vatC.w   - 4, align: 'right' });
      doc.text(fmt(totalGross), grossC.x + 2, y + 5, { width: grossC.w - 4, align: 'right' });
    }

    drawFooter();
    doc.end();
  });
};

module.exports = { generatePoPdf, generatePoListPdf };
