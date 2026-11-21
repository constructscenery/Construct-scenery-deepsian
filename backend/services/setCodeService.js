/**
 * CS-04 — which of the given set codes are NOT in a production's set list (its sets + active
 * universal codes)? Matching is trimmed and case-insensitive (ADR-02).
 *
 * Used to return non-blocking `warnings` from timesheet and PO saves: unknown codes are still saved
 * (CSV imports, roll-forward and legacy data keep working); the UI is what restricts new entries.
 */
const unknownSetCodes = async (db, productionId, codes) => {
  const wanted = [...new Set((codes || []).map(c => String(c ?? '').trim()).filter(Boolean))];
  if (!wanted.length || !productionId) return [];
  const { rows } = await db.query(
    `SELECT LOWER(TRIM(set_number)) AS code FROM sets
     WHERE production_id = $1 AND set_number IS NOT NULL AND LOWER(TRIM(set_number)) = ANY($2::text[])
     UNION
     SELECT LOWER(TRIM(code)) FROM universal_set_codes
     WHERE is_active = TRUE AND LOWER(TRIM(code)) = ANY($2::text[])`,
    [productionId, wanted.map(c => c.toLowerCase())]
  );
  const known = new Set(rows.map(r => r.code));
  return wanted.filter(c => !known.has(c.toLowerCase()));
};

const setCodeWarnings = unknown => unknown.map(code => ({
  set_code: code,
  message: `Set "${code}" is not in this production's set list. It was saved, but won't appear in per-set reporting until the set is added.`,
}));

module.exports = { unknownSetCodes, setCodeWarnings };
