import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hideToast, pressToastAction, showToast, useToastStore } from "./toast";

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hideToast();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs an action once and closes the toast", () => {
    const onPress = vi.fn();
    showToast("Moved", 6000, { label: "Undo", onPress });
    expect(useToastStore.getState().action?.label).toBe("Undo");
    pressToastAction();
    pressToastAction();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().message).toBeNull();
    expect(useToastStore.getState().action).toBeNull();
  });

  it("drops the action together with the message on timeout", () => {
    showToast("Moved", 1000, { label: "Undo", onPress: vi.fn() });
    vi.advanceTimersByTime(1000);
    expect(useToastStore.getState().action).toBeNull();
  });

  it("shows a message and hides it after the duration", () => {
    showToast("Offline", 1000);
    expect(useToastStore.getState().message).toBe("Offline");
    vi.advanceTimersByTime(999);
    expect(useToastStore.getState().message).toBe("Offline");
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().message).toBeNull();
  });

  it("restarts the timer and bumps the nonce when shown again", () => {
    showToast("A", 1000);
    const first = useToastStore.getState().nonce;
    vi.advanceTimersByTime(800);
    showToast("A", 1000);
    expect(useToastStore.getState().nonce).toBe(first + 1);
    vi.advanceTimersByTime(800);
    expect(useToastStore.getState().message).toBe("A");
    vi.advanceTimersByTime(200);
    expect(useToastStore.getState().message).toBeNull();
  });
});
