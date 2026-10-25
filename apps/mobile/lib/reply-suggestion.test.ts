import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import { suggestReplyTarget } from "./reply-suggestion";
import { newOptimisticCommentId } from "./pending-comments";

function comment(id: string, at: string, overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    type: "comment",
    id,
    actor_type: "agent",
    actor_id: "agent-1",
    actor_name: "coder-3",
    created_at: `2026-10-24T05:${at}:00Z`,
    content: "**Fertig** – PR #190",
    parent_id: null,
    ...overrides,
  };
}

const human = { actor_type: "member", actor_id: "user-1", actor_name: "admin" } as const;

describe("suggestReplyTarget (W1-4)", () => {
  it("suggests the latest comment when an agent wrote it", () => {
    const entries = [comment("h1", "00", human), comment("a1", "05")];
    expect(suggestReplyTarget(entries)).toEqual({
      commentId: "a1",
      agentId: "agent-1",
      actorName: "coder-3",
      preview: "**Fertig** – PR #190",
    });
  });

  it("suggests nothing when a person wrote the latest comment", () => {
    const entries = [comment("a1", "00"), comment("h1", "05", human)];
    expect(suggestReplyTarget(entries)).toBeNull();
  });

  it("suggests nothing once the own reply is still sending", () => {
    const entries = [comment("a1", "00"), comment(newOptimisticCommentId(), "05", human)];
    expect(suggestReplyTarget(entries)).toBeNull();
  });

  it("goes by time, not by list order", () => {
    const entries = [comment("a1", "05"), comment("h1", "00", human)];
    expect(suggestReplyTarget(entries)?.commentId).toBe("a1");
  });

  it("ignores activity rows after the agent comment", () => {
    const entries = [
      comment("a1", "00"),
      comment("act", "05", { type: "activity", actor_type: "member", actor_id: "user-1" }),
    ];
    expect(suggestReplyTarget(entries)?.commentId).toBe("a1");
  });

  it("targets an agent reply inside a thread, not its root", () => {
    const entries = [comment("h1", "00", human), comment("a1", "05", { parent_id: "h1" })];
    expect(suggestReplyTarget(entries)?.commentId).toBe("a1");
  });

  it("skips a resolved thread", () => {
    const entries = [
      comment("h1", "00", { ...human, resolved_at: "2026-10-24T05:10:00Z" }),
      comment("a1", "05", { parent_id: "h1" }),
    ];
    expect(suggestReplyTarget(entries)).toBeNull();
  });

  it("skips a deleted agent comment and looks at the one before", () => {
    const entries = [
      comment("h1", "00", human),
      comment("a1", "05", { deleted_at: "2026-10-24T05:06:00Z" }),
    ];
    expect(suggestReplyTarget(entries)).toBeNull();
  });

  it("returns null without entries", () => {
    expect(suggestReplyTarget(undefined)).toBeNull();
    expect(suggestReplyTarget([])).toBeNull();
  });
});

describe("suggestReplyTarget with a notification anchor (W1-5)", () => {
  it("suggests the anchored agent comment even when a person wrote later", () => {
    const entries = [comment("a1", "00"), comment("h1", "05", human)];
    expect(suggestReplyTarget(entries, "a1")?.commentId).toBe("a1");
  });

  it("prefers the anchor over a later agent comment", () => {
    const entries = [
      comment("a1", "00"),
      comment("a2", "05", { actor_id: "agent-2", actor_name: "planner" }),
    ];
    expect(suggestReplyTarget(entries, "a1")).toMatchObject({ commentId: "a1", agentId: "agent-1" });
  });

  it("falls back to the latest-comment rule when the anchor is a person's comment", () => {
    const entries = [comment("h1", "00", human), comment("a1", "05")];
    expect(suggestReplyTarget(entries, "h1")?.commentId).toBe("a1");
    expect(suggestReplyTarget([comment("a1", "00"), comment("h1", "05", human)], "h1")).toBeNull();
  });

  it("falls back when the anchor is unknown", () => {
    expect(suggestReplyTarget([comment("a1", "00")], "missing")?.commentId).toBe("a1");
  });
});
