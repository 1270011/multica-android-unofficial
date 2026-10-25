import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import { canReplyToThread, threadReplyTarget } from "./thread-reply";
import { newOptimisticCommentId } from "./pending-comments";

function comment(id: string, overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    type: "comment",
    id,
    actor_type: "agent",
    actor_id: "agent-1",
    created_at: "2026-10-23T17:00:00Z",
    content: "**Done** – see PR",
    parent_id: null,
    ...overrides,
  };
}

describe("canReplyToThread", () => {
  it("allows a server comment", () => {
    expect(canReplyToThread(comment("c1"))).toBe(true);
  });

  it("refuses a root that is still sending or failed", () => {
    expect(canReplyToThread(comment(newOptimisticCommentId()))).toBe(false);
  });

  it("refuses a deleted root", () => {
    expect(canReplyToThread(comment("c1", { deleted_at: "2026-10-23T17:01:00Z" }))).toBe(false);
  });

  it("refuses activity rows", () => {
    expect(canReplyToThread(comment("a1", { type: "activity" }))).toBe(false);
  });
});

describe("threadReplyTarget", () => {
  it("targets the thread root with the chip's name and preview", () => {
    expect(threadReplyTarget(comment("root"), "coder-3")).toEqual({
      commentId: "root",
      actorName: "coder-3",
      preview: "**Done** – see PR",
    });
  });

  it("uses an empty preview for an attachment-only root", () => {
    expect(threadReplyTarget({ id: "root", content: undefined }, "admin").preview).toBe("");
  });
});
