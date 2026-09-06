// In-memory search over a bounded window of submissions, extracted from index.ts
// (route registration only) so the paginate-after-filter ordering is unit tested.
// Filtering an already-paginated page made a match beyond the first page look
// like a genuine zero-match — a silently wrong answer.

export type SearchPage<T> = {
  data: T[];
  total: number;
  truncated: boolean;
};

// Query with `limit: cap + 1` so the extra row distinguishes "exactly cap rows
// exist" from "the scan was cut short"; the extra row is dropped before use.
export function filterAndPaginate<T extends { data?: Record<string, unknown> }>(
  rows: T[],
  search: string,
  offset: number,
  limit: number,
  cap: number
): SearchPage<T> {
  const truncated = rows.length > cap;
  const scanned = truncated ? rows.slice(0, cap) : rows;

  const needle = String(search ?? '').toLowerCase();
  const matched = needle
    ? scanned.filter((r) =>
        Object.values(r.data || {}).some((v) => String(v).toLowerCase().includes(needle))
      )
    : scanned;

  return {
    data: matched.slice(offset, offset + limit),
    total: matched.length,
    truncated,
  };
}

// `?limit=abc` produced slice(NaN, NaN) — an empty page next to a non-zero
// total, a self-contradicting response. Parse defensively on every path.
export function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
