import { describe, expect, it } from "vitest";
import {
  autoScrollStep,
  panUpdateAction,
  clampScroll,
  columnIndexAt,
  dropOutcome,
  DRAG_TAP_SLOP_DP,
  type ColumnsGeometry,
} from "./board-dnd";

// Board "columns" layout: px-3 (12) padding, gap-3 (12), 280 dp columns.
const G: ColumnsGeometry = { paddingLeft: 12, columnWidth: 280, gap: 12, count: 3 };

describe("columnIndexAt (drop target)", () => {
  it("maps points inside a column to that column", () => {
    expect(columnIndexAt(12, G)).toBe(0);
    expect(columnIndexAt(291, G)).toBe(0);
    expect(columnIndexAt(304, G)).toBe(1);
    expect(columnIndexAt(12 + 2 * 292 + 279, G)).toBe(2);
  });

  it("splits a gap between its two neighbours", () => {
    // Gap between column 0 (ends at 292) and column 1 (starts at 304).
    expect(columnIndexAt(297, G)).toBe(0);
    expect(columnIndexAt(299, G)).toBe(1);
  });

  it("returns none left of the first and right of the last column", () => {
    expect(columnIndexAt(8, G)).toBe(0); // within the half gap before column 0
    expect(columnIndexAt(5, G)).toBeNull(); // further out
    expect(columnIndexAt(-20, G)).toBeNull();
    expect(columnIndexAt(12 + 3 * 292 + 20, G)).toBeNull();
    expect(columnIndexAt(100, { ...G, count: 0 })).toBeNull();
  });

  it("uses content coordinates, so a scrolled board still hits the right column", () => {
    const scrollX = 292; // scrolled by one column
    const fingerInBoard = 100;
    expect(columnIndexAt(fingerInBoard + scrollX, G)).toBe(1);
  });
});

describe("autoScrollStep", () => {
  it("scrolls left near the left edge, right near the right edge, else not", () => {
    expect(autoScrollStep(0, 800)).toBe(-18);
    expect(autoScrollStep(28, 800)).toBe(-9);
    expect(autoScrollStep(400, 800)).toBe(0);
    expect(autoScrollStep(790, 800)).toBeGreaterThan(0);
    expect(autoScrollStep(800, 800)).toBe(18);
    expect(autoScrollStep(10, 0)).toBe(0);
  });

  it("clamps the scroll offset to the content", () => {
    expect(clampScroll(-10, 1200, 800)).toBe(0);
    expect(clampScroll(500, 1200, 800)).toBe(400);
    expect(clampScroll(100, 600, 800)).toBe(0);
  });
});

describe("dropOutcome", () => {
  it("moves when released over another column", () => {
    expect(dropOutcome("todo", "done", 300)).toEqual({ kind: "move", to: "done" });
  });
  it("opens the menu when held without moving (long press as in portrait)", () => {
    expect(dropOutcome("todo", "todo", DRAG_TAP_SLOP_DP - 1)).toEqual({ kind: "menu" });
    expect(dropOutcome("todo", null, 0)).toEqual({ kind: "menu" });
  });
  it("does nothing when dragged back to its column or off the board", () => {
    expect(dropOutcome("todo", "todo", 200)).toEqual({ kind: "none" });
    expect(dropOutcome("todo", null, 200)).toEqual({ kind: "none" });
  });
});

describe("panUpdateAction (alive check in onUpdate)", () => {
  it("ignores late updates after the reset dropped the drag", () => {
    expect(panUpdateAction(false, 10, false)).toBe("ignore");
    expect(panUpdateAction(false, 0, true)).toBe("ignore");
  });
  it("starts and stops the auto-scroll timer at the edges", () => {
    expect(panUpdateAction(true, 10, false)).toBe("start");
    expect(panUpdateAction(true, 10, true)).toBe("keep");
    expect(panUpdateAction(true, 0, true)).toBe("stop");
    expect(panUpdateAction(true, 0, false)).toBe("keep");
  });
});
