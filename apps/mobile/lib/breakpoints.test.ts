// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 0, height: 0 }) }));

import {
  breakpointFor,
  contentWidthFor,
  NAV_RAIL_MIN_DP,
  NAV_RAIL_WIDTH_DP,
  READING_MAX_WIDTH_DP,
  TWO_PANE_MIN_CONTENT_DP,
  TWO_PANE_MIN_HEIGHT_DP,
  twoPaneFor,
  windowClassFor,
} from "./breakpoints";
import { leftPaneWidth, MIN_PANE_DP } from "./issue-detail-layout";

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
    // low for the two-pane detail.
    expect(breakpointFor(914, 411)).toMatchObject({ windowClass: "expanded", landscape: true, twoPane: false });
    expect(breakpointFor(780, 360)).toMatchObject({ windowClass: "medium", landscape: true, twoPane: false });
  });

  it("two panes from 600 dp wide and 480 dp tall, in either orientation", () => {
    expect(TWO_PANE_MIN_CONTENT_DP).toBe(560);
    expect(TWO_PANE_MIN_HEIGHT_DP).toBe(480);
    expect(breakpointFor(600, 960)).toMatchObject({ windowClass: "medium", twoPane: true });
    expect(breakpointFor(800, 1280).twoPane).toBe(true);
    expect(breakpointFor(840, 1200).twoPane).toBe(true);
    expect(breakpointFor(1280, 800).twoPane).toBe(true);
    expect(breakpointFor(1280, 479).twoPane).toBe(false);
    expect(breakpointFor(599, 1200).twoPane).toBe(false);
  });

  it("phones stay single-pane: < 600 dp wide or < 480 dp tall", () => {
    expect(breakpointFor(411, 914).twoPane).toBe(false);
    expect(breakpointFor(599.9, 900).twoPane).toBe(false);
    // Phone landscape and a short split-screen half.
    expect(breakpointFor(914, 411).twoPane).toBe(false);
    expect(breakpointFor(700, 400).twoPane).toBe(false);
  });

  it("navigation rail and reading width limits", () => {
    expect(NAV_RAIL_MIN_DP).toBe(600);
    expect(READING_MAX_WIDTH_DP).toBe(720);
  });
});

describe("issue detail pane widths", () => {
  const split = (w: number) => [leftPaneWidth(w), w - leftPaneWidth(w)];

  it("600 dp → 300 / 300, 800 dp → 360 / 440, 1280 dp → 42 %", () => {
    expect(split(600)).toEqual([300, 300]);
    expect(split(800)).toEqual([360, 440]);
    expect(split(1280)).toEqual([538, 742]);
  });

  it("both panes get at least 280 dp from 600 dp on", () => {
    for (let w = 600; w <= 2000; w += 10) {
      const [left, right] = split(w);
      expect(left).toBeGreaterThanOrEqual(MIN_PANE_DP);
      expect(right).toBeGreaterThanOrEqual(MIN_PANE_DP);
    }
  });
});

describe("two panes by content width beside the rail", () => {
  // Content width of a screen beside the navigation rail.
  const beside = (w: number, h: number) => twoPaneFor(contentWidthFor(w, true), w, h);

  it("the rail takes 96 dp from 600 dp on, nothing on phones", () => {
    expect(NAV_RAIL_WIDTH_DP).toBe(96);
    expect(contentWidthFor(599, true)).toBe(599);
    expect(contentWidthFor(600, true)).toBe(504);
    expect(contentWidthFor(800, true)).toBe(704);
    expect(contentWidthFor(800, false)).toBe(800);
  });

  it("600 dp: rail + one pane, from 656 dp two panes, 800 / 1280 dp two panes", () => {
    expect(beside(600, 960)).toBe(false);
    expect(beside(655, 960)).toBe(false);
    expect(beside(656, 960)).toBe(true);
    expect(beside(800, 1280)).toBe(true);
    expect(beside(1280, 800)).toBe(true);
    expect(beside(1280, 479)).toBe(false);
  });

  it("without a rail beside it the whole window counts, phones stay single", () => {
    expect(twoPaneFor(600, 600, 960)).toBe(true);
    expect(twoPaneFor(580, 580, 960)).toBe(false);
  });

  it("both panes keep ≥ 280 dp whenever two panes show", () => {
    for (let w = 600; w <= 2000; w += 4) {
      const content = contentWidthFor(w, true);
      if (!twoPaneFor(content, w, 900)) continue;
      expect(leftPaneWidth(content)).toBeGreaterThanOrEqual(MIN_PANE_DP);
      expect(content - leftPaneWidth(content)).toBeGreaterThanOrEqual(MIN_PANE_DP);
    }
  });
});
