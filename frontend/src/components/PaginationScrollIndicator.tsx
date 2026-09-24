'use client';

import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationScrollIndicatorProps {
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  totalItems: number;
  pageSize: number;
  itemName?: string;
  className?: string;
}

export default function PaginationScrollIndicator({
  page,
  totalPages,
  onPageChange,
  totalItems,
  pageSize,
  itemName = 'items',
  className = '',
}: PaginationScrollIndicatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);

  // Keep refs up to date for global drag events
  const safePageRef = useRef(safePage);
  safePageRef.current = safePage;
  const safeTotalPagesRef = useRef(safeTotalPages);
  safeTotalPagesRef.current = safeTotalPages;
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;

  // Show a clean window of up to 5 dots for maximum sleekness
  const MAX_VISIBLE = 5;
  let startPage = 1;
  let endPage = safeTotalPages;

  if (safeTotalPages > MAX_VISIBLE) {
    const half = Math.floor(MAX_VISIBLE / 2);
    if (safePage <= half + 1) {
      startPage = 1;
      endPage = MAX_VISIBLE;
    } else if (safePage >= safeTotalPages - half) {
      startPage = safeTotalPages - MAX_VISIBLE + 1;
      endPage = safeTotalPages;
    } else {
      startPage = safePage - half;
      endPage = safePage + half;
    }
  }

  const visiblePages = Array.from(
    { length: endPage - startPage + 1 },
    (_, i) => startPage + i
  );

  // Update page based on horizontal position during drag
  const updatePageFromClientX = (clientX: number) => {
    if (!containerRef.current || safeTotalPagesRef.current <= 1) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const pct = rect.width > 0 ? x / rect.width : 0;
    const targetPage = Math.min(
      safeTotalPagesRef.current,
      Math.max(1, Math.round(pct * (safeTotalPagesRef.current - 1)) + 1)
    );
    if (targetPage !== safePageRef.current) {
      onPageChangeRef.current(targetPage);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    updatePageFromClientX(e.clientX);
    setIsDragging(true);

    const onMouseMove = (moveEvent: MouseEvent) => {
      updatePageFromClientX(moveEvent.clientX);
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (safeTotalPages <= 1) return;
    e.preventDefault();
    if (e.deltaY > 0 || e.deltaX > 0) {
      if (safePage < safeTotalPages) onPageChange(safePage + 1);
    } else if (e.deltaY < 0 || e.deltaX < 0) {
      if (safePage > 1) onPageChange(safePage - 1);
    }
  };

  const startItem = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endItem = Math.min(safePage * pageSize, totalItems);

  return (
    <div
      className={`px-4 py-2 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between gap-3 ${className}`}
    >
      {/* Item count summary */}
      <span className="text-slate-400 text-xs font-normal">
        Showing {startItem}–{endItem} of {totalItems} {itemName}
      </span>

      {/* Sleek Pagination Controls */}
      <div className="flex items-center gap-1.5">
        {/* Previous page arrow */}
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded-md disabled:opacity-20 transition-colors"
          title="Previous page"
          aria-label="Previous page"
        >
          <ChevronLeft size={13} />
        </button>

        {/* Sleek Minimalist Expanding Pill & Dot Indicator */}
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
          className="relative px-2.5 py-1.5 rounded-full bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center gap-1.5 cursor-pointer select-none group transition-colors hover:bg-slate-200/60"
          title={`Page ${safePage} of ${safeTotalPages} (click dot, drag, or scroll)`}
        >
          {visiblePages.map((p) => {
            const distance = Math.abs(p - safePage);

            // Active page: Sleek elongated capsule
            if (distance === 0) {
              return (
                <button
                  key={p}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPageChange(p);
                  }}
                  className="h-1.5 w-6 rounded-full bg-slate-800 dark:bg-slate-100 hover:bg-slate-900 transition-all duration-300 ease-out shadow-2xs flex-shrink-0 cursor-pointer"
                  title={`Page ${p} (Current)`}
                  aria-label={`Page ${p}`}
                />
              );
            }

            // Immediately adjacent page: Medium pill
            if (distance === 1) {
              return (
                <button
                  key={p}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPageChange(p);
                  }}
                  className="h-1.5 w-3 rounded-full bg-slate-400/80 dark:bg-slate-500 hover:bg-slate-500 transition-all duration-300 ease-out flex-shrink-0 cursor-pointer"
                  title={`Page ${p}`}
                  aria-label={`Page ${p}`}
                />
              );
            }

            // Boundary dots when more pages exist beyond window
            const isEdgeWithMore =
              (p === startPage && startPage > 1) ||
              (p === endPage && endPage < safeTotalPages);

            if (isEdgeWithMore) {
              return (
                <button
                  key={p}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPageChange(p);
                  }}
                  className="h-1 w-1 rounded-full bg-slate-300/80 dark:bg-slate-600 hover:bg-slate-400 transition-all duration-300 ease-out flex-shrink-0 cursor-pointer"
                  title={`Page ${p}`}
                  aria-label={`Page ${p}`}
                />
              );
            }

            // Inactive distant pages: Small circular dot
            return (
              <button
                key={p}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPageChange(p);
                }}
                className="h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 transition-all duration-300 ease-out flex-shrink-0 cursor-pointer"
                title={`Page ${p}`}
                aria-label={`Page ${p}`}
              />
            );
          })}

          {/* Hover / Drag Mini Tooltip */}
          <div
            className={`absolute -top-6 left-1/2 -translate-x-1/2 ${
              isDragging ? 'flex' : 'hidden group-hover:flex'
            } items-center px-1.5 py-0.5 rounded bg-slate-800 text-white text-[10px] font-normal pointer-events-none shadow-md whitespace-nowrap z-30`}
          >
            Page {safePage} of {safeTotalPages}
          </div>
        </div>

        {/* Next page arrow */}
        <button
          type="button"
          disabled={safePage >= safeTotalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded-md disabled:opacity-20 transition-colors"
          title="Next page"
          aria-label="Next page"
        >
          <ChevronRight size={13} />
        </button>

        {/* Compact page readout */}
        <span className="text-[11px] text-slate-400 font-normal min-w-[32px] text-right">
          {safePage}/{safeTotalPages}
        </span>
      </div>
    </div>
  );
}
