import { describe, expect, it } from "vitest";
import { boardCardInteraction } from "./board-selection";
import type { BoardMode } from "./board";

const MODES: BoardMode[] = ["pager", "selector", "columns"];

describe("boardCardInteraction", () => {
  it("opens the issue and keeps drag only in the columns layout outside selection", () => {
    expect(boardCardInteraction(false, "columns")).toEqual({
      drag: true,
      tap: "open",
      statusMenu: true,
      columnMoves: true,
    });
    expect(boardCardInteraction(false, "pager").drag).toBe(false);
    expect(boardCardInteraction(false, "selector").drag).toBe(false);
  });

  it.each(MODES)("in selection mode a tap toggles and drag is locked (%s)", (mode) => {
    expect(boardCardInteraction(true, mode)).toEqual({
      drag: false,
      tap: "toggle",
      statusMenu: false,
      columnMoves: false,
    });
  });
});
