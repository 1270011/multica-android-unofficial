import { describe, expect, it, vi } from "vitest";

vi.mock("./list-pages", () => ({ listIssuePages: vi.fn() }));

import {
  buildMyIssuesFilter,
  lockFiltersForScope,
  myIssueListOptions,
  showsAssigneeFilter,
  showsCreatorFilter,
  showsInvolvesMeFilter,
  toListParams,
} from "./my-issues";
import { EMPTY_ISSUE_LIST_FILTERS, type IssueListFilters } from "@/lib/issue-list-filters";
import { issueKeys, isMyIssuesScope, MY_ISSUES_SCOPES } from "./issue-keys";

describe("buildMyIssuesFilter", () => {
  it("maps the three tabs to server parameters", () => {
    expect(buildMyIssuesFilter("assigned", "u1")).toEqual({ assignee_id: "u1" });
    expect(buildMyIssuesFilter("created", "u1")).toEqual({ creator_id: "u1" });
    // All = whole workspace, no person parameter.
    expect(buildMyIssuesFilter("all", "u1")).toEqual({});
  });

  it("adds involves_user_id for 'My agents and squads' in Created and All", () => {
    expect(buildMyIssuesFilter("created", "u1", { involvesMe: true })).toEqual({
      creator_id: "u1",
      involves_user_id: "u1",
    });
    expect(buildMyIssuesFilter("all", "u1", { involvesMe: true })).toEqual({
      involves_user_id: "u1",
    });
  });

  it("ignores 'My agents and squads' in Assigned", () => {
    expect(buildMyIssuesFilter("assigned", "u1", { involvesMe: true })).toEqual({
      assignee_id: "u1",
    });
  });

  it("keeps every tab and filter under the myAll key for live refresh", () => {
    const prefix = issueKeys.myAll("ws");
    for (const scope of MY_ISSUES_SCOPES) {
      for (const involvesMe of [false, true]) {
        const filter = buildMyIssuesFilter(scope, "u1", { involvesMe });
        const key = myIssueListOptions("ws", scope, filter).queryKey;
        expect(key.slice(0, prefix.length)).toEqual([...prefix]);
        expect(key).toContainEqual(filter);
      }
    }
    // Different filters must not share a cache entry.
    const a = myIssueListOptions("ws", "all", buildMyIssuesFilter("all", "u1")).queryKey;
    const b = myIssueListOptions("ws", "all", buildMyIssuesFilter("all", "u1", { involvesMe: true })).queryKey;
    expect(a).not.toEqual(b);
  });

  it("knows only the three tabs", () => {
    expect(MY_ISSUES_SCOPES).toEqual(["assigned", "created", "all"]);
    expect(isMyIssuesScope("all")).toBe(true);
    expect(isMyIssuesScope("agents")).toBe(false);
    expect(isMyIssuesScope(null)).toBe(false);
  });
});

describe("showsInvolvesMeFilter", () => {
  it("offers 'My agents and squads' in Created and All, not in Assigned", () => {
    expect(showsInvolvesMeFilter("my", "created")).toBe(true);
    expect(showsInvolvesMeFilter("my", "all")).toBe(true);
    expect(showsInvolvesMeFilter("my", "assigned")).toBe(false);
  });

  it("does not offer it outside My Issues", () => {
    for (const scope of MY_ISSUES_SCOPES) {
      expect(showsInvolvesMeFilter("project", scope)).toBe(false);
      expect(showsInvolvesMeFilter("all", scope)).toBe(false);
    }
  });
});

const f = (partial: Partial<IssueListFilters>): IssueListFilters => ({
  ...EMPTY_ISSUE_LIST_FILTERS,
  ...partial,
});

const PEOPLE = f({
  assignees: ["member:u2", "agent:a1"],
  assigneeTypes: ["squad", "agent"],
  creators: ["agent:a2", "member:u3"],
  labels: ["bug"],
});

describe("toListParams", () => {
  it("All: sends every assignee and creator filter", () => {
    expect(toListParams("all", "u1", PEOPLE)).toEqual({
      assignee_filters: [
        { type: "agent", id: "a1" },
        { type: "member", id: "u2" },
      ],
      assignee_types: ["agent", "squad"],
      creator_filters: [
        { type: "agent", id: "a2" },
        { type: "member", id: "u3" },
      ],
    });
  });

  it("Assigned: fixed to me, assignee filters are dropped, creators stay", () => {
    expect(toListParams("assigned", "u1", { ...PEOPLE, involvesMe: true })).toEqual({
      assignee_id: "u1",
      creator_filters: [
        { type: "agent", id: "a2" },
        { type: "member", id: "u3" },
      ],
    });
    expect(toListParams("assigned", "u1", f({ includeNoAssignee: true }))).toEqual({
      assignee_id: "u1",
    });
  });

  it("Created: fixed to me as creator, creator filters are dropped", () => {
    expect(toListParams("created", "u1", { ...PEOPLE, involvesMe: true })).toEqual({
      creator_id: "u1",
      involves_user_id: "u1",
      assignee_filters: [
        { type: "agent", id: "a1" },
        { type: "member", id: "u2" },
      ],
      assignee_types: ["agent", "squad"],
    });
  });

  it("'Nobody' sends only include_no_assignee, never other assignee values", () => {
    // Inconsistent value (not reachable through the setters) on purpose.
    const mixed = { ...PEOPLE, involvesMe: true, includeNoAssignee: true };
    expect(toListParams("all", "u1", mixed)).toEqual({
      include_no_assignee: true,
      creator_filters: [
        { type: "agent", id: "a2" },
        { type: "member", id: "u3" },
      ],
    });
    expect(toListParams("created", "u1", mixed)).toEqual({
      creator_id: "u1",
      include_no_assignee: true,
    });
  });

  it("leaves client filters (status, label, …) out of the server parameters", () => {
    expect(toListParams("all", "u1", f({ labels: ["bug"], statuses: ["todo"] }))).toEqual({});
  });

  it("gives the same key for the same selection in another order", () => {
    const a = toListParams("all", "u1", f({ assignees: ["member:u2", "agent:a1"] }));
    const b = toListParams("all", "u1", f({ assignees: ["agent:a1", "member:u2"] }));
    expect(myIssueListOptions("ws", "all", a).queryKey).toEqual(
      myIssueListOptions("ws", "all", b).queryKey,
    );
  });

  it("puts the new parameters into the myAll key (live refresh, #86)", () => {
    const prefix = issueKeys.myAll("ws");
    const plain = myIssueListOptions("ws", "all", toListParams("all", "u1", f({}))).queryKey;
    for (const filters of [
      f({ assignees: ["member:u2"] }),
      f({ includeNoAssignee: true }),
      f({ assigneeTypes: ["agent"] }),
      f({ creators: ["agent:a1"] }),
    ]) {
      const params = toListParams("all", "u1", filters);
      const key = myIssueListOptions("ws", "all", params).queryKey;
      expect(key.slice(0, prefix.length)).toEqual([...prefix]);
      expect(key).toContainEqual(params);
      expect(key).not.toEqual(plain);
    }
  });
});

describe("lockFiltersForScope", () => {
  it("Assigned drops every assignee value, keeps the rest", () => {
    const stored = { ...PEOPLE, involvesMe: true };
    expect(lockFiltersForScope(stored, "assigned")).toEqual(
      f({ creators: PEOPLE.creators, labels: ["bug"] }),
    );
    expect(lockFiltersForScope(f({ includeNoAssignee: true }), "assigned")).toEqual(f({}));
  });

  it("Created drops creators, keeps assignee values", () => {
    expect(lockFiltersForScope(PEOPLE, "created")).toEqual({ ...PEOPLE, creators: [] });
  });

  it("All locks nothing; unchanged values keep their identity", () => {
    expect(lockFiltersForScope(PEOPLE, "all")).toBe(PEOPLE);
    const labelsOnly = f({ labels: ["bug"] });
    expect(lockFiltersForScope(labelsOnly, "assigned")).toBe(labelsOnly);
    expect(lockFiltersForScope(labelsOnly, "created")).toBe(labelsOnly);
  });

  it("the sheet hides exactly the locked section", () => {
    expect(showsAssigneeFilter("my", "assigned")).toBe(false);
    expect(showsAssigneeFilter("my", "created")).toBe(true);
    expect(showsCreatorFilter("my", "created")).toBe(false);
    expect(showsCreatorFilter("my", "assigned")).toBe(true);
    expect(showsCreatorFilter("my", "all")).toBe(true);
    expect(showsCreatorFilter("project", "all")).toBe(false);
  });
});

describe("toListParams with a sort", () => {
  it("adds sort and direction after the tab and filter parameters", () => {
    expect(
      toListParams("assigned", "u1", EMPTY_ISSUE_LIST_FILTERS, { field: "priority", direction: "desc" }),
    ).toEqual({ assignee_id: "u1", sort_by: "priority", sort_direction: "desc" });
  });

  it("sends nothing for Manual and changes the query key per sort", () => {
    const manual = toListParams("all", "u1", EMPTY_ISSUE_LIST_FILTERS, { field: "position", direction: "asc" });
    expect(manual).toEqual({});
    const byTitle = toListParams("all", "u1", EMPTY_ISSUE_LIST_FILTERS, { field: "title", direction: "asc" });
    const keyManual = myIssueListOptions("ws-1", "all", manual).queryKey;
    const keyTitle = myIssueListOptions("ws-1", "all", byTitle).queryKey;
    expect(keyTitle).not.toEqual(keyManual);
    // Both stay under myAll, so live refresh reaches them.
    expect(keyTitle.slice(0, 3)).toEqual([...issueKeys.myAll("ws-1")]);
  });
});
