/**
 * "My Issues" list, server-filtered by tab:
 *   - assigned: issues where assignee_id = me
 *   - created:  issues where creator_id  = me
 *   - all:      every issue of the workspace (replaces the page "All issues"
 *               behind "More"; differs from web, where "All" means
 *               "everything that concerns me")
 *
 * The former `agents` tab is the filter "My agents and squads"
 * (`involvesMe` → `involves_user_id`, MUL-2397: owned agents and squads I'm
 * involved in). It applies to Created and All; Assigned is fixed to me.
 *
 * Cache key shape is `issueKeys.myList(wsId, scope, filter)` — same prefix
 * as web's `packages/core/issues/queries.ts`, so invalidating
 * `issueKeys.myAll(wsId)` (live refresh) reaches every tab.
 */
import { queryOptions } from "@tanstack/react-query";
import {
  actorRefs,
  ASSIGNEE_TYPES,
  EMPTY_ISSUE_LIST_FILTERS,
  type IssueListFilters,
} from "@/lib/issue-list-filters";
import { type IssueListSort, MANUAL_SORT, sortParams } from "@/lib/issue-list-sort";
import { listIssuePages } from "./list-pages";
import { rememberListTotal } from "./list-total";
import {
  issueKeys,
  type MyIssuesFilter,
  type MyIssuesScope,
} from "./issue-keys";

/**
 * Whether the filter sheet offers "My agents and squads": only for the My
 * Issues list (not the project page), and not in Assigned, which is fixed to
 * me.
 */
export function showsInvolvesMeFilter(
  list: string,
  scope: MyIssuesScope,
): boolean {
  return list === "my" && scope !== "assigned";
}

/** Assignee section of the sheet (D3b): hidden in Assigned (fixed: me). */
export const showsAssigneeFilter = showsInvolvesMeFilter;

/** Creator section of the sheet (D3b): hidden in Created (fixed: me). */
export function showsCreatorFilter(list: string, scope: MyIssuesScope): boolean {
  return list === "my" && scope !== "created";
}

/**
 * Lock per tab: Assigned is fixed to
 * me, so every assignee filter is dropped there; Created is fixed to me as
 * creator, so creator filters are dropped. Stored values stay untouched and
 * apply again in the other tabs. Returns the same object when nothing is
 * locked away (stable for memo dependencies).
 */
export function lockFiltersForScope(
  filters: IssueListFilters,
  scope: MyIssuesScope,
): IssueListFilters {
  if (scope === "assigned") {
    if (
      !filters.involvesMe &&
      !filters.includeNoAssignee &&
      filters.assignees.length === 0 &&
      filters.assigneeTypes.length === 0
    ) {
      return filters;
    }
    return {
      ...filters,
      involvesMe: false,
      includeNoAssignee: false,
      assignees: [],
      assigneeTypes: [],
    };
  }
  if (scope === "created" && filters.creators.length > 0) {
    return { ...filters, creators: [] };
  }
  return filters;
}

/**
 * Server parameters of one tab with its filters. The tab
 * parameter comes first, the filters the tab does not lock follow:
 * `involves_user_id`, `assignee_filters`, `include_no_assignee`,
 * `assignee_types`, `creator_filters`, then the sort. "Nobody" sends only
 * `include_no_assignee`, never together with other assignee values (the
 * server would OR them). Actor lists are sorted so the same selection
 * always gives the same query key.
 */
export function toListParams(
  scope: MyIssuesScope,
  userId: string,
  filters: IssueListFilters,
  sort: IssueListSort = MANUAL_SORT,
): MyIssuesFilter {
  const f = lockFiltersForScope(filters, scope);
  const params: MyIssuesFilter =
    scope === "assigned"
      ? { assignee_id: userId }
      : scope === "created"
        ? { creator_id: userId }
        : {};
  if (f.includeNoAssignee) {
    params.include_no_assignee = true;
  } else {
    if (f.involvesMe) params.involves_user_id = userId;
    const assignees = actorRefs(f.assignees);
    if (assignees.length > 0) params.assignee_filters = assignees;
    const types = ASSIGNEE_TYPES.filter((t) => f.assigneeTypes.includes(t));
    if (types.length > 0) params.assignee_types = types;
  }
  const creators = actorRefs(f.creators);
  if (creators.length > 0) params.creator_filters = creators;
  return { ...params, ...sortParams(sort) };
}

/** Tab parameters plus "My agents and squads" only (D1 callers). */
export function buildMyIssuesFilter(
  scope: MyIssuesScope,
  userId: string,
  options: { involvesMe?: boolean } = {},
): MyIssuesFilter {
  return toListParams(scope, userId, {
    ...EMPTY_ISSUE_LIST_FILTERS,
    involvesMe: options.involvesMe === true,
  });
}

export const myIssueListOptions = (
  wsId: string | null,
  scope: MyIssuesScope,
  filter: MyIssuesFilter,
) =>
  queryOptions({
    queryKey: issueKeys.myList(wsId, scope, filter),
    queryFn: async ({ signal, client, queryKey }) => {
      const res = await listIssuePages(filter, { signal });
      rememberListTotal(client, queryKey, res.total);
      return res.issues;
    },
    enabled: !!wsId,
  });
