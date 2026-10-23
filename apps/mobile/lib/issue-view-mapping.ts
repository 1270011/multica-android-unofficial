/**
 * Saved issue views ↔ My Issues state.
 *
 * A view (`GET /api/issue-views`) stores web keys in `query` (filters) and
 * `display` (mode, sort); `scope_type`/`scope_variant` name the list. This
 * module maps both ways:
 * - `appStateFromView`: view → tab, filters, sort, list/board, plus whether
 *   the view carries something the app cannot show (`hiddenFilters`).
 * - `viewDefinitionFromApp`: app state → `scope_type`, `scope_variant`,
 *   `query`, `display`. Keys the app does not know stay as they are, so a
 *   later save (D8b/D8c) never drops web-only settings.
 *
 * Tab ↔ scope (spec §4 table): Assigned = `my/assigned`, Created =
 * `my/created`, All = `workspace` (variant `members`/`agents` when the
 * assignee kind is exactly members resp. agents + squads), All + "My agents
 * and squads" = `my/involved`. Web-only `my/any` ("everything about me",
 * question F1) opens in All with the hint. The due-date filter is app-only
 * and never part of a view.
 */
import type {
  IssueView,
  IssueViewPreference,
} from "@multica/core/api/schemas";
import type { IssueAssigneeType, IssuePriority, IssueStatus } from "@multica/core/types";
import type { MyIssuesScope } from "@/data/queries/issue-keys";
import {
  type ActorKey,
  ASSIGNEE_TYPES,
  CREATOR_TYPES,
  EMPTY_ISSUE_LIST_FILTERS,
  type IssueListFilters,
  parseActorKey,
} from "./issue-list-filters";
import {
  defaultSortDirection,
  ISSUE_SORT_FIELDS,
  type IssueListSort,
  type IssueSortField,
  MANUAL_SORT,
} from "./issue-list-sort";

export type IssueViewMode = "list" | "board";

/** What a view sets in My Issues. */
export interface AppViewState {
  readonly tab: MyIssuesScope;
  readonly filters: IssueListFilters;
  readonly sort: IssueListSort;
  readonly viewMode: IssueViewMode;
}

export interface AppliedView extends AppViewState {
  /**
   * The view filters or shows something the app does not (property or
   * project-status filters, `table`/`gantt` mode, a property sort, the
   * web-only "everything about me" scope). The list may then show more than
   * on web, and the screen says so.
   */
  readonly hiddenFilters: boolean;
}

export interface ViewDefinition {
  scope_type: "my" | "workspace";
  scope_variant: "assigned" | "created" | "involved" | "members" | "agents" | null;
  query: Record<string, unknown>;
  display: Record<string, unknown>;
}

/** `query` keys the app reads and writes; everything else is kept as is. */
export const APP_QUERY_KEYS = [
  "statusFilters",
  "priorityFilters",
  "assigneeFilters",
  "includeNoAssignee",
  "creatorFilters",
  "projectFilters",
  "includeNoProject",
  "labelFilters",
] as const;

/** `display` keys the app reads and writes. */
export const APP_DISPLAY_KEYS = ["viewMode", "sortBy", "sortDirection"] as const;

const PRIORITIES: readonly string[] = ["urgent", "high", "medium", "low", "none"];
const MEMBERS_ONLY: readonly IssueAssigneeType[] = ["member"];
const AGENTS_AND_SQUADS: readonly IssueAssigneeType[] = ["agent", "squad"];

/** A value that actually filters (empty lists/objects and `false` do not). */
function isSet(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "") {
    return false;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(isSet);
  }
  return true;
}

function strings(value: unknown): { values: string[]; dropped: boolean } {
  if (!Array.isArray(value)) return { values: [], dropped: isSet(value) };
  const values = [
    ...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0)),
  ];
  return { values, dropped: values.length !== value.length };
}

/** Web `[{type, id}]` → `type:id`; unknown kinds count as dropped. */
function actors(
  value: unknown,
  types: readonly IssueAssigneeType[],
): { values: ActorKey[]; dropped: boolean } {
  if (!Array.isArray(value)) return { values: [], dropped: isSet(value) };
  const keys = new Set<ActorKey>();
  let dropped = false;
  for (const item of value) {
    const r = item as { type?: unknown; id?: unknown } | null;
    const key =
      r && typeof r.type === "string" && typeof r.id === "string"
        ? `${r.type}:${r.id}`
        : "";
    if (parseActorKey(key, types)) keys.add(key as ActorKey);
    else dropped = true;
  }
  return { values: [...keys], dropped };
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

function scopeOf(view: Pick<IssueView, "scope_type" | "scope_variant">): {
  tab: MyIssuesScope;
  involvesMe: boolean;
  assigneeTypes: readonly IssueAssigneeType[];
  hidden: boolean;
} {
  const variant = view.scope_variant ?? null;
  if (view.scope_type === "my") {
    if (variant === "assigned" || variant === "created") {
      return { tab: variant, involvesMe: false, assigneeTypes: [], hidden: false };
    }
    if (variant === "involved") {
      return { tab: "all", involvesMe: true, assigneeTypes: [], hidden: false };
    }
    // `any` (and anything newer): the app has no "everything about me".
    return { tab: "all", involvesMe: false, assigneeTypes: [], hidden: true };
  }
  if (variant === "members") {
    return { tab: "all", involvesMe: false, assigneeTypes: MEMBERS_ONLY, hidden: false };
  }
  if (variant === "agents") {
    return { tab: "all", involvesMe: false, assigneeTypes: AGENTS_AND_SQUADS, hidden: false };
  }
  return { tab: "all", involvesMe: false, assigneeTypes: [], hidden: variant !== null };
}

function sortOf(display: Record<string, unknown>): { sort: IssueListSort; hidden: boolean } {
  const field = display.sortBy;
  if (field === undefined || field === null || field === "position") {
    return { sort: MANUAL_SORT, hidden: false };
  }
  if (!(ISSUE_SORT_FIELDS as readonly unknown[]).includes(field)) {
    // `property:<id>` and anything newer: the app sorts manually.
    return { sort: MANUAL_SORT, hidden: true };
  }
  const f = field as IssueSortField;
  const dir = display.sortDirection;
  return {
    sort: { field: f, direction: dir === "asc" || dir === "desc" ? dir : defaultSortDirection(f) },
    hidden: false,
  };
}

/** View → My Issues state. Tolerant: odd values degrade, never throw. */
export function appStateFromView(
  view: Pick<IssueView, "scope_type" | "scope_variant" | "query" | "display">,
): AppliedView {
  const query = (view.query ?? {}) as Record<string, unknown>;
  const display = (view.display ?? {}) as Record<string, unknown>;
  const scope = scopeOf(view);

  const status = strings(query.statusFilters);
  const priority = strings(query.priorityFilters);
  const priorities = priority.values.filter((p) => PRIORITIES.includes(p));
  const assignees = actors(query.assigneeFilters, ASSIGNEE_TYPES);
  const creators = actors(query.creatorFilters, CREATOR_TYPES);
  const projects = strings(query.projectFilters);
  const labels = strings(query.labelFilters);
  const includeNoAssignee = query.includeNoAssignee === true;

  const unknownQuery = Object.keys(query).some(
    (k) => !(APP_QUERY_KEYS as readonly string[]).includes(k) && isSet(query[k]),
  );
  const mode = display.viewMode;
  const viewMode: IssueViewMode = mode === "board" ? "board" : "list";
  const unknownMode = mode !== undefined && mode !== null && mode !== "list" && mode !== "board";
  const { sort, hidden: unknownSort } = sortOf(display);

  const filters: IssueListFilters = {
    ...EMPTY_ISSUE_LIST_FILTERS,
    statuses: status.values as IssueStatus[],
    priorities: priorities as IssuePriority[],
    projects: projects.values,
    includeNoProject: query.includeNoProject === true,
    labels: labels.values,
    involvesMe: scope.involvesMe,
    // "Nobody" excludes the other assignee values (setIncludeNoAssignee).
    assignees: includeNoAssignee ? [] : assignees.values,
    includeNoAssignee,
    assigneeTypes: includeNoAssignee ? [] : scope.assigneeTypes,
    creators: creators.values,
  };

  return {
    tab: scope.tab,
    filters,
    sort,
    viewMode,
    hiddenFilters:
      scope.hidden ||
      unknownQuery ||
      unknownMode ||
      unknownSort ||
      status.dropped ||
      priority.dropped ||
      priorities.length !== priority.values.length ||
      assignees.dropped ||
      creators.dropped ||
      projects.dropped ||
      labels.dropped,
  };
}

function actorRefs(keys: readonly ActorKey[]): { type: string; id: string }[] {
  return keys
    .map((k) => parseActorKey(k))
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => ({ type: r.type, id: r.id }));
}

/**
 * My Issues state → view definition. `base` is the view being edited (or
 * nothing for a new one); its unknown `query`/`display` keys are kept and
 * only the app's own keys are replaced. Assignee kinds other than "members"
 * or "agents + squads" have no web key and are not saved.
 */
export function viewDefinitionFromApp(
  state: AppViewState,
  base?: Pick<IssueView, "query" | "display"> | null,
): ViewDefinition {
  const f = state.filters;
  let scope_type: ViewDefinition["scope_type"] = "workspace";
  let scope_variant: ViewDefinition["scope_variant"] = null;
  if (state.tab === "assigned" || state.tab === "created") {
    scope_type = "my";
    scope_variant = state.tab;
  } else if (f.involvesMe) {
    scope_type = "my";
    scope_variant = "involved";
  } else if (sameSet(f.assigneeTypes, MEMBERS_ONLY)) {
    scope_variant = "members";
  } else if (sameSet(f.assigneeTypes, AGENTS_AND_SQUADS)) {
    scope_variant = "agents";
  }

  const query: Record<string, unknown> = {
    ...((base?.query ?? {}) as Record<string, unknown>),
    statusFilters: [...f.statuses],
    priorityFilters: [...f.priorities],
    assigneeFilters: state.tab === "assigned" ? [] : actorRefs(f.assignees),
    includeNoAssignee: state.tab === "assigned" ? false : f.includeNoAssignee,
    creatorFilters: state.tab === "created" ? [] : actorRefs(f.creators),
    projectFilters: [...f.projects],
    includeNoProject: f.includeNoProject,
    labelFilters: [...f.labels],
  };
  const display: Record<string, unknown> = {
    ...((base?.display ?? {}) as Record<string, unknown>),
    viewMode: state.viewMode,
    sortBy: state.sort.field,
    sortDirection: state.sort.direction,
  };
  return { scope_type, scope_variant, query, display };
}

/**
 * Views offered in one tab: Assigned and Created show the `my` views of
 * that variant; All shows the workspace views plus `my` views of variant
 * `involved` (All + "My agents and squads") and `any`/unknown (opened in
 * All with the hint).
 */
export function viewsForTab(
  tab: MyIssuesScope,
  myViews: readonly IssueView[],
  workspaceViews: readonly IssueView[],
): IssueView[] {
  if (tab === "assigned" || tab === "created") {
    return myViews.filter((v) => v.scope_variant === tab);
  }
  return [
    ...workspaceViews,
    ...myViews.filter((v) => v.scope_variant !== "assigned" && v.scope_variant !== "created"),
  ];
}

/**
 * Hidden views go, the rest follow `prefs.order` (ids `view:<uuid>`), then
 * the server order. Same ids as web `GET /api/issue-view-preferences`.
 */
export function orderViews(
  views: readonly IssueView[],
  ...prefs: (IssueViewPreference | null | undefined)[]
): IssueView[] {
  const hidden = new Set(prefs.flatMap((p) => p?.prefs.hidden ?? []));
  const order = prefs.flatMap((p) => p?.prefs.order ?? []);
  const rank = (v: IssueView) => {
    const i = order.indexOf(`view:${v.id}`);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return views
    .filter((v) => !hidden.has(`view:${v.id}`))
    .map((v, i) => ({ v, i }))
    .sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
    .map(({ v }) => v);
}

/**
 * A fresh read of the view before applying it: `GET /api/issue-views/{id}`
 * answers 404 when it was deleted or is no longer shared, and an unreadable
 * body comes back as null (data/api.ts). Both mean "gone".
 */
export function viewFetchOutcome(
  result: { view: IssueView | null } | { error: unknown },
): "apply" | "gone" | "error" {
  if ("view" in result) return result.view ? "apply" : "gone";
  const status = (result.error as { status?: unknown } | null)?.status;
  return status === 404 ? "gone" : "error";
}


/** What `activeViewGone` needs from one view-list query. */
export interface ViewListRead {
  data: readonly IssueView[] | undefined;
  isSuccess: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
}

/**
 * The applied view is missing from every view list (my + workspace) read
 * after `since` (when it became active, e.g. restored after a restart):
 * it was deleted or unshared elsewhere. Undecided while a list
 * loads, failed, is offline or still holds an older read.
 */
export function activeViewGone(
  activeId: string,
  lists: readonly ViewListRead[],
  since: number,
): boolean {
  if (lists.length === 0) return false;
  for (const q of lists) {
    if (!q.isSuccess || q.isFetching || !q.data || q.dataUpdatedAt < since) return false;
  }
  return !lists.some((q) => q.data!.some((v) => v.id === activeId));
}
