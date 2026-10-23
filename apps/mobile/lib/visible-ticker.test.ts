import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VISIBLE_TICK_MS, createVisibleTicker } from "./visible-ticker";

describe("createVisibleTicker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not tick while the screen is not focused", () => {
    const onTick = vi.fn();
    const t = createVisibleTicker(onTick);
    vi.advanceTimersByTime(5 * VISIBLE_TICK_MS);
    expect(onTick).not.toHaveBeenCalled();
    expect(t.isRunning()).toBe(false);
  });

  it("ticks immediately on focus and then every 30 s", () => {
    const onTick = vi.fn();
    const t = createVisibleTicker(onTick);
    t.setFocused(true);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(VISIBLE_TICK_MS - 1);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onTick).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2 * VISIBLE_TICK_MS);
    expect(onTick).toHaveBeenCalledTimes(4);
  });

  it("stops on blur and on app background, resumes with an immediate tick", () => {
    const onTick = vi.fn();
    const t = createVisibleTicker(onTick, { focused: true });
    expect(onTick).toHaveBeenCalledTimes(1);
    t.setAppActive(false);
    vi.advanceTimersByTime(10 * VISIBLE_TICK_MS);
    expect(onTick).toHaveBeenCalledTimes(1);
    t.setAppActive(true);
    expect(onTick).toHaveBeenCalledTimes(2);
    t.setFocused(false);
    vi.advanceTimersByTime(10 * VISIBLE_TICK_MS);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(t.isRunning()).toBe(false);
  });

  it("repeated focus events do not stack intervals", () => {
    const onTick = vi.fn();
    const t = createVisibleTicker(onTick);
    t.setFocused(true);
    t.setFocused(true);
    t.setAppActive(true);
    vi.advanceTimersByTime(VISIBLE_TICK_MS);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it("dispose stops for good", () => {
    const onTick = vi.fn();
    const t = createVisibleTicker(onTick, { focused: true });
    t.dispose();
    t.setFocused(true);
    vi.advanceTimersByTime(10 * VISIBLE_TICK_MS);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it("starts paused when created with the app in background", () => {
    const onTick = vi.fn();
    const t = createVisibleTicker(onTick, { focused: true, appActive: false });
    expect(t.isRunning()).toBe(false);
    expect(onTick).not.toHaveBeenCalled();
  });
});
