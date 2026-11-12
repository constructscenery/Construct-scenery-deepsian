/**
 * Quote PDF (Addendum 6 §8) — A4, Construct Scenery branding (same logo, palette and
 * company details as the PO PDF in poPdfService.js).
 *
 * Input is a quote as returned by quotesController.loadQuote (header + lines), or a
 * stored send snapshot of the same shape — so any version in the history can be
 * re-rendered exactly as it was sent.
 */

const PDFDocument = require('pdfkit');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '../assets/construct scenery logo.png');

const NAVY = '#0f172a';
const GOLD = '#b8962e';
const MUTED = '#64748b';
const BODY = '#334155';
const LINE = '#e2e8f0';

const COMPANY = {
  name: 'Construct Scenery Limited',
  address: 'Unit 4C Canal Wharf, Station Road, Langley, Berkshire, SL3 6EG',
  contact: 'info@constructscenery.co.uk  ·  invoice@constructscenery.co.uk',
};

const money = n => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = n => String(Number(n) || 0);
/** 'YYYY-MM-DD' (or ISO) → '10 Nov 2026'. Read as a calendar date, so no timezone drift. */
const fmtDate = d => {
  if (!d) return '—';
  const t = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** Lines are grouped by type on the PDF, each group with its own subtotal. */
const GROUPS = [
  { title: 'Labour', types: ['labour_grade', 'labour_department'] },
  { title: 'Materials', types: ['materials'] },
  { title: 'Plant Hire', types: ['plant_hire'] },
  { title: 'Miscellaneous', types: ['misc'] },
];

const VAT_LABEL = { standard: 'VAT (20%)', zero: 'VAT (0%)', exempt: 'VAT (Exempt)' };

const pdfFileName = q => `${q.reference}${Number(q.revision) > 1 ? `-rev${q.revision}` : ''}.pdf`;

const generateQuotePdf = quote => new Promise((resolve, reject) => {
  // Bottom margin keeps any long text PDFKit wraps onto a new page clear of the footer (rule at y=790).
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 55, left: 40, right: 40 }, bufferPages: true });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  const L = 40;
  const R = 555;
  const W = R - L;
  const PAGE_BOTTOM = 772; // our own layout stops here; footer sits below
  const lines = Array.isArray(quote.lines) ? [...quote.lines] : [];

  // ── Header band ─────────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 96).fill(NAVY);
  doc.roundedRect(L, 20, 56, 56, 6).fill('#ffffff');
  try {
    doc.image(LOGO_PATH, L + 4, 24, { width: 48, height: 48 });
  } catch (e) {
    console.error('Quote PDF logo load failed:', e.message);
  }
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#ffffff')
    .text(COMPANY.name, 250, 26, { width: R - 250, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor('#cbd5e1')
    .text(COMPANY.address, 250, 46, { width: R - 250, align: 'right' })
    .text(COMPANY.contact, 250, 59, { width: R - 250, align: 'right' });
  doc.rect(0, 96, doc.page.width, 2).fill(GOLD);

  // ── Title + quote meta ──────────────────────────────────────────────────────
  let y = 116;
  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text('QUOTATION', L, y);
  if (quote.status === 'draft') {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#b45309')
      .text('DRAFT — NOT YET SENT', 300, y + 6, { width: R - 300, align: 'right' });
  }
  y += 30;

  const metaH = 74;
  doc.roundedRect(L, y, W, metaH, 4).fillAndStroke('#f8fafc', LINE);
  const metaCols = [
    ['QUOTE REFERENCE', quote.reference],
    ['QUOTE DATE', fmtDate(quote.quote_date)],
    ['VALID UNTIL', fmtDate(quote.valid_until)],
    ['REVISION', `Rev ${Number(quote.revision) || 1}`],
  ];
  const colW = W / metaCols.length;
  metaCols.forEach(([label, value], i) => {
    const x = L + 12 + i * colW;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(label, x, y + 10);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(i === 0 ? '#2563eb' : NAVY).text(value || '—', x, y + 22, { width: colW - 16 });
  });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text('TITLE', L + 12, y + 44);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY)
    .text(quote.title || '—', L + 12, y + 55, { width: W - 24, lineBreak: false, ellipsis: true });
  y += metaH + 12;

  // ── Recipient block ─────────────────────────────────────────────────────────
  const recipient = quote.recipient_type === 'internal'
    ? [
      [`${quote.department || '—'} Department`, true],
      [`Production: ${quote.production_name || '—'}`, false],
    ]
    : [
      [quote.recipient_name || '—', true],
      [quote.recipient_company || '', false],
      [quote.recipient_email || '', false],
      ...(quote.production_name ? [[`Production: ${quote.production_name}`, false]] : []),
    ].filter(([text]) => text);
  const recH = 26 + recipient.length * 13;
  doc.roundedRect(L, y, W, recH, 4).fillAndStroke('#ffffff', LINE);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text('ADDRESSED TO', L + 12, y + 10);
  recipient.forEach(([text, bold], i) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9).fillColor(bold ? NAVY : BODY)
      .text(text, L + 12, y + 23 + i * 13, { width: W - 24, lineBreak: false, ellipsis: true });
  });
  y += recH + 14;

  // ── Introduction ────────────────────────────────────────────────────────────
  if (quote.introduction) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text('INTRODUCTION', L, y);
    doc.font('Helvetica').fontSize(9).fillColor(BODY).text(quote.introduction, L, y + 12, { width: W, lineGap: 2 });
    y = doc.y + 14;
  }

  // ── Line items, grouped by type ─────────────────────────────────────────────
  const COL = {
    desc: { x: L + 10, w: 250 },
    qty: { x: 300, w: 45 },
    unit: { x: 355, w: 60 },
    rate: { x: 415, w: 62 },
    total: { x: 483, w: 62 },
  };

  const newPage = () => {
    doc.addPage();
    return 50;
  };
  const tableHeader = () => {
    doc.rect(L, y, W, 20).fill(NAVY);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text('DESCRIPTION', COL.desc.x, y + 6, { width: COL.desc.w });
    doc.text('QTY', COL.qty.x, y + 6, { width: COL.qty.w, align: 'right' });
    doc.text('UNIT', COL.unit.x + 8, y + 6, { width: COL.unit.w - 8 });
    doc.text('RATE', COL.rate.x, y + 6, { width: COL.rate.w, align: 'right' });
    doc.text('TOTAL', COL.total.x, y + 6, { width: COL.total.w, align: 'right' });
    y += 20;
  };
  const ensureRoom = (h, withHeader = true) => {
    if (y + h <= PAGE_BOTTOM) return;
    y = newPage();
    if (withHeader) tableHeader();
  };

  if (y + 60 > PAGE_BOTTOM) y = newPage();
  tableHeader();

  for (const group of GROUPS) {
    const rows = lines.filter(l => group.types.includes(l.line_type));
    if (!rows.length) continue;

    ensureRoom(18 + 20 + 20);
    doc.rect(L, y, W, 18).fill('#f1f5f9');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text(group.title.toUpperCase(), COL.desc.x, y + 5);
    y += 18;

    let subtotal = 0;
    for (const line of rows) {
      doc.font('Helvetica').fontSize(9);
      const descH = doc.heightOfString(line.description || '', { width: COL.desc.w });
      doc.fontSize(7.5);
      const noteH = line.note ? doc.heightOfString(line.note, { width: COL.desc.w }) + 2 : 0;
      const rowH = Math.max(20, descH + noteH + 10);
      ensureRoom(rowH);

      doc.font('Helvetica').fontSize(9).fillColor(NAVY).text(line.description || '', COL.desc.x, y + 5, { width: COL.desc.w });
      if (line.note) {
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(line.note, COL.desc.x, y + 5 + descH + 2, { width: COL.desc.w });
      }
      doc.font('Helvetica').fontSize(9).fillColor(BODY);
      doc.text(qtyText(line.quantity), COL.qty.x, y + 5, { width: COL.qty.w, align: 'right' });
      doc.text(line.unit || '—', COL.unit.x + 8, y + 5, { width: COL.unit.w - 8, lineBreak: false, ellipsis: true });
      doc.text(money(line.unit_rate), COL.rate.x, y + 5, { width: COL.rate.w, align: 'right' });
      doc.font('Helvetica-Bold').fillColor(NAVY).text(money(line.line_total), COL.total.x, y + 5, { width: COL.total.w, align: 'right' });
      y += rowH;
      doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(0.5).stroke();
      subtotal += Number(line.line_total) || 0;
    }

    ensureRoom(20);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BODY)
      .text(`${group.title} subtotal`, COL.rate.x - 120, y + 6, { width: 180, align: 'right' });
    doc.fillColor(NAVY).text(money(subtotal), COL.total.x, y + 6, { width: COL.total.w, align: 'right' });
    y += 24;
  }

  if (!lines.length) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No line items.', COL.desc.x, y + 6);
    y += 24;
  }

  // ── Totals block (right-aligned) ────────────────────────────────────────────
  const discount = Number(quote.discount_amount) || 0;
  const totalsH = 16 * (discount > 0 ? 3 : 2) + 26;
  ensureRoom(totalsH + 10, false);
  y += 6;
  const tW = 230;
  const tX = R - tW;
  const totalRow = (label, value) => {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(label, tX + 10, y + 3, { width: 130 });
    doc.font('Helvetica').fontSize(9).fillColor(NAVY).text(value, tX + 120, y + 3, { width: tW - 130, align: 'right' });
    y += 16;
  };
  totalRow('Subtotal', money(quote.subtotal));
  if (discount > 0) {
    const pct = quote.discount_type === 'percent' ? ` (${Number(quote.discount_value)}%)` : '';
    totalRow(`Discount${pct}`, `-${money(discount)}`);
  }
  totalRow(VAT_LABEL[quote.vat_treatment] || 'VAT', money(quote.vat_amount));
  doc.rect(tX, y + 2, tW, 24).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
    .text('TOTAL', tX + 10, y + 9)
    .text(money(quote.total), tX + 120, y + 9, { width: tW - 130, align: 'right' });
  y += 36;

  // ── Terms / footer notes ────────────────────────────────────────────────────
  if (quote.footer_notes) {
    doc.font('Helvetica').fontSize(8.5);
    const notesH = doc.heightOfString(quote.footer_notes, { width: W - 24, lineGap: 2 }) + 30;
    ensureRoom(notesH, false);
    doc.roundedRect(L, y, W, notesH, 4).fillAndStroke('#f8fafc', LINE);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text('TERMS & NOTES', L + 12, y + 10);
    doc.font('Helvetica').fontSize(8.5).fillColor(BODY).text(quote.footer_notes, L + 12, y + 22, { width: W - 24, lineGap: 2 });
  }

  // ── Footer on every page: gold rule, company details, reference ─────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // the footer sits inside the bottom margin; stop PDFKit adding a page for it
    const fy = 790;
    doc.moveTo(L, fy).lineTo(R, fy).strokeColor(GOLD).lineWidth(1.5).stroke();
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
      .text(`${COMPANY.name}  ·  ${COMPANY.address}`, L, fy + 6, { width: W - 150, lineBreak: false });
    doc.text(`${quote.reference}  ·  Page ${i + 1} of ${range.count}`, R - 150, fy + 6, { width: 150, align: 'right', lineBreak: false });
  }

  doc.end();
});

module.exports = { generateQuotePdf, pdfFileName };
