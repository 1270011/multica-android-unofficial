/**
 * Window-size classes for layouts that change with width.
 * Same width thresholds as Android's window size classes:
 *
 *   compact  < 600 dp   phone portrait — one board column (pager)
 *   medium   < 840 dp   small phone landscape, small tablet — several columns
 *   expanded ≥ 840 dp   tablet, and most phones in landscape (Pixel 7: 914 dp)
 *
 * Width alone decides the board columns (docs/ux/kanban.md: several columns
 * from 600 dp, phones in landscape included). The two-pane issue detail
 * (package I) additionally needs a height of at least 480 dp (Android's
 * medium height class), so a phone in landscape keeps the single pane.
 *
 * React Native's window width is already in dp, so no density math here.
 * The board (package C) and the tablet detail read these instead of their
 * own magic numbers.
 */
import { useWindowDimensions } from "react-native";

export const COMPACT_MAX_DP = 600;
/** From this width the issue detail shows two panes … */
export const TWO_PANE_MIN_DP = 840;
/** … when the window is also at least this tall. */
export const TWO_PANE_MIN_HEIGHT_DP = 480;

export type WindowClass = "compact" | "medium" | "expanded";

export function windowClassFor(widthDp: number): WindowClass {
  if (widthDp < COMPACT_MAX_DP) return "compact";
  if (widthDp < TWO_PANE_MIN_DP) return "medium";
  return "expanded";
}

export interface Breakpoint {
  windowClass: WindowClass;
  width: number;
  height: number;
  landscape: boolean;
  /** Issue detail side by side (≥ 840 dp wide and ≥ 480 dp tall). */
  twoPane: boolean;
}

export function breakpointFor(width: number, height: number): Breakpoint {
  const windowClass = windowClassFor(width);
  return {
    windowClass,
    width,
    height,
    landscape: width > height,
    twoPane: windowClass === "expanded" && height >= TWO_PANE_MIN_HEIGHT_DP,
  };
}

/** Re-renders on rotation, split screen and window resizes. */
export function useBreakpoint(): Breakpoint {
  const { width, height } = useWindowDimensions();
  return breakpointFor(width, height);
}
