/**
 * First frame of the issue chat without the initial scroll.
 *
 * Re-opening a known issue had its rows in the first commit, yet the
 * bubbles showed up ~400 ms after JS was done: FlashList's
 * `startRenderingFromBottom` lays out the first window in passes of two
 * rows with hidden cells, then scrolls to the end in an effect; the rows
 * appear at a middle offset and jump to the end one frame later.
 *
 * The chat therefore paints the last rows once more in a plain bottom-aligned
 * view on top of the list ("cover"). It needs no measuring and no scroll, so
 * it is on screen with the first frame of the screen. The list itself mounts
 * one frame later, so its first window does not hold that frame up.
 *
 * Hand-over: FlashList's initial scroll runs while it
 * ignores scroll events, and its JS offset stays stale afterwards, so
 * neither `onScroll` nor the list's own layout tells when it stands at the
 * end. The list therefore gets its own scroll component that records the
 * native values (offset, viewport, content size) before FlashList sees
 * them. `CoverHandOver` probes these on every native scroll/size event, on
 * every list commit, on `onLoad` and frame by frame while it is close: the
 * cover goes once the ScrollView stands at its end with the same values
 * twice in a row (sizes settled), one frame later. The fallback timers stay
 * as a safety net only.
 *
 * Touches: while the cover stands it takes every touch itself
 * (`COVER_TOUCH_PROPS`) and its own bubbles do not respond. A tap, quote
 * jump, swipe-to-reply or long-press can therefore never reach a different
 * bubble of the list below, which may not stand at the end yet. A touch only
 * speeds up the hand-over check.
 *
 * The cover's rows follow the data (`liveCoverRows`): a message arriving
 * while it stands is shown at once, and the list has it at the hand-over.
 *
 * Landing: opening at a target comment (`?comment=`) or the
 * unread divider shows the rows from the target down, top-aligned with the
 * landing gap, and hands over once the ScrollView stands at the landing
 * offset (`aim`, from the list's layout of the target) with the same values
 * twice. A target above the first window keeps the old way without cover.
 */

import { ANCHOR_HOLD_MS, ANCHOR_TOLERANCE_PX } from "@/lib/chat-anchor";
import type { ChatItem } from "@/lib/issue-chat";

/** Rows in the cover. A bubble costs ~15–25 ms to render on a slow device
 *  (15 rows put ~250 ms before the first frame); 6 rows fill most
 *  of a phone screen, the rows above fill in when the list takes over. */
export const COVER_ROWS = 6;
/** Cover goes at the latest this long after the list's first layout. */
export const COVER_FALLBACK_MS = 800;
/** Cover goes at the latest this long after mount (list never loaded). */
export const COVER_MAX_MS = 2000;

export interface CoverOptions {
  targetCommentId?: string | null;
  /** Start of the list's first window (`chatWindowStart`). */
  windowStart?: number;
}

/** Where the list will stand once it took over: at its end, or landed on a
 *  row (target comment, else unread divider) with its top near the window's
 *  top. */
export type CoverMode = { kind: "end" } | { kind: "landing"; targetId: string };

/**
 * Cover for the first render, or `null` (no cover). A landing target above
 * the first window comes in by growing the window block by block
 *That way keeps no cover, a wrong position would show.
 */
export function coverMode<T extends Pick<ChatItem, "id" | "kind">>(
  items: readonly T[],
  opts: CoverOptions = {},
): CoverMode | null {
  if (items.length === 0) return null;
  const target =
    opts.targetCommentId && items.some((i) => i.id === opts.targetCommentId)
      ? opts.targetCommentId
      : (items.find((i) => i.kind === "unread")?.id ?? null);
  if (!target) return { kind: "end" };
  const index = items.findIndex((i) => i.id === target);
  if (index < (opts.windowStart ?? 0)) return null;
  return { kind: "landing", targetId: target };
}

/** Rows of the cover. `above` sits bottom-aligned in the space left, `from`
 *  starts at the top with the landing gap; `reachesEnd` = `from` holds the
 *  last row, so the footer follows it. */
export interface CoverRows<T> {
  above: T[];
  from: T[];
  reachesEnd: boolean;
}

/**
 * Rows the cover shows now, from the current data, so a message arriving
 * while it stands is not lost. `null` = no cover.
 *
 * End: the last rows, bottom-aligned. Landing: rows from the target down,
 * top-aligned like the list after `scrollToIndex` (`chat-anchor.ts`). When
 * these rows reach the end, the list may not scroll the target up to the
 * top (`anchorTargetOffset` clamps) and stands at its end instead; the rows
 * above then fill the space left from the bottom, which is the same picture
 * whichever case it is (the cover lays this out with flex, no measuring).
 */
export function liveCover<T extends Pick<ChatItem, "id">>(
  mode: CoverMode | null,
  items: readonly T[],
  rows = COVER_ROWS,
): CoverRows<T> | null {
  if (!mode || items.length === 0) return null;
  if (mode.kind === "end") {
    return { above: items.slice(Math.max(0, items.length - rows)), from: [], reachesEnd: true };
  }
  const index = items.findIndex((i) => i.id === mode.targetId);
  if (index < 0) return null;
  const from = items.slice(index, index + rows);
  const reachesEnd = index + rows >= items.length;
  const above = reachesEnd ? items.slice(Math.max(0, index - Math.max(0, rows - from.length)), index) : [];
  return { above, from, reachesEnd };
}

/** Native scroll values of the list's ScrollView, seen by the
 *  scroll component before FlashList handles (or drops) them. */
export interface NativeScrollProbe {
  /** `contentOffset.y` of the last native scroll event. */
  offset: number;
  /** Height of the ScrollView (`layoutMeasurement` / `onLayout`). */
  viewport: number;
  /** Height of the content (`contentSize` / `onContentSizeChange`). */
  content: number;
  /** Landing: offset at which the target row's top sits
   *  `ANCHOR_TOP_GAP_PX` below the window's top, from the list's layout.
   *  Unset = the end. */
  aim?: number;
}

/** Two native scroll events in a row moved the list up (away from the end)
 *  with the same window and content size. Neither FlashList's
 *  offset shift after rows above got measured (that event carries the new
 *  content size) nor our scroll to the end does that; a screen reader's
 *  scroll action does, and it starts no drag. */
export function scrolledUpInPlace(prev: NativeScrollProbe | null, next: NativeScrollProbe, slackPx = 2): boolean {
  if (!prev || prev.viewport <= 0 || prev.content <= 0) return false;
  if (Math.abs(prev.viewport - next.viewport) > 1 || Math.abs(prev.content - next.content) > 1) return false;
  return next.offset < prev.offset - slackPx;
}

/** Latest native values; fed by the list's scroll component. */
export class NativeScrollState {
  offset = 0;
  viewport = 0;
  content = 0;
  private lastScroll: NativeScrollProbe | null = null;
  private up = false;

  scroll(offset: number, viewport: number, content: number): void {
    const next = { offset, viewport, content };
    this.up = scrolledUpInPlace(this.lastScroll, next);
    this.lastScroll = next;
    this.offset = offset;
    if (viewport > 0) this.viewport = viewport;
    if (content > 0) this.content = content;
  }

  /** The last scroll event moved up in place (`scrolledUpInPlace`); read
   *  once, so a later size or layout event does not report it again. */
  takeScrolledUp(): boolean {
    const up = this.up;
    this.up = false;
    return up;
  }

  probe(): NativeScrollProbe | null {
    if (this.viewport <= 0 || this.content <= 0) return null;
    return { offset: this.offset, viewport: this.viewport, content: this.content };
  }
}

/** The ScrollView stands at its end: `offset + viewport >= content - slack`.
 *  An offset beyond the end (overscroll, a value from before the content
 *  grew) is not trusted. Content shorter than the window stands at 0. */
export function nativeStandsAtEnd(p: NativeScrollProbe, slackPx = 2): boolean {
  if (p.viewport <= 0 || p.content <= 0) return false;
  const maxOffset = Math.max(0, p.content - p.viewport);
  if (p.offset > maxOffset + slackPx) return false;
  return p.offset >= maxOffset - slackPx;
}

/** The window got shorter (keyboard, growing composer) while the
 *  ScrollView stood at its end (within `slackPx`): the offset that keeps the
 *  end in view, else `null`. The native view keeps its offset, so
 *  without this the keyboard covered the last rows. */
export function endOffsetAfterShrink(prev: NativeScrollProbe | null, viewport: number, slackPx = 24): number | null {
  if (!prev || viewport <= 0 || viewport >= prev.viewport) return null;
  if (!nativeStandsAtEnd(prev, slackPx)) return null;
  return Math.max(0, prev.content - viewport);
}

/**
 * Keeps an open at the end standing at the end while the rows settle
 *After the hand-over the held-back block is prepended and the
 * rows above get measured; FlashList shifts the offset only by the
 * estimated heights, so in about every second reopen the list stopped
 * ~870 px above the end (last bubble and footer out of view). Armed at the
 * end hand-over and again when the held-back block is released, for
 * `ms`; the reader's drag, a landing or a quote jump releases it. With a
 * screen reader a scroll up in place releases it too
 * (`scrolledUpInPlace`): TalkBack's scroll action starts no drag, and the hold pulled
 * the list back to the end.
 *
 * The correction on a content-size event often runs with the offset from
 * before FlashList's shift, which arrives afterwards. When no scroll event
 * reports that shift, the native values look like the end while the list is
 * not there. So the hold also scrolls to the end at fixed times
 * (`END_HOLD_RECHECK_MS`). That scroll does not depend on the recorded
 * offset, and it is a no-op where the list already stands. The list goes
 * there with FlashList's own `scrollToEnd`: a plain `scrollToOffset` moved
 * the ScrollView, but FlashList kept rendering the old rows (blank list above
 * the footer).
 */
export const END_HOLD_RECHECK_MS = [150, 400, 900, 1600, 2500, 4000] as const;

export class EndHold {
  private until = 0;

  constructor(private readonly ms = ANCHOR_HOLD_MS) {}

  arm(now: number): void {
    this.until = now + this.ms;
  }

  release(): void {
    this.until = 0;
  }

  active(now: number): boolean {
    return now < this.until;
  }

  /** Offset of the native end while held (timed recheck), else `null`. */
  endOffset(p: NativeScrollProbe | null, now: number): number | null {
    if (!p || !this.active(now) || p.viewport <= 0 || p.content <= 0) return null;
    return Math.max(0, p.content - p.viewport);
  }

  /** Offset of the native end while held and not standing there, else `null`. */
  correction(p: NativeScrollProbe | null, now: number, slackPx = 2): number | null {
    if (!p || !this.active(now) || p.viewport <= 0 || p.content <= 0) return null;
    if (nativeStandsAtEnd(p, slackPx)) return null;
    return Math.max(0, p.content - p.viewport);
  }
}

/** The ScrollView stands where the list lands: at `aim`, clamped to what it
 *  can scroll to (`anchorTargetOffset`), or at its end without an aim. */
export function nativeStandsRight(p: NativeScrollProbe, slackPx = 2): boolean {
  if (p.aim === undefined) return nativeStandsAtEnd(p, slackPx);
  if (p.viewport <= 0 || p.content <= 0) return false;
  const want = Math.min(Math.max(0, p.aim), Math.max(0, p.content - p.viewport));
  return Math.abs(p.offset - want) <= ANCHOR_TOLERANCE_PX;
}

/** Same sizes (and aim) in two probes: the content no longer changes
 *  (estimated rows measured). The offset may differ: the scroll to the end itself is the
 *  usual change between them, `nativeStandsAtEnd` pins it. */
export function sameNativeLayout(a: NativeScrollProbe | null, b: NativeScrollProbe | null, slackPx = 1): boolean {
  if (!a || !b) return false;
  if ((a.aim === undefined) !== (b.aim === undefined)) return false;
  if (a.aim !== undefined && Math.abs(a.aim - b.aim!) > slackPx) return false;
  return Math.abs(a.viewport - b.viewport) <= slackPx && Math.abs(a.content - b.content) <= slackPx;
}

export type CoverOffReason = "end" | "fallback" | "max" | "unmount";

/**
 * Hand-over state, framework-free so it is unit-tested. `probe` reads the
 * list (`null` while it has none), `nextFrame` is `requestAnimationFrame`.
 *
 * The cover goes once the ScrollView stands at its end (or at the landing
 * `aim`) with the same values as in the probe before; a probe there with
 * sizes still changing
 * re-checks in the next frame, so the hand-over does not wait for another
 * commit. After a settled probe it goes one frame later (cells painted),
 * or at once when a native event reported it (the native view
 * already shows that position, and the next frame can be ~800 ms away
 * while the list renders its remaining rows).
 */
export class CoverHandOver {
  private loaded = false;
  private phase: "covering" | "handing" | "off" = "covering";
  private last: NativeScrollProbe | null = null;
  private recheck = false;

  constructor(
    private readonly onOff: (reason: CoverOffReason) => void,
    private readonly nextFrame: (cb: () => void) => void,
    private readonly probe: () => NativeScrollProbe | null,
  ) {}

  get active(): boolean {
    return this.phase !== "off";
  }

  /** First layout done (`onLoad`). The probe values come from native
   *  events, often from before `onLoad`, so it hands over at once
   *  when they already stand settled at the end. */
  markLoaded(): void {
    this.loaded = true;
    this.check(true);
  }

  /** A list commit, touch or re-check frame; `native` = a native scroll,
   *  size or layout event of the ScrollView. */
  check(native = false): void {
    if (this.phase !== "covering") return;
    const p = this.probe();
    const prev = this.last;
    this.last = p;
    // Before the first layout only remembered: a native event at the end
    // then counts as the first of the two probes.
    if (!this.loaded) return;
    if (!p || !nativeStandsRight(p)) return;
    if (sameNativeLayout(prev, p)) {
      this.phase = "handing";
      if (native) this.off("end");
      else this.nextFrame(() => this.off("end"));
      return;
    }
    if (this.recheck) return;
    this.recheck = true;
    this.nextFrame(() => {
      this.recheck = false;
      this.check();
    });
  }

  /** Fallback timers and unmount: cover goes regardless of the list. */
  off(reason: CoverOffReason): void {
    if (this.phase === "off") return;
    this.phase = "off";
    this.onOff(reason);
  }
}

/** Touch props of the cover: it is the responder for every touch (start and
 *  move, never handed to a parent) and its children get none, so nothing
 *  reaches a bubble while it stands. Plain object, spread on the View. */
export const COVER_TOUCH_PROPS = {
  pointerEvents: "box-only",
  onStartShouldSetResponder: () => true,
  onMoveShouldSetResponder: () => true,
  onStartShouldSetResponderCapture: () => true,
  onMoveShouldSetResponderCapture: () => true,
  onResponderTerminationRequest: () => false,
} as const;
