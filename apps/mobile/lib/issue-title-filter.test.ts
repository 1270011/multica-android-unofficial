// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "@multica/core/types";

vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 0, height: 0 }) }));

import {
  allHiddenByTitle,
  applyTitleFilter,
  revealEndsOnBlur,
  titleFilterHint,
} from "./issue-title-filter";
import { EMPTY_ISSUE_LIST_FILTERS, filterIssueList, type IssueListFilters } from "./issue-list-filters";
import { boardColumns } from "./board";
import {
  getTitleFilterMatcher,
  resetTitleFilterCachesForTest,
  setTitleFilterClockForTest,
} from "./title-filter";
import { DEFAULT_TITLE_FILTER, type TitleFilterSettings } from "./view-prefs";
import { cpuBudgetMs, minCpuMs } from "./cpu-budget";

const on = (pattern: string, ignoreCase = false): TitleFilterSettings => ({
  enabled: true,
  pattern,
  ignoreCase,
  mutePush: false,
});
const issue = (id: string, title: string, status = "todo", priority = "none") =>
  ({ id, title, status, priority, created_at: "2026-10-01T00:00:00Z" }) as unknown as Issue;
const ids = (list: { id: string }[]) => list.map((i) => i.id);
const f = (patch: Partial<IssueListFilters>): IssueListFilters => ({
  ...EMPTY_ISSUE_LIST_FILTERS,
  ...patch,
});

const ISSUES = [
  issue("a", "AUTO: package 1", "todo", "high"),
  issue("b", "Feature", "todo", "high"),
  issue("c", "AUTO: package 2", "done", "low"),
  issue("d", "AUTO: package 2", "todo", "low"),
  issue("e", "auto: lower", "in_progress", "high"),
];

// Frozen clock: the time budget (title-filter.test.ts) must not switch the
// matcher off when a cold first test() is slow on a loaded runner.
beforeEach(() => {
  resetTitleFilterCachesForTest();
  setTitleFilterClockForTest(() => 0);
});

describe("applyTitleFilter", () => {
  it("hides matching titles and counts them (A5.2)", () => {
    const r = applyTitleFilter(ISSUES, getTitleFilterMatcher(on("^AUTO: ")));
    expect(ids(r.issues)).toEqual(["b", "e"]);
    expect(r.hidden).toBe(3);
  });

  it("hides both of two equal titles in a row (no g-flag lastIndex, A5.8)", () => {
    const r = applyTitleFilter(
      [issue("1", "AUTO: x"), issue("2", "AUTO: x"), issue("3", "AUTO: x")],
      getTitleFilterMatcher(on("^AUTO: ")),
    );
    expect(r.issues).toEqual([]);
    expect(r.hidden).toBe(3);
  });

  it("ignore case hides 'AUTO: x' with ^auto: (A5.7)", () => {
    const r = applyTitleFilter(ISSUES, getTitleFilterMatcher(on("^auto: ", true)));
    expect(ids(r.issues)).toEqual(["b"]);
  });

  it("off, empty or invalid pattern shows everything, same array (A5.1, A5.4)", () => {
    for (const s of [
      DEFAULT_TITLE_FILTER,
      on(""),
      on("("),
      on("(a+)+$"),
      { ...on("^AUTO: "), enabled: false },
    ]) {
      const r = applyTitleFilter(ISSUES, getTitleFilterMatcher(s));
      expect(r.issues).toBe(ISSUES);
      expect(r.hidden).toBe(0);
    }
  });

  it("nothing matches: same array, no hint", () => {
    const r = applyTitleFilter(ISSUES, getTitleFilterMatcher(on("^NOPE")));
    expect(r.issues).toBe(ISSUES);
    expect(r.hidden).toBe(0);
  });

  it("revealed shows all and keeps the count for 'Hide' (A5.6)", () => {
    const r = applyTitleFilter(ISSUES, getTitleFilterMatcher(on("^AUTO: ")), true);
    expect(r.issues).toBe(ISSUES);
    expect(r.hidden).toBe(3);
  });

  it("counts only among issues the other filters keep (combination, A5.8)", () => {
    const shown = filterIssueList(ISSUES, f({ statuses: ["todo"], priorities: ["high"] }));
    const r = applyTitleFilter(shown, getTitleFilterMatcher(on("^AUTO: ")));
    expect(ids(r.issues)).toEqual(["b"]);
    // "c" (done) and "d" (low) are already gone, so only "a" counts.
    expect(r.hidden).toBe(1);
  });

  it("board columns count only the visible issues (A5.2)", () => {
    const r = applyTitleFilter(ISSUES, getTitleFilterMatcher(on("^AUTO: ")));
    const cols = boardColumns(r.issues);
    const count = Object.fromEntries(cols.map((c) => [c.status, c.issues.length]));
    expect(count).toEqual({ todo: 1, in_progress: 1 });
  });

  it("filters 1000 issues with the other filters in under 5 ms (A5.9)", () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      issue(`id-${i}`, i % 4 === 0 ? `AUTO: package ${i} ${"x".repeat(80)}` : `Feature ${i}`),
    );
    const filters = f({ statuses: ["todo"] });
    let hidden = 0;
    const ms = minCpuMs(() => {
      resetTitleFilterCachesForTest();
      const matcher = getTitleFilterMatcher(on("^AUTO: |^TEST"));
      hidden = applyTitleFilter(filterIssueList(many, filters), matcher).hidden;
    });
    expect(hidden).toBe(250);
    expect(ms).toBeLessThan(cpuBudgetMs(5, 10));
  });
});

describe("titleFilterHint", () => {
  it("no row at 0, else hidden or revealed", () => {
    expect(titleFilterHint(0, false)).toBe("none");
    expect(titleFilterHint(0, true)).toBe("none");
    expect(titleFilterHint(37, false)).toBe("hidden");
    expect(titleFilterHint(37, true)).toBe("revealed");
  });
});

describe("allHiddenByTitle", () => {
  it("only when the title filter emptied a non-empty list", () => {
    expect(allHiddenByTitle(3, 0, 3)).toBe(true);
    expect(allHiddenByTitle(0, 0, 0)).toBe(false);
    expect(allHiddenByTitle(3, 3, 3)).toBe(false); // revealed
    expect(allHiddenByTitle(3, 1, 2)).toBe(false);
  });
});

describe("revealEndsOnBlur", () => {
  const tabs = (focused: string) => ({
    type: "tab",
    index: ["inbox", "my"].indexOf(focused),
    routes: [{ key: "inbox" }, { key: "my" }],
  });
  it("another bottom tab ends 'Show'", () => {
    expect(revealEndsOnBlur(tabs("inbox"), "my")).toBe(true);
  });
  it("an issue pushed above the tabs keeps it (tab still focused)", () => {
    expect(revealEndsOnBlur(tabs("my"), "my")).toBe(false);
  });
  it("stack screens keep it until they unmount", () => {
    expect(
      revealEndsOnBlur({ type: "stack", index: 1, routes: [{ key: "p" }, { key: "i" }] }, "p"),
    ).toBe(false);
    expect(revealEndsOnBlur(undefined, "p")).toBe(false);
  });
});
