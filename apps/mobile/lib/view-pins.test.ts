import { describe, expect, it, vi } from "vitest";
import type { PinnedItem } from "@multica/core/types";
import {
  isAlreadyPinned,
  isViewPinned,
  openPinnedView,
  pinnedViewHref,
  pinnedViewTarget,
  viewRowActions,
} from "./view-pins";

const pin = (item_type: PinnedItem["item_type"], item_id: string): PinnedItem => ({
  id: `p-${item_id}`,
  workspace_id: "ws-1",
  user_id: "u-1",
  item_type,
  item_id,
  position: 1,
  created_at: "",
});

describe("isViewPinned", () => {
  it("matches only view pins with the id", () => {
    const pins = [pin("issue", "v-1"), pin("view", "v-2")];
    expect(isViewPinned(pins, "v-2")).toBe(true);
    expect(isViewPinned(pins, "v-1")).toBe(false);
    expect(isViewPinned(undefined, "v-2")).toBe(false);
  });
});

describe("isAlreadyPinned", () => {
  it("is true for 409 only", () => {
    expect(isAlreadyPinned({ status: 409 })).toBe(true);
    expect(isAlreadyPinned({ status: 500 })).toBe(false);
    expect(isAlreadyPinned(new Error("x"))).toBe(false);
    expect(isAlreadyPinned(null)).toBe(false);
  });
});

describe("pinnedViewTarget / pinnedViewHref", () => {
  it.each([
    [{ scope_type: "my", scope_id: null }, { kind: "my-issues" }],
    [{ scope_type: "workspace", scope_id: null }, { kind: "my-issues" }],
    [{ scope_type: "project", scope_id: "p-1" }, { kind: "project", projectId: "p-1" }],
    // A project view without project id, or a scope from a newer server,
    // degrades to My Issues like the web sidebar.
    [{ scope_type: "project", scope_id: null }, { kind: "my-issues" }],
    [{ scope_type: "team", scope_id: "t-1" }, { kind: "my-issues" }],
  ])("%j → %j", (view, target) => {
    expect(pinnedViewTarget(view)).toEqual(target);
  });

  it("builds typed routes", () => {
    expect(pinnedViewHref({ kind: "my-issues" }, "acme")).toEqual({
      pathname: "/[workspace]/my-issues",
      params: { workspace: "acme" },
    });
    expect(pinnedViewHref({ kind: "project", projectId: "p-1" }, "acme")).toEqual({
      pathname: "/[workspace]/project/[id]",
      params: { workspace: "acme", id: "p-1" },
    });
  });
});

describe("openPinnedView", () => {
  const deps = (outcome: "apply" | "gone" | "error") => ({
    applyView: vi.fn(async () => outcome),
    navigate: vi.fn(),
  });

  it("applies a My-Issues view, then opens My Issues", async () => {
    const d = deps("apply");
    const order: string[] = [];
    d.applyView.mockImplementation(async () => (order.push("apply"), "apply"));
    d.navigate.mockImplementation(() => order.push("navigate"));
    const ok = await openPinnedView({ id: "v-1", scope_type: "my", scope_id: null }, "acme", d);
    expect(ok).toBe(true);
    expect(d.applyView).toHaveBeenCalledWith("v-1");
    expect(d.navigate).toHaveBeenCalledWith({
      pathname: "/[workspace]/my-issues",
      params: { workspace: "acme" },
    });
    // Filters are in place before the list opens.
    expect(order).toEqual(["apply", "navigate"]);
  });

  it.each(["gone", "error"] as const)("stays put when the view is %s", async (outcome) => {
    const d = deps(outcome);
    const ok = await openPinnedView(
      { id: "v-1", scope_type: "workspace", scope_id: null },
      "acme",
      d,
    );
    expect(ok).toBe(false);
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it("opens the project of a project view without applying", async () => {
    const d = deps("apply");
    await openPinnedView({ id: "v-2", scope_type: "project", scope_id: "p-1" }, "acme", d);
    expect(d.applyView).not.toHaveBeenCalled();
    expect(d.navigate).toHaveBeenCalledWith({
      pathname: "/[workspace]/project/[id]",
      params: { workspace: "acme", id: "p-1" },
    });
  });
});

describe("viewRowActions", () => {
  it("offers only pin/unpin to who may not manage the view", () => {
    expect(viewRowActions(false, false)).toEqual(["pin"]);
    expect(viewRowActions(true, false)).toEqual(["unpin"]);
  });

  it("adds edit for who may manage the view", () => {
    expect(viewRowActions(false, true)).toEqual(["pin", "edit"]);
    expect(viewRowActions(true, true)).toEqual(["unpin", "edit"]);
  });
});
