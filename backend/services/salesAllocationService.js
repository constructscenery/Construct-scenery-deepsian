const db = require('../config/db');
const { logAudit } = require('./auditService');

/**
 * CS-06 — Sales invoice ↔ production matching.
 *
 * One matcher is shared by the allocation panel's suggestion and by auto-allocation, so the
 * suggestion a user sees and what auto-allocation does can never disagree.
 *
 * A production matches when its production_code appears in the Xero reference as a whole token
 * (case-insensitive): code "CS1" matches "CS1 wk3" and "Ref: cs1/2" but NOT "CS10".
 *
 * Auto-allocation (InvoiceAllocationSource.AUTO) only touches invoices that:
 *   - are unallocated (production_id IS NULL)
 *   - have never been allocated or unallocated by a person (allocation_source IS NULL)
 *   - match exactly ONE production, whose code is at least 3 characters long
 * Any manual allocate / unallocate sets allocation_source = 'manual' (InvoiceAllocationSource.MANUAL),
 * and auto-allocation never touches that invoice again.
 */

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

/** True when `code` appears in `reference` as a whole token (not inside a longer word/number). */
const referenceContainsCode = (reference, code) => {
  const ref = String(reference || '').trim().toLowerCase();
  const c = String(code || '').trim().toLowerCase();
  if (!ref || !c) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(c)}($|[^a-z0-9])`).test(ref);
};

/** Productions that can be matched: live (not deleted, not archived) with a non-blank code. */
const loadMatchableProductions = async (queryRunner = db) => {
  const { rows } = await queryRunner.query(
    `SELECT id, name, production_code
     FROM productions
     WHERE deleted_at IS NULL
       AND status <> 'archived'
       AND production_code IS NOT NULL AND TRIM(production_code) <> ''
     ORDER BY name`
  );
  return rows;
};

/** Productions whose code appears (as a whole token) in the reference. */
const matchProductions = (reference, productions) =>
  productions.filter(p => referenceContainsCode(reference, p.production_code));

const findSuggestedProductions = async reference => {
  if (!reference || !String(reference).trim()) return [];
  return matchProductions(reference, await loadMatchableProductions());
};

// XeroInvoiceStatus.AUTHORISED / PAID — the same invoices the Sales page shows
const AUTO_ALLOCATE_STATUSES = ['authorised', 'paid'];
const MIN_AUTO_CODE_LENGTH = 3;

/**
 * Link every eligible invoice whose reference matches exactly one production.
 * Safe to run any number of times. Returns { allocated: [{ id, invoice_number, production_id }] }.
 */
const autoAllocateInvoices = async () => {
  const [productions, { rows: invoices }] = await Promise.all([
    loadMatchableProductions(),
    db.query(
      `SELECT id, invoice_number, reference
       FROM xero_invoices
       WHERE production_id IS NULL
         AND allocation_source IS NULL
         AND reference IS NOT NULL AND TRIM(reference) <> ''
         AND xero_status = ANY($1::text[])`,
      [AUTO_ALLOCATE_STATUSES]
    ),
  ]);
  if (!productions.length || !invoices.length) return { allocated: [] };

  // Very short codes (e.g. "12") could match the day or month of a date in a reference, so they are
  // only ever *suggested*, never auto-linked.
  const autoLinkable = productions.filter(p => String(p.production_code).trim().length >= MIN_AUTO_CODE_LENGTH);
  const pairs = [];
  for (const inv of invoices) {
    // Ambiguity is judged against ALL matchable productions, so a short code still blocks a wrong auto-link.
    const matches = matchProductions(inv.reference, productions);
    if (matches.length === 1 && autoLinkable.includes(matches[0])) pairs.push({ invoice: inv, production: matches[0] });
  }
  if (!pairs.length) return { allocated: [] };

  // Guarded update: a person may have allocated one of these between the read and this write.
  const { rows: allocated } = await db.query(
    `UPDATE xero_invoices xi
     SET production_id = m.production_id, allocation_source = 'auto',
         allocated_by = NULL, allocated_at = NOW(), updated_at = NOW()
     FROM UNNEST($1::uuid[], $2::uuid[]) AS m(invoice_id, production_id)
     WHERE xi.id = m.invoice_id
       AND xi.production_id IS NULL
       AND xi.allocation_source IS NULL
     RETURNING xi.id, xi.invoice_number, xi.production_id`,
    [pairs.map(p => p.invoice.id), pairs.map(p => p.production.id)]
  );

  const byInvoice = new Map(pairs.map(p => [p.invoice.id, p]));
  for (const row of allocated) {
    const pair = byInvoice.get(row.id);
    await logAudit({
      userName: 'System (Xero auto-link)',
      productionId: row.production_id,
      category: 'financial',
      action: 'sales_invoice_auto_allocated',
      entityType: 'xero_invoice',
      entityId: row.invoice_number,
      details: `Auto-linked invoice ${row.invoice_number} to ${pair.production.name} (reference "${pair.invoice.reference}" contains code ${pair.production.production_code})`,
      metadata: { invoice_id: row.id, production_id: row.production_id, matched_code: pair.production.production_code },
    });
  }
  return { allocated };
};

module.exports = {
  referenceContainsCode,
  matchProductions,
  findSuggestedProductions,
  autoAllocateInvoices,
};
