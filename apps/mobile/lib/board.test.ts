// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Issue, IssueStatusEntry } from "@multica/core/types";

vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 0, height: 0 }) }));

import {
  boardColumns,
  boardLayout,
  countLabel,
  hiddenIssueCount,
  isOverdue,
  boardIsEmpty,
  boardNotices,
  isTruncated,
  neighborStatus,
  stepColumn,
} from "./board";

const issue = (id: string, status: string, created: string, category?: string) =>
  ({ id, status, status_category: category, created_at: created }) as unknown as Issue;
const entry = (key: string, category: string, position: number, archived = false) =>
  ({ key, name: key, category, position, archived_at: archived ? "2026-01-01" : null }) as unknown as IssueStatusEntry;

describe("boardColumns", () => {
  it("keeps every built-in board status in order, empty ones included, without Cancelled", () => {
    const cols = boardColumns([issue("a", "in_progress", "2026-10-01T00:00:00Z")]);
    expect(cols.map((c) => c.status)).toEqual(["in_progress"]);

    const entries = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"].map((k, i) =>
      entry(k, { backlog: "unstarted", todo: "unstarted", done: "done", cancelled: "closed" }[k] ?? "started", i),
    );
    const all = boardColumns([issue("a", "in_progress", "2026-10-01T00:00:00Z")], entries);
    expect(all.map((c) => c.status)).toEqual(["backlog", "todo", "in_progress", "in_review", "blocked", "done"]);
    expect(all.find((c) => c.status === "todo")?.issues).toEqual([]);
    expect(boardColumns([], entries, { hiddenStatuses: [] }).at(-1)?.status).toBe("cancelled");
  });

  it("orders custom statuses by category and position, skips archived ones", () => {
    const entries = [
      entry("todo", "unstarted", 1),
      entry("qa", "started", 2),
      entry("in_progress", "started", 1),
      entry("old", "started", 3, true),
      entry("done", "done", 1),
    ];
    expect(boardColumns([], entries).map((c) => c.status)).toEqual(["todo", "in_progress", "qa", "done"]);
  });

  it("keeps an issue on an archived or unknown status visible in its own column", () => {
    const entries = [entry("todo", "unstarted", 1), entry("old", "started", 3, true)];
    const cols = boardColumns([issue("x", "old", "2026-10-01T00:00:00Z", "started")], entries);
    expect(cols.map((c) => c.status)).toEqual(["todo", "old"]);
  });

  it("sorts cards newest first", () => {
    const cols = boardColumns([
      issue("old", "todo", "2026-09-01T00:00:00Z"),
      issue("new", "todo", "2026-10-01T00:00:00Z"),
    ]);
    expect(cols[0]?.issues.map((i) => i.id)).toEqual(["new", "old"]);
  });

  it("keeps the server order with a sort other than Manual", () => {
    const cols = boardColumns(
      [
        issue("old", "todo", "2026-09-01T00:00:00Z"),
        issue("new", "todo", "2026-10-01T00:00:00Z"),
      ],
      [],
      { sort: { field: "title", direction: "asc" } },
    );
    expect(cols[0]?.issues.map((i) => i.id)).toEqual(["old", "new"]);
  });
});

describe("status filter vs hidden columns", () => {
  const entries = [
    entry("todo", "unstarted", 1),
    entry("done", "done", 1),
    entry("cancelled", "closed", 1),
    entry("wontfix", "closed", 2),
  ];
  const issues = [
    issue("a", "cancelled", "2026-10-01T00:00:00Z", "closed"),
    issue("b", "cancelled", "2026-10-02T00:00:00Z", "closed"),
    issue("c", "todo", "2026-10-03T00:00:00Z"),
  ];

  it("filter on Cancelled shows exactly that column with its issues", () => {
    const cols = boardColumns(issues, entries, { statusFilters: ["cancelled"] });
    expect(cols.map((c) => c.status)).toEqual(["cancelled"]);
    expect(cols[0]?.issues.map((i) => i.id)).toEqual(["b", "a"]);
    expect(hiddenIssueCount(issues, { statusFilters: ["cancelled"] })).toBe(0);
  });

  it("without a filter only the key cancelled is hidden, custom closed stays", () => {
    expect(boardColumns(issues, entries).map((c) => c.status)).toEqual(["todo", "done", "wontfix"]);
    expect(hiddenIssueCount(issues)).toBe(2);
  });

  it("a filter on several statuses keeps board order", () => {
    expect(boardColumns(issues, entries, { statusFilters: ["cancelled", "todo"] }).map((c) => c.status)).toEqual([
      "todo",
      "cancelled",
    ]);
  });
});

describe("truncation from the server total", () => {
  it("uses total when the server sent one", () => {
    expect(isTruncated(100, 100)).toBe(false); // exactly 100: complete
    expect(isTruncated(100, 250)).toBe(true);
    expect(isTruncated(40, 41)).toBe(true);
    expect(isTruncated(0, 0)).toBe(false);
  });
  it("a WS-added issue beyond a stale total is not truncation", () => {
    expect(isTruncated(101, 100)).toBe(false);
  });
  it("falls back to the cap without a total (not loaded / old server)", () => {
    expect(isTruncated(100, undefined)).toBe(true);
    expect(isTruncated(100, 0)).toBe(true);
    expect(isTruncated(99, 0)).toBe(false);
  });
});

describe("boardNotices: one notice, not two", () => {
  it("the filter chips carry the hint while a filter is active", () => {
    expect(boardNotices({ truncated: true, filtersActive: true, hiddenCount: 0 })).toEqual({
      truncated: false,
      hidden: false,
    });
  });
  it("without a filter the board says it itself", () => {
    expect(boardNotices({ truncated: true, filtersActive: false, hiddenCount: 0 }).truncated).toBe(true);
  });
  it("hidden column notice is independent", () => {
    expect(boardNotices({ truncated: false, filtersActive: true, hiddenCount: 3 }).hidden).toBe(true);
    expect(boardNotices({ truncated: false, filtersActive: false, hiddenCount: 0 }).hidden).toBe(false);
  });
});

describe("boardIsEmpty (empty state instead of empty columns)", () => {
  it("true when no visible column has a card", () => {
    expect(boardIsEmpty([{ status: "todo", issues: [] }, { status: "done", issues: [] }])).toBe(true);
    expect(boardIsEmpty([{ status: "todo", issues: [{ id: "1" } as Issue] }])).toBe(false);
  });
});

describe("truncated lists (server cap 100)", () => {
  it("marks counts as incomplete from 100 loaded issues", () => {
    expect(isTruncated(99)).toBe(false);
    expect(isTruncated(100)).toBe(true);
    expect(countLabel(7, false)).toBe("7");
    expect(countLabel(7, true)).toBe("7+");
  });
});

describe("boardLayout", () => {
  it("portrait phone: pager with a peek of the next column", () => {
    expect(boardLayout(411, 1)).toEqual({ mode: "pager", columnWidth: 371 });
  });

  it("portrait phone at 150 % font or more: selector row, full width", () => {
    expect(boardLayout(411, 1.5)).toEqual({ mode: "selector", columnWidth: 411 });
    expect(boardLayout(384, 2)).toEqual({ mode: "selector", columnWidth: 384 });
  });

  it("from 600 dp: columns of 280 dp × font scale, clamped to 280–420", () => {
    expect(boardLayout(914, 1)).toEqual({ mode: "columns", columnWidth: 280 });
    expect(boardLayout(914, 1.3)).toEqual({ mode: "columns", columnWidth: 364 });
    expect(boardLayout(914, 2)).toEqual({ mode: "columns", columnWidth: 420 });
    expect(boardLayout(1280, 0.85).columnWidth).toBe(280);
    // 200 % in landscape: at most two columns fit.
    expect(Math.floor(914 / boardLayout(914, 2).columnWidth)).toBe(2);
  });
});

describe("neighborStatus", () => {
  const cols = ["todo", "in_progress", "done"].map((status) => ({ status, issues: [] }));
  it("finds the next and previous column, null at the ends", () => {
    expect(neighborStatus(cols, "todo", 1)).toBe("in_progress");
    expect(neighborStatus(cols, "done", -1)).toBe("in_progress");
    expect(neighborStatus(cols, "todo", -1)).toBeNull();
    expect(neighborStatus(cols, "done", 1)).toBeNull();
    expect(neighborStatus(cols, "cancelled", 1)).toBeNull();
  });
});

describe("stepColumn / isOverdue", () => {
  it("steps without wrapping", () => {
    expect(stepColumn(0, -1, 5)).toBe(0);
    expect(stepColumn(4, 1, 5)).toBe(4);
    expect(stepColumn(2, 1, 5)).toBe(3);
    expect(stepColumn(3, 1, 0)).toBe(0);
  });

  it("a due date before today is overdue, today is not", () => {
    const today = new Date(2026, 9, 16, 12);
    expect(isOverdue("2026-10-15", today)).toBe(true);
    expect(isOverdue("2026-10-16", today)).toBe(false);
    expect(isOverdue(null, today)).toBe(false);
  });
});
