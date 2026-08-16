import { useMemo, useState, useEffect } from "react";

/**
 * Client-side pagination over an already-fetched array. Resets to page 1
 * whenever the source list changes length or identity (e.g. a filter changes
 * what "data" is), so stale pages never show an empty page 4 of 2.
 */
export function usePagination<T>(data: T[], pageSize = 25) {
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(data.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [data.length]);

  const safePage = Math.min(page, pageCount);

  const pageData = useMemo(
    () => data.slice((safePage - 1) * pageSize, safePage * pageSize),
    [data, safePage, pageSize],
  );

  return {
    page: safePage,
    pageCount,
    pageData,
    setPage,
    total: data.length,
    pageSize,
  };
}
