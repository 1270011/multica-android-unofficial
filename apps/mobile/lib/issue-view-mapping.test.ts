// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { IssueView } from "@multica/core/api/schemas";
import { EMPTY_ISSUE_LIST_FILTERS } from "./issue-list-filters";
import { MANUAL_SORT } from "./issue-list-sort";
import {
  activeViewGone,
  appStateFromView,
  type AppViewState,
  orderViews,
  viewDefinitionFromApp,
  viewFetchOutcome,
  viewsForTab,
} from "./issue-view-mapping";

function view(over: Partial<IssueView> = {}): IssueView {
  return {
    id: "v1",
    workspace_id: "ws",
    owner_id: "me",
    name: "Offen & dringend",
    scope_type: "workspace",
    scope_id: null,
    scope_variant: null,
    visibility: "private",
    definition_version: 1,
    query: {},
    display: {},
    revision: 1,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

const webQuery = {
  statusFilters: ["todo", "in_progress", "qa_custom"],
  priorityFilters: ["urgent", "high"],
  assigneeFilters: [
    { type: "member", id: "u1" },
    { type: "agent", id: "a1" },
  ],
  includeNoAssignee: false,
  creatorFilters: [{ type: "member", id: "u2" }],
  projectFilters: ["p1"],
  includeNoProject: true,
  labelFilters: ["l1"],
};

describe("saved view → app (D8a)", () => {
  it("maps the web query and display keys onto filters, sort and mode", () => {
    const applied = appStateFromView(
      view({
        query: webQuery,
        display: { viewMode: "board", sortBy: "priority", sortDirection: "desc" },
      }),
    );
    expect(applied.tab).toBe("all");
    expect(applied.filters).toEqual({
      ...EMPTY_ISSUE_LIST_FILTERS,
      statuses: ["todo", "in_progress", "qa_custom"],
      priorities: ["urgent", "high"],
      assignees: ["member:u1", "agent:a1"],
      creators: ["member:u2"],
      projects: ["p1"],
      includeNoProject: true,
      labels: ["l1"],
    });
    expect(applied.sort).toEqual({ field: "priority", direction: "desc" });
    expect(applied.viewMode).toBe("board");
    expect(applied.hiddenFilters).toBe(false);
  });

  it("maps scope and variant onto the tab", () => {
    expect(appStateFromView(view({ scope_type: "my", scope_variant: "assigned" })).tab).toBe("assigned");
    expect(appStateFromView(view({ scope_type: "my", scope_variant: "created" })).tab).toBe("created");
    const involved = appStateFromView(view({ scope_type: "my", scope_variant: "involved" }));
    expect(involved.tab).toBe("all");
    expect(involved.filters.involvesMe).toBe(true);
    expect(appStateFromView(view({ scope_variant: "members" })).filters.assigneeTypes).toEqual(["member"]);
    expect(appStateFromView(view({ scope_variant: "agents" })).filters.assigneeTypes).toEqual(["agent", "squad"]);
  });

  it("an empty view is the default list", () => {
    const applied = appStateFromView(view());
    expect(applied.filters).toEqual(EMPTY_ISSUE_LIST_FILTERS);
    expect(applied.sort).toBe(MANUAL_SORT);
    expect(applied.viewMode).toBe("list");
    expect(applied.hiddenFilters).toBe(false);
  });

  it("flags filters the app cannot show (foreign keys, modes, sorts, scopes)", () => {
    const hidden = (v: Partial<IssueView>) => appStateFromView(view(v)).hiddenFilters;
    expect(hidden({ query: { propertyFilters: { d1: ["x"] } } })).toBe(true);
    expect(hidden({ query: { projectStatusFilters: ["in_progress"] } })).toBe(true);
    expect(hidden({ display: { viewMode: "table" } })).toBe(true);
    expect(hidden({ display: { sortBy: "property:d1" } })).toBe(true);
    expect(hidden({ scope_type: "my", scope_variant: "any" })).toBe(true);
    expect(hidden({ query: { priorityFilters: ["blocker"] } })).toBe(true);
    expect(hidden({ query: { creatorFilters: [{ type: "squad", id: "s1" }] } })).toBe(true);
  });

  it("does not flag empty foreign keys or display-only settings", () => {
    const hidden = (v: Partial<IssueView>) => appStateFromView(view(v)).hiddenFilters;
    expect(hidden({ query: { propertyFilters: {}, projectStatusFilters: [] } })).toBe(false);
    expect(hidden({ display: { grouping: "assignee", tableColumns: [{ key: "title" }] } })).toBe(false);
  });

  it("falls back on odd values instead of throwing", () => {
    const applied = appStateFromView(
      view({
        query: { statusFilters: "todo", assigneeFilters: [null, { type: "member" }] },
        display: { viewMode: "gantt", sortBy: "priority", sortDirection: "sideways" },
      }),
    );
    expect(applied.filters.statuses).toEqual([]);
    expect(applied.filters.assignees).toEqual([]);
    expect(applied.viewMode).toBe("list");
    expect(applied.sort).toEqual({ field: "priority", direction: "asc" });
    expect(applied.hiddenFilters).toBe(true);
  });

  it("'Nobody' wins over assignees, like the filter sheet", () => {
    const applied = appStateFromView(
      view({
        scope_variant: "members",
        query: { includeNoAssignee: true, assigneeFilters: [{ type: "member", id: "u1" }] },
      }),
    );
    expect(applied.filters.includeNoAssignee).toBe(true);
    expect(applied.filters.assignees).toEqual([]);
    expect(applied.filters.assigneeTypes).toEqual([]);
  });
});

describe("app → saved view (D8a, used by D8b/D8c)", () => {
  const foreignQuery = {
    propertyFilters: { d1: ["x"] },
    projectStatusFilters: ["planned"],
    futureKey: { nested: true },
  };
  const foreignDisplay = {
    grouping: "assignee",
    tableColumns: [{ key: "title", width: 320 }],
    swimlaneGrouping: "parent",
  };

  it("round-trips view → app → view and keeps foreign keys", () => {
    const original = view({
      query: { ...webQuery, ...foreignQuery },
      display: { viewMode: "board", sortBy: "created_at", sortDirection: "desc", ...foreignDisplay },
    });
    const applied = appStateFromView(original);
    const def = viewDefinitionFromApp(applied, original);
    expect(def.scope_type).toBe("workspace");
    expect(def.scope_variant).toBeNull();
    expect(def.query).toEqual({ ...webQuery, ...foreignQuery });
    expect(def.display).toEqual({
      viewMode: "board",
      sortBy: "created_at",
      sortDirection: "desc",
      ...foreignDisplay,
    });
    // And back again: same app state.
    expect(appStateFromView({ ...original, ...def })).toEqual(applied);
  });

  it("round-trips app → view → app for every tab", () => {
    const states: AppViewState[] = [
      {
        tab: "assigned",
        filters: { ...EMPTY_ISSUE_LIST_FILTERS, statuses: ["todo"], creators: ["agent:a1"] },
        sort: MANUAL_SORT,
        viewMode: "list",
      },
      {
        tab: "created",
        filters: { ...EMPTY_ISSUE_LIST_FILTERS, assignees: ["squad:s1"], labels: ["l1"] },
        sort: { field: "title", direction: "asc" },
        viewMode: "board",
      },
      {
        tab: "all",
        filters: { ...EMPTY_ISSUE_LIST_FILTERS, involvesMe: true, priorities: ["low"] },
        sort: { field: "updated_at", direction: "desc" },
        viewMode: "list",
      },
      {
        tab: "all",
        filters: { ...EMPTY_ISSUE_LIST_FILTERS, assigneeTypes: ["agent", "squad"], includeNoProject: true },
        sort: MANUAL_SORT,
        viewMode: "list",
      },
      {
        tab: "all",
        filters: { ...EMPTY_ISSUE_LIST_FILTERS, includeNoAssignee: true },
        sort: MANUAL_SORT,
        viewMode: "list",
      },
    ];
    for (const state of states) {
      const def = viewDefinitionFromApp(state);
      const back = appStateFromView(view({ ...def }));
      expect({ tab: back.tab, filters: back.filters, sort: back.sort, viewMode: back.viewMode }).toEqual(state);
      expect(back.hiddenFilters).toBe(false);
    }
  });

  it("names the scope per tab", () => {
    const base = { filters: EMPTY_ISSUE_LIST_FILTERS, sort: MANUAL_SORT, viewMode: "list" as const };
    expect(viewDefinitionFromApp({ ...base, tab: "assigned" })).toMatchObject({ scope_type: "my", scope_variant: "assigned" });
    expect(viewDefinitionFromApp({ ...base, tab: "created" })).toMatchObject({ scope_type: "my", scope_variant: "created" });
    expect(viewDefinitionFromApp({ ...base, tab: "all" })).toMatchObject({ scope_type: "workspace", scope_variant: null });
    expect(
      viewDefinitionFromApp({ ...base, tab: "all", filters: { ...EMPTY_ISSUE_LIST_FILTERS, assigneeTypes: ["member"] } }),
    ).toMatchObject({ scope_type: "workspace", scope_variant: "members" });
  });

  it("never saves the app-only due-date filter", () => {
    const def = viewDefinitionFromApp({
      tab: "all",
      filters: { ...EMPTY_ISSUE_LIST_FILTERS, due: ["overdue"] },
      sort: MANUAL_SORT,
      viewMode: "list",
    });
    expect(JSON.stringify(def)).not.toContain("overdue");
  });
});

describe("view list and fetch", () => {
  const mine = [
    view({ id: "a", scope_type: "my", scope_variant: "assigned" }),
    view({ id: "c", scope_type: "my", scope_variant: "created" }),
    view({ id: "i", scope_type: "my", scope_variant: "involved" }),
    view({ id: "y", scope_type: "my", scope_variant: "any" }),
  ];
  const ws = [view({ id: "w1" }), view({ id: "w2", scope_variant: "agents" })];

  it("offers per tab only the views that open there", () => {
    expect(viewsForTab("assigned", mine, ws).map((v) => v.id)).toEqual(["a"]);
    expect(viewsForTab("created", mine, ws).map((v) => v.id)).toEqual(["c"]);
    expect(viewsForTab("all", mine, ws).map((v) => v.id)).toEqual(["w1", "w2", "i", "y"]);
  });

  it("drops hidden views and follows the stored order", () => {
    const pref = {
      scope_type: "workspace",
      scope_id: null,
      prefs: { hidden: ["view:w2"], order: ["builtin:all", "view:i", "view:w1"] },
      updated_at: "",
    };
    expect(orderViews(viewsForTab("all", mine, ws), pref, null).map((v) => v.id)).toEqual(["i", "w1", "y"]);
  });

  it("treats 404 and an unreadable body as 'gone'", () => {
    expect(viewFetchOutcome({ view: view() })).toBe("apply");
    expect(viewFetchOutcome({ view: null })).toBe("gone");
    expect(viewFetchOutcome({ error: Object.assign(new Error("not found"), { status: 404 }) })).toBe("gone");
    expect(viewFetchOutcome({ error: Object.assign(new Error("boom"), { status: 500 }) })).toBe("error");
    expect(viewFetchOutcome({ error: new TypeError("Network request failed") })).toBe("error");
  });
});

describe("activeViewGone", () => {
  const v = (id: string) => ({ id }) as IssueView;
  const read = (data: IssueView[] | undefined, over: Partial<{ isSuccess: boolean; isFetching: boolean; dataUpdatedAt: number }> = {}) => ({
    data,
    isSuccess: data !== undefined,
    isFetching: false,
    dataUpdatedAt: 200,
    ...over,
  });

  it("an unknown stored view is gone once both lists are read", () => {
    expect(activeViewGone("x", [read([v("a")]), read([v("b")])], 100)).toBe(true);
    expect(activeViewGone("x", [read([]), read([])], 100)).toBe(true);
  });

  it("a view in the own or the shared list stays", () => {
    expect(activeViewGone("a", [read([v("a")]), read([])], 100)).toBe(false);
    expect(activeViewGone("b", [read([]), read([v("b")])], 100)).toBe(false);
  });

  it("stays undecided while loading, failed, offline or on an older read", () => {
    expect(activeViewGone("x", [read(undefined), read([])], 100)).toBe(false);
    expect(activeViewGone("x", [read([], { isFetching: true }), read([])], 100)).toBe(false);
    expect(activeViewGone("x", [read([], { isSuccess: false }), read([])], 100)).toBe(false);
    expect(activeViewGone("x", [read([], { dataUpdatedAt: 50 }), read([])], 100)).toBe(false);
    expect(activeViewGone("x", [], 100)).toBe(false);
  });
});
