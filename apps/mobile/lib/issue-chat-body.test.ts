import { describe, expect, it } from "vitest";
import { chatBody, type ChatBodyInput } from "./issue-chat-body";

const cached: ChatBodyInput = {
  notFound: false,
  detailLoading: false,
  hasIssue: true,
  detailError: false,
  timelineLoading: false,
  timelineError: false,
  hasEntries: true,
  itemCount: 25,
};

describe("chatBody", () => {
  it("shows the list at once when issue and rows are in the cache", () => {
    expect(chatBody(cached)).toBe("list");
  });

  it("never falls back to skeleton or error while cached rows exist", () => {
    // Refetch on re-open, failed refetch, detail refetch error: rows stay.
    expect(chatBody({ ...cached, timelineLoading: true })).toBe("list");
    expect(chatBody({ ...cached, timelineError: true })).toBe("list");
    expect(chatBody({ ...cached, detailError: true })).toBe("list");
  });

  it("shows the skeleton only while nothing is there yet", () => {
    expect(chatBody({ ...cached, hasIssue: false, detailLoading: true })).toBe("loading");
    expect(chatBody({ ...cached, hasEntries: false, itemCount: 0, timelineLoading: true })).toBe(
      "timeline-loading",
    );
  });

  it("keeps the error and empty states", () => {
    expect(chatBody({ ...cached, hasIssue: false, detailError: true })).toBe("error");
    expect(chatBody({ ...cached, hasEntries: false, itemCount: 0, timelineError: true })).toBe(
      "timeline-error",
    );
    expect(chatBody({ ...cached, itemCount: 0 })).toBe("empty");
    expect(chatBody({ ...cached, notFound: true })).toBe("gone");
  });
});
