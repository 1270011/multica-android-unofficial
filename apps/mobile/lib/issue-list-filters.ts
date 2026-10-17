/**
 * Issue-list filters for All, My and Project.
 *
 * Status, priority, project and label mirror `filterIssues()` in
 * packages/views/issues/utils/filter.ts: OR within a dimension, AND between
 * dimensions, empty = no filter; "No project" is its own option
 * (`includeNoProject`), labels match when the issue carries any selected
 * label. The due-date filter is mobile-only (docs/UX.md §3, Paket F):
 * overdue, due this week, no due date.
 *
 * Filtering is client-side on the loaded list, so the board (which receives
 * the filtered list) follows automatically. Only the status filter changes
 * the board's columns (`boardColumns` statusFilters), as before.
 */
import type { Issue, IssuePriority, IssueStatus } from "@multica/core/types";
import { isTruncated } from "./list-cap";

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
});

export function issueListFilterCount(filters: IssueListFilters): number {
  return (
    filters.statuses.length +
    filters.priorities.length +
    filters.projects.length +
    (filters.includeNoProject ? 1 : 0) +
    filters.labels.length +
    filters.due.length
  );
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
  if (isEmptyIssueListFilters(filters)) return issues;
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

/** Tolerant parse of the stored value; unknown enum values are dropped. */
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
  const filters: IssueListFilters = {
    statuses: stringArray(r.statuses) as IssueStatus[],
    priorities: stringArray(r.priorities).filter((p) => PRIORITIES.has(p)) as IssuePriority[],
    projects: stringArray(r.projects),
    includeNoProject: r.includeNoProject === true,
    labels: stringArray(r.labels),
    due: stringArray(r.due).filter((d) => DUE.has(d)) as DueFilter[],
  };
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
  });
}

/**
 * `GET /api/issues` returns at most 100 issues per request; the lists load
 * up to LIST_ISSUES_MAX_PAGES pages.
 * Client filters then only see those, so an empty result may hide matches
 * (review #22). Passing status/priority/project to the server comes with
 * column-wise loading in a later wave.
 */
export function filtersMayMissIssues(
  loadedCount: number,
  filters: IssueListFilters,
  total?: number,
): boolean {
  return isTruncated(loadedCount, total) && !isEmptyIssueListFilters(filters);
}
