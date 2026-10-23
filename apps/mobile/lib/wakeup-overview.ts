/**
 * Rules for the workspace wakeup overview, the
 * "Wakeups" segment of the Autopilots page
 *Pure functions, so
 * the query parameters, paging and row actions are unit-tested without
 * rendering.
 *
 * - Scope chip, the three filters and the search map 1:1 onto the query
 *   parameters of `GET /api/issue-wakeups` (`overviewQuery`). The search
 *   is trimmed; the screen debounces it (300 ms) before it gets here.
 * - Paging: `limit=50`, the next page starts after all loaded rows
 *   (`nextOverviewOffset`); `total` from the server stops it.
 * - Row actions: the same rules as the issue section (lib/wakeup-actions.ts),
 *   but the overview carries `can_manage`, so without it there are none.
 *   System rows (`rule`) have no actions here: their id is the issue's id
 *   and they are changed through the issue's system rules, not these
 *   endpoints.
 */
import type {
  MobileWorkspaceWakeup,
  MobileWorkspaceWakeupPage,
  WakeupScope,
  WorkspaceWakeupFilters,
} from "@/data/wakeup-schemas";
import { wakeupActions, wakeupSwitchState, type WakeupAction } from "@/lib/wakeup-actions";

export const OVERVIEW_PAGE_SIZE = 50;
export const OVERVIEW_SEARCH_DEBOUNCE_MS = 300;

/** Chip order of the sketch in §1.5. */
export const OVERVIEW_SCOPES: WakeupScope[] = ["active", "paused", "disabled", "ended", "all"];
export const OVERVIEW_KINDS: WorkspaceWakeupFilters["kind"][] = ["all", "event", "at", "recurring"];
export const OVERVIEW_SOURCES: WorkspaceWakeupFilters["source"][] = ["", "member", "agent", "system"];

/** What the user picked; everything except the page offset. */
export interface OverviewFilterState {
  scope: WakeupScope;
  kind: WorkspaceWakeupFilters["kind"];
  source: WorkspaceWakeupFilters["source"];
  agentId: string;
  search: string;
}

export const DEFAULT_OVERVIEW_FILTERS: OverviewFilterState = {
  scope: "active",
  kind: "all",
  source: "",
  agentId: "",
  search: "",
};

/** Query parameters for one page (`offset` comes from the pager). */
export function overviewQuery(
  state: OverviewFilterState,
  offset = 0,
): WorkspaceWakeupFilters {
  return {
    scope: state.scope,
    kind: state.kind,
    source: state.source,
    search: state.search.trim(),
    agent_id: state.agentId,
    offset,
    limit: OVERVIEW_PAGE_SIZE,
  };
}

/** Number of filters set in the sheet (scope and search are not in it). */
export function activeFilterCount(state: OverviewFilterState): number {
  return (state.kind !== "all" ? 1 : 0) + (state.source ? 1 : 0) + (state.agentId ? 1 : 0);
}

/**
 * Empty list: "no rules yet" only when the workspace has none at all
 * (`counts.all` 0 without filters or search), otherwise "no matches" with
 * "Reset filters".
 */
export function overviewEmptyKind(
  state: OverviewFilterState,
  counts: Pick<MobileWorkspaceWakeupPage["counts"], "all"> | undefined,
): "none" | "no_matches" {
  const unfiltered = activeFilterCount(state) === 0 && state.search.trim() === "";
  return unfiltered && (counts?.all ?? 0) === 0 ? "none" : "no_matches";
}

/**
 * Next page offset, or undefined when everything is loaded. Stops on a
 * short page too, so a `total` that is wrong or 0 can't loop the pager.
 */
export function nextOverviewOffset(
  lastPage: Pick<MobileWorkspaceWakeupPage, "items" | "total">,
  pages: Pick<MobileWorkspaceWakeupPage, "items">[],
): number | undefined {
  const loaded = pages.reduce((sum, p) => sum + p.items.length, 0);
  if (lastPage.items.length < OVERVIEW_PAGE_SIZE) return undefined;
  if (loaded >= lastPage.total) return undefined;
  return loaded;
}

/**
 * All loaded rows, without duplicates: a rule that moved between pages
 * while paging (someone switched one off) would otherwise show twice.
 */
export function overviewRows(
  pages: readonly Pick<MobileWorkspaceWakeupPage, "items">[] | undefined,
): MobileWorkspaceWakeup[] {
  const seen = new Set<string>();
  const out: MobileWorkspaceWakeup[] = [];
  for (const page of pages ?? []) {
    for (const row of page.items) {
      const key = overviewRowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

/** System rows reuse the issue id as id; the rule makes them unique. */
export function overviewRowKey(w: Pick<MobileWorkspaceWakeup, "id" | "rule">): string {
  return w.rule ? `system:${w.rule}:${w.id}` : w.id;
}

export function isSystemRow(w: Pick<MobileWorkspaceWakeup, "rule" | "source">): boolean {
  return !!w.rule || w.source === "system";
}

type ActionRow = Parameters<typeof wakeupActions>[0] &
  Pick<MobileWorkspaceWakeup, "can_manage" | "issue_closed" | "rule" | "source">;

/**
 * Row actions: issue-section rules, gated by `can_manage`. "View runs"
 * stays in the issue section; the overview row opens the issue there.
 */
export function overviewRowActions(w: ActionRow, forbidden = false): WakeupAction[] {
  if (isSystemRow(w)) return [];
  return wakeupActions(w, { closed: w.issue_closed, canManage: w.can_manage && !forbidden }).filter(
    (action) => action !== "view_runs",
  );
}

export function overviewSwitchState(w: ActionRow, forbidden = false) {
  if (isSystemRow(w)) return "hidden" as const;
  return wakeupSwitchState(w, { closed: w.issue_closed, canManage: w.can_manage && !forbidden });
}

/** Paused banner: rules the platform paused, or null when there are none. */
export function pausedBannerCount(paused: readonly unknown[] | undefined): number | null {
  const n = paused?.length ?? 0;
  return n > 0 ? n : null;
}

/** Issue detail at the "Wakeups" section (`section=wakeups`, W8). */
export function wakeupIssueHref(wsSlug: string, issueId: string) {
  return {
    pathname: "/[workspace]/issue/[id]" as const,
    params: { workspace: wsSlug, id: issueId, section: "wakeups" },
  };
}
