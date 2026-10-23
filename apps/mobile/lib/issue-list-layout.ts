/**
 * Layout decisions of the "My Issues" list.
 *
 * Low windows (small phone in landscape, 640×384 dp): the tabs, the view
 * bar, the filter chips and the sort row scroll with the list (`ListHeaderComponent`)
 * instead of staying on top, so at least three rows remain visible, also
 * with the selection bar at the bottom. Same height threshold as the
 * two-pane detail (`TWO_PANE_MIN_HEIGHT_DP`, Android's medium height class).
 * Portrait is unchanged.
 */
import { TWO_PANE_MIN_HEIGHT_DP } from "./breakpoints";

export const SCROLLING_CONTROLS_MAX_HEIGHT_DP = TWO_PANE_MIN_HEIGHT_DP;

/** True when the list controls should scroll with the list rows. */
export function listControlsScroll(windowHeight: number, viewMode: "list" | "board"): boolean {
  // The board scrolls sideways; its columns keep the fixed controls.
  return viewMode === "list" && windowHeight < SCROLLING_CONTROLS_MAX_HEIGHT_DP;
}

/**
 * Empty state "Leer, mit Filter": text plus the button "Filter zurücksetzen".
 * Without filters there is nothing to reset, so no button.
 */
export function showResetFilters(empty: boolean, activeFilterCount: number): boolean {
  return empty && activeFilterCount > 0;
}
