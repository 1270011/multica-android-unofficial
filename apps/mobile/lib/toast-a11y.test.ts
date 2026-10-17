import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_TOAST_DURATION_MS } from "./toast";
import { actionToastDuration, SCREEN_READER_MIN_MS } from "./toast-a11y";

// vi.mock is hoisted above the imports.

const a11y = vi.hoisted(() => ({
  getRecommendedTimeoutMillis: vi.fn<(ms: number) => Promise<number>>(),
  isScreenReaderEnabled: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("react-native", () => ({ AccessibilityInfo: a11y }));

describe("actionToastDuration", () => {
  beforeEach(() => {
    a11y.getRecommendedTimeoutMillis.mockImplementation(async (ms) => ms);
    a11y.isScreenReaderEnabled.mockResolvedValue(false);
  });

  it("keeps the default without screen reader and without a time-to-act setting", async () => {
    expect(await actionToastDuration()).toBe(ACTION_TOAST_DURATION_MS);
    expect(a11y.getRecommendedTimeoutMillis).toHaveBeenCalledWith(ACTION_TOAST_DURATION_MS);
  });

  it("follows Android's time-to-act setting also without a screen reader", async () => {
    a11y.getRecommendedTimeoutMillis.mockResolvedValue(30_000);
    expect(await actionToastDuration()).toBe(30_000);
  });

  it("never goes below the default", async () => {
    a11y.getRecommendedTimeoutMillis.mockResolvedValue(1_000);
    expect(await actionToastDuration()).toBe(ACTION_TOAST_DURATION_MS);
  });

  it("gives a screen reader at least 20 s, more if the setting asks for it", async () => {
    a11y.isScreenReaderEnabled.mockResolvedValue(true);
    expect(await actionToastDuration()).toBe(SCREEN_READER_MIN_MS);
    a11y.getRecommendedTimeoutMillis.mockResolvedValue(60_000);
    expect(await actionToastDuration()).toBe(60_000);
  });

  it("falls back to the default when the native query fails", async () => {
    a11y.getRecommendedTimeoutMillis.mockRejectedValue(new Error("no native module"));
    expect(await actionToastDuration()).toBe(ACTION_TOAST_DURATION_MS);
  });
});
