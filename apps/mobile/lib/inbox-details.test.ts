import { describe, expect, it } from "vitest";
import { normalizeInboxDetails } from "./inbox-details";

describe("normalizeInboxDetails", () => {
  it("returns null for null / undefined / non-objects", () => {
    expect(normalizeInboxDetails(null)).toBeNull();
    expect(normalizeInboxDetails(undefined)).toBeNull();
    expect(normalizeInboxDetails("x")).toBeNull();
    expect(normalizeInboxDetails(42)).toBeNull();
    expect(normalizeInboxDetails([1, 2])).toBeNull();
  });

  it("passes string values through unchanged", () => {
    expect(
      normalizeInboxDetails({ comment_id: "01a1", identifier: "MUL-83" }),
    ).toEqual({ comment_id: "01a1", identifier: "MUL-83" });
  });

  it("stringifies numbers and booleans (children_done total/stage, max_attempts)", () => {
    expect(
      normalizeInboxDetails({
        rule: "child_done",
        total: 3,
        stage: 2,
        max_attempts: 5,
        notified: true,
      }),
    ).toEqual({
      rule: "child_done",
      total: "3",
      stage: "2",
      max_attempts: "5",
      notified: "true",
    });
  });

  it("drops null and undefined values but keeps the rest", () => {
    expect(
      normalizeInboxDetails({
        original_prompt: "make it so",
        source_context_id: null,
        error: undefined,
      }),
    ).toEqual({ original_prompt: "make it so" });
  });

  it("JSON-encodes nested objects and arrays", () => {
    expect(normalizeInboxDetails({ receipts: ["a", "b"], meta: { k: 1 } })).toEqual({
      receipts: '["a","b"]',
      meta: '{"k":1}',
    });
  });

  it("returns an empty object for an empty details object", () => {
    expect(normalizeInboxDetails({})).toEqual({});
  });
});
