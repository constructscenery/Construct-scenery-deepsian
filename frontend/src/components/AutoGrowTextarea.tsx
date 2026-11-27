'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * A textarea that opens to fit its whole text and grows as you type (Ben, 27 Nov 2026: the PO
 * Description box must "completely reopen" when editing). Capped at `maxHeightVh` of the screen,
 * after which it scrolls. Line breaks are kept (a one-line <input> silently drops them).
 */
type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  minRows?: number;
  maxHeightVh?: number;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
};

export default function AutoGrowTextarea({
  value, onChange, className = '', minRows = 4, maxHeightVh = 60, placeholder, id, disabled, 'aria-label': ariaLabel,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';                                   // shrink first so deletions reduce the height
    const max = (window.innerHeight * maxHeightVh) / 100;
    const next = Math.min(el.scrollHeight + 2, max);            // +2 for the borders
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden';
  }, [value, maxHeightVh]);

  return (
    <textarea
      ref={ref}
      id={id}
      rows={minRows}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={e => onChange(e.target.value)}
      className={className}
    />
  );
}
