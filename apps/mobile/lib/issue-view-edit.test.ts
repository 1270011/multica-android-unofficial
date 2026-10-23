// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { IssueView } from "@multica/core/api/schemas";
import { EMPTY_ISSUE_LIST_FILTERS, type IssueListFilters } from "./issue-list-filters";
import { MANUAL_SORT } from "./issue-list-sort";
import type { AppViewState } from "./issue-view-mapping";
import {
  canChangeVisibility,
  canManageView,
  canSaveIntoView,
  editViewRequest,
  hasViewChanges,
  isViewModified,
  saveIntoViewRequest,
  viewConflictDialog,
  viewSaveButton,
  viewUpdateErrorKind,
} from "./issue-view-edit";

function apiError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function state(
  over: Partial<Omit<AppViewState, "filters">> & { filters?: Partial<IssueListFilters> } = {},
): AppViewState {
  const { filters, ...rest } = over;
  return {
    tab: "all",
    sort: MANUAL_SORT,
    viewMode: "list",
    ...rest,
    filters: { ...EMPTY_ISSUE_LIST_FILTERS, ...filters },
  };
}

function view(over: Partial<IssueView> = {}): IssueView {
  return {
    id: "v1",
    workspace_id: "ws",
    owner_id: "owner",
    name: "Offen",
    scope_type: "workspace",
    scope_id: null,
    scope_variant: null,
    visibility: "private",
    definition_version: 1,
    query: {},
    display: {},
    revision: 3,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("canManageView", () => {
  it("lets the owner manage private and shared views", () => {
    expect(canManageView(view({ visibility: "private" }), "owner", "member")).toBe(true);
    expect(canManageView(view({ visibility: "workspace" }), "owner", "member")).toBe(true);
  });

  it("lets workspace admins and owners manage shared views only", () => {
    for (const role of ["admin", "owner"]) {
      expect(canManageView(view({ visibility: "workspace" }), "someone", role)).toBe(true);
      expect(canManageView(view({ visibility: "private" }), "someone", role)).toBe(false);
    }
  });

  it("denies everyone else", () => {
    expect(canManageView(view({ visibility: "workspace" }), "someone", "member")).toBe(false);
    expect(canManageView(view({ visibility: "workspace" }), "someone", null)).toBe(false);
    expect(canManageView(view(), null, "owner")).toBe(false);
  });
});

describe("isViewModified", () => {
  const applied = state({ filters: { statuses: ["todo", "in_progress"], priorities: ["high"] } });

  it("is false for the same filters in another order", () => {
    expect(
      isViewModified(
        applied,
        state({ filters: { statuses: ["in_progress", "todo"], priorities: ["high"] } }),
      ),
    ).toBe(false);
  });

  it("ignores the app-only due filter (not saved, F3)", () => {
    expect(
      isViewModified(
        applied,
        state({ filters: { ...applied.filters, due: ["overdue"] } }),
      ),
    ).toBe(false);
  });

  it("notices changed filters, sort and list/board", () => {
    expect(isViewModified(applied, state({ filters: { statuses: ["todo"] } }))).toBe(true);
    expect(
      isViewModified(applied, { ...applied, sort: { field: "priority", direction: "asc" } }),
    ).toBe(true);
    expect(isViewModified(applied, { ...applied, viewMode: "board" })).toBe(true);
  });
});

describe("saving into a view", () => {
  it("patches query/display with expected_revision and keeps unknown keys", () => {
    const v = view({
      revision: 7,
      query: { propertyFilters: [{ id: "p" }], statusFilters: ["todo"] },
      display: { tableColumns: ["title"], viewMode: "list" },
    });
    const body = saveIntoViewRequest(v, state({ filters: { statuses: ["done"] }, viewMode: "board" }));
    expect(body.expected_revision).toBe(7);
    expect(body.scope_variant).toBeNull();
    expect(body.query).toMatchObject({ propertyFilters: [{ id: "p" }], statusFilters: ["done"] });
    expect(body.display).toMatchObject({ tableColumns: ["title"], viewMode: "board" });
    expect(body).not.toHaveProperty("name");
    expect(body).not.toHaveProperty("visibility");
  });

  it("cannot move a workspace view into `my` (My agents and squads)", () => {
    expect(canSaveIntoView(view(), state())).toBe(true);
    expect(canSaveIntoView(view(), state({ filters: { involvesMe: true } }))).toBe(false);
    expect(
      canSaveIntoView(view({ scope_type: "my", scope_variant: "assigned" }), state({ tab: "assigned" })),
    ).toBe(true);
  });
});

describe("editViewRequest", () => {
  it("sends only changed fields, trimmed, with expected_revision", () => {
    const v = view({ name: "Offen", visibility: "private", revision: 2 });
    expect(editViewRequest(v, " Offen ", false)).toEqual({ expected_revision: 2 });
    expect(hasViewChanges(editViewRequest(v, "Offen", false))).toBe(false);
    expect(editViewRequest(v, " Neu ", true)).toEqual({
      expected_revision: 2,
      name: "Neu",
      visibility: "workspace",
    });
  });

  it("never shares a `my` view", () => {
    const v = view({ scope_type: "my", scope_variant: "created" });
    expect(canChangeVisibility(v)).toBe(false);
    expect(editViewRequest(v, v.name, true)).toEqual({ expected_revision: 3 });
  });

  it("unshares a shared view", () => {
    const v = view({ visibility: "workspace" });
    expect(editViewRequest(v, v.name, false)).toEqual({
      expected_revision: 3,
      visibility: "private",
    });
  });
});

describe("409 dialog", () => {
  it("maps 409 to conflict and the other answers", () => {
    expect(viewUpdateErrorKind(apiError(409, "view was modified by someone else"))).toBe(
      "conflict",
    );
    expect(viewUpdateErrorKind(apiError(404, "view not found"))).toBe("gone");
    expect(viewUpdateErrorKind(apiError(403, "insufficient permissions"))).toBe("forbidden");
    expect(viewUpdateErrorKind(apiError(400, "name must be between 1 and 80 characters"))).toBe(
      "name",
    );
    expect(viewUpdateErrorKind(new TypeError("Network request failed"))).toBe("offline");
    expect(viewUpdateErrorKind(apiError(500, "boom"))).toBe("failed");
  });

  it("offers reload and save-as-new when saving the filters", () => {
    const d = viewConflictDialog("save");
    expect(d.titleKey).toBe("issues:views.edit.conflict_title");
    expect(d.buttons.map((b) => b.action)).toEqual(["cancel", "save_as_new", "reload"]);
    expect(d.buttons.find((b) => b.action === "cancel")?.style).toBe("cancel");
  });

  it("offers only reload when renaming or sharing", () => {
    expect(viewConflictDialog("edit").buttons.map((b) => b.action)).toEqual(["cancel", "reload"]);
  });
});

describe("viewSaveButton", () => {
  it("is hidden without the right to save", () => {
    expect(viewSaveButton({ canSave: false, saving: false, online: false })).toBe("hidden");
  });
  it("is disabled with the offline hint while offline, also during a save", () => {
    expect(viewSaveButton({ canSave: true, saving: false, online: false })).toBe("offline");
    expect(viewSaveButton({ canSave: true, saving: true, online: false })).toBe("offline");
  });
  it("is free again once the connection is back", () => {
    expect(viewSaveButton({ canSave: true, saving: false, online: true })).toBe("save");
    expect(viewSaveButton({ canSave: true, saving: true, online: true })).toBe("saving");
  });
});
