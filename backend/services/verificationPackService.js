/**
 * Generates a single merged verification-pack PDF for the Accountant.
 *
 * Structure (alphabetical by last name, repeating per crew member):
 *   [Timesheet page(s)] → [Invoice page(s) or PAYE placeholder]
 *
 * Invoice handling:
 *   - PDF invoice  → pages copied directly into the merged document
 *   - JPEG/PNG     → embedded as a full-page image (scaled to fit A4)
 *   - PAYE crew    → placeholder page "PAYE — no invoice required."
 *   - Missing file → placeholder page with error note
 */

let pdfLib = null;
const getPdfLib = () => {
  if (!pdfLib) {
    pdfLib = require('pdf-lib');
  }
  return pdfLib;
};
const { generateTimesheetPdf }            = require('./timesheetPdfService');
const path                                = require('path');
const fs                                  = require('fs').promises;
const https                               = require('https');
const http                                = require('http');

const A4 = [595.28, 841.89]; // points

const fileStorage = require('./fileStorage');

// Fetch an invoice file — handles S3 URLs using fileStorage
const readUploadedFile = async (url) => {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return fileStorage.getFileBuffer(url);
  }
  // Legacy local path fallback
  const urlPath  = url.startsWith('/') ? url.slice(1) : url;
  const filePath = path.join(process.cwd(), urlPath);
  return fs.readFile(filePath);
};

const getExt = (filename) => (filename || '').toLowerCase().split('.').pop();

// Draw a centred placeholder box on a blank A4 page
const addPlaceholderPage = (doc, boldFont, font, ts, message) => {
  const { rgb } = getPdfLib();
  const page = doc.addPage(A4);
  const [pageW, pageH] = A4;
  const boxX = 50, boxY = pageH / 2 - 70, boxW = pageW - 100, boxH = 140;

  page.drawRectangle({
    x: boxX, y: boxY, width: boxW, height: boxH,
    color: rgb(0.97, 0.98, 0.99),
    borderColor: rgb(0.88, 0.90, 0.93),
    borderWidth: 1,
  });

  const isPAYE   = ts.employment_status === 'paye';
  const title    = message || (isPAYE ? 'PAYE — no invoice required.' : 'No invoice attached.');
  const crewLine = `${ts.first_name} ${ts.last_name}  ·  ${ts.crew_number}  ·  Week ending ${ts.week_ending_date}`;

  page.drawText(title, {
    x: boxX + 25, y: boxY + boxH - 35,
    size: 13, font: boldFont,
    color: rgb(0.06, 0.09, 0.16),
    maxWidth: boxW - 50,
  });
  page.drawText(crewLine, {
    x: boxX + 25, y: boxY + boxH - 60,
    size: 10, font,
    color: rgb(0.28, 0.33, 0.40),
    maxWidth: boxW - 50,
  });
};

/**
 * Generate the merged verification pack.
 *
 * @param {Array}  timesheets  - Timesheet rows, each with `.entries` array attached
 * @param {string} productionName
 * @returns {{ pdfBytes: Uint8Array, timesheetPageCount: number, invoicePageCount: number, crewCount: number }}
 */
const generateVerificationPack = async (timesheets, productionName) => {
  const { PDFDocument, StandardFonts } = getPdfLib();
  const merged     = await PDFDocument.create();
  const font       = await merged.embedFont(StandardFonts.Helvetica);
  const boldFont   = await merged.embedFont(StandardFonts.HelveticaBold);

  let timesheetPageCount = 0;
  let invoicePageCount   = 0;

  // Alphabetical by last name, then first name
  const sorted = [...timesheets].sort((a, b) =>
    (a.last_name || '').localeCompare(b.last_name || '') ||
    (a.first_name || '').localeCompare(b.first_name || '')
  );

  for (const ts of sorted) {
    // ── 1. Timesheet pages ────────────────────────────────────────────────────
    const tsPdfBytes = await generateTimesheetPdf(ts, ts.entries || []);
    const tsPdf      = await PDFDocument.load(tsPdfBytes);
    const tsCopied   = await merged.copyPages(tsPdf, tsPdf.getPageIndices());
    tsCopied.forEach(p => merged.addPage(p));
    timesheetPageCount += tsCopied.length;

    // ── 2. Invoice page(s) or placeholder ────────────────────────────────────
    const isPAYE     = ts.employment_status === 'paye';
    const hasInvoice = !!ts.invoice_attachment_url;

    if (!isPAYE && hasInvoice) {
      try {
        const fileBytes = await readUploadedFile(ts.invoice_attachment_url);
        const ext       = getExt(ts.invoice_attachment_name);

        if (ext === 'pdf') {
          const invPdf    = await PDFDocument.load(fileBytes);
          const invCopied = await merged.copyPages(invPdf, invPdf.getPageIndices());
          invCopied.forEach(p => merged.addPage(p));
          invoicePageCount += invCopied.length;
        } else if (['jpg', 'jpeg', 'png'].includes(ext)) {
          const imgPage = merged.addPage(A4);
          const img     = ext === 'png'
            ? await merged.embedPng(fileBytes)
            : await merged.embedJpg(fileBytes);
          const { width: imgW, height: imgH } = img.scale(1);
          const scale   = Math.min(A4[0] / imgW, A4[1] / imgH, 1); // never upscale
          const scaledW = imgW * scale;
          const scaledH = imgH * scale;
          imgPage.drawImage(img, {
            x: (A4[0] - scaledW) / 2,
            y: (A4[1] - scaledH) / 2,
            width:  scaledW,
            height: scaledH,
          });
          invoicePageCount++;
        } else {
          addPlaceholderPage(merged, boldFont, font, ts, `Invoice file type .${ext} cannot be embedded — please check manually.`);
          invoicePageCount++;
        }
      } catch (fileErr) {
        console.error(`Verification pack: could not read invoice for ${ts.first_name} ${ts.last_name}:`, fileErr.message);
        addPlaceholderPage(merged, boldFont, font, ts, 'Invoice file could not be read — please check manually.');
        invoicePageCount++;
      }
    } else if (!isPAYE && ts.invoice_override_reason) {
      // FB-06: self-employed timesheet verified without an invoice — say so, with the reason given.
      // Standard PDF fonts only encode WinAnsi, so strip anything else rather than fail the whole pack.
      const reason = String(ts.invoice_override_reason).replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u20AC]/g, '?');
      const short  = reason.length > 70 ? `${reason.slice(0, 67)}...` : reason;
      addPlaceholderPage(merged, boldFont, font, ts, `Verified without invoice: ${short}`);
      invoicePageCount++;
    } else {
      // PAYE crew (no invoice required) or SE without invoice attached
      addPlaceholderPage(merged, boldFont, font, ts, null);
      invoicePageCount++;
    }
  }

  const pdfBytes = await merged.save();
  return { pdfBytes, timesheetPageCount, invoicePageCount, crewCount: sorted.length };
};

module.exports = { generateVerificationPack };
