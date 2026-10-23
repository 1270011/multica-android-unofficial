import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { coalesce, EVENT_COALESCE_MS } from "./coalesce";

describe("coalesce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs once at the end of the window, however many requests joined", () => {
    const fn = vi.fn();
    const c = coalesce(fn);
    for (let i = 0; i < 10; i++) c.schedule();
    vi.advanceTimersByTime(EVENT_COALESCE_MS - 1);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not push the run back on a steady stream (no starvation)", () => {
    const fn = vi.fn();
    const c = coalesce(fn, 1000);
    for (let t = 0; t < 2500; t += 50) {
      c.schedule();
      vi.advanceTimersByTime(50);
    }
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel drops the pending run and allows a new one", () => {
    const fn = vi.fn();
    const c = coalesce(fn);
    c.schedule();
    c.cancel();
    vi.advanceTimersByTime(EVENT_COALESCE_MS);
    expect(fn).not.toHaveBeenCalled();
    c.schedule();
    vi.advanceTimersByTime(EVENT_COALESCE_MS);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
