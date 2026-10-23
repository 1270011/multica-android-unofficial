// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EMPTY_ISSUE_LIST_FILTERS } from "./issue-list-filters";
import { MANUAL_SORT } from "./issue-list-sort";
import type { AppViewState } from "./issue-view-mapping";
import {
  canShareView,
  checkViewName,
  createViewRequest,
  ISSUE_VIEW_NAME_MAX,
  viewCreateErrorKind,
} from "./issue-view-create";

/** Duck-typed like data/api.ts ApiError. */
function apiError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function state(over: Partial<AppViewState> = {}): AppViewState {
  return {
    tab: "all",
    filters: EMPTY_ISSUE_LIST_FILTERS,
    sort: MANUAL_SORT,
    viewMode: "list",
    ...over,
  };
}

describe("viewCreateErrorKind", () => {
  it("maps the server's 400 texts (issue_view.go) to name and limit", () => {
    expect(viewCreateErrorKind(apiError(400, "name must be between 1 and 80 characters"))).toBe(
      "name",
    );
    expect(viewCreateErrorKind(apiError(400, "view limit reached for this workspace"))).toBe(
      "limit",
    );
    expect(viewCreateErrorKind(apiError(400, "invalid scope_variant for this scope_type"))).toBe(
      "failed",
    );
  });

  it("maps 409 to a duplicate name and 403 to forbidden", () => {
    expect(viewCreateErrorKind(apiError(409, "view name already exists"))).toBe("duplicate");
    expect(viewCreateErrorKind(apiError(403, "insufficient permissions"))).toBe("forbidden");
  });

  it("treats no answer as offline and anything else as failed", () => {
    expect(viewCreateErrorKind(new TypeError("Network request failed"))).toBe("offline");
    expect(viewCreateErrorKind(apiError(0, "aborted"))).toBe("offline");
    expect(viewCreateErrorKind(apiError(500, "failed to create view"))).toBe("failed");
    expect(viewCreateErrorKind(apiError(404, "project not found"))).toBe("failed");
    expect(viewCreateErrorKind(null)).toBe("failed");
    expect(viewCreateErrorKind("boom")).toBe("failed");
  });
});

describe("checkViewName", () => {
  it("trims and accepts 1–80 characters", () => {
    expect(checkViewName("  Offen & dringend ")).toEqual({ ok: true, name: "Offen & dringend" });
    expect(checkViewName("x".repeat(ISSUE_VIEW_NAME_MAX)).ok).toBe(true);
  });

  it("rejects empty and too long names", () => {
    expect(checkViewName("   ")).toEqual({ ok: false, reason: "empty" });
    expect(checkViewName("x".repeat(ISSUE_VIEW_NAME_MAX + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("counts code points like the server, so 80 emoji fit", () => {
    expect(checkViewName("🔥".repeat(ISSUE_VIEW_NAME_MAX)).ok).toBe(true);
    expect(checkViewName("🔥".repeat(ISSUE_VIEW_NAME_MAX + 1)).ok).toBe(false);
  });

  it("rejects a name already in the tab, ignoring case and spaces", () => {
    expect(checkViewName("meine reviews ", ["Meine Reviews"])).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(checkViewName("Meine Reviews 2", ["Meine Reviews"]).ok).toBe(true);
  });
});

describe("createViewRequest", () => {
  const filters = {
    ...EMPTY_ISSUE_LIST_FILTERS,
    statuses: ["todo" as const],
    priorities: ["urgent" as const],
    assignees: ["agent:a1" as const],
    creators: ["member:u1" as const],
    due: ["overdue" as const],
  };
  const sort = { field: "priority" as const, direction: "desc" as const };

  it("Assigned: my/assigned, always private, no assignee filter", () => {
    const body = createViewRequest(state({ tab: "assigned", filters, sort }), " Mine ", true);
    expect(body).toMatchObject({
      name: "Mine",
      scope_type: "my",
      scope_id: null,
      scope_variant: "assigned",
      visibility: "private",
      definition_version: 1,
    });
    expect(body.query).toMatchObject({
      statusFilters: ["todo"],
      priorityFilters: ["urgent"],
      assigneeFilters: [],
      includeNoAssignee: false,
      creatorFilters: [{ type: "member", id: "u1" }],
    });
    expect(body.display).toEqual({ viewMode: "list", sortBy: "priority", sortDirection: "desc" });
  });

  it("Created: my/created, always private, no creator filter", () => {
    const body = createViewRequest(
      state({ tab: "created", filters, viewMode: "board" }),
      "Von mir",
      true,
    );
    expect(body).toMatchObject({ scope_type: "my", scope_variant: "created", visibility: "private" });
    expect(body.query).toMatchObject({
      assigneeFilters: [{ type: "agent", id: "a1" }],
      creatorFilters: [],
    });
    expect(body.display).toMatchObject({ viewMode: "board", sortBy: "position" });
  });

  it("All: workspace scope, shared on request, due filter never saved", () => {
    const body = createViewRequest(state({ tab: "all", filters }), "Team", true);
    expect(body).toMatchObject({
      scope_type: "workspace",
      scope_variant: null,
      visibility: "workspace",
    });
    expect(Object.keys(body.query)).not.toContain("due");
    expect(JSON.stringify(body)).not.toContain("overdue");
    expect(createViewRequest(state({ tab: "all", filters }), "Team", false).visibility).toBe(
      "private",
    );
  });

  it("All + assignee kind members: workspace/members", () => {
    const body = createViewRequest(
      state({ filters: { ...EMPTY_ISSUE_LIST_FILTERS, assigneeTypes: ["member"] } }),
      "Menschen",
      false,
    );
    expect(body).toMatchObject({ scope_type: "workspace", scope_variant: "members" });
  });

  it("All + My agents and squads: my/involved, private even when shared", () => {
    const s = state({ filters: { ...EMPTY_ISSUE_LIST_FILTERS, involvesMe: true } });
    expect(canShareView(s)).toBe(false);
    expect(createViewRequest(s, "Meine Agents", true)).toMatchObject({
      scope_type: "my",
      scope_variant: "involved",
      visibility: "private",
    });
  });

  it("only the workspace scope can be shared", () => {
    expect(canShareView(state({ tab: "all" }))).toBe(true);
    expect(canShareView(state({ tab: "assigned" }))).toBe(false);
    expect(canShareView(state({ tab: "created" }))).toBe(false);
  });
});
