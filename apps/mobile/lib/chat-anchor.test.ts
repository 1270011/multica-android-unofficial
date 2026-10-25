import { describe, expect, it } from "vitest";
import {
  anchorIsEnd,
  anchorIsNear,
  ANCHOR_HOLD_MS,
  ANCHOR_RECHECK_MS,
  anchorHolds,
  ANCHOR_TOP_GAP_PX,
  ANCHOR_TOLERANCE_PX,
  anchorNeedsCorrection,
  anchorScrollParams,
  anchorTargetOffset,
  autoscrollThreshold,
  holdScrollToEnd,
  innerOffset,
  returnInner,
  RETURN_VISIBLE_PX,
  tableReturnKeeps,
  tableReturnRowInner,
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

  it("lands inside the row when given the spot (far correction)", () => {
    // FlashList: final = top + viewOffset (viewPosition 0) = the measured aim.
    const inner = 949;
    const { viewOffset } = anchorScrollParams(4, inner);
    expect(base.itemTop + viewOffset + base.firstItemOffset).toBe(
      anchorTargetOffset({ ...base, inner, scrollHeight: 1e6 }),
    );
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

describe("landing inside the row (table after a rotation)", () => {
  it("puts the spot `inner` below the row top at the landing gap", () => {
    expect(anchorTargetOffset({ ...base, inner: 1800 })).toBe(5000 + 1800 + 12 - ANCHOR_TOP_GAP_PX);
    expect(anchorNeedsCorrection({ ...base, inner: 1800, scrollOffset: 5000 + 12 - ANCHOR_TOP_GAP_PX })).toBe(true);
  });

  it("still clamps to the end", () => {
    expect(anchorTargetOffset({ ...base, itemTop: 19000, inner: 900 })).toBe(20000 + 12 - 700);
    expect(anchorIsEnd({ ...base, itemTop: 19000, inner: 900 })).toBe(true);
  });

  it("innerOffset: table top on screen minus row top on screen", () => {
    // List box at y=100, scrolled so the row top is 8 px below it; the
    // table is drawn 1300 px further down on screen.
    const m = { listTop: 100, itemTop: 5000, firstItemOffset: 12, scrollOffset: 5004 };
    expect(innerOffset({ ...m, viewTop: 100 + 8 + 1300 })).toBe(1300);
  });

  it("innerOffset is never negative (view above the row: land on its top)", () => {
    expect(
      innerOffset({ viewTop: 0, listTop: 100, itemTop: 5000, firstItemOffset: 12, scrollOffset: 5004 }),
    ).toBe(0);
  });
});

describe("returnInner", () => {
  const m = { inner: 1300, height: 900, listTop: 100, windowHeight: 700 };

  it("puts the table top back where it stood on screen when it was opened", () => {
    // Opened with the table top 250 px below the list's top.
    const inner = returnInner({ ...m, savedTop: 350 });
    const offset = anchorTargetOffset({ ...base, inner });
    const rowTopOnScreen = base.itemTop + base.firstItemOffset - offset;
    expect(rowTopOnScreen + 1300).toBe(250);
  });

  it("keeps a table that started above the window top there (tall cards at 200 %)", () => {
    const inner = returnInner({ ...m, savedTop: 100 - 600 });
    const offset = anchorTargetOffset({ ...base, inner });
    expect(base.itemTop + base.firstItemOffset - offset + 1300).toBe(-600);
  });

  it("keeps some of the table visible when the layout changed", () => {
    const above = returnInner({ ...m, savedTop: -5000 });
    expect(base.itemTop + base.firstItemOffset - anchorTargetOffset({ ...base, inner: above }) + 1300).toBe(
      RETURN_VISIBLE_PX - 900,
    );
    const below = returnInner({ ...m, savedTop: 5000 });
    expect(base.itemTop + base.firstItemOffset - anchorTargetOffset({ ...base, inner: below }) + 1300).toBe(
      700 - RETURN_VISIBLE_PX,
    );
  });

  it("without a saved place the table top lands at the gap", () => {
    expect(returnInner({ ...m, savedTop: null })).toBe(1300);
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

describe("anchorIsNear", () => {
  it("a few pixels off (start at the row's top, no landing gap) is near", () => {
    const at = anchorTargetOffset(base);
    expect(anchorIsNear({ ...base, scrollOffset: at + ANCHOR_TOP_GAP_PX })).toBe(true);
  });

  it("a window or more away (list at its end) is not near: the rows there must render first", () => {
    const at = anchorTargetOffset(base);
    expect(anchorIsNear({ ...base, scrollOffset: at + base.windowHeight })).toBe(false);
    expect(anchorIsNear({ ...base, scrollOffset: 20000 + 12 - 700 })).toBe(false);
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

describe("tableReturnKeeps", () => {
  const saved = { top: 104.8, height: 812 };

  it("keeps the chat when the row has its old place and height", () => {
    expect(tableReturnKeeps(saved, { top: 104.8, height: 812 })).toBe(true);
    expect(tableReturnKeeps(saved, { top: 104.8 + ANCHOR_TOLERANCE_PX, height: 812 - ANCHOR_TOLERANCE_PX })).toBe(true);
  });

  it("corrects when the row moved or changed height (200 %: rewrapped rows)", () => {
    expect(tableReturnKeeps(saved, { top: 212.6, height: 812 })).toBe(false);
    expect(tableReturnKeeps(saved, { top: 104.8, height: 1290 })).toBe(false);
  });

  it("corrects without a saved or current place", () => {
    expect(tableReturnKeeps(null, saved)).toBe(false);
    expect(tableReturnKeeps(saved, null)).toBe(false);
  });
});

describe("tableReturnRowInner", () => {
  it("puts the row's top back to its saved place when only the offset changed", () => {
    const saved = { top: -1738.5, height: 2382.5 };
    const inner = tableReturnRowInner(saved, { top: 713, height: 2382.5 });
    expect(inner).toBe(ANCHOR_TOP_GAP_PX + 1738.5);
    // anchorTargetOffset: row top lands at itemTop + firstItemOffset - offset = saved.top
    const m = { ...base, inner: inner ?? 0, scrollHeight: 100000 };
    expect(m.itemTop + m.firstItemOffset - anchorTargetOffset(m)).toBeCloseTo(saved.top);
  });

  it("leaves a rewrapped row (other height) to the measured return", () => {
    expect(tableReturnRowInner({ top: -846, height: 1539 }, { top: 13036, height: 1083 })).toBeNull();
    expect(tableReturnRowInner(null, { top: 0, height: 10 })).toBeNull();
    expect(tableReturnRowInner({ top: 0, height: 10 }, null)).toBeNull();
  });
});
