const {
  computeTotals, lineTotal, validateDiscount, canTransition, formatQuoteReference, round2,
} = require('../services/quoteCalculations');

describe('quote calculations', () => {
  test('line total is quantity × rate rounded to 2 dp', () => {
    expect(lineTotal(2.5, 312.4)).toBe(781);
    expect(lineTotal(3, 0.335)).toBe(1.01);
    expect(lineTotal(1, 0)).toBe(0);
  });

  test('round2 rounds halves away from zero', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(300.005)).toBe(300.01);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(0.0000001)).toBe(0);
    expect(round2('12.345')).toBe(12.35);
    expect(round2(null)).toBe(0);
  });

  test('standard VAT on lines with no discount', () => {
    const t = computeTotals([{ quantity: 5, unit_rate: 300 }, { quantity: 1, unit_rate: 250 }], { vat_treatment: 'standard' });
    expect(t).toEqual({ subtotal: 1750, discount_amount: 0, vat_amount: 350, total: 2100 });
  });

  test('percentage discount is applied before VAT', () => {
    const t = computeTotals([{ quantity: 1, unit_rate: 1000 }], { discount_type: 'percent', discount_value: 10, vat_treatment: 'standard' });
    expect(t).toEqual({ subtotal: 1000, discount_amount: 100, vat_amount: 180, total: 1080 });
  });

  test('fixed discount is applied before VAT', () => {
    const t = computeTotals([{ quantity: 1, unit_rate: 1000 }], { discount_type: 'fixed', discount_value: 250, vat_treatment: 'standard' });
    expect(t).toEqual({ subtotal: 1000, discount_amount: 250, vat_amount: 150, total: 900 });
  });

  test('fixed discount never exceeds the subtotal', () => {
    const t = computeTotals([{ quantity: 1, unit_rate: 100 }], { discount_type: 'fixed', discount_value: 500, vat_treatment: 'standard' });
    expect(t).toEqual({ subtotal: 100, discount_amount: 100, vat_amount: 0, total: 0 });
  });

  test.each(['zero', 'exempt'])('%s VAT adds nothing', vat => {
    const t = computeTotals([{ quantity: 2, unit_rate: 50 }], { vat_treatment: vat });
    expect(t).toEqual({ subtotal: 100, discount_amount: 0, vat_amount: 0, total: 100 });
  });

  test('no lines gives zero totals', () => {
    expect(computeTotals([], {})).toEqual({ subtotal: 0, discount_amount: 0, vat_amount: 0, total: 0 });
  });

  test('discount validation', () => {
    expect(validateDiscount(null, 0)).toBeNull();
    expect(validateDiscount('percent', 100)).toBeNull();
    expect(validateDiscount('percent', 101)).toMatch(/more than 100/);
    expect(validateDiscount('percent', -1)).toMatch(/0 or more/);
    expect(validateDiscount('fixed', 50, 40)).toMatch(/more than the subtotal/);
    expect(validateDiscount('bogus', 5)).toMatch(/Invalid discount type/);
  });
});

describe('quote status transitions', () => {
  test.each([
    ['draft', 'sent'],
    ['sent', 'approved'],
    ['sent', 'declined'],
    ['approved', 'awaiting_po_ref'],
    ['awaiting_po_ref', 'invoice_raised'],
  ])('%s → %s is allowed', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  test.each([
    ['draft', 'approved'],
    ['sent', 'awaiting_po_ref'],
    ['approved', 'invoice_raised'],
    ['declined', 'approved'],
    ['invoice_raised', 'draft'],
    ['sent', 'draft'],
  ])('%s → %s is refused', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe('quote reference', () => {
  test('is CSL-Q- plus at least 4 digits', () => {
    expect(formatQuoteReference(41)).toBe('CSL-Q-0041');
    expect(formatQuoteReference(9999)).toBe('CSL-Q-9999');
    expect(formatQuoteReference(10000)).toBe('CSL-Q-10000');
  });
});
