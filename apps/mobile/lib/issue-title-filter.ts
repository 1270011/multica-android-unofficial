/**
 * Title filter in the overview lists (W5
 * P8). Runs as the last step after `filterIssueList`, so the list, the
 * board columns and the hint count the same issues.
 *
 * Applies to My Issues (all tabs, list and board), the project page and the
 * chat suggestion bar. Not to search, Inbox, sub-issues, pins, the @-issue
 * search, the parent chip or opened issues.
 *
 * Pure functions only; the matcher comes from lib/title-filter.ts.
 */
import type { TitleFilterIssue, TitleFilterMatcher } from "./title-filter";

export interface TitleFilteredList<T> {
  /** The issues to show. */
  issues: T[];
  /** Issues the filter hides (also counted while revealed). */
  hidden: number;
}

/**
 * Drops the issues the matcher hides. `revealed` ("Show" in the hint row)
 * keeps all issues but still counts the hidden ones, so the row can offer
 * "Hide" again. Returns the input array itself when nothing is hidden.
 */
export function applyTitleFilter<T extends TitleFilterIssue>(
  issues: T[],
  matcher: TitleFilterMatcher,
  revealed = false,
): TitleFilteredList<T> {
  if (!matcher.active || issues.length === 0) return { issues, hidden: 0 };
  const visible: T[] = [];
  for (const issue of issues) {
    if (!matcher.matchesTitleFilter(issue)) visible.push(issue);
  }
  const hidden = issues.length - visible.length;
  if (hidden === 0 || revealed) return { issues, hidden };
  return { issues: visible, hidden };
}

export type TitleFilterHint = "none" | "hidden" | "revealed";

/** Hint row above list or board: none at 0, else "n hidden · Show" or
 *  "Title filter off for now · Hide". */
export function titleFilterHint(hidden: number, revealed: boolean): TitleFilterHint {
  if (hidden === 0) return "none";
  return revealed ? "revealed" : "hidden";
}

/** Every issue left after the other filters is hidden by the title filter:
 *  empty state "All issues here are hidden…" with "Show". */
export function allHiddenByTitle(
  beforeTitleFilter: number,
  shown: number,
  hidden: number,
): boolean {
  return beforeTitleFilter > 0 && shown === 0 && hidden > 0;
}

/** Minimal navigator state, as returned by `navigation.getState()`. */
export interface RevealNavState {
  type?: string;
  index?: number;
  routes?: readonly { key: string }[];
}

/**
 * "Show" holds only while the user stays on this screen. Leaving means
 * another bottom tab (tab navigator, this route no longer focused) or going
 * back (unmount, handled by the hook). Opening an issue from the list keeps
 * it: the issue is pushed on a stack above, the screen stays where it was.
 */
export function revealEndsOnBlur(
  state: RevealNavState | undefined,
  routeKey: string,
): boolean {
  if (!state || state.type !== "tab") return false;
  const focused = state.routes?.[state.index ?? 0]?.key;
  return focused !== routeKey;
}
