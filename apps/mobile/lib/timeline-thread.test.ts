// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";

import {
  buildTimelineRows,
  findLandingIndex,
  timelineListTestID,
} from "./timeline-thread";

function comment(id: string, parent_id?: string): TimelineEntry {
  return {
    type: "comment",
    id,
    parent_id,
    actor_type: "member",
    actor_id: "m1",
    created_at: "2026-10-16T00:00:00Z",
    content: id,
  } as TimelineEntry;
}

function activity(id: string): TimelineEntry {
  return {
    type: "activity",
    id,
    actor_type: "member",
    actor_id: "m1",
    created_at: "2026-10-16T00:00:00Z",
    action: "status_changed",
    details: {},
  } as TimelineEntry;
}

describe("buildTimelineRows", () => {
  it("bundles replies (also reply-to-reply) into the root row", () => {
    const rows = buildTimelineRows([
      comment("a"),
      comment("b", "a"),
      activity("x"),
      comment("c", "b"),
    ]);
    expect(rows.map((r) => r.entry.id)).toEqual(["a", "x"]);
    expect(rows[0].replies.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("promotes an orphan reply to a top-level row", () => {
    const rows = buildTimelineRows([comment("b", "missing")]);
    expect(rows.map((r) => r.entry.id)).toEqual(["b"]);
  });
});

describe("findLandingIndex (inbox landing)", () => {
  // A long thread: the target sits in the middle, far from both ends.
  const rows = buildTimelineRows([
    activity("x1"),
    comment("a"),
    ...Array.from({ length: 40 }, (_, i) => activity(`fill-${i}`)),
    comment("target"),
    comment("reply", "target"),
    comment("nested", "reply"),
    ...Array.from({ length: 40 }, (_, i) => comment(`late-${i}`)),
  ]);
  const targetRow = rows.findIndex((r) => r.entry.id === "target");

  it("lands on the row of a root comment", () => {
    expect(targetRow).toBe(42);
    expect(findLandingIndex(rows, "target")).toBe(targetRow);
  });

  it("lands on the root row for a reply and a reply-to-reply", () => {
    expect(findLandingIndex(rows, "reply")).toBe(targetRow);
    expect(findLandingIndex(rows, "nested")).toBe(targetRow);
  });

  it("lands on the first row when the target is the first comment", () => {
    expect(findLandingIndex(rows, "x1")).toBe(0);
  });

  it("falls back to the header (undefined) without a target", () => {
    expect(findLandingIndex(rows, undefined)).toBeUndefined();
    expect(findLandingIndex(rows, null)).toBeUndefined();
    expect(findLandingIndex(rows, "")).toBeUndefined();
  });

  it("falls back to the header when the comment is not in the timeline", () => {
    expect(findLandingIndex(rows, "deleted")).toBeUndefined();
    expect(findLandingIndex([], "target")).toBeUndefined();
  });

  it("never lands on the last row for a target in the middle", () => {
    expect(findLandingIndex(rows, "target")).not.toBe(rows.length - 1);
  });
});

describe("timelineListTestID (e2e landing marker)", () => {
  it("flags a pending landing, including the first row", () => {
    expect(timelineListTestID(42, false)).toBe("timeline-list-landing");
    expect(timelineListTestID(0, false)).toBe("timeline-list-landing");
  });

  it("stays plain without a landing target once loaded", () => {
    expect(timelineListTestID(undefined, false)).toBe("timeline-list");
  });

  it("reports loading only while no target row is known", () => {
    expect(timelineListTestID(undefined, true)).toBe("timeline-list-loading");
    expect(timelineListTestID(3, true)).toBe("timeline-list-landing");
  });
});
