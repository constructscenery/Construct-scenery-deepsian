import React, { useState, useRef, useEffect } from 'react';
import { ArrowDown, ArrowUp, Filter } from 'lucide-react';

export interface SortState {
  key: string;
  dir: 'asc' | 'desc' | null;
}

interface ColumnHeaderProps {
  label: string;
  sortKey?: string;
  sort?: SortState;
  onSort?: (sort: SortState) => void;
  filterType?: 'text' | 'date' | 'select' | 'none';
  filterOptions?: Array<{ label: string; value: string }>;
  filterValue?: string;
  onFilterChange?: (value: string) => void;
  className?: string;
}

export function ColumnHeader({
  label,
  sortKey,
  sort,
  onSort,
  filterType = 'none',
  filterOptions = [],
  filterValue = '',
  onFilterChange,
  className = ''
}: ColumnHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isSortedAsc = sort?.key === sortKey && sort?.dir === 'asc';
  const isSortedDesc = sort?.key === sortKey && sort?.dir === 'desc';
  const hasFilter = filterValue !== '' && filterValue != null;

  const handleSortAsc = () => {
    if (onSort && sortKey) onSort({ key: sortKey, dir: 'asc' });
    setIsOpen(false);
  };

  const handleSortDesc = () => {
    if (onSort && sortKey) onSort({ key: sortKey, dir: 'desc' });
    setIsOpen(false);
  };

  const handleClearSort = () => {
    if (onSort && sortKey) onSort({ key: '', dir: null });
    setIsOpen(false);
  };

  return (
    <th className={`px-4 py-2.5 text-xs font-semibold text-slate-500 relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 hover:text-slate-800 transition-colors uppercase tracking-wider"
      >
        {label}
        {isSortedAsc && <ArrowUp size={12} className="text-blue-500" />}
        {isSortedDesc && <ArrowDown size={12} className="text-blue-500" />}
        {hasFilter && !isSortedAsc && !isSortedDesc && <Filter size={10} className="text-blue-500" />}
      </button>

      {isOpen && (
        <div ref={popoverRef} className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-xl border border-slate-200 z-50 p-2 font-normal text-slate-700 normal-case tracking-normal">
          {sortKey && (
            <div className="flex flex-col gap-1 pb-2 mb-2 border-b border-slate-100">
              <button onClick={handleSortAsc} className={`text-left px-2 py-1.5 rounded hover:bg-slate-50 text-xs flex items-center gap-2 ${isSortedAsc ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}>
                <ArrowUp size={12} /> Sort A-Z / Oldest
              </button>
              <button onClick={handleSortDesc} className={`text-left px-2 py-1.5 rounded hover:bg-slate-50 text-xs flex items-center gap-2 ${isSortedDesc ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}>
                <ArrowDown size={12} /> Sort Z-A / Newest
              </button>
              {(isSortedAsc || isSortedDesc) && (
                <button onClick={handleClearSort} className="text-left px-2 py-1.5 rounded hover:bg-slate-50 text-xs text-slate-400">
                  Clear Sort
                </button>
              )}
            </div>
          )}

          {filterType !== 'none' && onFilterChange && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase font-semibold text-slate-400 px-1">Filter by {label}</label>
              
              {filterType === 'select' && (
                <select
                  value={filterValue}
                  onChange={(e) => onFilterChange(e.target.value)}
                  className="w-full text-xs p-1.5 border border-slate-200 rounded mt-1 bg-white outline-none"
                >
                  <option value="">All</option>
                  {filterOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}

              {filterType === 'date' && (
                <input
                  type="date"
                  value={filterValue}
                  onChange={(e) => onFilterChange(e.target.value)}
                  className="w-full text-xs p-1.5 border border-slate-200 rounded mt-1 outline-none"
                />
              )}

              {filterType === 'text' && (
                <input
                  type="text"
                  placeholder={`Search ${label}...`}
                  value={filterValue}
                  onChange={(e) => onFilterChange(e.target.value)}
                  className="w-full text-xs p-1.5 border border-slate-200 rounded mt-1 outline-none"
                />
              )}
              
              {filterValue && (
                <button onClick={() => onFilterChange('')} className="text-left px-2 py-1.5 mt-1 rounded hover:bg-slate-50 text-xs text-rose-500">
                  Clear Filter
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </th>
  );
}
