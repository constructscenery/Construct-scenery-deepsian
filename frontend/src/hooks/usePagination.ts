'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;
const CHANGE_EVENT = 'cs-page-size-change';

const subscribe = (onChange: () => void) => {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};

const readPageSize = (storageKey: string) => {
  try {
    const saved = Number(localStorage.getItem(storageKey));
    return PAGE_SIZE_OPTIONS.includes(saved) ? saved : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
};

/** Rows-per-page for one table, remembered in this browser. Server render always uses the default. */
export function usePageSize(key: string) {
  const storageKey = `cs_page_size:${key}`;
  const pageSize = useSyncExternalStore(subscribe, () => readPageSize(storageKey), () => DEFAULT_PAGE_SIZE);

  const setPageSize = useCallback((size: number) => {
    try { localStorage.setItem(storageKey, String(size)); } catch { /* storage unavailable — size just won't persist */ }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [storageKey]);

  return [pageSize, setPageSize] as const;
}

/** Client-side pagination for an already filtered/sorted list. Returns to page 1 whenever the result count changes. */
export function usePagedList<T>(items: T[], key: string) {
  const [pageSize, setPageSize] = usePageSize(key);
  const [page, setPage] = useState(1);
  const [prevCount, setPrevCount] = useState(items.length);
  if (items.length !== prevCount) {
    setPrevCount(items.length);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);

  return {
    pageItems: items.slice((safePage - 1) * pageSize, safePage * pageSize),
    barProps: {
      page: safePage,
      totalPages,
      onPageChange: setPage,
      totalItems: items.length,
      pageSize,
      onPageSizeChange: (size: number) => { setPageSize(size); setPage(1); },
    },
  };
}
