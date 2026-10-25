import { beforeEach, describe, expect, it } from "vitest";
import {
  checkTitlePattern,
  getTitleFilterMatcher,
  hasNestedQuantifier,
  isMarkedTooSlow,
  matchesTitleFilter,
  measureTitlePattern,
  patternState,
  resetTitleFilterCachesForTest,
  setTitleFilterClockForTest,
  shortRegexMessage,
  TITLE_FILTER_MAX_PATTERN,
  TITLE_FILTER_MAX_SINGLE_MS,
  TITLE_FILTER_MAX_TEST_MS,
  TITLE_FILTER_MAX_TITLE,
  titleFilterPreview,
  titleFilterState,
  truncateTitle,
  validateTitlePattern,
} from "./title-filter";
import { DEFAULT_TITLE_FILTER, type TitleFilterSettings } from "./view-prefs";
import { cpuBudgetMs, minCpuMs } from "./cpu-budget";

const on = (pattern: string, ignoreCase = false): TitleFilterSettings => ({
  enabled: true,
  pattern,
  ignoreCase,
  mutePush: false,
});

/** Fake clock: every call advances by `step` ms. */
function steppingClock(step: number) {
  let now = 0;
  return () => {
    now += step;
    return now;
  };
}

/** Fake clock returning `times` in order, then repeating the last one. */
function sequenceClock(...times: number[]) {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

// Functional tests run on a frozen clock, so real runtime under CI load never
// trips the budget. The budget itself is tested with fake clocks.
beforeEach(() => {
  resetTitleFilterCachesForTest();
  setTitleFilterClockForTest(() => 0);
});

describe("validateTitlePattern", () => {
  it("accepts the default and alternatives", () => {
    for (const p of ["^AUTO: ", "^AUTO: |^TEST", "(?:ab)+", "a{2,3}", "\\(a+\\)+", "[+*]+", "(a)+", "x(?=y)"]) {
      expect(validateTitlePattern(p, false).ok, p).toBe(true);
    }
  });

  it("reports invalid syntax with a short message and never throws", () => {
    const check = validateTitlePattern("(", false);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error.kind).toBe("invalid");
      if (check.error.kind === "invalid") {
        expect(check.error.message.length).toBeGreaterThan(0);
        expect(check.error.message).not.toContain("Invalid regular expression");
      }
    }
    for (const p of ["[", "*", "a{2,1}", "(?<", "\\"]) {
      expect(() => validateTitlePattern(p, true)).not.toThrow();
      expect(validateTitlePattern(p, true).ok, p).toBe(false);
    }
  });

  it("rejects patterns over 200 characters", () => {
    expect(validateTitlePattern("a".repeat(TITLE_FILTER_MAX_PATTERN), false).ok).toBe(true);
    const check = validateTitlePattern("a".repeat(TITLE_FILTER_MAX_PATTERN + 1), false);
    expect(check).toEqual({ ok: false, error: { kind: "too_long" } });
  });

  it("rejects nested repetition as too complex", () => {
    for (const p of ["(a+)+$", "(.*)*", "(\\w+\\s?)*", "(a*){2}", "((ab)+)+", "(?:x+y)*", "((a+))+", "(a+b){1,}"]) {
      expect(validateTitlePattern(p, false), p).toEqual({ ok: false, error: { kind: "too_complex" } });
    }
  });

  it("compiles without g/y, only i when ignoring case", () => {
    const a = validateTitlePattern("^AUTO: ", false);
    const b = validateTitlePattern("^AUTO: ", true);
    expect(a.ok && a.regex.flags).toBe("");
    expect(b.ok && b.regex.flags).toBe("i");
  });
});

describe("hasNestedQuantifier", () => {
  it("ignores escapes and character classes", () => {
    expect(hasNestedQuantifier("\\(a+\\)+")).toBe(false);
    expect(hasNestedQuantifier("([+])+")).toBe(false);
    expect(hasNestedQuantifier("([]+])+")).toBe(false);
    expect(hasNestedQuantifier("([^)]+)+")).toBe(true);
    expect(hasNestedQuantifier("(a{x})+")).toBe(false); // literal braces
  });

  it("does not flag a quantified group without inner repetition", () => {
    expect(hasNestedQuantifier("(ab)+")).toBe(false);
    expect(hasNestedQuantifier("(a|b)*c+")).toBe(false);
    expect(hasNestedQuantifier("(a+)?")).toBe(false);
  });
});

describe("shortRegexMessage", () => {
  it("keeps the last part of the engine message", () => {
    expect(shortRegexMessage(new SyntaxError("Invalid regular expression: /(/: Unterminated group"))).toBe(
      "Unterminated group",
    );
    expect(shortRegexMessage("plain")).toBe("plain");
  });
});

describe("timing guard", () => {
  it("cuts titles to 300 characters", () => {
    expect(truncateTitle("x".repeat(500))).toHaveLength(TITLE_FILTER_MAX_TITLE);
    expect(truncateTitle("short")).toBe("short");
    // A match only after character 300 does not count.
    expect(matchesTitleFilter({ id: "1", title: `${"x".repeat(300)}AUTO` }, on("AUTO"))).toBe(false);
  });

  it("measures one pass with the given clock", () => {
    expect(measureTitlePattern(/a/, ["a", "b"], steppingClock(7))).toBe(7);
  });

  it("rejects a pattern whose test run exceeds 50 ms and marks it", () => {
    const check = checkTitlePattern("(a|a)*b", false, ["aaaa"], steppingClock(51));
    expect(check).toEqual({ ok: false, error: { kind: "too_slow" } });
    expect(isMarkedTooSlow("(a|a)*b", false)).toBe(true);
    expect(isMarkedTooSlow("(a|a)*b", true)).toBe(false);
    expect(patternState({ pattern: "(a|a)*b", ignoreCase: false })).toEqual({
      status: "error",
      error: { kind: "too_slow" },
    });
    expect(checkTitlePattern("^AUTO: ", false, ["AUTO: x"], steppingClock(1)).ok).toBe(true);
  });

  it("switches the matcher off after one very slow test", () => {
    const matcher = getTitleFilterMatcher(on("^A"), steppingClock(20));
    expect(matcher.active).toBe(true);
    expect(matcher.matchesTitleFilter({ id: "1", title: "AUTO: x" })).toBe(false);
    expect(matcher.active).toBe(false);
    expect(isMarkedTooSlow("^A", false)).toBe(true);
  });

  it("accepts a test run of exactly 50 ms, rejects 51 ms", () => {
    const at = (ms: number) => checkTitlePattern("^AUTO: ", false, ["AUTO: x"], sequenceClock(0, ms));
    expect(at(TITLE_FILTER_MAX_TEST_MS).ok).toBe(true);
    expect(isMarkedTooSlow("^AUTO: ", false)).toBe(false);
    expect(at(TITLE_FILTER_MAX_TEST_MS + 1)).toEqual({ ok: false, error: { kind: "too_slow" } });
    expect(isMarkedTooSlow("^AUTO: ", false)).toBe(true);
  });

  it("keeps the matcher on at exactly 10 ms per test", () => {
    const matcher = getTitleFilterMatcher(on("^A"), steppingClock(TITLE_FILTER_MAX_SINGLE_MS));
    expect(matcher.matchesTitleFilter({ id: "1", title: "AUTO: x" })).toBe(true);
    expect(matcher.matchesTitleFilter({ id: "2", title: "Feature" })).toBe(false);
    expect(matcher.active).toBe(true);
    expect(isMarkedTooSlow("^A", false)).toBe(false);
  });

  it("a slow cold first test switches the filter off for the session", () => {
    // First test() 11 ms, every later one 0 ms: the matcher stays off.
    const matcher = getTitleFilterMatcher(on("^A"), sequenceClock(0, TITLE_FILTER_MAX_SINGLE_MS + 1, 20));
    expect(matcher.matchesTitleFilter({ id: "1", title: "AUTO: x" })).toBe(false);
    expect(matcher.matchesTitleFilter({ id: "2", title: "AUTO: y" })).toBe(false);
    expect(matcher.active).toBe(false);
    // A new matcher for the same pattern (other pattern in between) stays off.
    expect(getTitleFilterMatcher(on("^B")).active).toBe(true);
    expect(getTitleFilterMatcher(on("^A")).active).toBe(false);
    expect(patternState({ pattern: "^A", ignoreCase: false })).toEqual({
      status: "error",
      error: { kind: "too_slow" },
    });
    // Other flags are a different pattern.
    expect(getTitleFilterMatcher(on("^A", true)).active).toBe(true);
  });

  it("cached results are not timed again", () => {
    let calls = 0;
    const matcher = getTitleFilterMatcher(on("^A"), () => {
      calls += 1;
      return 0;
    });
    matcher.matchesTitleFilter({ id: "1", title: "AUTO: x" });
    matcher.matchesTitleFilter({ id: "1", title: "AUTO: x" });
    expect(calls).toBe(2);
  });

  it("the test clock hook drives calls without an explicit clock", () => {
    setTitleFilterClockForTest(steppingClock(TITLE_FILTER_MAX_SINGLE_MS + 1));
    expect(matchesTitleFilter({ id: "1", title: "AUTO: x" }, on("^A"))).toBe(false);
    expect(isMarkedTooSlow("^A", false)).toBe(true);
  });

  it("without the hook, the real clock measures (no budget assertion)", () => {
    setTitleFilterClockForTest(null);
    const ms = measureTitlePattern(/a/, ["a", "b"]);
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it("an explicit clock gets its own matcher, not the cached one", () => {
    const real = getTitleFilterMatcher(on("^A"));
    const slow = getTitleFilterMatcher(on("^A"), steppingClock(20));
    expect(slow).not.toBe(real);
    expect(slow.matchesTitleFilter({ id: "1", title: "AUTO: x" })).toBe(false);
    expect(slow.active).toBe(false);
  });
});

describe("titleFilterState", () => {
  it("is off when disabled or empty, error for unusable patterns", () => {
    expect(titleFilterState(DEFAULT_TITLE_FILTER)).toEqual({ status: "off" });
    expect(titleFilterState(on(""))).toEqual({ status: "off" });
    expect(titleFilterState(on("^AUTO: ")).status).toBe("active");
    expect(titleFilterState(on("(")).status).toBe("error");
    expect(titleFilterState(on("(a+)+$"))).toEqual({ status: "error", error: { kind: "too_complex" } });
  });
});

describe("matchesTitleFilter", () => {
  it("hides matching titles, case-sensitive by default", () => {
    const s = on("^AUTO: ");
    expect(matchesTitleFilter({ id: "1", title: "AUTO: build" }, s)).toBe(true);
    expect(matchesTitleFilter({ id: "2", title: "auto: build" }, s)).toBe(false);
    expect(matchesTitleFilter({ id: "3", title: "Fix AUTO: later" }, s)).toBe(false);
  });

  it("ignores case when asked (A5.7)", () => {
    expect(matchesTitleFilter({ id: "1", title: "AUTO: x" }, on("^auto: ", true))).toBe(true);
    expect(matchesTitleFilter({ id: "1", title: "AUTO: x" }, on("^auto: ", false))).toBe(false);
  });

  it("hides nothing when off or invalid, without throwing (A5.4)", () => {
    const issue = { id: "1", title: "AUTO: x" };
    expect(matchesTitleFilter(issue, { ...on("^AUTO: "), enabled: false })).toBe(false);
    expect(() => matchesTitleFilter(issue, on("("))).not.toThrow();
    expect(matchesTitleFilter(issue, on("("))).toBe(false);
    expect(matchesTitleFilter(issue, on("(a+)+$"))).toBe(false);
    expect(getTitleFilterMatcher(on("(")).active).toBe(false);
  });

  it("hides two equal titles in a row (no lastIndex drift)", () => {
    const s = on("AUTO");
    const titles = ["AUTO: a", "AUTO: a", "AUTO: a", "AUTO: a"];
    expect(titles.map((title, i) => matchesTitleFilter({ id: String(i), title }, s))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("reuses the compiled matcher and caches per id + title", () => {
    const a = getTitleFilterMatcher(on("^AUTO: "));
    expect(getTitleFilterMatcher(on("^AUTO: "))).toBe(a);
    expect(getTitleFilterMatcher(on("^AUTO: ", true))).not.toBe(a);
    const m = getTitleFilterMatcher(on("^AUTO: "));
    expect(m.matchesTitleFilter({ id: "1", title: "AUTO: a" })).toBe(true);
    // Renamed issue: same id, new title is tested again.
    expect(m.matchesTitleFilter({ id: "1", title: "Done" })).toBe(false);
  });

  it("filters 1000 issues in under 5 ms (A5.9)", () => {
    const issues = Array.from({ length: 1000 }, (_, i) => ({
      id: `id-${i}`,
      title: i % 3 === 0 ? `AUTO: package ${i} ${"x".repeat(80)}` : `Feature ${i} ${"y".repeat(80)}`,
    }));
    const s = on("^AUTO: |^TEST");
    // Rough bound (A5.9): CPU time of fresh matchers after warm-up, fastest
    // pass; 10 ms in CI (coverage + loaded runner), see cpu-budget.ts.
    let hidden = 0;
    const ms = minCpuMs(() => {
      resetTitleFilterCachesForTest();
      hidden = issues.filter((issue) => matchesTitleFilter(issue, s)).length;
    });
    expect(hidden).toBe(334);
    expect(ms).toBeLessThan(cpuBudgetMs(5, 10));
  });
});

describe("titleFilterPreview", () => {
  it("counts matches among loaded titles, ignoring the switch", () => {
    const titles = ["AUTO: a", "AUTO: b", "Feature", "auto: c"];
    expect(titleFilterPreview({ pattern: "^AUTO: ", ignoreCase: false }, titles)).toEqual({ hidden: 2, total: 4 });
    expect(titleFilterPreview({ pattern: "^AUTO: ", ignoreCase: true }, titles)).toEqual({ hidden: 3, total: 4 });
    expect(titleFilterPreview({ pattern: "(", ignoreCase: false }, titles)).toBeNull();
    expect(titleFilterPreview({ pattern: "", ignoreCase: false }, titles)).toBeNull();
  });
});
