/**
 * Landing on a comment anchor in the issue chat.
 *
 * The chat list (FlashList v2, starts at the bottom) used to jump once with
 * `scrollToIndex({ viewPosition: 0.4 })` 250 ms after open. Two problems:
 *
 * - FlashList computes `offset - (window - item) * viewPosition`. For a
 *   comment taller than the window the term turns negative, so the list
 *   lands *inside* the comment, towards its end (tables, long reports).
 * - The jump runs on estimated row heights. Rows above the target get
 *   measured afterwards (at 200 % font scale the estimate is far off), and
 *   the list's "follow the end" autoscroll fires on that content growth
 *   while it still believes the reader is at the bottom.
 *
 * So: jump with the row's top edge at the top of the window, then re-check
 * a few times after layout and after every scroll the reader did not start
 * (a late footer such as "Runs" still pulled the list to the end at 100 %),
 * and correct; while anchored, the list never follows to the end.
 */

/** Gap between the window's top edge and the comment's top edge. */
export const ANCHOR_TOP_GAP_PX = 8;
/** A landing within this distance of the target counts as precise. */
export const ANCHOR_TOLERANCE_PX = 4;
/** Re-check times (ms after the first jump) for the post-layout correction. */
export const ANCHOR_RECHECK_MS = [120, 350, 800, 1500] as const;
/** While anchored, a scroll the reader did not start (late footer, the
 *  list's own bottom-follow) is re-checked this long after it settles. */
export const ANCHOR_SETTLE_MS = 150;
/** Scroll-triggered corrections only within this time after the jump, so a
 *  screen-reader scroll (no drag event) later on is never pulled back. */
export const ANCHOR_HOLD_MS = 5000;

/** Whether a scroll at `now` should be re-checked against the anchor. */
export function anchorHolds(anchoredAt: number | null, now: number): boolean {
  return anchoredAt !== null && now - anchoredAt < ANCHOR_HOLD_MS;
}

/** Arguments for the first, estimate-based jump. Non-animated: an animated
 *  native scroll races the list's own offset corrections. */
export function anchorScrollParams(index: number) {
  return {
    index,
    animated: false,
    viewPosition: 0,
    viewOffset: -ANCHOR_TOP_GAP_PX,
  } as const;
}

export interface AnchorMeasure {
  /** Row top inside the list content (`getLayout(index).y`). */
  itemTop: number;
  /** Header / padding before the first row (`getFirstItemOffset()`). */
  firstItemOffset: number;
  /** Current scroll offset (`getAbsoluteLastScrollOffset()`). */
  scrollOffset: number;
  /** Rows' total height (`getChildContainerDimensions().height`). */
  contentHeight: number;
  /** Visible height (`getWindowSize().height`). */
  windowHeight: number;
  /** Whole scroll content incl. footer and paddings (native `contentSize`).
   *  Without it the end is rows + header only, so a landing near the end
   *  stopped one footer ("Runs") short of it. */
  scrollHeight?: number;
}

/** Offset at which the row's top sits `ANCHOR_TOP_GAP_PX` below the window
 *  top, clamped to what the list can scroll to (a short last comment cannot
 *  reach the top of the window). */
export function anchorTargetOffset(m: AnchorMeasure): number {
  const wanted = m.itemTop + m.firstItemOffset - ANCHOR_TOP_GAP_PX;
  const content = m.scrollHeight ?? m.contentHeight + m.firstItemOffset;
  const max = Math.max(0, content - m.windowHeight);
  return Math.min(Math.max(0, wanted), max);
}

/** The row's top cannot reach the landing spot because it lies in the last
 *  screen: the landing is the end. For the unread divider the list then
 *  just stands at its end and keeps following (late footer, new messages),
 *  instead of holding an offset short of the end. */
export function anchorIsEnd(m: AnchorMeasure): boolean {
  const content = m.scrollHeight ?? m.contentHeight + m.firstItemOffset;
  const max = Math.max(0, content - m.windowHeight);
  return m.itemTop + m.firstItemOffset - ANCHOR_TOP_GAP_PX >= max - ANCHOR_TOLERANCE_PX;
}

/** True when the list needs another jump to bring the row's top into place. */
export function anchorNeedsCorrection(m: AnchorMeasure): boolean {
  return Math.abs(anchorTargetOffset(m) - m.scrollOffset) > ANCHOR_TOLERANCE_PX;
}

/** Bottom-follow threshold for FlashList's `maintainVisibleContentPosition`.
 *  Anchored, the follow is off (negative = FlashList skips the check). With
 *  0 it still fired: FlashList judges "at the end" by its JS offset, which
 *  stays at the end after the initial render from the bottom, so a refetch
 *  or a late row measure scrolled a landed list to the end. */
export function autoscrollThreshold(anchored: boolean): number {
  return anchored ? -1 : 0.2;
}

const HOLD_END = Symbol("holdScrollToEnd");

/** Off, FlashList keeps its last "near bottom" flag and still runs one
 *  `scrollToEnd` on the next content change. So while `held()` is true the
 *  scroll view drops `scrollToEnd` itself; `onHeld` reports it (perf mark).
 *  Our own jumps to the end ("↓ new", sending) release the anchor first.
 *  Patches the ScrollView's public instance once (its methods are own
 *  properties); returns the same instance. */
export function holdScrollToEnd<T extends { scrollToEnd: (o?: { animated?: boolean }) => void }>(
  inst: T,
  held: () => boolean,
  onHeld?: () => void,
): T {
  const marked = inst as T & { [HOLD_END]?: true };
  if (marked[HOLD_END]) return inst;
  const original = inst.scrollToEnd;
  inst.scrollToEnd = (o) => {
    if (held()) {
      onHeld?.();
      return;
    }
    original(o);
  };
  marked[HOLD_END] = true;
  return inst;
}

/** A new message while anchored shows the "↓ new" chip, never follows:
 *  the list may report "at the end" from a stale offset. */
export function newMessagesFollow(atBottom: boolean, anchored: boolean): boolean {
  return atBottom && !anchored;
}
