'use client';

import type { RateCardType } from '@/lib/api';

/** CS-08 — Standard / Commercial rate card for a production. */
export default function RateCardSelector({ value, onChange, upliftPct }: {
  value: RateCardType;
  onChange: (v: RateCardType) => void;
  upliftPct?: number | null;
}) {
  const pct = upliftPct ?? 10;
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">Rate card</label>
      <div className="grid grid-cols-2 gap-2">
        {([['standard', 'Standard', 'Rate card rates'], ['commercial', `Commercial (+${pct}%)`, `Every day and OT rate +${pct}%`]] as const).map(([key, title, hint]) => (
          <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={value === key}
            className={`text-left rounded-lg border px-3 py-2 text-xs transition-colors ${value === key ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <span className="block font-semibold">{title}</span>
            <span className="block text-[11px] opacity-80">{hint}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mt-1">Meals, mileage and travel are not uplifted. Manual rate overrides are used as entered.</p>
    </div>
  );
}
