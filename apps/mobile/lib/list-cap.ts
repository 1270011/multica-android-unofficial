/**
 * Server cap of `GET /api/issues` (handler issue.go: at most 100 issues
 * plus the real `total`). Own module without React Native so the list
 * filters can use it in node tests; lib/board.ts re-exports it.
 */
/** Server cap of one `GET /api/issues` request (page size). */
export const LIST_ISSUES_LIMIT = 100;

/** Pages the flat lists load with `offset` (data/queries/list-pages.ts). */
export const LIST_ISSUES_MAX_PAGES = 10;

/**
 * True when the server has more issues than the list loaded. Uses the
 * server `total`; without one (not loaded yet, or an old
 * server that sends none → 0) it falls back to "the cap was reached".
 */
export function isTruncated(loadedCount: number, total?: number): boolean {
  if (total === undefined || (total === 0 && loadedCount > 0)) return loadedCount >= LIST_ISSUES_LIMIT;
  return total > loadedCount;
}
