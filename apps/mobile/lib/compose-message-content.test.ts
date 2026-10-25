import { describe, expect, it } from "vitest";
import { composeMessageContent } from "./compose-message-content";

describe("composeMessageContent", () => {
  it("puts mention chips before the trimmed text", () => {
    expect(
      composeMessageContent("  hi  ", [{ type: "agent", id: "a1", name: "Walt" }]),
    ).toBe("[@Walt](mention://agent/a1) hi");
  });

  it("handles text only, chips only and issue/@all labels", () => {
    expect(composeMessageContent(" text ", [])).toBe("text");
    expect(
      composeMessageContent("", [
        { type: "issue", id: "i1", name: "MUL-1" },
        { type: "all", id: "all", name: "all" },
      ]),
    ).toBe("[MUL-1](mention://issue/i1) [@all](mention://all/all)");
    expect(composeMessageContent("   ", [])).toBe("");
  });
});
