// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 0, height: 0 }) }));

import {
  listControlsScroll,
  SCROLLING_CONTROLS_MAX_HEIGHT_DP,
  showResetFilters,
} from "./issue-list-layout";

describe("listControlsScroll", () => {
  it("scrolls the controls with the list below 480 dp height (small phone landscape)", () => {
    expect(SCROLLING_CONTROLS_MAX_HEIGHT_DP).toBe(480);
    expect(listControlsScroll(384, "list")).toBe(true);
    expect(listControlsScroll(479.9, "list")).toBe(true);
  });

  it("keeps them fixed in portrait and on tall windows", () => {
    expect(listControlsScroll(480, "list")).toBe(false);
    expect(listControlsScroll(640, "list")).toBe(false);
    expect(listControlsScroll(914, "list")).toBe(false);
  });

  it("keeps them fixed on the board, which scrolls sideways", () => {
    expect(listControlsScroll(384, "board")).toBe(false);
  });
});

describe("showResetFilters", () => {
  it("shows the reset button only for an empty list with active filters", () => {
    expect(showResetFilters(true, 1)).toBe(true);
    expect(showResetFilters(true, 3)).toBe(true);
  });

  it("hides it without filters or with rows", () => {
    expect(showResetFilters(true, 0)).toBe(false);
    expect(showResetFilters(false, 2)).toBe(false);
    expect(showResetFilters(false, 0)).toBe(false);
  });
});
