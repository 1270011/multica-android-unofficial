import { describe, expect, it } from "vitest";
import type { Issue, Label } from "@multica/core/types";
import de from "../locales/de/issues.json";
import en from "../locales/en/issues.json";
import zh from "../locales/zh-Hans/issues.json";
import {
  dueBucket,
  EMPTY_ISSUE_LIST_FILTERS,
  filtersMayMissIssues,
  filterIssueList,
  issueListFilterCount,
  type IssueListFilters,
  parseStoredIssueListFilters,
  serializeIssueListFilters,
  toggleIssueListFilter,
  withoutProjectFilter,
} from "./issue-list-filters";

// Thursday, 2026-10-15, local time. The week runs Mon 12th – Sun 18th.
const TODAY = new Date(2026, 9, 15, 10, 0, 0);

const label = (id: string): Label => ({ id, name: id, color: "#3b82f6" }) as Label;

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: "i",
    status: "todo",
    priority: "medium",
    project_id: null,
    due_date: null,
    labels: [],
    ...overrides,
  } as Issue;
}

const ISSUES = [
  issue({ id: "a", status: "todo", priority: "high", project_id: "p1", labels: [label("bug")], due_date: "2026-10-10" }),
  issue({ id: "b", status: "in_progress", priority: "low", project_id: "p2", labels: [label("ui"), label("bug")], due_date: "2026-10-18T00:00:00Z" }),
  issue({ id: "c", status: "done", priority: "none", project_id: null, labels: [], due_date: null }),
  issue({ id: "d", status: "todo", priority: "urgent", project_id: "p1", labels: undefined, due_date: "2026-10-19" }),
];

const f = (partial: Partial<IssueListFilters>): IssueListFilters => ({
  ...EMPTY_ISSUE_LIST_FILTERS,
  ...partial,
});
const ids = (rows: Issue[]) => rows.map((r) => r.id);

describe("dueBucket", () => {
  it("sorts by calendar day: overdue, this week up to Sunday, later, none", () => {
    expect(dueBucket("2026-10-14", TODAY)).toBe("overdue");
    expect(dueBucket("2026-10-15", TODAY)).toBe("this_week");
    expect(dueBucket("2026-10-18T00:00:00Z", TODAY)).toBe("this_week");
    expect(dueBucket("2026-10-19", TODAY)).toBe("later");
    expect(dueBucket(null, TODAY)).toBe("none");
  });

  it("treats Sunday as the last day of its week", () => {
    const sunday = new Date(2026, 9, 18, 9, 0, 0);
    expect(dueBucket("2026-10-18", sunday)).toBe("this_week");
    expect(dueBucket("2026-10-19", sunday)).toBe("later");
  });
});

describe("filterIssueList", () => {
  it("returns the same list without filters", () => {
    expect(filterIssueList(ISSUES, EMPTY_ISSUE_LIST_FILTERS, TODAY)).toBe(ISSUES);
  });

  it("keeps the status/priority behaviour of the old filter", () => {
    expect(ids(filterIssueList(ISSUES, f({ statuses: ["todo"] }), TODAY))).toEqual(["a", "d"]);
    expect(ids(filterIssueList(ISSUES, f({ statuses: ["todo"], priorities: ["urgent"] }), TODAY))).toEqual(["d"]);
  });

  it("filters by project, with 'No project' as its own option (web parity)", () => {
    expect(ids(filterIssueList(ISSUES, f({ projects: ["p1"] }), TODAY))).toEqual(["a", "d"]);
    expect(ids(filterIssueList(ISSUES, f({ includeNoProject: true }), TODAY))).toEqual(["c"]);
    expect(ids(filterIssueList(ISSUES, f({ projects: ["p2"], includeNoProject: true }), TODAY))).toEqual(["b", "c"]);
  });

  it("matches issues that carry any selected label", () => {
    expect(ids(filterIssueList(ISSUES, f({ labels: ["bug"] }), TODAY))).toEqual(["a", "b"]);
    expect(ids(filterIssueList(ISSUES, f({ labels: ["ui", "missing"] }), TODAY))).toEqual(["b"]);
  });

  it("filters by due bucket; 'later' matches none of them", () => {
    expect(ids(filterIssueList(ISSUES, f({ due: ["overdue"] }), TODAY))).toEqual(["a"]);
    expect(ids(filterIssueList(ISSUES, f({ due: ["this_week", "none"] }), TODAY))).toEqual(["b", "c"]);
  });

  it("ANDs across dimensions", () => {
    expect(
      ids(filterIssueList(ISSUES, f({ projects: ["p1"], labels: ["bug"], due: ["overdue"] }), TODAY)),
    ).toEqual(["a"]);
    expect(ids(filterIssueList(ISSUES, f({ projects: ["p1"], due: ["this_week"] }), TODAY))).toEqual([]);
  });
});

describe("toggle, count, project page", () => {
  it("toggles one value and counts every dimension", () => {
    const on = toggleIssueListFilter(f({ includeNoProject: true }), "labels", "bug");
    expect(on.labels).toEqual(["bug"]);
    expect(issueListFilterCount(on)).toBe(2);
    expect(toggleIssueListFilter(on, "labels", "bug").labels).toEqual([]);
  });

  it("drops project filters on the project page, keeps the rest", () => {
    const stored = f({ projects: ["p1"], includeNoProject: true, labels: ["bug"] });
    expect(withoutProjectFilter(stored)).toEqual(f({ labels: ["bug"] }));
    const plain = f({ labels: ["bug"] });
    expect(withoutProjectFilter(plain)).toBe(plain);
  });
});

describe("filtersMayMissIssues (100-cap hint)", () => {
  it("warns only when the server cap was hit and a filter is active", () => {
    expect(filtersMayMissIssues(100, f({ labels: ["bug"] }))).toBe(true);
    expect(filtersMayMissIssues(99, f({ labels: ["bug"] }))).toBe(false);
    expect(filtersMayMissIssues(100, EMPTY_ISSUE_LIST_FILTERS)).toBe(false);
  });
  it("uses the server total when known", () => {
    expect(filtersMayMissIssues(100, f({ labels: ["bug"] }), 100)).toBe(false);
    expect(filtersMayMissIssues(100, f({ labels: ["bug"] }), 180)).toBe(true);
  });
});

describe("persistence format", () => {
  it("round-trips", () => {
    const value = f({
      statuses: ["todo", "custom_review"],
      priorities: ["high"],
      projects: ["p1"],
      includeNoProject: true,
      labels: ["bug"],
      due: ["overdue", "none"],
    });
    expect(parseStoredIssueListFilters(serializeIssueListFilters(value))).toEqual(value);
  });

  it("tolerates missing, broken or foreign values", () => {
    expect(parseStoredIssueListFilters(null)).toBe(EMPTY_ISSUE_LIST_FILTERS);
    expect(parseStoredIssueListFilters("nope")).toBe(EMPTY_ISSUE_LIST_FILTERS);
    expect(parseStoredIssueListFilters("[1]")).toBe(EMPTY_ISSUE_LIST_FILTERS);
    expect(
      parseStoredIssueListFilters(
        JSON.stringify({ priorities: ["bogus", "low"], due: ["later", "none"], includeNoProject: "yes", labels: [1, "x", "x"] }),
      ),
    ).toEqual(f({ priorities: ["low"], due: ["none"], labels: ["x"] }));
  });
});

describe("filter strings", () => {
  const KEYS = ["project", "no_project", "label", "due_date", "due_overdue", "due_this_week", "due_none", "remove_chip", "limit_hint", "project_scope_hint", "button_active"];
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every filter key`, () => {
      const filters = (file as { filters: Record<string, string> }).filters;
      for (const key of KEYS) expect(filters[key], `${lang}:${key}`).toBeTypeOf("string");
    });
  }
});
