import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTitleFilterCachesForTest } from "../title-filter";
import { DEFAULT_TITLE_FILTER, type TitleFilterSettings } from "../view-prefs";
import {
  createTitleMuteMirror,
  sameTitleMute,
  titleMuteAvailable,
  titleMuteConfig,
} from "./title-mute";

beforeEach(() => resetTitleFilterCachesForTest());

const on = (over: Partial<TitleFilterSettings> = {}): TitleFilterSettings => ({
  ...DEFAULT_TITLE_FILTER,
  enabled: true,
  mutePush: true,
  ...over,
});

describe("titleMuteAvailable", () => {
  it("needs the filter on and a valid pattern", () => {
    expect(titleMuteAvailable(DEFAULT_TITLE_FILTER)).toBe(false);
    expect(titleMuteAvailable(on())).toBe(true);
    expect(titleMuteAvailable(on({ enabled: false }))).toBe(false);
    expect(titleMuteAvailable(on({ pattern: "" }))).toBe(false);
    expect(titleMuteAvailable(on({ pattern: "(" }))).toBe(false);
    expect(titleMuteAvailable(on({ pattern: "(a+)+" }))).toBe(false);
    expect(titleMuteAvailable(on({ pattern: "a".repeat(201) }))).toBe(false);
  });
});

describe("titleMuteConfig", () => {
  it("is off by default", () => {
    expect(DEFAULT_TITLE_FILTER.mutePush).toBe(false);
    expect(titleMuteConfig({ ...DEFAULT_TITLE_FILTER, enabled: true })).toBeNull();
  });

  it("mirrors pattern and case only when filter and switch are on", () => {
    expect(titleMuteConfig(on())).toEqual({ pattern: "^AUTO: ", ignoreCase: false });
    expect(titleMuteConfig(on({ ignoreCase: true }))).toEqual({ pattern: "^AUTO: ", ignoreCase: true });
    expect(titleMuteConfig(on({ mutePush: false }))).toBeNull();
    expect(titleMuteConfig(on({ enabled: false }))).toBeNull();
  });

  it("never mutes with an unusable pattern (the switch stays stored)", () => {
    expect(titleMuteConfig(on({ pattern: "(" }))).toBeNull();
    expect(titleMuteConfig(on({ pattern: "(.*)*" }))).toBeNull();
  });
});

describe("createTitleMuteMirror", () => {
  it("pushes each workspace once and then only changes", () => {
    const push = vi.fn();
    const mirror = createTitleMuteMirror(push);
    mirror.sync({ a: on(), b: DEFAULT_TITLE_FILTER });
    expect(push.mock.calls).toEqual([
      ["a", { pattern: "^AUTO: ", ignoreCase: false }],
      ["b", null],
    ]);
    push.mockClear();
    mirror.sync({ a: on(), b: DEFAULT_TITLE_FILTER });
    expect(push).not.toHaveBeenCalled();
    mirror.sync({ a: on({ pattern: "^WIP" }), b: DEFAULT_TITLE_FILTER });
    expect(push.mock.calls).toEqual([["a", { pattern: "^WIP", ignoreCase: false }]]);
    push.mockClear();
    mirror.sync({ a: on({ pattern: "^WIP", enabled: false }) });
    expect(push.mock.calls).toEqual([["a", null]]);
  });

  it("pushes again after a reset (new session)", () => {
    const push = vi.fn();
    const mirror = createTitleMuteMirror(push);
    mirror.sync({ a: on() });
    mirror.reset();
    mirror.sync({ a: on() });
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("compares configs", () => {
    expect(sameTitleMute(null, null)).toBe(true);
    expect(sameTitleMute(null, { pattern: "x", ignoreCase: false })).toBe(false);
    expect(sameTitleMute({ pattern: "x", ignoreCase: true }, { pattern: "x", ignoreCase: false })).toBe(false);
  });
});
