import { describe, expect, it, vi } from "vitest";
import {
  bulkSelectionReducer,
  bulkToast,
  disableSequentially,
  isBulkSelectable,
  pruneSelection,
  selectedRows,
  selectionAfterBulk,
  toggleSelection,
} from "./wakeup-bulk";

const row = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    issue_id: `issue-${id}`,
    enabled: true,
    can_manage: true,
    rule: null,
    source: "member",
    ...over,
  }) as Parameters<typeof isBulkSelectable>[0] & { issue_id: string };

describe("isBulkSelectable", () => {
  it("allows an enabled rule the user can manage", () => {
    expect(isBulkSelectable(row("a"))).toBe(true);
  });

  it("rejects rows without can_manage, after a 403, switched off or system rows", () => {
    expect(isBulkSelectable(row("a", { can_manage: false }))).toBe(false);
    expect(isBulkSelectable(row("a"), true)).toBe(false);
    expect(isBulkSelectable(row("a", { enabled: false }))).toBe(false);
    expect(isBulkSelectable(row("a", { rule: "child_done" }))).toBe(false);
    expect(isBulkSelectable(row("a", { source: "system" }))).toBe(false);
  });
});

describe("toggleSelection", () => {
  it("adds and removes a row", () => {
    const one = toggleSelection(new Set(), row("a"));
    expect([...one]).toEqual(["a"]);
    expect([...toggleSelection(one, row("a"))]).toEqual([]);
  });

  it("never adds a row without can_manage", () => {
    expect(toggleSelection(new Set(), row("a", { can_manage: false })).size).toBe(0);
  });

  it("still removes a row that became unselectable", () => {
    expect(toggleSelection(new Set(["a"]), row("a", { enabled: false })).size).toBe(0);
  });
});

describe("pruneSelection", () => {
  it("drops ids that left the list or were switched off", () => {
    const sel = new Set(["a", "b", "c"]);
    const next = pruneSelection(sel, [row("a"), row("b", { enabled: false })]);
    expect([...next]).toEqual(["a"]);
  });

  it("drops rows the server answered 403 for", () => {
    expect([...pruneSelection(new Set(["a"]), [row("a")], new Set(["a"]))]).toEqual([]);
  });

  it("returns the same set when nothing changed", () => {
    const sel = new Set(["a"]);
    expect(pruneSelection(sel, [row("a"), row("b")])).toBe(sel);
  });
});

describe("selectedRows", () => {
  it("keeps list order", () => {
    const rows = [row("a"), row("b"), row("c")];
    expect(selectedRows(rows, new Set(["c", "a"])).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("disableSequentially", () => {
  it("runs the requests one after another with the row's issue id", async () => {
    let running = 0;
    const calls: string[] = [];
    const disable = vi.fn(async (issueId: string, id: string) => {
      running += 1;
      expect(running).toBe(1);
      calls.push(`${issueId}/${id}`);
      await Promise.resolve();
      running -= 1;
    });
    await disableSequentially([row("a"), row("b")], disable);
    expect(calls).toEqual(["issue-a/a", "issue-b/b"]);
  });

  it("partial success: failed rows are reported and stay selected", async () => {
    const forbidden = Object.assign(new Error("no"), { status: 403 });
    const disable = vi.fn(async (_issueId: string, id: string) => {
      if (id === "b") throw new Error("boom");
      if (id === "c") throw forbidden;
    });
    const result = await disableSequentially(
      [row("a"), row("b"), row("c"), row("d")],
      disable,
      (err) => (err as { status?: number }).status === 403,
    );
    expect(result).toEqual({ succeeded: ["a", "d"], failed: ["b", "c"], forbidden: ["c"] });
    expect([...selectionAfterBulk(result)]).toEqual(["b", "c"]);
    expect(bulkToast(result)).toEqual({
      key: "wakeups.bulk.toast_partial",
      values: { count: 2, ok: 2, total: 4 },
    });
  });

  it("full success empties the selection", async () => {
    const result = await disableSequentially([row("a"), row("b")], async () => undefined);
    expect(selectionAfterBulk(result).size).toBe(0);
    expect(bulkToast(result)).toEqual({
      key: "wakeups.bulk.toast_done",
      values: { count: 2, ok: 2, total: 2 },
    });
  });
});

describe("bulkSelectionReducer", () => {
  it("cancel empties the selection", () => {
    let sel: ReadonlySet<string> = new Set();
    sel = bulkSelectionReducer(sel, { type: "toggle", row: row("a") });
    sel = bulkSelectionReducer(sel, { type: "toggle", row: row("b") });
    expect(sel.size).toBe(2);
    expect(bulkSelectionReducer(sel, { type: "cancel" }).size).toBe(0);
  });

  it("result keeps only the failed rows selected", () => {
    const sel = new Set(["a", "b", "c"]);
    expect([...bulkSelectionReducer(sel, { type: "result", result: { failed: ["b"] } })]).toEqual(["b"]);
  });

  it("toggle ignores rows without can_manage", () => {
    const sel = bulkSelectionReducer(new Set(), { type: "toggle", row: row("a", { can_manage: false }) });
    expect(sel.size).toBe(0);
  });

  it("prune after a refetch drops switched-off rows", () => {
    const sel = new Set(["a", "b"]);
    const next = bulkSelectionReducer(sel, { type: "prune", rows: [row("a"), row("b", { enabled: false })] });
    expect([...next]).toEqual(["a"]);
  });
});
