import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERVIEW_FILTERS,
  OVERVIEW_PAGE_SIZE,
  activeFilterCount,
  nextOverviewOffset,
  overviewEmptyKind,
  overviewQuery,
  overviewRowActions,
  overviewRowKey,
  overviewRows,
  overviewSwitchState,
  pausedBannerCount,
  wakeupIssueHref,
} from "./wakeup-overview";

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: "w-1",
    issue_id: "i-1",
    kind: "event",
    enabled: true,
    next_fire_at: null,
    disabled_at: null,
    paused_reason: null,
    can_manage: true,
    issue_closed: false,
    rule: null,
    source: "member",
    ...over,
  }) as Parameters<typeof overviewRowActions>[0];

const page = (n: number, total: number, start = 0) => ({
  items: Array.from({ length: n }, (_, i) => ({ id: `w-${start + i}` })) as never[],
  total,
});

describe("overviewQuery", () => {
  it("defaults to the active scope, page 1 of 50", () => {
    expect(overviewQuery(DEFAULT_OVERVIEW_FILTERS)).toEqual({
      scope: "active",
      kind: "all",
      source: "",
      search: "",
      agent_id: "",
      offset: 0,
      limit: 50,
    });
  });

  it("maps scope, filters, trimmed search and offset onto the parameters", () => {
    const q = overviewQuery(
      { scope: "paused", kind: "recurring", source: "agent", agentId: "a-7", search: "  MUL-126 " },
      100,
    );
    expect(q).toEqual({
      scope: "paused",
      kind: "recurring",
      source: "agent",
      search: "MUL-126",
      agent_id: "a-7",
      offset: 100,
      limit: OVERVIEW_PAGE_SIZE,
    });
  });

  it("changes when only the scope changes", () => {
    const a = overviewQuery(DEFAULT_OVERVIEW_FILTERS);
    const b = overviewQuery({ ...DEFAULT_OVERVIEW_FILTERS, scope: "ended" });
    expect(b.scope).toBe("ended");
    expect({ ...b, scope: a.scope }).toEqual(a);
  });
});

describe("activeFilterCount / overviewEmptyKind", () => {
  it("counts only the sheet filters", () => {
    expect(activeFilterCount(DEFAULT_OVERVIEW_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_OVERVIEW_FILTERS, scope: "all", search: "x" })).toBe(0);
    expect(
      activeFilterCount({ ...DEFAULT_OVERVIEW_FILTERS, kind: "at", source: "system", agentId: "a" }),
    ).toBe(3);
  });

  it("says 'none' only for a workspace without rules and no filters", () => {
    expect(overviewEmptyKind(DEFAULT_OVERVIEW_FILTERS, { all: 0 })).toBe("none");
    expect(overviewEmptyKind(DEFAULT_OVERVIEW_FILTERS, undefined)).toBe("none");
    expect(overviewEmptyKind(DEFAULT_OVERVIEW_FILTERS, { all: 3 })).toBe("no_matches");
    expect(overviewEmptyKind({ ...DEFAULT_OVERVIEW_FILTERS, search: "zz" }, { all: 0 })).toBe("no_matches");
    expect(overviewEmptyKind({ ...DEFAULT_OVERVIEW_FILTERS, kind: "event" }, { all: 0 })).toBe("no_matches");
  });
});

describe("nextOverviewOffset", () => {
  it("loads the next page after all loaded rows", () => {
    const p1 = page(50, 120);
    expect(nextOverviewOffset(p1, [p1])).toBe(50);
    const p2 = page(50, 120, 50);
    expect(nextOverviewOffset(p2, [p1, p2])).toBe(100);
  });

  it("stops at total and on a short page", () => {
    const p1 = page(50, 120);
    const p2 = page(50, 120, 50);
    const p3 = page(20, 120, 100);
    expect(nextOverviewOffset(p3, [p1, p2, p3])).toBeUndefined();
    const full = page(50, 50);
    expect(nextOverviewOffset(full, [full])).toBeUndefined();
    // A wrong total of 0 must not loop.
    const short = page(10, 0);
    expect(nextOverviewOffset(short, [short])).toBeUndefined();
  });
});

describe("overviewRows", () => {
  it("joins pages and drops a rule that moved onto the next page", () => {
    const rows = overviewRows([
      { items: [{ id: "a" }, { id: "b" }] as never[] },
      { items: [{ id: "b" }, { id: "c" }] as never[] },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(overviewRows(undefined)).toEqual([]);
  });

  it("keys system rows by rule, since their id is the issue id", () => {
    expect(overviewRowKey({ id: "i-1", rule: "child_done" })).toBe("system:child_done:i-1");
    expect(overviewRowKey({ id: "w-1", rule: null })).toBe("w-1");
    const rows = overviewRows([
      { items: [{ id: "i-1", rule: "child_done" }, { id: "i-1", rule: null }] as never[] },
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe("overviewRowActions", () => {
  it("offers the issue-section actions with can_manage", () => {
    expect(overviewRowActions(row())).toEqual(["trigger", "edit_instruction", "disable", "delete"]);
    expect(overviewSwitchState(row())).toBe("on");
  });

  it("offers nothing without can_manage or after a 403", () => {
    expect(overviewRowActions(row({ can_manage: false }))).toEqual([]);
    expect(overviewSwitchState(row({ can_manage: false }))).toBe("hidden");
    expect(overviewRowActions(row(), true)).toEqual([]);
    expect(overviewSwitchState(row(), true)).toBe("hidden");
  });

  it("uses issue_closed for the closed-issue rules", () => {
    expect(overviewRowActions(row({ enabled: false, issue_closed: true }))).toEqual([
      "edit_instruction",
      "delete",
    ]);
    expect(overviewSwitchState(row({ enabled: false, issue_closed: true }))).toBe("off_locked");
  });

  it("leaves 'view runs' to the issue section", () => {
    expect(overviewRowActions(row())).not.toContain("view_runs");
    expect(overviewRowActions(row({ can_manage: false }))).not.toContain("view_runs");
  });

  it("has no actions on system rows", () => {
    expect(overviewRowActions(row({ rule: "child_done", source: "system" }))).toEqual([]);
    expect(overviewRowActions(row({ source: "system" }))).toEqual([]);
    expect(overviewSwitchState(row({ rule: "child_done" }))).toBe("hidden");
  });
});

describe("pausedBannerCount / wakeupIssueHref", () => {
  it("shows the banner only with paused rules", () => {
    expect(pausedBannerCount(undefined)).toBeNull();
    expect(pausedBannerCount([])).toBeNull();
    expect(pausedBannerCount([{}, {}])).toBe(2);
  });

  it("opens the issue at its Wakeups section", () => {
    expect(wakeupIssueHref("rb", "i-9")).toEqual({
      pathname: "/[workspace]/issue/[id]",
      params: { workspace: "rb", id: "i-9", section: "wakeups" },
    });
  });
});
