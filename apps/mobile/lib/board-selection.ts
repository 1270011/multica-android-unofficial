/**
 * How a board card reacts in and out of selection mode. On the board the long press is taken
 * (status menu, or lifting the card in the columns layout), so selection
 * starts from the header menu ⋮ → "Select". While it is on, dragging is
 * off, a tap toggles the card instead of opening the issue, and the long
 * press and the TalkBack column moves are gone: status changes go through
 * the batch bar instead.
 */
import type { BoardMode } from "@/lib/board";

export interface BoardCardInteraction {
  /** Long press lifts the card (drag & drop). */
  drag: boolean;
  /** What a tap does. */
  tap: "open" | "toggle";
  /** Long press / TalkBack action opens the status menu. */
  statusMenu: boolean;
  /** TalkBack "move to next / previous column". */
  columnMoves: boolean;
}

export function boardCardInteraction(selecting: boolean, mode: BoardMode): BoardCardInteraction {
  if (selecting) return { drag: false, tap: "toggle", statusMenu: false, columnMoves: false };
  return { drag: mode === "columns", tap: "open", statusMenu: true, columnMoves: true };
}
