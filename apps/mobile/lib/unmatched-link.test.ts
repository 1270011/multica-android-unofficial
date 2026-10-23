import { describe, expect, it } from "vitest";
import { UNMATCHED_LINK_TOAST, unmatchedLinkTarget } from "./unmatched-link";

describe("unmatched link fallback", () => {
  it("goes to the Inbox of the current workspace", () => {
    expect(unmatchedLinkTarget("acme")).toBe("/acme/inbox");
  });

  it("leaves it to the entry redirect without a workspace", () => {
    expect(unmatchedLinkTarget(null)).toBe("/");
    expect(unmatchedLinkTarget(undefined)).toBe("/");
    expect(unmatchedLinkTarget("")).toBe("/");
  });

  it("reuses the invalid-link toast", () => {
    expect(UNMATCHED_LINK_TOAST).toBe("issues:chat.invalid_link");
  });
});
