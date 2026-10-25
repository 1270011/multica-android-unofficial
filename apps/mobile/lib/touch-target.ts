/**
 * Touch-target sizing for small inline icons.
 *
 * `hitSlop` leaves the view's own bounds at glyph size, so TalkBack, the
 * accessibility scanner and uiautomator still report a 16 dp target. A
 * box that only overflows its row loses touches to later siblings drawn
 * on top of it (Android hit-tests the topmost view first).
 *
 * So the visible glyph stays where it is (layout unchanged) and a
 * transparent 48 dp Pressable (Material / WCAG 2.5.5) is laid over it as
 * the parent's last, absolutely positioned child: real bounds, topmost
 * in the hit test. `maxReachUp` caps how far it may reach above the glyph
 * (e.g. up to the edge where an ancestor would clip it); the rest goes
 * below.
 */
export const MIN_TOUCH_TARGET = 48;

export interface TouchTargetOverlayStyle {
  position: "absolute";
  top: number;
  right: number;
  width: number;
  height: number;
}

export function touchTargetOverlay({
  glyphSize,
  glyphTop,
  glyphRight,
  maxReachUp = Infinity,
  target = MIN_TOUCH_TARGET,
}: {
  glyphSize: number;
  /** Glyph offset from the parent's top edge. */
  glyphTop: number;
  /** Glyph offset from the parent's right edge. */
  glyphRight: number;
  maxReachUp?: number;
  target?: number;
}): TouchTargetOverlayStyle {
  const box = Math.max(target, glyphSize);
  const extra = box - glyphSize;
  const up = Math.min(extra / 2, Math.max(0, maxReachUp));
  return {
    position: "absolute",
    top: glyphTop - up,
    right: glyphRight - extra / 2,
    width: box,
    height: box,
  };
}
