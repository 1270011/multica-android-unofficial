import { describe, expect, it, vi } from "vitest";
import type { QueryKey } from "@tanstack/react-query";
import { createFocusRefreshTracker } from "./focus-refresh-tracker";

function setup(initialFocused: boolean, initialKeys: readonly QueryKey[] = [["inbox", "ws1"]]) {
  const park = vi.fn<(keys: readonly QueryKey[], focused: boolean) => void>();
  const onRegain = vi.fn<(keys: readonly QueryKey[]) => void>();
  const tracker = createFocusRefreshTracker({ initialFocused, initialKeys, park, onRegain });
  return { tracker, park, onRegain };
}

describe("createFocusRefreshTracker", () => {
  it("pushing a screen on top (blur) parks the keys without a refetch", () => {
    const { tracker, park, onRegain } = setup(true);
    tracker.blur();
    expect(park).toHaveBeenLastCalledWith([["inbox", "ws1"]], false);
    expect(onRegain).not.toHaveBeenCalled();
    expect(tracker.isFocused()).toBe(false);
  });

  it("coming back (focus after blur) unparks and refreshes once", () => {
    const { tracker, park, onRegain } = setup(true);
    tracker.blur();
    tracker.focus();
    expect(park).toHaveBeenLastCalledWith([["inbox", "ws1"]], true);
    expect(onRegain).toHaveBeenCalledTimes(1);
    expect(onRegain).toHaveBeenCalledWith([["inbox", "ws1"]]);
  });

  it("does not refresh on the initial focus or on repeated focus events", () => {
    const { tracker, onRegain, park } = setup(true);
    tracker.focus();
    tracker.focus();
    expect(onRegain).not.toHaveBeenCalled();
    expect(park).not.toHaveBeenCalled();
  });

  it("a screen mounted unfocused refreshes on its first focus", () => {
    const { tracker, onRegain } = setup(false);
    tracker.blur();
    expect(onRegain).not.toHaveBeenCalled();
    tracker.focus();
    expect(onRegain).toHaveBeenCalledTimes(1);
  });

  it("setKeys re-parks under the current focus state and later events use the new keys", () => {
    const { tracker, park, onRegain } = setup(true);
    tracker.setKeys([["inbox", "ws2"]]);
    expect(park).toHaveBeenLastCalledWith([["inbox", "ws2"]], true);
    tracker.blur();
    expect(park).toHaveBeenLastCalledWith([["inbox", "ws2"]], false);
    tracker.setKeys([["inbox", "ws3"]]);
    expect(park).toHaveBeenLastCalledWith([["inbox", "ws3"]], false);
    tracker.focus();
    expect(onRegain).toHaveBeenCalledWith([["inbox", "ws3"]]);
  });
});
