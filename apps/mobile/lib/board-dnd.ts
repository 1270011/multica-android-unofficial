/**
 * Drag & drop on the issue board in landscape and on
 * tablets: pure geometry and payload, tested in
 * lib/board-dnd.test.ts. The gesture lives in components/issue/board.
 *
 * - Only in the "columns" layout (≥ 600 dp: landscape, tablet). Portrait
 *   keeps the long-press sheet; a drag gesture there would fight the pager.
 * - The drag starts after a long press (DRAG_ACTIVATE_MS), so a quick swipe
 *   still scrolls the board or a column.
 * - Dropping on another column changes the status through
 *   `useBoardStatusChange` (data/mutations/board-status.ts, payload
 *   `statusMoveBody`: no `before_id`/`after_id`). A position is only for a
 *   manual sort order; the board sorts newest first and mobile has no
 *   manual sort, so a drop never reorders.
 *   Without neighbour ids the server keeps the card's position, so Undo
 *   restores it exactly.
 */
import type { IssueStatus } from "@multica/core/types";

/** Hold time before a card lifts; shorter than the 400 ms menu long press. */
export const DRAG_ACTIVATE_MS = 350;
/** Distance from the board edge that scrolls the board while dragging. */
export const AUTO_SCROLL_EDGE_DP = 56;
export const AUTO_SCROLL_MAX_STEP_DP = 18;
/** Movement below this counts as "held, not dragged" → open the menu. */
export const DRAG_TAP_SLOP_DP = 12;

export interface ColumnsGeometry {
  /** Left padding of the horizontal scroll content (px-3). */
  paddingLeft: number;
  columnWidth: number;
  /** Gap between columns (gap-3). */
  gap: number;
  count: number;
}

/**
 * Column under a point, `x` in scroll-content coordinates (finger x within
 * the board + horizontal scroll offset). A point in a gap belongs to the
 * nearer column; left of the first or right of the last column is none.
 */
export function columnIndexAt(x: number, g: ColumnsGeometry): number | null {
  if (g.count <= 0 || g.columnWidth <= 0) return null;
  const local = x - g.paddingLeft;
  const pitch = g.columnWidth + g.gap;
  if (local < -g.gap / 2) return null;
  const index = Math.floor((local + g.gap / 2) / pitch);
  if (index >= g.count) {
    // Still over the last column's right half-gap? Then it is the last one.
    return local <= (g.count - 1) * pitch + g.columnWidth + g.gap / 2 ? g.count - 1 : null;
  }
  return Math.max(0, index);
}

/**
 * Board scroll step while the finger is near an edge: negative = left.
 * Grows linearly from 0 at the edge zone's inner border to the max step at
 * the board edge.
 */
export function autoScrollStep(
  xInBoard: number,
  viewportWidth: number,
  edge: number = AUTO_SCROLL_EDGE_DP,
  maxStep: number = AUTO_SCROLL_MAX_STEP_DP,
): number {
  if (viewportWidth <= 0) return 0;
  if (xInBoard < edge) {
    return -Math.round(maxStep * Math.min(1, (edge - xInBoard) / edge));
  }
  const fromRight = viewportWidth - xInBoard;
  if (fromRight < edge) {
    return Math.round(maxStep * Math.min(1, (edge - fromRight) / edge));
  }
  return 0;
}

/** Clamp a scroll offset to the scrollable range. */
export function clampScroll(x: number, contentWidth: number, viewportWidth: number): number {
  return Math.max(0, Math.min(x, Math.max(0, contentWidth - viewportWidth)));
}

/** What releasing a lifted card does. */
export type DropOutcome =
  | { kind: "move"; to: IssueStatus }
  | { kind: "menu" }
  | { kind: "none" };

/**
 * Released over another column → move. Released where it started without
 * really moving → the status menu (the long press still works as in
 * portrait). Anything else (dragged around, back to its column or off the
 * board) → nothing.
 */
export function dropOutcome(
  from: IssueStatus,
  target: IssueStatus | null,
  distance: number,
): DropOutcome {
  if (target && target !== from) return { kind: "move", to: target };
  if (distance < DRAG_TAP_SLOP_DP) return { kind: "menu" };
  return { kind: "none" };
}

export type PanUpdateAction = "ignore" | "start" | "stop" | "keep";

/**
 * What a pan update does. Once the reset effect dropped the drag (rotation,
 * card moved by a refetch), late updates are ignored: no floating card, no
 * hover, and no auto-scroll timer that would scroll a board without a drag
 * (`alive`). Otherwise the edge step starts or stops the timer.
 */
export function panUpdateAction(alive: boolean, step: number, timerRunning: boolean): PanUpdateAction {
  if (!alive) return "ignore";
  if (step === 0) return timerRunning ? "stop" : "keep";
  return timerRunning ? "keep" : "start";
}
