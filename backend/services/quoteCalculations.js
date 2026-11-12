/**
 * Quote maths and status rules (Addendum 6 — Quotes).
 * Pure functions: no DB access, so they are unit-tested directly.
 *
 * Enum references (src/enums/index.ts):
 *   QuoteStatus, QuoteRecipientType, QuoteLineType, VatTreatment, DiscountType
 */

// QuoteStatus
const QUOTE_STATUSES = ['draft', 'sent', 'approved', 'declined', 'awaiting_po_ref', 'invoice_raised'];
// QuoteRecipientType
const RECIPIENT_TYPES = ['internal', 'external'];
// QuoteLineType
const LINE_TYPES = ['labour_grade', 'labour_department', 'materials', 'plant_hire', 'misc'];
// VatTreatment
const VAT_TREATMENTS = ['standard', 'zero', 'exempt'];
// DiscountType
const DISCOUNT_TYPES = ['percent', 'fixed'];

const VAT_RATES = { standard: 0.2, zero: 0, exempt: 0 };

/**
 * Allowed status moves (Addendum 6 §9). A Sent quote can go to Approved or Declined;
 * every other move is strictly sequential. Anything not listed here is refused.
 */
const ALLOWED_TRANSITIONS = {
  draft: ['sent'],
  sent: ['approved', 'declined'],
  approved: ['awaiting_po_ref'],
  awaiting_po_ref: ['invoice_raised'],
  declined: [],
  invoice_raised: [],
};

/** Timestamp column set when a quote enters each status. */
const STATUS_TIMESTAMP_COLUMN = {
  sent: 'sent_at',
  approved: 'approved_at',
  declined: 'declined_at',
  invoice_raised: 'invoice_raised_at',
};

/**
 * Round to 2 dp, half away from zero — the same result Postgres gives when storing NUMERIC(12,2).
 * Shifting by exponent ("300.005e2") avoids float error (300.005 * 100 = 30000.499…).
 */
const round2 = (n) => {
  const v = Number(n) || 0;
  const shifted = Number(`${Math.abs(v)}e2`);
  const r = Math.round(Number.isFinite(shifted) ? shifted : Math.abs(v) * 100) / 100;
  return v < 0 ? -r : r;
};

const lineTotal = (quantity, unitRate) => round2((Number(quantity) || 0) * (Number(unitRate) || 0));

/**
 * Totals for a quote: Subtotal = Σ line totals (each already rounded);
 * discount applied before VAT; VAT on (subtotal − discount); Total = net + VAT.
 */
const computeTotals = (lines, { discount_type = null, discount_value = 0, vat_treatment = 'standard' } = {}) => {
  const subtotal = round2((lines || []).reduce((sum, l) => sum + lineTotal(l.quantity, l.unit_rate), 0));

  let discount_amount = 0;
  const dv = Number(discount_value) || 0;
  if (discount_type === 'percent') discount_amount = round2(subtotal * (dv / 100));
  else if (discount_type === 'fixed') discount_amount = round2(dv);
  discount_amount = Math.min(Math.max(discount_amount, 0), subtotal);

  const net = round2(subtotal - discount_amount);
  const vat_amount = round2(net * (VAT_RATES[vat_treatment] ?? VAT_RATES.standard));
  const total = round2(net + vat_amount);

  return { subtotal, discount_amount, vat_amount, total };
};

/** Returns an error message, or null when the discount is valid for the given subtotal. */
const validateDiscount = (discount_type, discount_value, subtotal = Infinity) => {
  if (discount_type == null || discount_type === '') return null;
  if (!DISCOUNT_TYPES.includes(discount_type)) return `Invalid discount type. Must be one of: ${DISCOUNT_TYPES.join(', ')}`;
  const v = Number(discount_value);
  if (!Number.isFinite(v) || v < 0) return 'Discount must be 0 or more';
  if (discount_type === 'percent' && v > 100) return 'Percentage discount cannot be more than 100';
  if (discount_type === 'fixed' && v > subtotal) return 'Fixed discount cannot be more than the subtotal';
  return null;
};

const canTransition = (from, to) => (ALLOWED_TRANSITIONS[from] || []).includes(to);

/** CSL-Q-0001 … CSL-Q-9999, then CSL-Q-10000 onward. */
const formatQuoteReference = (n) => `CSL-Q-${String(n).padStart(4, '0')}`;

module.exports = {
  QUOTE_STATUSES,
  RECIPIENT_TYPES,
  LINE_TYPES,
  VAT_TREATMENTS,
  DISCOUNT_TYPES,
  ALLOWED_TRANSITIONS,
  STATUS_TIMESTAMP_COLUMN,
  round2,
  lineTotal,
  computeTotals,
  validateDiscount,
  canTransition,
  formatQuoteReference,
};
