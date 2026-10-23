/**
 * Issue-list filters for All, My and Project.
 *
 * Status, priority, project and label mirror `filterIssues()` in
 * packages/views/issues/utils/filter.ts: OR within a dimension, AND between
 * dimensions, empty = no filter; "No project" is its own option
 * (`includeNoProject`), labels match when the issue carries any selected
 * label. The due-date filter is mobile-only (Paket F):
 * overdue, due this week, no due date.
 *
 * Filtering is client-side on the loaded list, so the board (which receives
 * the filtered list) follows automatically. Only the status filter changes
 * the board's columns (`boardColumns` statusFilters), as before.
 */
import type {
  Issue,
  IssueActorRef,
  IssueAssigneeType,
  IssuePriority,
  IssueStatus,
} from "@multica/core/types";
import { isTruncated } from "./list-cap";

/**
 * An actor as `type:id` (`member:<id>`, `agent:<id>`, `squad:<id>`), the same
 * form as `actorFilterKey` on web (packages/core/issue-views/baseline.ts).
 */
export type ActorKey = `${IssueAssigneeType}:${string}`;
export const ASSIGNEE_TYPES: readonly IssueAssigneeType[] = ["member", "agent", "squad"];
/** Creators are members or agents; squads never create issues. */
export const CREATOR_TYPES: readonly IssueAssigneeType[] = ["member", "agent"];

export type DueFilter = "overdue" | "this_week" | "none";
export const DUE_FILTERS: readonly DueFilter[] = ["overdue", "this_week", "none"];

export interface IssueListFilters {
  readonly statuses: readonly IssueStatus[];
  readonly priorities: readonly IssuePriority[];
  /** Project ids; see `includeNoProject` for issues without a project. */
  readonly projects: readonly string[];
  readonly includeNoProject: boolean;
  /** Label ids. */
  readonly labels: readonly string[];
  readonly due: readonly DueFilter[];
  /**
   * "My agents and squads" (`involves_user_id`). Applied by the
   * server in My Issues (tabs Created and All), not by filterIssueList.
   */
  readonly involvesMe: boolean;
  /**
   * Assignee and creator filters. Like `involvesMe` they go to the server (`toListParams` in
   * data/queries/my-issues.ts), so `total` and paging stay right:
   * - `assignees` → `assignee_filters` (OR within)
   * - `includeNoAssignee` → `include_no_assignee` ("Nobody"); excludes
   *   `assignees`, `assigneeTypes` and `involvesMe` (`setIncludeNoAssignee`)
   * - `assigneeTypes` → `assignee_types` (AND with `assignees`)
   * - `creators` → `creator_filters`
   */
  readonly assignees: readonly ActorKey[];
  readonly includeNoAssignee: boolean;
  readonly assigneeTypes: readonly IssueAssigneeType[];
  readonly creators: readonly ActorKey[];
}

export type IssueListFilterDimension =
  | "statuses"
  | "priorities"
  | "projects"
  | "labels"
  | "due";

export const EMPTY_ISSUE_LIST_FILTERS: IssueListFilters = Object.freeze({
  statuses: Object.freeze([]),
  priorities: Object.freeze([]),
  projects: Object.freeze([]),
  includeNoProject: false,
  labels: Object.freeze([]),
  due: Object.freeze([]),
  involvesMe: false,
  assignees: Object.freeze([]),
  includeNoAssignee: false,
  assigneeTypes: Object.freeze([]),
  creators: Object.freeze([]),
});

export function issueListFilterCount(filters: IssueListFilters): number {
  return (
    filters.statuses.length +
    filters.priorities.length +
    filters.projects.length +
    (filters.includeNoProject ? 1 : 0) +
    filters.labels.length +
    filters.due.length +
    (filters.involvesMe ? 1 : 0) +
    filters.assignees.length +
    (filters.includeNoAssignee ? 1 : 0) +
    filters.assigneeTypes.length +
    filters.creators.length
  );
}

/** The filters the server applies; `filterIssueList` leaves them alone. */
export function withoutServerFilters(filters: IssueListFilters): IssueListFilters {
  return {
    ...filters,
    involvesMe: false,
    assignees: [],
    includeNoAssignee: false,
    assigneeTypes: [],
    creators: [],
  };
}

export function isEmptyIssueListFilters(filters: IssueListFilters): boolean {
  return issueListFilterCount(filters) === 0;
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Last day (Sunday) of the week containing `today`; weeks start Monday. */
function endOfWeek(today: Date): string {
  const end = new Date(today);
  const daysToSunday = (7 - today.getDay()) % 7;
  end.setDate(today.getDate() + daysToSunday);
  return localDay(end);
}

/**
 * Which due bucket an issue falls into, compared by calendar day (the server
 * stores `due_date` as a date or a midnight timestamp):
 * - `overdue`: before today
 * - `this_week`: today up to and including Sunday of this week
 * - `later`: after this week (matches no due filter)
 * - `none`: no due date
 */
export function dueBucket(
  dueDate: string | null | undefined,
  today = new Date(),
): DueFilter | "later" {
  if (!dueDate) return "none";
  const day = dueDate.slice(0, 10);
  const todayDay = localDay(today);
  if (day < todayDay) return "overdue";
  if (day <= endOfWeek(today)) return "this_week";
  return "later";
}

export function filterIssueList(
  issues: Issue[],
  filters: IssueListFilters,
  today = new Date(),
): Issue[] {
  if (isEmptyIssueListFilters(withoutServerFilters(filters))) return issues;
  const hasProjectFilter =
    filters.projects.length > 0 || filters.includeNoProject;
  return issues.filter((issue) => {
    if (filters.statuses.length > 0 && !filters.statuses.includes(issue.status)) {
      return false;
    }
    if (
      filters.priorities.length > 0 &&
      !filters.priorities.includes(issue.priority)
    ) {
      return false;
    }
    if (hasProjectFilter) {
      if (!issue.project_id) {
        if (!filters.includeNoProject) return false;
      } else if (!filters.projects.includes(issue.project_id)) {
        return false;
      }
    }
    if (filters.labels.length > 0) {
      const labels = issue.labels ?? [];
      if (!labels.some((l) => filters.labels.includes(l.id))) return false;
    }
    if (filters.due.length > 0) {
      const bucket = dueBucket(issue.due_date, today);
      if (bucket === "later" || !filters.due.includes(bucket)) return false;
    }
    return true;
  });
}

export function toggleIssueListFilter(
  filters: IssueListFilters,
  dimension: IssueListFilterDimension,
  value: string,
): IssueListFilters {
  const current = filters[dimension] as readonly string[];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return { ...filters, [dimension]: next };
}

/** The project page is already scoped to one project. */
export function withoutProjectFilter(filters: IssueListFilters): IssueListFilters {
  if (filters.projects.length === 0 && !filters.includeNoProject) return filters;
  return { ...filters, projects: [], includeNoProject: false };
}

function toggleValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

/**
 * "Nobody" excludes every other assignee value: switching it on clears
 * people, assignee kinds and "My agents and squads"; picking one of those
 * switches "Nobody" off.
 */
export function setIncludeNoAssignee(
  filters: IssueListFilters,
  value: boolean,
): IssueListFilters {
  if (!value) return { ...filters, includeNoAssignee: false };
  return {
    ...filters,
    includeNoAssignee: true,
    assignees: [],
    assigneeTypes: [],
    involvesMe: false,
  };
}

export function setInvolvesMe(
  filters: IssueListFilters,
  value: boolean,
): IssueListFilters {
  return {
    ...filters,
    involvesMe: value,
    includeNoAssignee: value ? false : filters.includeNoAssignee,
  };
}

export function toggleAssignee(
  filters: IssueListFilters,
  actor: ActorKey,
): IssueListFilters {
  return {
    ...filters,
    assignees: toggleValue(filters.assignees, actor),
    includeNoAssignee: false,
  };
}

export function toggleAssigneeType(
  filters: IssueListFilters,
  type: IssueAssigneeType,
): IssueListFilters {
  return {
    ...filters,
    assigneeTypes: toggleValue(filters.assigneeTypes, type),
    includeNoAssignee: false,
  };
}

export function toggleCreator(
  filters: IssueListFilters,
  actor: ActorKey,
): IssueListFilters {
  return { ...filters, creators: toggleValue(filters.creators, actor) };
}

export function actorKey(type: IssueAssigneeType, id: string): ActorKey {
  return `${type}:${id}`;
}

/** `type:id` → actor ref; null for unknown kinds or an empty id. */
export function parseActorKey(
  key: string,
  types: readonly IssueAssigneeType[] = ASSIGNEE_TYPES,
): IssueActorRef | null {
  const i = key.indexOf(":");
  if (i <= 0) return null;
  const type = key.slice(0, i) as IssueAssigneeType;
  const id = key.slice(i + 1);
  if (!types.includes(type) || id.length === 0) return null;
  return { type, id };
}

/** Actor refs for the server, in a stable order (one cache key per set). */
export function actorRefs(keys: readonly ActorKey[]): IssueActorRef[] {
  return [...keys]
    .sort()
    .map((k) => parseActorKey(k))
    .filter((r): r is IssueActorRef => r !== null);
}

const PRIORITIES = new Set<string>(["urgent", "high", "medium", "low", "none"]);
const DUE = new Set<string>(DUE_FILTERS);

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ];
}

function actorKeys(value: unknown, types: readonly IssueAssigneeType[]): ActorKey[] {
  return stringArray(value).filter(
    (k): k is ActorKey => parseActorKey(k, types) !== null,
  );
}

/**
 * Tolerant parse of the stored value; unknown enum values are dropped.
 * Values stored before a field existed (e.g. before D3a) load with that
 * field empty; an inconsistent "Nobody" + assignee mix keeps "Nobody".
 */
export function parseStoredIssueListFilters(raw: string | null): IssueListFilters {
  if (!raw) return EMPTY_ISSUE_LIST_FILTERS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_ISSUE_LIST_FILTERS;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return EMPTY_ISSUE_LIST_FILTERS;
  }
  const r = value as Record<string, unknown>;
  let filters: IssueListFilters = {
    statuses: stringArray(r.statuses) as IssueStatus[],
    priorities: stringArray(r.priorities).filter((p) => PRIORITIES.has(p)) as IssuePriority[],
    projects: stringArray(r.projects),
    includeNoProject: r.includeNoProject === true,
    labels: stringArray(r.labels),
    due: stringArray(r.due).filter((d) => DUE.has(d)) as DueFilter[],
    involvesMe: r.involvesMe === true,
    assignees: actorKeys(r.assignees, ASSIGNEE_TYPES),
    includeNoAssignee: false,
    assigneeTypes: stringArray(r.assigneeTypes).filter((t) =>
      (ASSIGNEE_TYPES as readonly string[]).includes(t),
    ) as IssueAssigneeType[],
    creators: actorKeys(r.creators, CREATOR_TYPES),
  };
  if (r.includeNoAssignee === true) filters = setIncludeNoAssignee(filters, true);
  return isEmptyIssueListFilters(filters) ? EMPTY_ISSUE_LIST_FILTERS : filters;
}

export function serializeIssueListFilters(filters: IssueListFilters): string {
  return JSON.stringify({
    statuses: filters.statuses,
    priorities: filters.priorities,
    projects: filters.projects,
    includeNoProject: filters.includeNoProject,
    labels: filters.labels,
    due: filters.due,
    involvesMe: filters.involvesMe,
    assignees: filters.assignees,
    includeNoAssignee: filters.includeNoAssignee,
    assigneeTypes: filters.assigneeTypes,
    creators: filters.creators,
  });
}

/**
 * `GET /api/issues` returns at most 100 issues per request; the lists load
 * up to LIST_ISSUES_MAX_PAGES pages (data/queries/list-pages.ts).
 * Client filters then only see those, so an empty result may hide matches
 *Passing status/priority/project to the server comes with
 * column-wise loading in a later wave.
 */
export function filtersMayMissIssues(
  loadedCount: number,
  filters: IssueListFilters,
  total?: number,
): boolean {
  // Assignee/creator filters go to the server, so the loaded list already
  // respects them.
  return (
    isTruncated(loadedCount, total) &&
    !isEmptyIssueListFilters(withoutServerFilters(filters))
  );
}
