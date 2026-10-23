import { describe, expect, it, vi } from "vitest";
import * as Haptics from "./haptics";
import * as Clipboard from "./clipboard";

// vi.mock is hoisted above the imports.

vi.mock("expo-haptics", () => {
  throw new Error("native module missing");
});
vi.mock("expo-clipboard", () => {
  throw new Error("native module missing");
});

describe("lazy haptics/clipboard facades", () => {
  it("reject instead of throwing when the late load fails", async () => {
    // A synchronous throw would escape `.catch(() => {})` at the call sites.
    const calls = [
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
      () => Haptics.selectionAsync(),
      () => Clipboard.getStringAsync(),
      () => Clipboard.setStringAsync("x"),
    ];
    for (const call of calls) {
      let p: Promise<unknown> | undefined;
      expect(() => {
        p = call();
      }).not.toThrow();
      await expect(p).rejects.toThrow();
    }
  });
});
