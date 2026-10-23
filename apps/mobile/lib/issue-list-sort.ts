/**
 * Sort order of the issue lists. Fields and default directions mirror web
 * (`SORT_OPTIONS`, `defaultSortDirection` in
 * packages/core/issues/stores/view-store.ts); custom-property sorts
 * (`property:<id>`) belong to the property-filter package, not here.
 *
 * The server sorts (`GET /api/issues?sort=…&direction=…`, handler
 * ListIssues), so paging and `total` stay right. "Manual" (`position`) is the
 * server default and sends nothing; the server ignores a direction there.
 * The list keeps its status groups, each group in server order
 * (`groupIssuesByStatus` keeps input order). The board only reorders on
 * drop with "Manual" (`boardMoveNeighbours`).
 */
import type { ListIssuesParams } from "@multica/core/types";

export type IssueSortField =
  | "position"
  | "status"
  | "priority"
  | "start_date"
  | "due_date"
  | "created_at"
  | "updated_at"
  | "title";

export type IssueSortDirection = "asc" | "desc";

/** Web order of the sort menu. */
export const ISSUE_SORT_FIELDS: readonly IssueSortField[] = [
  "position",
  "status",
  "priority",
  "start_date",
  "due_date",
  "created_at",
  "updated_at",
  "title",
];

export interface IssueListSort {
  readonly field: IssueSortField;
  readonly direction: IssueSortDirection;
}

export const MANUAL_SORT: IssueListSort = Object.freeze({
  field: "position",
  direction: "asc",
});

export function defaultSortDirection(field: IssueSortField): IssueSortDirection {
  return field === "created_at" || field === "updated_at" ? "desc" : "asc";
}

export function isManualSort(sort: IssueListSort): boolean {
  return sort.field === "position";
}

function isSortField(value: unknown): value is IssueSortField {
  return (ISSUE_SORT_FIELDS as readonly unknown[]).includes(value);
}

/** Picking a field starts with its default direction, like web. */
export function sortForField(field: IssueSortField): IssueListSort {
  return field === "position"
    ? MANUAL_SORT
    : { field, direction: defaultSortDirection(field) };
}

export function withSortDirection(
  sort: IssueListSort,
  direction: IssueSortDirection,
): IssueListSort {
  return isManualSort(sort) ? MANUAL_SORT : { ...sort, direction };
}

/**
 * Tolerant parse of the stored value: an unknown field (an older or newer
 * app, a removed property sort) falls back to "Manual" without an error
 * (spec §2 "Zustände"); an unknown direction falls back to the field's
 * default.
 */
export function parseStoredSort(raw: string | null): IssueListSort {
  if (!raw) return MANUAL_SORT;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return MANUAL_SORT;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return MANUAL_SORT;
  const r = value as Record<string, unknown>;
  if (!isSortField(r.field) || r.field === "position") return MANUAL_SORT;
  const direction =
    r.direction === "asc" || r.direction === "desc"
      ? r.direction
      : defaultSortDirection(r.field);
  return { field: r.field, direction };
}

/** null = nothing to store ("Manual" is the default). */
export function serializeSort(sort: IssueListSort): string | null {
  return isManualSort(sort) ? null : JSON.stringify(sort);
}

/**
 * Server parameters; `data/api.ts` sends them as `sort`/`direction`. Empty
 * for "Manual", so the default query key stays what it was before D4.
 */
export function sortParams(
  sort: IssueListSort,
): Pick<ListIssuesParams, "sort_by" | "sort_direction"> {
  if (isManualSort(sort)) return {};
  return { sort_by: sort.field, sort_direction: sort.direction };
}

/** The server rejected the sort ("invalid sort value", "invalid direction value"). */
export function isSortBadRequest(message: string): boolean {
  return /invalid (sort|direction)/i.test(message);
}

/**
 * Neighbour ids for a drop on the board (spec §2 "Board"). Only "Manual"
 * has a meaningful position, so with any other sort the move sends just the
 * status (no `before_id`/`after_id`) and the server keeps the position.
 */
export function boardMoveNeighbours(
  sort: IssueListSort,
  neighbours: { before_id?: string | null; after_id?: string | null } = {},
): { before_id: string | null; after_id: string | null } {
  if (!isManualSort(sort)) return { before_id: null, after_id: null };
  return {
    before_id: neighbours.before_id ?? null,
    after_id: neighbours.after_id ?? null,
  };
}
