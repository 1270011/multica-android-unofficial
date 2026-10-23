/**
 * Window-size classes for layouts that change with width. Same width thresholds as Android's window size classes:
 *
 *   compact  < 600 dp   phone portrait — one board column (pager)
 *   medium   < 840 dp   small phone landscape, small tablet — several columns
 *   expanded ≥ 840 dp   tablet, and most phones in landscape (Pixel 7: 914 dp)
 *
 * Width alone decides the board columns. The two-pane issue detail
 * (package I) depends on the content width the screen really gets — the
 * window minus a navigation rail beside it: two panes from 560 dp
 * content width, so both stay ≥ 280 dp. It additionally needs a height of at
 * least 480 dp (Android's medium height class), so a phone in landscape keeps
 * the single pane.
 *
 * React Native's window width is already in dp, so no density math here.
 * The board (package C) and the tablet detail read these instead of their
 * own magic numbers.
 */
import { useWindowDimensions } from "react-native";

export const COMPACT_MAX_DP = 600;
/** Start of Android's expanded width class. */
export const EXPANDED_MIN_DP = 840;
/** From this content width the issue detail shows two panes (2 × 280 dp) … */
export const TWO_PANE_MIN_CONTENT_DP = 560;
/** … when the window is also at least this tall. */
export const TWO_PANE_MIN_HEIGHT_DP = 480;
/** From this width the side navigation rail replaces the bottom tab bar. */
export const NAV_RAIL_MIN_DP = 600;
/** Rail width without the left safe-area inset (Material rail is 80 dp; a
 *  little more so "Meine Issues" fits on two lines at large font scales). */
export const NAV_RAIL_WIDTH_DP = 96;
/** Lists and forms stay this wide at most on wide windows, centred. */
export const READING_MAX_WIDTH_DP = 720;

export type WindowClass = "compact" | "medium" | "expanded";

export function windowClassFor(widthDp: number): WindowClass {
  if (widthDp < COMPACT_MAX_DP) return "compact";
  if (widthDp < EXPANDED_MIN_DP) return "medium";
  return "expanded";
}

export interface Breakpoint {
  windowClass: WindowClass;
  width: number;
  height: number;
  landscape: boolean;
  /**
   * Issue detail side by side, assuming the whole window width is content
   * (≥ 600 dp wide and ≥ 480 dp tall). A screen beside the rail passes its
   * own content width to twoPaneFor instead.
   */
  twoPane: boolean;
}

/** Width left for a screen's content; the rail takes NAV_RAIL_WIDTH_DP. */
export function contentWidthFor(windowWidth: number, besideRail: boolean): number {
  return besideRail && windowWidth >= NAV_RAIL_MIN_DP ? windowWidth - NAV_RAIL_WIDTH_DP : windowWidth;
}

/**
 * Two panes from 560 dp content width and 480 dp window height;
 * phone windows (< 600 dp) always keep one pane.
 */
export function twoPaneFor(contentWidth: number, windowWidth: number, height: number): boolean {
  return (
    windowWidth >= COMPACT_MAX_DP &&
    contentWidth >= TWO_PANE_MIN_CONTENT_DP &&
    height >= TWO_PANE_MIN_HEIGHT_DP
  );
}

export function breakpointFor(width: number, height: number): Breakpoint {
  const windowClass = windowClassFor(width);
  return {
    windowClass,
    width,
    height,
    landscape: width > height,
    twoPane: twoPaneFor(width, width, height),
  };
}

/** Re-renders on rotation, split screen and window resizes. */
export function useBreakpoint(): Breakpoint {
  const { width, height } = useWindowDimensions();
  return breakpointFor(width, height);
}
