// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 0, height: 0 }) }));

import { breakpointFor, TWO_PANE_MIN_DP, TWO_PANE_MIN_HEIGHT_DP, windowClassFor } from "./breakpoints";

describe("windowClassFor", () => {
  it("uses 600 / 840 dp as boundaries (lower bound inclusive)", () => {
    expect(windowClassFor(360)).toBe("compact");
    expect(windowClassFor(599.9)).toBe("compact");
    expect(windowClassFor(600)).toBe("medium");
    expect(windowClassFor(839)).toBe("medium");
    expect(windowClassFor(840)).toBe("expanded");
    expect(windowClassFor(1280)).toBe("expanded");
  });
});

describe("breakpointFor", () => {
  it("phone portrait → compact; phone landscape → wide class by width, never two panes", () => {
    expect(breakpointFor(411, 914)).toMatchObject({ windowClass: "compact", landscape: false, twoPane: false });
    // Pixel 7 landscape: expanded by width (board: several columns), but too
    // low for the two-pane detail (review #16).
    expect(breakpointFor(914, 411)).toMatchObject({ windowClass: "expanded", landscape: true, twoPane: false });
    expect(breakpointFor(780, 360)).toMatchObject({ windowClass: "medium", landscape: true, twoPane: false });
  });

  it("two panes from 840 dp wide and 480 dp tall, in either orientation", () => {
    expect(TWO_PANE_MIN_DP).toBe(840);
    expect(TWO_PANE_MIN_HEIGHT_DP).toBe(480);
    expect(breakpointFor(840, 1200).twoPane).toBe(true);
    expect(breakpointFor(1280, 800).twoPane).toBe(true);
    expect(breakpointFor(1280, 479).twoPane).toBe(false);
    expect(breakpointFor(839, 1200).twoPane).toBe(false);
  });
});
