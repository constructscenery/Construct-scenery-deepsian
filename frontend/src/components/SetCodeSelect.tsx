'use client';

import type { SetCodeOption } from '@/lib/api';

/**
 * CS-04 — set code dropdown for timesheet days and purchase orders.
 * Options: the production's sets, then universal (management) codes. A saved value that isn't in
 * the list (legacy free text) is kept and shown with a "not in set list" marker — never wiped.
 * When the list couldn't be loaded (`options === null`) it falls back to a plain text box, as before.
 */
export const isKnownSetCode = (value: string, options: SetCodeOption[] | null) =>
  !value.trim() || !options || options.some(o => o.code.trim().toLowerCase() === value.trim().toLowerCase());

/** The list's spelling of a code, so saved values are consistent ("  100 " → "100"). */
export const canonicalSetCode = (value: string, options: SetCodeOption[] | null) => {
  const hit = options?.find(o => o.code.trim().toLowerCase() === value.trim().toLowerCase());
  return hit ? hit.code : value;
};

export default function SetCodeSelect({
  value, onChange, options, disabled, className = '', ariaLabel = 'Set',
}: {
  value: string;
  onChange: (code: string) => void;
  options: SetCodeOption[] | null;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  if (options === null) {
    return (
      <input type="text" placeholder="—" value={value} disabled={disabled} aria-label={ariaLabel}
        onChange={e => onChange(e.target.value)} className={className} />
    );
  }
  const sets = options.filter(o => o.source === 'production');
  const universal = options.filter(o => o.source === 'universal');
  const known = isKnownSetCode(value, options);
  const selected = known ? canonicalSetCode(value, options) : value;

  return (
    <select value={selected} disabled={disabled} aria-label={ariaLabel}
      onChange={e => onChange(e.target.value)}
      className={`${className} ${known ? '' : 'border-amber-400 bg-amber-50'}`}
      title={known ? undefined : 'This set is not in the production’s set list'}>
      <option value="">—</option>
      {!known && <option value={value}>{value} (not in set list)</option>}
      {sets.length > 0 && (
        <optgroup label="Sets">
          {sets.map(o => <option key={`s-${o.code}`} value={o.code}>{o.code} — {o.name}</option>)}
        </optgroup>
      )}
      {universal.length > 0 && (
        <optgroup label="Management (all productions)">
          {universal.map(o => <option key={`u-${o.code}`} value={o.code}>{o.code} — {o.name}</option>)}
        </optgroup>
      )}
    </select>
  );
}
