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
  actorRefs,
  parseActorKey,
  serializeIssueListFilters,
  setIncludeNoAssignee,
  setInvolvesMe,
  toggleAssignee,
  toggleAssigneeType,
  toggleCreator,
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

  it("counts 'My agents and squads' but leaves the list to the server (D1)", () => {
    const value = f({ involvesMe: true });
    expect(issueListFilterCount(value)).toBe(1);
    expect(filterIssueList(ISSUES, value, TODAY)).toEqual(ISSUES);
  });

  it("drops project filters on the project page, keeps the rest", () => {
    const stored = f({ projects: ["p1"], includeNoProject: true, labels: ["bug"] });
    expect(withoutProjectFilter(stored)).toEqual(f({ labels: ["bug"] }));
    const plain = f({ labels: ["bug"] });
    expect(withoutProjectFilter(plain)).toBe(plain);
  });
});

describe("assignee and creator filters", () => {
  it("counts every assignee and creator value", () => {
    const value = f({
      assignees: ["member:u1", "agent:a1"],
      assigneeTypes: ["squad"],
      creators: ["member:u2"],
    });
    expect(issueListFilterCount(value)).toBe(4);
    expect(issueListFilterCount(f({ includeNoAssignee: true }))).toBe(1);
  });

  it("leaves the list to the server", () => {
    const value = f({ assignees: ["member:u1"], creators: ["agent:a1"], assigneeTypes: ["agent"] });
    expect(filterIssueList(ISSUES, value, TODAY)).toBe(ISSUES);
    expect(filterIssueList(ISSUES, f({ includeNoAssignee: true }), TODAY)).toBe(ISSUES);
  });

  it("'Nobody' clears people, kinds and 'My agents and squads'", () => {
    const before = f({
      assignees: ["member:u1"],
      assigneeTypes: ["agent"],
      involvesMe: true,
      creators: ["member:u2"],
      labels: ["bug"],
    });
    expect(setIncludeNoAssignee(before, true)).toEqual(
      f({ includeNoAssignee: true, creators: ["member:u2"], labels: ["bug"] }),
    );
    expect(setIncludeNoAssignee(f({ includeNoAssignee: true }), false)).toEqual(f({}));
  });

  it("picking an assignee value switches 'Nobody' off", () => {
    const nobody = f({ includeNoAssignee: true });
    expect(toggleAssignee(nobody, "member:u1")).toEqual(f({ assignees: ["member:u1"] }));
    expect(toggleAssigneeType(nobody, "squad")).toEqual(f({ assigneeTypes: ["squad"] }));
    expect(setInvolvesMe(nobody, true)).toEqual(f({ involvesMe: true }));
    // Switching "My agents and squads" off does not bring "Nobody" back.
    expect(setInvolvesMe(f({ involvesMe: true }), false)).toEqual(f({}));
    // Creators are another section: "Nobody" stays.
    expect(toggleCreator(nobody, "agent:a1")).toEqual(
      f({ includeNoAssignee: true, creators: ["agent:a1"] }),
    );
  });

  it("toggles actors on and off", () => {
    const on = toggleAssignee(f({}), "squad:s1");
    expect(on.assignees).toEqual(["squad:s1"]);
    expect(toggleAssignee(on, "squad:s1").assignees).toEqual([]);
    expect(toggleCreator(toggleCreator(f({}), "member:u1"), "member:u1").creators).toEqual([]);
  });

  it("parses actor keys like web's actorFilterKey", () => {
    expect(parseActorKey("member:u1")).toEqual({ type: "member", id: "u1" });
    expect(parseActorKey("squad:s:1")).toEqual({ type: "squad", id: "s:1" });
    expect(parseActorKey("robot:x")).toBeNull();
    expect(parseActorKey("member:")).toBeNull();
    expect(parseActorKey("u1")).toBeNull();
    expect(parseActorKey("squad:s1", ["member", "agent"])).toBeNull();
    expect(actorRefs(["member:u2", "agent:a1", "member:u1"])).toEqual([
      { type: "agent", id: "a1" },
      { type: "member", id: "u1" },
      { type: "member", id: "u2" },
    ]);
  });
});

describe("filtersMayMissIssues (100-cap hint)", () => {
  it("warns only when the server cap was hit and a filter is active", () => {
    expect(filtersMayMissIssues(100, f({ labels: ["bug"] }))).toBe(true);
    expect(filtersMayMissIssues(99, f({ labels: ["bug"] }))).toBe(false);
    expect(filtersMayMissIssues(100, EMPTY_ISSUE_LIST_FILTERS)).toBe(false);
  });
  it("ignores the server-side 'My agents and squads' filter (D1)", () => {
    expect(filtersMayMissIssues(100, f({ involvesMe: true }))).toBe(false);
    expect(filtersMayMissIssues(100, f({ involvesMe: true, labels: ["bug"] }))).toBe(true);
  });
  it("ignores the server-side assignee and creator filters (D3a)", () => {
    expect(
      filtersMayMissIssues(
        100,
        f({ assignees: ["member:u1"], includeNoAssignee: false, assigneeTypes: ["agent"], creators: ["agent:a1"] }),
      ),
    ).toBe(false);
    expect(filtersMayMissIssues(100, f({ includeNoAssignee: true }))).toBe(false);
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
      involvesMe: true,
      assignees: ["member:u1", "squad:s1"],
      assigneeTypes: ["agent", "squad"],
      creators: ["agent:a1"],
    });
    expect(parseStoredIssueListFilters(serializeIssueListFilters(value))).toEqual(value);
    const nobody = f({ includeNoAssignee: true, creators: ["member:u1"] });
    expect(parseStoredIssueListFilters(serializeIssueListFilters(nobody))).toEqual(nobody);
  });

  it("loads filters stored before D3a without the new fields", () => {
    const old = JSON.stringify({
      statuses: ["todo"],
      priorities: [],
      projects: [],
      includeNoProject: false,
      labels: [],
      due: [],
      involvesMe: true,
    });
    expect(parseStoredIssueListFilters(old)).toEqual(
      f({ statuses: ["todo"], involvesMe: true }),
    );
    // Even older: before involvesMe (D1).
    expect(parseStoredIssueListFilters(JSON.stringify({ labels: ["bug"] }))).toEqual(
      f({ labels: ["bug"] }),
    );
  });

  it("drops broken actor values and keeps 'Nobody' alone", () => {
    expect(
      parseStoredIssueListFilters(
        JSON.stringify({
          assignees: ["member:u1", "robot:x", "member:", 7, "member:u1"],
          assigneeTypes: ["agent", "bot"],
          creators: ["squad:s1", "agent:a1"],
          includeNoAssignee: "yes",
        }),
      ),
    ).toEqual(f({ assignees: ["member:u1"], assigneeTypes: ["agent"], creators: ["agent:a1"] }));
    // A hand-edited mix of "Nobody" and people keeps "Nobody" only.
    expect(
      parseStoredIssueListFilters(
        JSON.stringify({ includeNoAssignee: true, assignees: ["member:u1"], involvesMe: true }),
      ),
    ).toEqual(f({ includeNoAssignee: true }));
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
  const KEYS = ["project", "no_project", "label", "due_date", "due_overdue", "due_this_week", "due_none", "remove_chip", "limit_hint", "project_scope_hint", "button_active", "involves_me"];
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every filter key`, () => {
      const filters = (file as { filters: Record<string, string> }).filters;
      for (const key of KEYS) expect(filters[key], `${lang}:${key}`).toBeTypeOf("string");
    });
  }
});
