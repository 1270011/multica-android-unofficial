/**
 * Paged `GET /api/issues` for the flat issue lists. The server
 * returns at most 100 issues per request; a workspace with many done
 * issues pushed open ones past that cap (done issues sort first by
 * position), so the board's Backlog column lost cards. The lists now load
 * page by page with `offset` until the server `total`, up to
 * LIST_ISSUES_MAX_PAGES pages. The cache shape stays a flat `Issue[]`, so
 * the WS updaters and mutations keep patching the same keys.
 */
import type { Issue, ListIssuesParams, ListIssuesResponse } from "@multica/core/types";
import { api } from "@/data/api";
import { LIST_ISSUES_LIMIT, LIST_ISSUES_MAX_PAGES } from "@/lib/list-cap";

/**
 * Loads the first page, then the remaining pages (in parallel) up to the
 * page cap. Issues are de-duplicated by id: a position change between two
 * page requests can move an issue onto the next page as well.
 */
export async function listIssuePages(
  params: ListIssuesParams,
  opts?: { signal?: AbortSignal },
): Promise<ListIssuesResponse> {
  const first = await api.listIssues({ ...params, limit: LIST_ISSUES_LIMIT }, opts);
  const pages = Math.min(Math.ceil(first.total / LIST_ISSUES_LIMIT), LIST_ISSUES_MAX_PAGES);
  // A short first page is complete, also when an old server sends no total.
  if (pages <= 1 || first.issues.length < LIST_ISSUES_LIMIT) return first;
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      api.listIssues({ ...params, limit: LIST_ISSUES_LIMIT, offset: (i + 1) * LIST_ISSUES_LIMIT }, opts),
    ),
  );
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const page of [first, ...rest]) {
    for (const issue of page.issues) {
      if (seen.has(issue.id)) continue;
      seen.add(issue.id);
      issues.push(issue);
    }
  }
  return { issues, total: first.total };
}
