// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Issue, IssueStatusEntry } from "@multica/core/types";

vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 0, height: 0 }) }));

import { boardColumns, hiddenIssueCount } from "./board";
import { EMPTY_ISSUE_LIST_FILTERS, filterIssueList, type IssueListFilters } from "./issue-list-filters";

/**
 * F2 filters × C1 board: the list filters only thin out the
 * cards; the status filter alone decides the columns and lifts hiding
 * Cancelled — the screens pass `filterIssueList(...)` as issues and
 * `filters.statuses` as statusFilters.
 */
const entries = ["backlog", "todo", "in_progress", "done", "cancelled"].map(
  (key, position) =>
    ({
      key,
      name: key,
      category: { backlog: "unstarted", todo: "unstarted", done: "done", cancelled: "closed" }[key] ?? "started",
      position,
      archived_at: null,
    }) as unknown as IssueStatusEntry,
);
const issue = (id: string, status: string, over: Partial<Issue> = {}) =>
  ({
    id,
    status,
    priority: "none",
    project_id: null,
    labels: [],
    due_date: null,
    created_at: `2026-10-0${id.length}T00:00:00Z`,
    ...over,
  }) as unknown as Issue;
const issues = [
  issue("a", "todo", { project_id: "p1" }),
  issue("bb", "todo", { project_id: "p2" }),
  issue("ccc", "in_progress", { project_id: "p1" }),
  issue("dddd", "cancelled", { project_id: "p1" }),
];
const filters = (over: Partial<IssueListFilters>): IssueListFilters => ({ ...EMPTY_ISSUE_LIST_FILTERS, ...over });
const board = (f: IssueListFilters) => {
  const shown = filterIssueList(issues, f);
  return { shown, columns: boardColumns(shown, entries, { statusFilters: f.statuses }) };
};

describe("list filters on the board", () => {
  it("a project filter thins the cards but keeps every column", () => {
    const { columns } = board(filters({ projects: ["p1"] }));
    expect(columns.map((c) => c.status)).toEqual(["backlog", "todo", "in_progress", "done"]);
    expect(columns.find((c) => c.status === "todo")?.issues.map((i) => i.id)).toEqual(["a"]);
  });

  it("a status filter decides the columns and shows Cancelled", () => {
    const { columns } = board(filters({ statuses: ["cancelled"], projects: ["p1"] }));
    expect(columns.map((c) => c.status)).toEqual(["cancelled"]);
    expect(columns[0]?.issues.map((i) => i.id)).toEqual(["dddd"]);
  });

  it("without a status filter Cancelled stays hidden and is counted for the hint", () => {
    const { shown, columns } = board(filters({ projects: ["p1"] }));
    expect(columns.some((c) => c.status === "cancelled")).toBe(false);
    expect(hiddenIssueCount(shown, { statusFilters: [] })).toBe(1);
  });

  it("no match leaves empty columns (the screens show their empty state)", () => {
    const { shown } = board(filters({ projects: ["nope"] }));
    expect(shown).toEqual([]);
  });
});
