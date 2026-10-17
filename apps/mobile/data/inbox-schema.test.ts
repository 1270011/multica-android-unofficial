import { describe, expect, it } from "vitest";
import { InboxListSchema, InboxUnreadSummarySchema } from "./schemas";

/**
 * Tests for mobile's CLIENT-SIDE parsing of GET /api/inbox.
 *
 * Scope, stated precisely because the name of this file used to overclaim:
 * these are hand-written fixtures run against `InboxListSchema`. They pin how
 * this client REACTS to a given payload. They cannot fail when the Go server
 * starts sending something new — nothing here executes server code.
 *
 * There is NO server-side guarantee that `details` values are strings: the
 * services marshal `map[string]any` (children_done total/stage, delegated
 * failure max_attempts, nullable source_context_id). The schema therefore
 * normalises values (lib/inbox-details.ts) and validates rows one by one, so
 * a single odd row can never empty the whole inbox again (the
 * MUL-5483 `child_count` incident was the same failure mode).
 */
describe("inbox list schema", () => {
  it("parses a row shaped like the documented server payload", () => {
    const serverRow = {
      id: "inbox-1",
      workspace_id: "ws-1",
      recipient_type: "member",
      recipient_id: "user-1",
      type: "status_changed",
      severity: "info",
      issue_id: "issue-1",
      title: "P0: delegated subscription rule",
      body: "",
      actor_type: "agent",
      actor_id: "agent-1",
      read: false,
      archived: false,
      created_at: "2026-07-30T00:00:00Z",
      details: { from: "in_progress", to: "in_review" },
    };

    const parsed = InboxListSchema.safeParse([serverRow]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[0]?.type).toBe("status_changed");
    expect(parsed.success && parsed.data[0]?.details?.to).toBe("in_review");
  });

  it("stringifies numeric details values instead of rejecting the row", () => {
    // Real payloads carry numbers: `children_done` sends total/stage as
    // integers, delegated-failure exhaustion sends max_attempts. Before
    // one such row made the WHOLE inbox render empty.
    const row = {
      id: "inbox-2",
      recipient_type: "member",
      type: "children_done",
      details: { rule: "child_done", total: 3, stage: 2, notified: true, gone: null },
    };

    const parsed = InboxListSchema.safeParse([row]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[0]?.details).toEqual({
      rule: "child_done",
      total: "3",
      stage: "2",
      notified: "true",
    });
  });

  it("drops only the malformed row, never the whole list", () => {
    const good = {
      id: "inbox-3",
      recipient_type: "member",
      type: "status_changed",
      details: { from: "todo", to: "in_review" },
    };
    // No `id` at all — the row cannot be keyed or acted on, so it is dropped.
    const bad = {
      recipient_type: "member",
      type: "status_changed",
    };

    const parsed = InboxListSchema.safeParse([good, bad, good]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.map((i) => i.id)).toEqual([
      "inbox-3",
      "inbox-3",
    ]);
  });

  it("accepts null details and a missing details key", () => {
    const parsed = InboxListSchema.safeParse([
      { id: "a", recipient_type: "member", type: "mentioned", details: null },
      { id: "b", recipient_type: "member", type: "mentioned" },
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.map((i) => i.details)).toEqual([null, null]);
  });

  it("renders an unknown server type instead of dropping the row", () => {
    // Mirrors the root CLAUDE.md API-compatibility rule and mobile's own
    // "render every inbox type, never silently drop a category" parity rule: a
    // type this build has never heard of must still parse.
    const future = {
      id: "inbox-5",
      recipient_type: "member",
      type: "some_future_type",
      details: { anything: "still a string" },
    };

    const parsed = InboxListSchema.safeParse([future]);
    expect(parsed.success).toBe(true);
  });
});

/**
 * GET /api/inbox/unread-summary — the source of the inbox tab badge.
 *
 * Blast radius differs from the list above: `getInboxUnreadSummary` falls back
 * to an empty array, which reads as "nothing unread" and simply hides the
 * badge. A wrong number would be worse than no number, so the schema stays
 * strict about the shape and lenient only about extra fields.
 */
describe("inbox unread summary schema", () => {
  it("parses the documented server payload", () => {
    const parsed = InboxUnreadSummarySchema.safeParse([
      { workspace_id: "ws-1", count: 3 },
      { workspace_id: "ws-2", count: 1 },
    ]);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[1]?.count).toBe(1);
  });

  it("passes through a field this client does not know yet", () => {
    const parsed = InboxUnreadSummarySchema.safeParse([
      { workspace_id: "ws-1", count: 3, unread_mentions: 2 },
    ]);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[0]?.count).toBe(3);
  });

  it("reads a non-numeric count as zero rather than failing the list", () => {
    // One malformed row must not blank every other workspace's count.
    const parsed = InboxUnreadSummarySchema.safeParse([
      { workspace_id: "ws-1", count: "many" },
      { workspace_id: "ws-2", count: 5 },
    ]);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data[0]?.count).toBe(0);
    expect(parsed.success && parsed.data[1]?.count).toBe(5);
  });

  it("rejects a row with no workspace id", () => {
    // Without an id the entry can never be matched to a workspace, so it would
    // silently contribute nothing — fail loudly into the empty fallback.
    expect(
      InboxUnreadSummarySchema.safeParse([{ count: 3 }]).success,
    ).toBe(false);
  });

  it("keeps issue_priority, and leaves it undefined when an older server omits it", () => {
    const base = {
      id: "inbox-p",
      type: "status_changed",
      issue_id: "issue-1",
      title: "t",
      read: false,
      archived: false,
      created_at: "2026-10-16T00:00:00Z",
      details: {},
    };
    const parsed = InboxListSchema.parse([
      { ...base, issue_priority: "high" },
      { ...base, id: "inbox-null", issue_priority: null },
      { ...base, id: "inbox-bogus", issue_priority: "bogus" },
      { ...base, id: "inbox-old" },
    ]);
    expect(parsed.map((i) => i.issue_priority)).toEqual(["high", null, null, undefined]);
  });
});
