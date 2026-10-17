import { describe, expect, it } from "vitest";
import {
  INITIAL_CARD,
  LATER_MS,
  NATIVE_STRING_KEYS,
  afterDecision,
  afterLater,
  buildNativeStrings,
  dateFromHhmm,
  hhmm,
  mutedServerGroup,
  parseCardState,
  setCategory,
  setQuietHours,
  setWorkspaceEnabled,
  shouldShowCard,
} from "./push-logic";
import { DEFAULT_SETTINGS } from "./native";

describe("settings helpers", () => {
  it("toggles categories without duplicates", () => {
    const off = setCategory(DEFAULT_SETTINGS, "mentions", false);
    expect(off.disabledCategories).toEqual(["mentions"]);
    expect(setCategory(off, "mentions", false).disabledCategories).toEqual(["mentions"]);
    expect(setCategory(off, "mentions", true).disabledCategories).toEqual([]);
  });

  it("toggles workspaces", () => {
    const off = setWorkspaceEnabled(DEFAULT_SETTINGS, "rb", false);
    expect(off.disabledWorkspaces).toEqual(["rb"]);
    expect(setWorkspaceEnabled(off, "rb", true).disabledWorkspaces).toEqual([]);
  });

  it("sets and clears quiet hours", () => {
    const on = setQuietHours(DEFAULT_SETTINGS, { start: "22:00", end: "07:00" });
    expect([on.quietStart, on.quietEnd]).toEqual(["22:00", "07:00"]);
    expect(setQuietHours(on, null).quietStart).toBeNull();
  });

  it("formats and parses HH:MM", () => {
    expect(hhmm(new Date(2026, 9, 16, 7, 5))).toBe("07:05");
    const d = dateFromHhmm("22:30", new Date(2026, 9, 16, 1, 0));
    expect([d.getHours(), d.getMinutes()]).toEqual([22, 30]);
  });

  it("maps categories to the server inbox group that must be on", () => {
    const prefs = { status_changes: "muted" as const };
    expect(mutedServerGroup("blocked", prefs)).toBe("status_changes");
    expect(mutedServerGroup("approvals", prefs)).toBe("status_changes");
    expect(mutedServerGroup("mentions", prefs)).toBeNull();
    expect(mutedServerGroup("failed_runs", { agent_activity: "muted" })).toBe("agent_activity");
    expect(mutedServerGroup("assignments", undefined)).toBeNull();
  });
});

describe("permission card", () => {
  const ctx = { available: true, enabled: false, now: 1000 };

  it("shows once by default, never when unavailable or already on", () => {
    expect(shouldShowCard(INITIAL_CARD, ctx)).toBe(true);
    expect(shouldShowCard(INITIAL_CARD, { ...ctx, available: false })).toBe(false);
    expect(shouldShowCard(INITIAL_CARD, { ...ctx, enabled: true })).toBe(false);
  });

  it("hides for 7 days after the first later, for good after the second", () => {
    const once = afterLater(INITIAL_CARD, 1000);
    expect(shouldShowCard(once, { ...ctx, now: 1000 + LATER_MS - 1 })).toBe(false);
    expect(shouldShowCard(once, { ...ctx, now: 1000 + LATER_MS })).toBe(true);
    const twice = afterLater(once, 1000 + LATER_MS);
    expect(twice.done).toBe(true);
    expect(shouldShowCard(twice, { ...ctx, now: Number.MAX_SAFE_INTEGER })).toBe(false);
  });

  it("is done after a decision", () => {
    expect(shouldShowCard(afterDecision(INITIAL_CARD), ctx)).toBe(false);
  });

  it("parses stored state defensively", () => {
    expect(parseCardState(null)).toEqual(INITIAL_CARD);
    expect(parseCardState("{broken")).toEqual(INITIAL_CARD);
    expect(parseCardState('{"done":true,"laterCount":1,"hiddenUntil":5}')).toEqual({
      done: true,
      laterCount: 1,
      hiddenUntil: 5,
    });
  });
});

describe("native strings", () => {
  it("covers every native key and keeps {count} literal", () => {
    const seen: Array<[string, Record<string, unknown> | undefined]> = [];
    const out = buildNativeStrings((key, options) => {
      seen.push([key, options]);
      return key.endsWith("summary_title") ? `${String(options?.count)} issues` : key;
    });
    expect(Object.keys(out).sort()).toEqual(Object.keys(NATIVE_STRING_KEYS).sort());
    expect(out.summary_title).toBe("{count} issues");
  });
});
