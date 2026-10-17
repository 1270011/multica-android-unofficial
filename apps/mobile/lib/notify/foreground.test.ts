// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createForegroundTracker } from "./foreground";

describe("foreground issue tracker (review #14 Fix 3)", () => {
  it("chat A → chat B: A's late blur does not clear B", () => {
    const native = { setForegroundIssue: vi.fn() };
    const fg = createForegroundTracker(native);
    fg.set("A", true);
    fg.set("B", false); // focus of B comes before A's blur
    fg.clear("A");
    expect(fg.current).toBe("B");
    expect(native.setForegroundIssue).toHaveBeenLastCalledWith("B", false);
    fg.clear("B");
    expect(native.setForegroundIssue).toHaveBeenLastCalledWith(null, false);
  });

  it("background pauses, returning to the app restores the open chat", () => {
    const native = { setForegroundIssue: vi.fn() };
    const fg = createForegroundTracker(native);
    fg.set("A", true);
    fg.pause();
    expect(native.setForegroundIssue).toHaveBeenLastCalledWith(null, false);
    fg.resume();
    expect(native.setForegroundIssue).toHaveBeenLastCalledWith("A", false);
  });

  it("resume without an open chat sends nothing", () => {
    const native = { setForegroundIssue: vi.fn() };
    createForegroundTracker(native).resume();
    expect(native.setForegroundIssue).not.toHaveBeenCalled();
  });
});
