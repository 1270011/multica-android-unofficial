/**
 * Issue title filter: validate and
 * compile the user's pattern, guard against catastrophic backtracking and
 * match issue titles.
 *
 * Pure functions only, no React. Consumers:
 *   - Settings › View › Hide issues (P7): `checkTitlePattern`, preview
 *   - lists and board (P8) and push mute (W7): `matchesTitleFilter`
 *
 * Rules (concept W5 "Technik"):
 *   - flags are `""` or `"i"`, never `g`/`y` (a moving `lastIndex` would let
 *     every second matching title through)
 *   - pattern at most 200 characters, titles cut to 300 before the test
 *   - nested quantifiers (`(a+)+`, `(.*)*`, `(\w+\s?)*`) are rejected
 *   - a test run over the loaded titles longer than 50 ms rejects the pattern
 *   - an unusable pattern never throws: the filter is simply off
 */
import type { TitleFilterSettings } from "./view-prefs";

export const TITLE_FILTER_MAX_PATTERN = 200;
export const TITLE_FILTER_MAX_TITLE = 300;
export const TITLE_FILTER_MAX_TEST_MS = 50;
/** One `test()` on a 300-character title normally takes microseconds. A
 *  single call above this budget switches the matcher off for the session
 *  (guard for stored patterns that are slow on titles loaded later). */
export const TITLE_FILTER_MAX_SINGLE_MS = 10;

export type TitlePatternError =
  | { kind: "invalid"; message: string }
  | { kind: "too_long" }
  | { kind: "too_complex" }
  | { kind: "too_slow" };

export type TitlePatternCheck =
  | { ok: true; regex: RegExp }
  | { ok: false; error: TitlePatternError };

export function titleFilterFlags(ignoreCase: boolean): "" | "i" {
  return ignoreCase ? "i" : "";
}

/**
 * Heuristic for nested repetition: a group whose content holds a quantifier
 * (`+`, `*`, `{n…}`) and that is itself directly followed by `+`, `*` or
 * `{`. Escapes and character classes are skipped, so `\(a+\)+` or `[+]+`
 * are fine.
 */
export function hasNestedQuantifier(pattern: string): boolean {
  // One entry per open group: does its content contain a quantifier?
  const groups: boolean[] = [];
  let i = 0;
  const isQuantifierAt = (at: number): boolean => {
    const c = pattern[at];
    if (c === "+" || c === "*") return true;
    return c === "{" && /^\{\d+(,\d*)?\}/.test(pattern.slice(at));
  };
  const markQuantified = () => {
    if (groups.length > 0) groups[groups.length - 1] = true;
  };
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") {
      // Skip the class; `]` right after `[` or `[^` is a literal.
      i += 1;
      if (pattern[i] === "^") i += 1;
      if (pattern[i] === "]") i += 1;
      while (i < pattern.length && pattern[i] !== "]") {
        i += pattern[i] === "\\" ? 2 : 1;
      }
      i += 1;
      continue;
    }
    if (c === "(") {
      groups.push(false);
      i += 1;
      continue;
    }
    if (c === ")") {
      const inner = groups.pop() ?? false;
      if (isQuantifierAt(i + 1)) {
        if (inner) return true;
        markQuantified();
      } else if (inner) {
        markQuantified();
      }
      i += 1;
      continue;
    }
    if (isQuantifierAt(i)) markQuantified();
    i += 1;
  }
  return false;
}

/** Syntax, length and complexity, without timing. Never throws. */
export function validateTitlePattern(pattern: string, ignoreCase: boolean): TitlePatternCheck {
  if (pattern.length > TITLE_FILTER_MAX_PATTERN) {
    return { ok: false, error: { kind: "too_long" } };
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, titleFilterFlags(ignoreCase));
  } catch (e) {
    return { ok: false, error: { kind: "invalid", message: shortRegexMessage(e) } };
  }
  if (hasNestedQuantifier(pattern)) {
    return { ok: false, error: { kind: "too_complex" } };
  }
  return { ok: true, regex };
}

/** "Invalid regular expression: /(/: Unterminated group" → "Unterminated group". */
export function shortRegexMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const tail = raw.split(": ").pop() ?? raw;
  return tail.trim() || raw;
}

export function truncateTitle(title: string): string {
  return title.length > TITLE_FILTER_MAX_TITLE ? title.slice(0, TITLE_FILTER_MAX_TITLE) : title;
}

type Clock = () => number;

/** Tests only: replaces the real clock (see `setTitleFilterClockForTest`). */
let testClock: Clock | null = null;

const defaultClock: Clock = () => {
  if (testClock) return testClock();
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
};

/**
 * Tests only: clock behind every call without an explicit `clock`
 * (`matchesTitleFilter`, `getTitleFilterMatcher(settings)`), `null` for the
 * real one. Functional tests use a frozen clock, so a cold first `test()` on
 * a loaded runner cannot trip the time budget and switch the filter off.
 */
export function setTitleFilterClockForTest(clock: Clock | null) {
  testClock = clock;
}

/** Milliseconds for one pass of `regex` over `titles` (already cut). */
export function measureTitlePattern(
  regex: RegExp,
  titles: readonly string[],
  clock: Clock = defaultClock,
): number {
  const start = clock();
  for (const title of titles) regex.test(truncateTitle(title));
  return clock() - start;
}

/**
 * Full check used when saving: validation plus a timed test run over the
 * loaded titles. A slow pattern is remembered (see `isMarkedTooSlow`), so
 * the lists treat it as off for the rest of the session.
 */
export function checkTitlePattern(
  pattern: string,
  ignoreCase: boolean,
  titles: readonly string[],
  clock: Clock = defaultClock,
): TitlePatternCheck {
  const check = validateTitlePattern(pattern, ignoreCase);
  if (!check.ok) return check;
  if (measureTitlePattern(check.regex, titles, clock) > TITLE_FILTER_MAX_TEST_MS) {
    markTooSlow(pattern, ignoreCase);
    return { ok: false, error: { kind: "too_slow" } };
  }
  return check;
}

const tooSlow = new Set<string>();
const slowKey = (pattern: string, ignoreCase: boolean) =>
  `${titleFilterFlags(ignoreCase)}/${pattern}`;

function markTooSlow(pattern: string, ignoreCase: boolean) {
  tooSlow.add(slowKey(pattern, ignoreCase));
}

export function isMarkedTooSlow(pattern: string, ignoreCase: boolean): boolean {
  return tooSlow.has(slowKey(pattern, ignoreCase));
}

/** Tests only. */
export function resetTitleFilterCachesForTest() {
  tooSlow.clear();
  cachedMatcher = null;
}

/** Why a stored filter does not filter, or `null` when it is active. */
export type TitleFilterState =
  | { status: "off" }
  | { status: "active"; regex: RegExp }
  | { status: "error"; error: TitlePatternError };

export function titleFilterState(settings: TitleFilterSettings): TitleFilterState {
  if (!settings.enabled || settings.pattern === "") return { status: "off" };
  return patternState(settings);
}

/** Like `titleFilterState`, ignoring the switch (preview and field error). */
export function patternState(
  settings: Pick<TitleFilterSettings, "pattern" | "ignoreCase">,
): TitleFilterState {
  if (settings.pattern === "") return { status: "off" };
  if (isMarkedTooSlow(settings.pattern, settings.ignoreCase)) {
    return { status: "error", error: { kind: "too_slow" } };
  }
  const check = validateTitlePattern(settings.pattern, settings.ignoreCase);
  return check.ok
    ? { status: "active", regex: check.regex }
    : { status: "error", error: check.error };
}

export interface TitleFilterIssue {
  id: string;
  title: string;
}

export interface TitleFilterMatcher {
  /** False when the filter is off or the pattern unusable. */
  readonly active: boolean;
  /** True when the issue is hidden by the title filter. */
  matchesTitleFilter(issue: TitleFilterIssue): boolean;
}

const INACTIVE: TitleFilterMatcher = Object.freeze({
  active: false,
  matchesTitleFilter: () => false,
});

function regexMatcher(
  regex: RegExp,
  pattern: string,
  ignoreCase: boolean,
  clock: Clock,
): TitleFilterMatcher {
  // Result per id (with the title it was computed for); a new pattern
  // builds a new matcher, so the map starts empty.
  const results = new Map<string, { title: string; hit: boolean }>();
  let disabled = false;
  return {
    get active() {
      return !disabled;
    },
    matchesTitleFilter(issue) {
      if (disabled) return false;
      const cached = results.get(issue.id);
      if (cached && cached.title === issue.title) return cached.hit;
      const start = clock();
      // Flags are "" or "i": test() keeps no state between calls.
      const hit = regex.test(truncateTitle(issue.title));
      if (clock() - start > TITLE_FILTER_MAX_SINGLE_MS) {
        disabled = true;
        markTooSlow(pattern, ignoreCase);
        return false;
      }
      results.set(issue.id, { title: issue.title, hit });
      return hit;
    },
  };
}

let cachedMatcher: {
  clock: Clock;
  enabled: boolean;
  pattern: string;
  ignoreCase: boolean;
  matcher: TitleFilterMatcher;
} | null = null;

/**
 * Compiled matcher for the settings, reused while enabled/pattern/ignoreCase
 * stay the same (one compile per pattern, result cache per issue).
 */
export function getTitleFilterMatcher(
  settings: TitleFilterSettings,
  clock: Clock = defaultClock,
): TitleFilterMatcher {
  const c = cachedMatcher;
  if (
    c &&
    c.clock === clock &&
    c.enabled === settings.enabled &&
    c.pattern === settings.pattern &&
    c.ignoreCase === settings.ignoreCase
  ) {
    return c.matcher;
  }
  const state = titleFilterState(settings);
  const matcher =
    state.status === "active"
      ? regexMatcher(state.regex, settings.pattern, settings.ignoreCase, clock)
      : INACTIVE;
  cachedMatcher = {
    clock,
    enabled: settings.enabled,
    pattern: settings.pattern,
    ignoreCase: settings.ignoreCase,
    matcher,
  };
  return matcher;
}

/** True when the issue is hidden by the title filter `settings`. */
export function matchesTitleFilter(
  issue: TitleFilterIssue,
  settings: TitleFilterSettings,
): boolean {
  return getTitleFilterMatcher(settings).matchesTitleFilter(issue);
}

/** Preview "Matches x of y loaded issues" (ignores the on/off switch). */
export function titleFilterPreview(
  settings: Pick<TitleFilterSettings, "pattern" | "ignoreCase">,
  titles: readonly string[],
): { hidden: number; total: number } | null {
  const state = patternState(settings);
  if (state.status !== "active") return null;
  let hidden = 0;
  for (const title of titles) if (state.regex.test(truncateTitle(title))) hidden += 1;
  return { hidden, total: titles.length };
}
