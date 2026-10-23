import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import {
  collectLocalComments,
  isOptimisticCommentId,
  knownCommentIds,
  mergeLocalComments,
  newOptimisticCommentId,
  settleOptimisticComment,
  type LocalComment,
} from "./pending-comments";

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

const l = (entry: TimelineEntry, knownIds?: ReadonlySet<string>): LocalComment => ({
  entry,
  knownIds,
});

function own(id: string, content: string, created_at: string, parent_id: string | null = null) {
  return { ...comment(id, created_at), content, parent_id } as TimelineEntry;
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
    const merged = mergeLocalComments(server, [l(b), l(a)]);
    expect(merged?.map((e) => e.id)).toEqual(["c1", "c2", "optimistic-1", "optimistic-2"]);
  });

  it("lets the server row win once the comment landed", () => {
    const local = comment("c2", "2026-10-15T10:01:00Z");
    expect(mergeLocalComments(server, [l(local)])).toBe(server);
  });

  it("dedupes a row reported both pending and failed", () => {
    const local = comment("optimistic-1", "2026-10-15T10:02:00Z");
    const merged = mergeLocalComments(server, [l(local), l({ ...local })]);
    expect(merged?.filter((e) => e.id === "optimistic-1")).toHaveLength(1);
  });

  it("works while the server list has not loaded yet", () => {
    const local = comment("optimistic-1", "2026-10-15T10:02:00Z");
    expect(mergeLocalComments(undefined, [l(local)])?.map((e) => e.id)).toEqual(["optimistic-1"]);
  });
});

describe("mergeLocalComments – echo of the own send", () => {
  const before = [own("c1", "earlier", "2026-10-17T22:00:00Z")];
  const known = knownCommentIds(before);
  const pending = own("optimistic-1", "hello", "2026-10-17T22:05:00Z");

  it("shows the pending row while no echo is there", () => {
    const merged = mergeLocalComments(before, [l(pending, known)]);
    expect(merged?.map((e) => e.id)).toEqual(["c1", "optimistic-1"]);
  });

  it("drops the pending row once the comment:created echo is in the list", () => {
    // WS append put the real row next to the optimistic copy in the cache.
    const cache = [...before, pending, own("real-1", "hello", "2026-10-17T22:05:01Z")];
    const merged = mergeLocalComments(cache, [l(pending, known)]);
    expect(merged?.map((e) => e.id)).toEqual(["c1", "real-1"]);
  });

  it("accepts an echo whose server clock is a bit behind the device", () => {
    const cache = [...before, own("real-1", " hello\n", "2026-10-17T22:04:00Z")];
    expect(mergeLocalComments(cache, [l(pending, known)])?.map((e) => e.id)).toEqual(["c1", "real-1"]);
  });

  it("never takes a comment that was already there for the echo", () => {
    const earlier = [own("c1", "hello", "2026-10-17T22:04:30Z")];
    const merged = mergeLocalComments(earlier, [l(pending, knownCommentIds(earlier))]);
    expect(merged?.map((e) => e.id)).toEqual(["c1", "optimistic-1"]);
  });

  it("keeps two equal sends apart: one echo absorbs one row", () => {
    const second = own("optimistic-2", "hello", "2026-10-17T22:05:02Z");
    const cache = [...before, own("real-1", "hello", "2026-10-17T22:05:01Z")];
    const merged = mergeLocalComments(cache, [l(second, known), l(pending, known)]);
    expect(merged?.map((e) => e.id)).toEqual(["c1", "real-1", "optimistic-2"]);
  });

  it("does not match another author, thread or text", () => {
    const cache = [
      ...before,
      { ...own("x1", "hello", "2026-10-17T22:05:01Z"), actor_id: "u2" } as TimelineEntry,
      own("x2", "hello", "2026-10-17T22:05:01Z", "c1"),
      own("x3", "hello!", "2026-10-17T22:05:01Z"),
    ];
    const merged = mergeLocalComments(cache, [l(pending, known)]);
    expect(merged?.at(-1)?.id).toBe("optimistic-1");
  });

  it("hides cache-only optimistic rows that are no longer pending or failed", () => {
    const cache = [...before, pending];
    expect(mergeLocalComments(cache, [])?.map((e) => e.id)).toEqual(["c1"]);
  });
});

describe("settleOptimisticComment", () => {
  const pending = own("optimistic-1", "hello", "2026-10-17T22:05:00Z");
  const real = own("real-1", "hello", "2026-10-17T22:05:01Z");

  it("swaps the optimistic row for the server row", () => {
    expect(settleOptimisticComment([pending], "optimistic-1", real)?.map((e) => e.id)).toEqual([
      "real-1",
    ]);
  });

  it("only drops the optimistic row when the echo is already there", () => {
    const settled = settleOptimisticComment([pending, real], "optimistic-1", { ...real });
    expect(settled?.map((e) => e.id)).toEqual(["real-1"]);
  });

  it("leaves an unloaded cache alone", () => {
    expect(settleOptimisticComment(undefined, "optimistic-1", real)).toBeUndefined();
  });
});

describe("collectLocalComments", () => {
  it("takes pending rows and the failed rows of this issue only", () => {
    const a = own("optimistic-1", "a", "2026-10-17T22:05:00Z");
    const b = own("optimistic-2", "b", "2026-10-17T22:05:01Z");
    const local = collectLocalComments(
      [l(a), null],
      [
        { issueId: "i1", entry: b },
        { issueId: "i2", entry: b },
      ],
      "i1",
    );
    expect(local.map((x) => x.entry.id)).toEqual(["optimistic-1", "optimistic-2"]);
  });
});

describe("isOptimisticCommentId", () => {
  it("recognises the ids minted by useCreateComment", () => {
    expect(isOptimisticCommentId("optimistic-1760000000000")).toBe(true);
    expect(isOptimisticCommentId("01a140ec-cbdb-7afc-8f49-63befa80139e")).toBe(false);
    expect(isOptimisticCommentId(newOptimisticCommentId())).toBe(true);
  });

  it("mints distinct ids within the same millisecond", () => {
    expect(newOptimisticCommentId(1)).not.toBe(newOptimisticCommentId(1));
  });
});
