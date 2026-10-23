/**
 * Render window of the issue chat.
 *
 * Re-opening a long issue committed the whole cached timeline in
 * one block of ~300 ms before the first frame. The list starts at the
 * bottom, so the first commit only needs the rows the reader sees there:
 * the last `CHAT_WINDOW_SIZE` rows.
 *
 * Older rows are no longer prepended all at once: handing
 * FlashList all 1122 rows of a long issue in one transition cost 0.6–2.8 s per
 * commit (the whole head was laid out again under
 * `maintainVisibleContentPosition`). The window now grows in blocks of
 * `CHAT_WINDOW_STEP` rows: when the reader scrolls near its top
 * (`onStartReached`), one frame per block toward a landing target (`?comment=`,
 * unread divider, quote root), and slowly while idle when a screen reader is
 * on. No commit after the first one adds more than `CHAT_WINDOW_STEP` rows.
 *
 * The window is always a suffix of the rows (never a slice in the middle):
 * then rows only ever get prepended, nothing below the reader appears late
 * and pulls the bottom-follow. A landing target just above the first window
 * (within one block) widens the first commit so the common unread divider
 * lands without extra frames; older targets are reached block by block.
 *
 * The window never loses rows at its top while it is shown: when
 * the data changes (cache → server sync brings one new entry), `keepFromId`
 * — the first row of the window on screen — keeps the start, so rows are
 * only appended. Dropping the top row shifted every index, FlashList
 * re-bound its cells for a frame (a bubble showed another comment) and the
 * bottom position jumped. If that row disappears (a system group expanded
 * into its lines), `keepFromEnd` keeps the window's length instead.
 *
 * The first window is small: that issue's last 25 rows were estimated at
 * ~2100 px and measured at ~6600 px after `onLoad`; FlashList spent 0.5–0.9 s
 * of JS on that before the cover could go. While the cover stands and while
 * a landing is anchored, `onStartReached` does not grow the window
 * (`WindowGrowthGate`); the held-back block comes once the cover is gone
 * (end) or the reader drags (landing), so the landing is not pushed away by
 * rows prepended under it.
 */

import type { ChatItem } from "@/lib/issue-chat";

/** Rows committed on the first render: a phone screen shows ~4–8 bubbles
 *  (rows of a long issue average ~260 px), the cover 6 (was 25). */
export const CHAT_WINDOW_SIZE = 10;
/** Rows kept above a landing target. */
export const CHAT_WINDOW_LEAD = 5;
/** Rows prepended per later commit (at most ~100). */
export const CHAT_WINDOW_STEP = 75;
/** Idle fill while a screen reader is on: small blocks, spaced out. */
export const CHAT_IDLE_STEP = 50;
export const CHAT_IDLE_MS = 400;

export interface ChatWindowOptions {
  focusId?: string | null;
  size?: number;
  /** First row of the window already on screen; the start never passes it. */
  keepFromId?: string | null;
  /** Window length to keep when `keepFromId` is no longer in the rows. */
  keepFromEnd?: number | null;
}

/** Index of the first row to render. */
export function chatWindowStart(
  items: readonly Pick<ChatItem, "id">[],
  opts: ChatWindowOptions,
): number {
  const size = opts.size ?? CHAT_WINDOW_SIZE;
  let start = Math.max(0, items.length - size);
  if (opts.focusId && start > 0) {
    const focus = items.findIndex((i) => i.id === opts.focusId);
    // Only a target within one block above: older ones grow block by block.
    if (focus >= 0 && focus < start + CHAT_WINDOW_LEAD && focus >= start - CHAT_WINDOW_STEP) {
      start = Math.max(0, focus - CHAT_WINDOW_LEAD);
    }
  }
  if (opts.keepFromId && start > 0) {
    const kept = items.findIndex((i) => i.id === opts.keepFromId);
    if (kept >= 0) {
      if (kept < start) start = kept;
    } else if (opts.keepFromEnd) {
      start = Math.min(start, Math.max(0, items.length - opts.keepFromEnd));
    }
  }
  return start;
}

/** Rows to hand to the list: the window, or `items` itself (same reference)
 *  when nothing is cut, so the list does not see a new array for nothing. */
export function chatWindow<T extends Pick<ChatItem, "id">>(
  items: T[],
  opts: ChatWindowOptions,
): T[] {
  const start = chatWindowStart(items, opts);
  return start === 0 ? items : items.slice(start);
}

/** Start after one more block above `start` (0 = everything rendered). */
export function grownWindowStart(start: number, step = CHAT_WINDOW_STEP): number {
  return Math.max(0, start - step);
}

/**
 * Next start on the way to row `id` (with `CHAT_WINDOW_LEAD` rows above it),
 * at most one block per call; `null` when the window already holds it or the
 * row does not exist.
 */
export function windowStepTowards(
  items: readonly Pick<ChatItem, "id">[],
  start: number,
  id: string,
  step = CHAT_WINDOW_STEP,
): number | null {
  const index = items.findIndex((i) => i.id === id);
  if (index < 0) return null;
  const want = Math.max(0, index - CHAT_WINDOW_LEAD);
  if (start <= want) return null;
  return Math.max(want, start - step);
}

/**
 * Holds the window's growth while the cover stands or a landing is anchored
 *`request` says whether a growth may run now and remembers it
 * otherwise; `release` says once, after the hold ended, that one was held back.
 */
export class WindowGrowthGate {
  private pending = false;

  constructor(private readonly held: () => boolean) {}

  request(): boolean {
    if (!this.held()) return true;
    this.pending = true;
    return false;
  }

  release(): boolean {
    if (!this.pending || this.held()) return false;
    this.pending = false;
    return true;
  }
}
