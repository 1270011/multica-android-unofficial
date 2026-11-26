/**
 * Pure decision logic for the issue timeline's "Jump to latest" button.
 * The React component (components/issue/timeline-list.tsx) keeps only the
 * scroll metrics, timers and rendering; thresholds and branches live here so
 * they can be unit-tested (apps/mobile/CLAUDE.md: test transforms in the
 * Vitest setup).
 *
 * Upstream web parity: packages/views/issues/hooks/use-jump-to-latest.ts
 * (MUL-8324, MUL-8951, MUL-9303).
 */

/** How close to the bottom, in viewports, counts as back at the latest
 *  entry. Once away, the reader has to come within this distance for the
 *  button to clear, so it does not flicker at the threshold. */
export const RETURN_WITHIN_SCREENS = 0.5;

/** Share of the page the reader may scroll through before the button
 *  hides on phone layouts: once they have scrolled further on their own
 *  they are reading, not hunting for the latest entry, and the button
 *  would cover the text column above the composer. Scaled by the page
 *  height, as on web (`SHOW_WITHIN_TOP_RATIO`). */
export const NEAR_TOP_RATIO = 0.2;

/** A jump keeps re-pinning the bottom while the follow window is open —
 *  async markdown (Shiki highlight, image natural-size) and WS appends can
 *  resolve after the jump and leave the reader short of the newest entry
 *  (the web jump does the same with a rAF loop). */
export const JUMP_FOLLOW_MS = 2000;

/** Cadence of the follow-window re-pin check. Doubling as the settle
 *  window: an offset that has not moved for a tick is treated as landed
 *  (or stalled), safe to correct. */
export const JUMP_FOLLOW_TICK_MS = 120;

/** Distance from the bottom (px) that still counts as landed after a jump. */
export const JUMP_AT_END_EPSILON_PX = 4;

export interface JumpMetrics {
  /** Current scroll offset (px from the top). */
  offset: number;
  /** Content height (px; estimated for rows that are not laid out yet). */
  contentH: number;
  /** Viewport height (px; 0 before the first layout pass). */
  viewportH: number;
}

export interface JumpVisibility {
  /** True while the bottom is out of comfortable reach, subject to the
   *  hysteresis in `computeJumpVisibility`. */
  away: boolean;
  /** Whether the button should render. */
  visible: boolean;
}

/**
 * Decides the button state for one measurement. `prevAway` carries the
 * hysteresis state across calls: the button appears once the bottom is more
 * than a viewport away, and only clears once the reader is back within
 * RETURN_WITHIN_SCREENS of the bottom.
 *
 * `tailPending` reports that the last row has not been laid out yet. A
 * virtualized list estimates unrendered rows, so `contentH` can claim the
 * bottom is close while screens of comments are still below (the web jump
 * exposes this as `tailPending`); while pending, the reader is away
 * regardless of the computed distance.
 */
export function computeJumpVisibility(
  prevAway: boolean,
  { offset, contentH, viewportH }: JumpMetrics,
  tailPending: boolean,
): JumpVisibility {
  if (viewportH <= 0) {
    return { away: prevAway, visible: false };
  }
  const dist = contentH - (offset + viewportH);
  const threshold = prevAway ? viewportH * RETURN_WITHIN_SCREENS : viewportH;
  const away = tailPending || dist > threshold;
  const nearTop = contentH > 0 && offset <= contentH * NEAR_TOP_RATIO;
  return { away, visible: away && nearTop };
}

/**
 * Whether one follow-window tick should re-pin the scroll to the bottom.
 * `lastOffsetChangeAt`/`now` gate on the travel having settled — pinning
 * mid-flight would fight the animated jump. Late content growth moves the
 * bottom without moving the offset, which is exactly the case caught here.
 */
export function jumpFollowShouldPin(
  metrics: JumpMetrics,
  lastOffsetChangeAt: number,
  now: number,
): boolean {
  if (metrics.viewportH <= 0) return false;
  if (now - lastOffsetChangeAt <= JUMP_FOLLOW_TICK_MS) return false;
  return (
    metrics.contentH - (metrics.offset + metrics.viewportH) >
    JUMP_AT_END_EPSILON_PX
  );
}
