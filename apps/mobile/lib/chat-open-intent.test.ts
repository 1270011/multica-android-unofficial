import { describe, expect, it } from "vitest";
import { consumeInAppChatOpen, markInAppChatOpen } from "./chat-open-intent";

describe("in-app chat open marker", () => {
  it("is consumed exactly once", () => {
    markInAppChatOpen("a", 1000);
    expect(consumeInAppChatOpen("a", 1500)).toBe(true);
    expect(consumeInAppChatOpen("a", 1600)).toBe(false);
  });

  it("is absent for an external deep link", () => {
    expect(consumeInAppChatOpen("never-marked", 0)).toBe(false);
  });

  it("expires", () => {
    markInAppChatOpen("b", 0);
    expect(consumeInAppChatOpen("b", 10_001)).toBe(false);
  });

  it("is per issue", () => {
    markInAppChatOpen("c", 0);
    expect(consumeInAppChatOpen("d", 1)).toBe(false);
    expect(consumeInAppChatOpen("c", 1)).toBe(true);
  });
});
