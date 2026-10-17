import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import { isOptimisticCommentId, mergeLocalComments } from "./pending-comments";

function comment(id: string, created_at: string): TimelineEntry {
  return {
    type: "comment",
    id,
    actor_type: "member",
    actor_id: "u1",
    content: id,
    parent_id: null,
    created_at,
    updated_at: created_at,
    comment_type: "comment",
    reactions: [],
    attachments: [],
  } as TimelineEntry;
}

describe("mergeLocalComments", () => {
  const server = [comment("c1", "2026-10-15T10:00:00Z"), comment("c2", "2026-10-15T10:01:00Z")];

  it("returns the server list untouched when nothing is local", () => {
    expect(mergeLocalComments(server, [])).toBe(server);
    expect(mergeLocalComments(undefined, [])).toBeUndefined();
  });

  it("re-appends local rows that a refetch dropped, in creation order", () => {
    const b = comment("optimistic-2", "2026-10-15T10:03:00Z");
    const a = comment("optimistic-1", "2026-10-15T10:02:00Z");
    const merged = mergeLocalComments(server, [b, a]);
    expect(merged?.map((e) => e.id)).toEqual(["c1", "c2", "optimistic-1", "optimistic-2"]);
  });

  it("lets the server row win once the comment landed", () => {
    const local = comment("c2", "2026-10-15T10:01:00Z");
    expect(mergeLocalComments(server, [local])).toBe(server);
  });

  it("dedupes a row reported both pending and failed", () => {
    const local = comment("optimistic-1", "2026-10-15T10:02:00Z");
    const merged = mergeLocalComments(server, [local, { ...local }]);
    expect(merged?.filter((e) => e.id === "optimistic-1")).toHaveLength(1);
  });

  it("works while the server list has not loaded yet", () => {
    const local = comment("optimistic-1", "2026-10-15T10:02:00Z");
    expect(mergeLocalComments(undefined, [local])?.map((e) => e.id)).toEqual(["optimistic-1"]);
  });
});

describe("isOptimisticCommentId", () => {
  it("recognises the ids minted by useCreateComment", () => {
    expect(isOptimisticCommentId("optimistic-1760000000000")).toBe(true);
    expect(isOptimisticCommentId("01a140ec-cbdb-7afc-8f49-63befa80139e")).toBe(false);
  });
});
