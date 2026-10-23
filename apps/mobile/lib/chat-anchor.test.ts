import { describe, expect, it } from "vitest";
import {
  anchorIsEnd,
  ANCHOR_HOLD_MS,
  ANCHOR_RECHECK_MS,
  anchorHolds,
  ANCHOR_TOP_GAP_PX,
  anchorNeedsCorrection,
  anchorScrollParams,
  anchorTargetOffset,
  autoscrollThreshold,
  holdScrollToEnd,
  newMessagesFollow,
} from "./chat-anchor";

const base = {
  itemTop: 5000,
  firstItemOffset: 12,
  scrollOffset: 0,
  contentHeight: 20000,
  windowHeight: 700,
};

describe("anchorScrollParams", () => {
  it("lands the row's top at the window top, not centred, without animation", () => {
    expect(anchorScrollParams(17)).toEqual({
      index: 17,
      animated: false,
      viewPosition: 0,
      viewOffset: -ANCHOR_TOP_GAP_PX,
    });
  });

  it("keeps the start of a comment taller than the window in view", () => {
    // FlashList: final = top - (window - item) * viewPosition + viewOffset.
    const item = 2400;
    const window = 700;
    const { viewPosition, viewOffset } = anchorScrollParams(3);
    const final = base.itemTop - (window - item) * viewPosition + viewOffset;
    expect(final).toBeLessThanOrEqual(base.itemTop);
    // The old centred landing (0.4) ended 680 px inside the comment.
    const old = base.itemTop - (window - item) * 0.4;
    expect(old - base.itemTop).toBe(680);
  });
});

describe("anchorTargetOffset", () => {
  it("puts the row top a small gap below the window top", () => {
    expect(anchorTargetOffset(base)).toBe(5000 + 12 - ANCHOR_TOP_GAP_PX);
  });

  it("clamps to the end of the list for a short last comment", () => {
    const m = { ...base, itemTop: 19900 };
    expect(anchorTargetOffset(m)).toBe(20000 + 12 - 700);
  });

  it("never goes below 0", () => {
    expect(anchorTargetOffset({ ...base, itemTop: 0, firstItemOffset: 0 })).toBe(0);
    expect(anchorTargetOffset({ ...base, contentHeight: 300 })).toBe(0);
  });
});

describe("anchorNeedsCorrection", () => {
  it("is false within the tolerance", () => {
    const at = anchorTargetOffset(base);
    expect(anchorNeedsCorrection({ ...base, scrollOffset: at })).toBe(false);
    expect(anchorNeedsCorrection({ ...base, scrollOffset: at + 3 })).toBe(false);
  });

  it("asks for a second jump when rows above grew after the first jump", () => {
    // First jump went to the estimate, then the rows above measured 900 px taller.
    const first = anchorTargetOffset(base);
    expect(
      anchorNeedsCorrection({ ...base, itemTop: base.itemTop + 900, scrollOffset: first }),
    ).toBe(true);
  });

  it("asks for a jump when the list stayed at the end (200 % font scale case)", () => {
    expect(anchorNeedsCorrection({ ...base, scrollOffset: 20000 + 12 - 700 })).toBe(true);
  });
});

describe("re-check schedule and bottom-follow", () => {
  it("re-checks a few times, increasing, within 2 s", () => {
    expect(ANCHOR_RECHECK_MS.length).toBeGreaterThanOrEqual(2);
    expect([...ANCHOR_RECHECK_MS].sort((a, b) => a - b)).toEqual([...ANCHOR_RECHECK_MS]);
    expect(ANCHOR_RECHECK_MS[ANCHOR_RECHECK_MS.length - 1]).toBeLessThanOrEqual(2000);
  });

  it("turns the bottom-follow off while anchored", () => {
    // Anchored: off (negative), FlashList skips its "near bottom" check.
    expect(autoscrollThreshold(true)).toBeLessThan(0);
    expect(autoscrollThreshold(false)).toBe(0.2);
  });
});

describe("anchorHolds", () => {
  it("re-checks scrolls only shortly after the jump", () => {
    expect(anchorHolds(null, 1000)).toBe(false);
    expect(anchorHolds(1000, 1000 + 200)).toBe(true);
    expect(anchorHolds(1000, 1000 + ANCHOR_HOLD_MS)).toBe(false);
  });
});

describe("holdScrollToEnd", () => {
  function view() {
    const calls: unknown[] = [];
    return { calls, inst: { scrollToEnd: (o?: { animated?: boolean }) => void calls.push(o) } };
  }

  it("anchored: drops the list's own scrollToEnd and reports it", () => {
    const { calls, inst } = view();
    let held = 0;
    holdScrollToEnd(inst, () => true, () => held++);
    inst.scrollToEnd({ animated: true });
    expect(calls).toEqual([]);
    expect(held).toBe(1);
  });

  it("not anchored: passes scrollToEnd on unchanged", () => {
    const { calls, inst } = view();
    holdScrollToEnd(inst, () => false);
    inst.scrollToEnd({ animated: false });
    expect(calls).toEqual([{ animated: false }]);
  });

  it("follows the anchor state at call time (release, then jump to the end)", () => {
    const { calls, inst } = view();
    let anchored = true;
    holdScrollToEnd(inst, () => anchored);
    inst.scrollToEnd();
    anchored = false;
    inst.scrollToEnd({ animated: true });
    expect(calls).toEqual([{ animated: true }]);
  });

  it("patches an instance only once (ref callback runs again)", () => {
    const { calls, inst } = view();
    let held = 0;
    holdScrollToEnd(inst, () => true, () => held++);
    holdScrollToEnd(inst, () => true, () => held++);
    inst.scrollToEnd();
    expect(held).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe("newMessagesFollow", () => {
  it("anchored: a new message shows the chip, even if the list reports the end", () => {
    expect(newMessagesFollow(true, true)).toBe(false);
    expect(newMessagesFollow(false, true)).toBe(false);
  });

  it("not anchored: follows only at the end", () => {
    expect(newMessagesFollow(true, false)).toBe(true);
    expect(newMessagesFollow(false, false)).toBe(false);
  });
});

describe("landing near the end", () => {
  // Rows 4391 + header 12, footer and paddings make the native content 4508.
  const m = { firstItemOffset: 12, scrollOffset: 0, contentHeight: 4391, windowHeight: 974 };
  it("clamps to the native end with the footer, not rows + header", () => {
    expect(anchorTargetOffset({ ...m, itemTop: 4235 })).toBe(4403 - 974);
    expect(anchorTargetOffset({ ...m, itemTop: 4235, scrollHeight: 4508 })).toBe(4508 - 974);
  });
  it("a row in the last screen is the end", () => {
    expect(anchorIsEnd({ ...m, itemTop: 4235, scrollHeight: 4508 })).toBe(true);
  });
  it("a row that can reach the top of the window is not", () => {
    expect(anchorIsEnd({ ...m, itemTop: 1000, scrollHeight: 4508 })).toBe(false);
  });
});
