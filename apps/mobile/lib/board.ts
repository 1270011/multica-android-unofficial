/**
 * Pure logic behind the issue board.
 *
 * Columns: one per status key, in the same order as the grouped lists
 * (`groupIssuesByStatus`: category, then workspace position). Every active
 * status gets a column, also when it is empty, so the column bar can show
 * "0". Like web (`visibleStatusKeys`, `DEFAULT_HIDDEN_STATUSES`):
 * - without a status filter only the key `cancelled` is hidden (custom
 *   closed statuses stay visible);
 * - a status filter overrides hiding and shows exactly the filtered columns.
 * Deliberate divergence: an issue on an archived (or unknown) status keeps
 * its own column, web drops it; mobile never hides a loaded issue.
 * Cards inside a column: newest first (web's default board sort).
 *
 * `GET /api/issues` returns at most 100 issues per request (server cap,
 * handler issue.go) plus the real `total`; the lists load up to 10 pages
 * and `isTruncated` tells the board its
 * counts are incomplete (data/queries/list-total.ts).
 *
 * Layout: portrait phones page one column per screen; at a font scale of
 * 1.5 or more the column bar becomes the selector row "‹ Todo · 7 ›" and the
 * column takes the full width. From 600 dp several columns sit side by side,
 * 280 dp × font scale, clamped to 280–420 dp.
 */
import type { Issue, IssueStatus, IssueStatusEntry } from "@multica/core/types";
import { COMPACT_MAX_DP } from "./breakpoints";
import { groupIssuesByStatus } from "./group-issues-by-status";
import { issueColumnCategory } from "./issue-status";

export interface BoardColumn {
  status: IssueStatus;
  issues: Issue[];
}

export interface BoardColumnOptions {
  /** Active status filter (exact keys); overrides hidden columns. */
  statusFilters?: readonly IssueStatus[];
  /** Hidden without a filter; web's default is just `cancelled`. */
  hiddenStatuses?: readonly IssueStatus[];
}

export const DEFAULT_HIDDEN_STATUSES: readonly IssueStatus[] = ["cancelled"];

export { LIST_ISSUES_LIMIT, isTruncated } from "./list-cap";

/**
 * Which notices the board shows above its columns. With an active filter
 * the filter chips already say "filters apply to the first n issues",
 * so the board drops its own "narrow it down with filters" (one notice).
 */
export function boardNotices({
  truncated,
  filtersActive,
  hiddenCount,
}: {
  truncated: boolean;
  filtersActive: boolean;
  hiddenCount: number;
}): { truncated: boolean; hidden: boolean } {
  return { truncated: truncated && !filtersActive, hidden: hiddenCount > 0 };
}

/** No card in any visible column (e.g. every match sits in Cancelled). */
export function boardIsEmpty(columns: BoardColumn[]): boolean {
  return columns.every((c) => c.issues.length === 0);
}

/** "7", or "7+" when the list may be cut off. */
export function countLabel(count: number, truncated: boolean): string {
  return truncated ? `${count}+` : String(count);
}

/** Issues the board does not show because their column is hidden. */
export function hiddenIssueCount(
  issues: Issue[],
  { statusFilters = [], hiddenStatuses = DEFAULT_HIDDEN_STATUSES }: BoardColumnOptions = {},
): number {
  if (statusFilters.length > 0) return 0;
  return issues.filter((i) => hiddenStatuses.includes(i.status)).length;
}

const newestFirst = (a: Issue, b: Issue) => Date.parse(b.created_at) - Date.parse(a.created_at);

export function boardColumns(
  issues: Issue[],
  entries: IssueStatusEntry[] = [],
  { statusFilters = [], hiddenStatuses = DEFAULT_HIDDEN_STATUSES }: BoardColumnOptions = {},
): BoardColumn[] {
  const byStatus = new Map<IssueStatus, Issue[]>();
  for (const section of groupIssuesByStatus(issues, entries)) byStatus.set(section.status, section.data);

  // Order every column key with the list's rule: one stand-in row per key
  // (status + category) is all groupIssuesByStatus reads.
  const keys = new Set<IssueStatus>(byStatus.keys());
  for (const entry of entries) if (!entry.archived_at) keys.add(entry.key);
  // A filtered status gets its column even when empty or not loaded yet.
  for (const key of statusFilters) keys.add(key);
  const categoryOf = (key: IssueStatus) =>
    entries.find((e) => e.key === key)?.category ??
    issueColumnCategory({ status: key, status_category: byStatus.get(key)?.[0]?.status_category });
  const ordered = groupIssuesByStatus(
    [...keys].map((status) => ({ status, status_category: categoryOf(status) }) as Issue),
    entries,
  ).map((s) => s.status);

  const visible = (status: IssueStatus) =>
    statusFilters.length > 0 ? statusFilters.includes(status) : !hiddenStatuses.includes(status);
  return ordered
    .filter(visible)
    .map((status) => ({ status, issues: [...(byStatus.get(status) ?? [])].sort(newestFirst) }));
}

export type BoardMode = "pager" | "selector" | "columns";

export interface BoardLayout {
  mode: BoardMode;
  columnWidth: number;
}

export const COLUMN_BASE_DP = 280;
export const COLUMN_MAX_DP = 420;
/** Gap that leaves the next column's edge visible in the pager. */
export const PAGER_PEEK_DP = 40;
/** From this font scale the portrait column bar becomes one selector row. */
export const SELECTOR_FONT_SCALE = 1.5;

export function boardLayout(width: number, fontScale: number): BoardLayout {
  if (width < COMPACT_MAX_DP) {
    return fontScale >= SELECTOR_FONT_SCALE
      ? { mode: "selector", columnWidth: width }
      : { mode: "pager", columnWidth: width - PAGER_PEEK_DP };
  }
  const columnWidth = Math.min(COLUMN_MAX_DP, Math.max(COLUMN_BASE_DP, COLUMN_BASE_DP * fontScale));
  return { mode: "columns", columnWidth };
}

/** Status of the column next to `status` (TalkBack "next/previous
 *  column"); null at the ends or when the status has no column. */
export function neighborStatus(columns: BoardColumn[], status: IssueStatus, delta: number): IssueStatus | null {
  const index = columns.findIndex((c) => c.status === status);
  if (index === -1) return null;
  return columns[index + delta]?.status ?? null;
}

/** Step through columns in the selector row without wrapping. */
export function stepColumn(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, index + delta));
}

/** Calendar-day due date in the past (YYYY-MM-DD, local day). */
export function isOverdue(dueDate: string | null | undefined, today = new Date()): boolean {
  if (!dueDate) return false;
  const day = dueDate.slice(0, 10);
  const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return day < local;
}
