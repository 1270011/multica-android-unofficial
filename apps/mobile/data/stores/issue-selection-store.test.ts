import { beforeEach, describe, expect, it } from "vitest";
import { allSelected, useIssueSelectionStore } from "./issue-selection-store";

const state = () => useIssueSelectionStore.getState();

describe("useIssueSelectionStore", () => {
  beforeEach(() => state().reset());

  it("begins empty from the header menu (board, D5b) and toggles cards", () => {
    state().begin();
    expect(state()).toMatchObject({ active: true, ids: [] });
    state().toggle("a");
    state().toggle("b");
    expect(state().ids).toEqual(["a", "b"]);
    state().toggle("a");
    expect(state().ids).toEqual(["b"]);
    state().reset();
    expect(state()).toMatchObject({ active: false, ids: [] });
  });

  it("starts with the long-pressed issue and toggles rows", () => {
    state().start("a");
    expect(state().active).toBe(true);
    expect(state().ids).toEqual(["a"]);
    state().toggle("b");
    state().toggle("a");
    expect(state().ids).toEqual(["b"]);
    // An empty selection keeps the mode on; only reset ends it.
    state().toggle("b");
    expect(state()).toMatchObject({ active: true, ids: [] });
  });

  it("filter change keeps only visible issues", () => {
    state().start("a");
    state().toggle("b");
    state().toggle("c");
    state().prune(["c", "a", "x"]);
    expect(state().ids).toEqual(["a", "c"]);
    expect(state().active).toBe(true);
  });

  it("prune with nothing removed keeps the same array", () => {
    state().start("a");
    const before = state().ids;
    state().prune(["a", "b"]);
    expect(state().ids).toBe(before);
  });

  it("All selects every visible issue, a second tap selects none", () => {
    state().start("b");
    state().toggleAll(["a", "b", "c"]);
    expect(state().ids).toEqual(["a", "b", "c"]);
    state().toggleAll(["a", "b", "c"]);
    expect(state().ids).toEqual([]);
    expect(state().active).toBe(true);
  });

  it("All after a filter change selects the new visible set", () => {
    state().start("a");
    state().toggleAll(["a", "b"]);
    state().prune(["b", "c"]);
    expect(allSelected(state().ids, ["b", "c"])).toBe(false);
    state().toggleAll(["b", "c"]);
    expect(state().ids).toEqual(["b", "c"]);
  });

  it("reset ends the mode and clears the selection", () => {
    state().start("a");
    state().toggle("b");
    state().reset();
    expect(state()).toMatchObject({ active: false, ids: [] });
  });

  it("keeps the selection while a batch picker is open; reset clears the flag", () => {
    state().start("a");
    state().setPickerOpen(true);
    expect(state()).toMatchObject({ active: true, ids: ["a"], pickerOpen: true });
    state().setPickerOpen(false);
    expect(state()).toMatchObject({ active: true, ids: ["a"], pickerOpen: false });
    state().setPickerOpen(true);
    state().reset();
    expect(state()).toMatchObject({ active: false, ids: [], pickerOpen: false });
  });
});

describe("allSelected", () => {
  it("is false for an empty list", () => {
    expect(allSelected([], [])).toBe(false);
  });

  it("ignores selected ids that are not visible", () => {
    expect(allSelected(["a", "b", "z"], ["a", "b"])).toBe(true);
    expect(allSelected(["a"], ["a", "b"])).toBe(false);
  });
});
