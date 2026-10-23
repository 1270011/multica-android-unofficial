import { describe, expect, it } from "vitest";
import {
  endOffsetAfterShrink,
  COVER_ROWS,
  COVER_TOUCH_PROPS,
  CoverHandOver,
  EndHold,
  coverMode,
  liveCover,
  nativeStandsAtEnd,
  nativeStandsRight,
  NativeScrollState,
  sameNativeLayout,
  scrolledUpInPlace,
  type CoverOffReason,
  type NativeScrollProbe,
} from "./chat-first-frame";

type Row = { id: string; kind: "message" | "day" | "unread" | "system" };
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, kind: "message" }));

describe("coverMode", () => {
  it("end when nothing is landed on", () => {
    expect(coverMode(rows(100))).toEqual({ kind: "end" });
  });
  it("no cover for an empty chat", () => {
    expect(coverMode([])).toBeNull();
  });
  it("lands on a target comment inside the first window", () => {
    expect(coverMode(rows(50), { targetCommentId: "r40", windowStart: 25 })).toEqual({
      kind: "landing",
      targetId: "r40",
    });
  });
  it("lands on the unread divider", () => {
    const items: Row[] = [...rows(10), { id: "unread", kind: "unread" }, ...rows(2)];
    expect(coverMode(items)).toEqual({ kind: "landing", targetId: "unread" });
  });
  it("a target comment wins over the unread divider", () => {
    const items: Row[] = [...rows(10), { id: "unread", kind: "unread" }, ...rows(2)];
    expect(coverMode(items, { targetCommentId: "r3" })).toEqual({ kind: "landing", targetId: "r3" });
  });
  it("unknown target comment: unread divider, else the end", () => {
    const items: Row[] = [...rows(10), { id: "unread", kind: "unread" }, ...rows(2)];
    expect(coverMode(items, { targetCommentId: "gone" })).toEqual({ kind: "landing", targetId: "unread" });
    expect(coverMode(rows(50), { targetCommentId: "gone" })).toEqual({ kind: "end" });
  });
  it("no cover when the target comes in by growing the window", () => {
    expect(coverMode(rows(200), { targetCommentId: "r10", windowStart: 175 })).toBeNull();
    const items: Row[] = [...rows(100), { id: "unread", kind: "unread" }, ...rows(100)];
    expect(coverMode(items, { windowStart: 176 })).toBeNull();
  });
});

describe("liveCover", () => {
  const ids = (r: readonly Row[]) => r.map((x) => x.id);
  it("end: the last rows, footer follows", () => {
    const c = liveCover({ kind: "end" }, rows(100))!;
    expect(c.above).toHaveLength(COVER_ROWS);
    expect(c.above[c.above.length - 1]!.id).toBe("r99");
    expect(c.from).toEqual([]);
    expect(c.reachesEnd).toBe(true);
  });
  it("end: all rows of a short chat", () => {
    expect(liveCover({ kind: "end" }, rows(3))!.above).toHaveLength(3);
  });
  it("shows a message that arrives while the cover stands", () => {
    const after = liveCover({ kind: "end" }, [...rows(20), { id: "new", kind: "message" as const }])!;
    expect(after.above).toHaveLength(COVER_ROWS);
    expect(after.above[after.above.length - 1]!.id).toBe("new");
  });
  it("nothing once the cover is off", () => {
    expect(liveCover(null, rows(20))).toBeNull();
  });
  it("landing far from the end: rows from the target down, top-aligned, no footer", () => {
    const c = liveCover({ kind: "landing", targetId: "r40" }, rows(100))!;
    expect(ids(c.from)).toEqual(["r40", "r41", "r42", "r43", "r44", "r45"]);
    expect(c.above).toEqual([]);
    expect(c.reachesEnd).toBe(false);
  });
  it("landing near the end: rows above fill up to the same row count, footer follows", () => {
    const items: Row[] = [...rows(30), { id: "unread", kind: "unread" }, ...rows(2).map((r) => ({ ...r, id: `n${r.id}` }))];
    const c = liveCover({ kind: "landing", targetId: "unread" }, items)!;
    expect(ids(c.from)).toEqual(["unread", "nr0", "nr1"]);
    expect(ids(c.above)).toEqual(["r27", "r28", "r29"]);
    expect(c.reachesEnd).toBe(true);
  });
  it("landing exactly COVER_ROWS from the end reaches it", () => {
    const c = liveCover({ kind: "landing", targetId: `r${100 - COVER_ROWS}` }, rows(100))!;
    expect(c.from).toHaveLength(COVER_ROWS);
    expect(c.above).toEqual([]);
    expect(c.reachesEnd).toBe(true);
  });
  it("landing on the first row has nothing above", () => {
    const c = liveCover({ kind: "landing", targetId: "r0" }, rows(3))!;
    expect(ids(c.from)).toEqual(["r0", "r1", "r2"]);
    expect(c.above).toEqual([]);
  });
  it("a new message joins the landing rows while they reach the end", () => {
    const items: Row[] = [...rows(30), { id: "unread", kind: "unread" }, { id: "a", kind: "message" }];
    const c = liveCover({ kind: "landing", targetId: "unread" }, [...items, { id: "new", kind: "message" } as Row])!;
    expect(ids(c.from)).toEqual(["unread", "a", "new"]);
  });
  it("target gone from the data: no cover", () => {
    expect(liveCover({ kind: "landing", targetId: "gone" }, rows(10))).toBeNull();
  });
});

const atEnd: NativeScrollProbe = { offset: 1400, viewport: 600, content: 2000 };
const midway: NativeScrollProbe = { offset: 700, viewport: 600, content: 2000 };

describe("nativeStandsAtEnd", () => {
  it("end reached: offset + viewport >= content - slack", () => {
    expect(nativeStandsAtEnd(atEnd)).toBe(true);
    expect(nativeStandsAtEnd({ ...atEnd, offset: 1398.5 })).toBe(true);
  });
  it("end not reached", () => {
    expect(nativeStandsAtEnd(midway)).toBe(false);
    expect(nativeStandsAtEnd({ ...atEnd, offset: 1390 })).toBe(false);
  });
  it("content grew (estimates measured): the old offset is no longer the end", () => {
    // Seen on device: estimated rows end at 2068, measured at 6547.
    expect(nativeStandsAtEnd({ offset: 1468, viewport: 600, content: 2068 })).toBe(true);
    expect(nativeStandsAtEnd({ offset: 1468, viewport: 600, content: 6547 })).toBe(false);
  });
  it("does not trust an offset beyond the end", () => {
    expect(nativeStandsAtEnd({ offset: 4628, viewport: 664, content: 2068 })).toBe(false);
  });
  it("content shorter than the window stands at 0", () => {
    expect(nativeStandsAtEnd({ offset: 0, viewport: 600, content: 400 })).toBe(true);
    expect(nativeStandsAtEnd({ offset: 50, viewport: 600, content: 400 })).toBe(false);
  });
  it("no viewport or content yet", () => {
    expect(nativeStandsAtEnd({ ...atEnd, viewport: 0 })).toBe(false);
    expect(nativeStandsAtEnd({ ...atEnd, content: 0 })).toBe(false);
  });
});

describe("sameNativeLayout", () => {
  it("equal within a pixel", () => {
    expect(sameNativeLayout(atEnd, { ...atEnd, content: 2000.5 })).toBe(true);
  });
  it("the scroll to the end in between does not count as a change", () => {
    expect(sameNativeLayout({ ...atEnd, offset: 0 }, atEnd)).toBe(true);
  });
  it("estimates still changing or window resized", () => {
    expect(sameNativeLayout(atEnd, { ...atEnd, content: 6535 })).toBe(false);
    expect(sameNativeLayout(atEnd, { ...atEnd, viewport: 500 })).toBe(false);
    expect(sameNativeLayout(null, atEnd)).toBe(false);
  });
});

describe("NativeScrollState", () => {
  it("no probe before the first layout and content size", () => {
    const st = new NativeScrollState();
    expect(st.probe()).toBeNull();
    st.viewport = 600;
    expect(st.probe()).toBeNull();
    st.content = 2000;
    expect(st.probe()).toEqual({ offset: 0, viewport: 600, content: 2000 });
  });
  it("a scroll event updates offset, keeps known sizes on zero values", () => {
    const st = new NativeScrollState();
    st.scroll(1400, 600, 2000);
    st.scroll(1500, 0, 0);
    expect(st.probe()).toEqual({ offset: 1500, viewport: 600, content: 2000 });
  });
});

function setup(first: NativeScrollProbe | null = atEnd) {
  const frames: (() => void)[] = [];
  const offs: CoverOffReason[] = [];
  const state = { probe: first };
  const h = new CoverHandOver(
    (r) => offs.push(r),
    (cb) => frames.push(cb),
    () => state.probe,
  );
  const frame = () => frames.splice(0).forEach((cb) => cb());
  return { h, offs, frame, state };
}

describe("CoverHandOver", () => {
  it("hands over one frame after the list stands at the end with settled sizes", () => {
    const { h, offs, frame, state } = setup(midway);
    h.markLoaded(); // first layout, initial scroll not applied yet
    h.check();
    expect(offs).toEqual([]);
    state.probe = atEnd; // commit after the initial scroll, same sizes → handing
    h.check();
    expect(offs).toEqual([]);
    expect(h.active).toBe(true);
    frame();
    expect(offs).toEqual(["end"]);
    expect(h.active).toBe(false);
  });
  it("keeps covering while the rows are still being measured", () => {
    const { h, offs, frame, state } = setup();
    h.markLoaded();
    state.probe = { ...atEnd, content: 6535 }; // rows above measured taller
    frame();
    frame();
    expect(offs).toEqual([]);
    expect(h.active).toBe(true);
    state.probe = { offset: 5935, viewport: 600, content: 6535 };
    h.check();
    frame();
    frame();
    expect(offs).toEqual(["end"]);
  });
  it("never hands over on a stale offset right after onLoad", () => {
    const { h, offs, frame } = setup({ offset: 4628, viewport: 664, content: 2068 });
    h.markLoaded();
    h.check();
    frame();
    frame();
    expect(offs).toEqual([]);
  });
  it("waits for the first layout even when the probe says end", () => {
    const { h, offs, frame } = setup();
    h.check();
    h.check();
    frame();
    frame();
    expect(offs).toEqual([]);
    h.markLoaded();
    frame();
    frame();
    expect(offs).toEqual(["end"]);
  });
  it("hands over once, later checks and timers do nothing", () => {
    const { h, offs, frame } = setup();
    h.markLoaded();
    h.check();
    h.check();
    frame();
    frame();
    h.off("fallback");
    h.off("max");
    expect(offs).toEqual(["end"]);
  });
  it("fallback removes the cover when the list never reaches the end", () => {
    const { h, offs } = setup(null);
    h.markLoaded();
    h.off("fallback");
    expect(offs).toEqual(["fallback"]);
    expect(h.active).toBe(false);
  });
  it("a timer during the hand-over frame wins once, not twice", () => {
    const { h, offs, frame } = setup();
    h.markLoaded();
    h.check();
    h.off("max");
    frame();
    frame();
    expect(offs).toEqual(["max"]);
  });
  it("stays active (touches swallowed) until the hand-over frame", () => {
    const { h, frame } = setup();
    h.markLoaded();
    h.check();
    expect(h.active).toBe(true);
    frame();
    expect(h.active).toBe(false);
  });
});

describe("COVER_TOUCH_PROPS", () => {
  it("cover takes every touch itself, its bubbles get none", () => {
    expect(COVER_TOUCH_PROPS.pointerEvents).toBe("box-only");
    expect(COVER_TOUCH_PROPS.onStartShouldSetResponder()).toBe(true);
    expect(COVER_TOUCH_PROPS.onMoveShouldSetResponder()).toBe(true);
    expect(COVER_TOUCH_PROPS.onStartShouldSetResponderCapture()).toBe(true);
    expect(COVER_TOUCH_PROPS.onMoveShouldSetResponderCapture()).toBe(true);
    expect(COVER_TOUCH_PROPS.onResponderTerminationRequest()).toBe(false);
  });
});

describe("CoverHandOver with native events", () => {
  it("hands over at once on a native event at the end with settled sizes", () => {
    const { h, offs, state } = setup({ offset: 0, viewport: 974, content: 2120 });
    h.markLoaded(); // content reported, not scrolled yet
    expect(offs).toEqual([]);
    state.probe = { offset: 1146, viewport: 974, content: 2120 }; // native scroll to the end
    h.check(true);
    expect(offs).toEqual(["end"]);
  });
  it("a native event while the content still grows waits for the next probe", () => {
    const { h, offs, frame, state } = setup({ offset: 1146, viewport: 974, content: 2120 });
    h.markLoaded();
    state.probe = { offset: 1146, viewport: 974, content: 5564 }; // rows above measured
    h.check(true);
    frame();
    expect(offs).toEqual([]);
    state.probe = { offset: 4590, viewport: 974, content: 5564 }; // kept at the end
    h.check(true);
    expect(offs).toEqual(["end"]);
  });
  it("not at the end: no hand-over, whatever the source", () => {
    const { h, offs, frame } = setup(midway);
    h.markLoaded();
    h.check(true);
    h.check(true);
    frame();
    expect(offs).toEqual([]);
  });
  it("a native end before onLoad lets onLoad hand over at once", () => {
    const { h, offs, state } = setup({ offset: 0, viewport: 974, content: 1936 });
    h.check(true); // content size, before onLoad
    state.probe = { offset: 962, viewport: 974, content: 1936 };
    h.check(true); // native scroll to the end, before onLoad
    expect(offs).toEqual([]);
    h.markLoaded();
    expect(offs).toEqual(["end"]);
  });
});

describe("nativeStandsRight (landing)", () => {
  // Target row's top at 900 + gap: aim = 892.
  const landed: NativeScrollProbe = { offset: 892, viewport: 600, content: 3000, aim: 892 };
  it("without aim it is the end check", () => {
    expect(nativeStandsRight(atEnd)).toBe(true);
    expect(nativeStandsRight(midway)).toBe(false);
  });
  it("stands at the aim within the anchor tolerance", () => {
    expect(nativeStandsRight(landed)).toBe(true);
    expect(nativeStandsRight({ ...landed, offset: 896 })).toBe(true);
    expect(nativeStandsRight({ ...landed, offset: 880 })).toBe(false);
  });
  it("still at the end before the jump is not the landing", () => {
    expect(nativeStandsRight({ ...landed, offset: 2400 })).toBe(false);
  });
  it("an aim beyond the end lands at the end (list clamps)", () => {
    expect(nativeStandsRight({ offset: 2400, viewport: 600, content: 3000, aim: 2700 })).toBe(true);
    expect(nativeStandsRight({ offset: 2000, viewport: 600, content: 3000, aim: 2700 })).toBe(false);
  });
  it("an aim above the start lands at 0", () => {
    expect(nativeStandsRight({ offset: 0, viewport: 600, content: 3000, aim: -4 })).toBe(true);
  });
  it("aim changes between probes (row above measured) are not settled", () => {
    expect(sameNativeLayout(landed, { ...landed, aim: 1400 })).toBe(false);
    expect(sameNativeLayout(landed, { ...landed, offset: 0 })).toBe(true);
    expect(sameNativeLayout(atEnd, { ...atEnd, aim: 1400 })).toBe(false);
  });
});

describe("CoverHandOver on a landing", () => {
  it("no hand-over before the jump, then once the target stands settled at its aim", () => {
    // Before the jump the probe is null (component), the list is at its end.
    const { h, offs, frame, state } = setup(null);
    h.markLoaded();
    h.check(true);
    frame();
    expect(offs).toEqual([]);
    // Jump ran, rows above still estimated: the aim moves with the measuring.
    state.probe = { offset: 892, viewport: 600, content: 3000, aim: 892 };
    h.check(true);
    state.probe = { offset: 892, viewport: 600, content: 3400, aim: 1292 };
    h.check();
    frame();
    expect(offs).toEqual([]);
    // Correction lands it again; sizes and aim as in the probe before: the
    // native scroll event hands over at once.
    state.probe = { offset: 1292, viewport: 600, content: 3400, aim: 1292 };
    h.check(true);
    expect(offs).toEqual(["end"]);
  });
  it("a landing the list cannot scroll up to the top hands over at the end", () => {
    const { h, offs } = setup({ offset: 2400, viewport: 600, content: 3000, aim: 2700 });
    h.markLoaded();
    h.check(true);
    expect(offs).toEqual(["end"]);
  });
});

describe("endOffsetAfterShrink", () => {
  const atEnd = { offset: 4831, viewport: 974, content: 5805 };
  it("keeps the end in view when the window gets shorter at the end", () => {
    expect(endOffsetAfterShrink(atEnd, 937)).toBe(4868);
  });
  it("leaves the offset alone away from the end", () => {
    expect(endOffsetAfterShrink({ ...atEnd, offset: 3000 }, 937)).toBeNull();
  });
  it("leaves it alone when the window grows or nothing is known yet", () => {
    expect(endOffsetAfterShrink(atEnd, 1200)).toBeNull();
    expect(endOffsetAfterShrink(null, 937)).toBeNull();
  });
});

describe("EndHold", () => {
  const at = (offset: number, content = 13724.57, viewport = 664.38): NativeScrollProbe => ({ offset, viewport, content });

  it("does nothing before it is armed", () => {
    expect(new EndHold(5000).correction(at(12186.67), 0)).toBeNull();
  });
  it("pulls back to the end after the prepended block was measured", () => {
    const h = new EndHold(5000);
    h.arm(1000);
    // Lauf 752 / local r8: MVCP left the list at 12186.67, end is 13060.19.
    expect(h.correction(at(12186.67), 2000)).toBeCloseTo(13724.57 - 664.38);
  });
  it("leaves a list that stands at the end alone", () => {
    const h = new EndHold(5000);
    h.arm(0);
    expect(h.correction(at(13724.57 - 664.38), 100)).toBeNull();
    expect(h.correction(at(13724.57 - 664.38 - 1.5), 100)).toBeNull();
  });
  it("corrects an offset beyond the end (content shrank)", () => {
    const h = new EndHold(5000);
    h.arm(0);
    expect(h.correction(at(14000), 100)).toBeCloseTo(13724.57 - 664.38);
  });
  it("short content stands at 0", () => {
    const h = new EndHold(5000);
    h.arm(0);
    expect(h.correction(at(30, 400, 664.38), 100)).toBe(0);
    expect(h.correction(at(0, 400, 664.38), 100)).toBeNull();
  });
  it("ends after its time, re-arming extends it", () => {
    const h = new EndHold(5000);
    h.arm(0);
    expect(h.active(4999)).toBe(true);
    h.arm(3000);
    expect(h.correction(at(100), 7000)).not.toBeNull();
    expect(h.active(8000)).toBe(false);
    expect(h.correction(at(100), 8000)).toBeNull();
  });
  it("a drag, landing or quote jump releases it", () => {
    const h = new EndHold(5000);
    h.arm(0);
    h.release();
    expect(h.active(1)).toBe(false);
    expect(h.correction(at(100), 1)).toBeNull();
  });
  it("timed recheck: the end offset while held, even when the values say end", () => {
    const h = new EndHold(5000);
    expect(h.endOffset(at(100), 1)).toBeNull();
    h.arm(0);
    expect(h.endOffset(at(13724.57 - 664.38), 900)).toBeCloseTo(13724.57 - 664.38);
    expect(h.endOffset(at(12186.67), 900)).toBeCloseTo(13724.57 - 664.38);
    expect(h.endOffset(null, 900)).toBeNull();
    h.release();
    expect(h.endOffset(at(12186.67), 900)).toBeNull();
  });
  it("no probe or no sizes yet: no correction", () => {
    const h = new EndHold(5000);
    h.arm(0);
    expect(h.correction(null, 1)).toBeNull();
    expect(h.correction({ offset: 0, viewport: 0, content: 0 }, 1)).toBeNull();
  });
});

describe("scrolledUpInPlace", () => {
  const at = (offset: number, content = 13724.57, viewport = 664.38): NativeScrollProbe => ({ offset, viewport, content });

  it("a screen reader's scroll up: same sizes, offset smaller", () => {
    expect(scrolledUpInPlace(at(13060.19), at(12500))).toBe(true);
    expect(scrolledUpInPlace(at(13060.19), at(13050))).toBe(true);
  });
  it("not FlashList's shift after rows above got measured (content changed)", () => {
    expect(scrolledUpInPlace(at(13060.19), at(12186.67, 14598.09))).toBe(false);
    expect(scrolledUpInPlace(at(13060.19, 14598.09), at(12186.67, 13724.57))).toBe(false);
  });
  it("not a scroll down, to the end or a jitter within the slack", () => {
    expect(scrolledUpInPlace(at(12186.67), at(13060.19))).toBe(false);
    expect(scrolledUpInPlace(at(13060.19), at(13058.5))).toBe(false);
  });
  it("not when the window changed (keyboard) or nothing came before", () => {
    expect(scrolledUpInPlace(at(13060.19), at(12700, 13724.57, 400))).toBe(false);
    expect(scrolledUpInPlace(null, at(12500))).toBe(false);
  });
  it("NativeScrollState reports it once, for scroll events only", () => {
    const st = new NativeScrollState();
    st.scroll(13060.19, 664.38, 13724.57);
    expect(st.takeScrolledUp()).toBe(false);
    st.scroll(12500, 664.38, 13724.57);
    expect(st.takeScrolledUp()).toBe(true);
    expect(st.takeScrolledUp()).toBe(false);
    // Content grew above, then FlashList's shift down with the new size.
    st.content = 14598.09;
    st.scroll(12100, 664.38, 14598.09);
    expect(st.takeScrolledUp()).toBe(false);
  });
});
