/**
 * Where the workspace tabs live (Tablet B): a bottom tab bar on
 * phones, a navigation rail on the left from NAV_RAIL_MIN_DP. Pure, so the
 * switch and the More-menu placement are testable without React Native.
 */
import { NAV_RAIL_MIN_DP, NAV_RAIL_WIDTH_DP } from "./breakpoints";

export type NavMode = "tabs" | "rail";

/** Rail width without the left safe-area inset (lib/breakpoints.ts). */
export const NAV_RAIL_WIDTH = NAV_RAIL_WIDTH_DP;

// iOS/Android bottom tab bar default height above the safe area — React
// Navigation doesn't export it (bottom-tabs settles at 49).
export const TAB_BAR_HEIGHT = 49;

export function navModeFor(widthDp: number): NavMode {
  return widthDp >= NAV_RAIL_MIN_DP ? "rail" : "tabs";
}

interface Insets {
  top: number;
  bottom: number;
  left: number;
}

export interface MoreMenuPlacement {
  /** Absolute rect of the invisible trigger the popover anchors to. */
  anchor: {
    position: "absolute";
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
    width: number | `${number}%`;
    height: number;
  };
  // @rn-primitives positions popovers only above or below the trigger.
  side: "top" | "bottom";
  align: "start" | "end";
}

/**
 * Tabs: the trigger covers the More tab (right quarter of the bar), the
 * popover opens above it. Rail: a 1 dp trigger sits at the rail's top
 * right edge, so the popover opens below it, top-aligned beside the rail
 * and never covering it.
 */
export function moreMenuPlacement(mode: NavMode, insets: Insets): MoreMenuPlacement {
  if (mode === "rail") {
    return {
      anchor: {
        position: "absolute",
        left: NAV_RAIL_WIDTH + insets.left,
        top: insets.top,
        width: 1,
        height: 1,
      },
      side: "bottom",
      align: "start",
    };
  }
  return {
    anchor: {
      position: "absolute",
      right: 0,
      bottom: insets.bottom,
      width: "25%",
      height: TAB_BAR_HEIGHT,
    },
    side: "top",
    align: "end",
  };
}
