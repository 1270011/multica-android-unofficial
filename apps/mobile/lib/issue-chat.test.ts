import { describe, expect, it, vi } from "vitest";
import type { InboxItem, TimelineEntry } from "@multica/core/types";
import {
  activeForIssue,
  buildChatItems,
  canMarkDone,
  firstLine,
  isIssueId,
  mentionsUser,
  opensInChat,
  shallowEqualProps,
  shareChatItems,
  unreadAnchorId,
  unreadForIssue,
  type ChatItem,
} from "./issue-chat";
import { getInboxOpenTarget } from "./inbox-display";
import { chatWindow } from "./chat-window";
import { TimelineCacheStore } from "@/data/timeline-cache/core";
import { MemoryKv } from "@/data/timeline-cache/memory-kv";

vi.mock("@/data/server-config-store", () => ({ getServerBaseUrl: () => null }));

const ME = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const dayKey = (iso: string) => iso.slice(0, 10);

function comment(id: string, at: string, overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    type: "comment",
    id,
    actor_type: "agent",
    actor_id: AGENT,
    created_at: at,
    content: `text ${id}`,
    parent_id: null,
    ...overrides,
  };
}

function activity(id: string, at: string, to = "in_progress", action = "status_changed"): TimelineEntry {
  return {
    type: "activity",
    id,
    actor_type: "agent",
    actor_id: AGENT,
    created_at: at,
    action,
    details: { from: "todo", to },
  };
}

function inbox(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: "inbox-1",
    workspace_id: "ws-1",
    recipient_type: "member",
    recipient_id: ME,
    actor_type: "agent",
    actor_id: AGENT,
    type: "new_comment",
    severity: "info",
    issue_id: "issue-1",
    title: "Issue",
    body: null,
    issue_status: null,
    read: false,
    archived: false,
    created_at: "2026-10-16T08:00:00Z",
    details: null,
    ...overrides,
  };
}

const kinds = (items: ChatItem[]) => items.map((i) => `${i.kind}:${i.id}`);

describe("buildChatItems", () => {
  it("returns nothing for an empty or missing timeline", () => {
    expect(buildChatItems(undefined, { userId: ME })).toEqual([]);
    expect(buildChatItems([], { userId: ME })).toEqual([]);
  });

  it("orders by time, inserts day separators and marks own messages", () => {
    const items = buildChatItems(
      [
        comment("c2", "2026-10-16T09:00:00Z", { actor_type: "member", actor_id: ME }),
        comment("c1", "2026-10-15T23:00:00Z"),
      ],
      { userId: ME, dayKey },
    );
    expect(kinds(items)).toEqual([
      "day:day:2026-10-15",
      "message:c1",
      "day:day:2026-10-16",
      "message:c2",
    ]);
    const own = items.filter((i) => i.kind === "message").map((i) => i.kind === "message" && i.own);
    expect(own).toEqual([false, true]);
  });

  it("groups consecutive messages of one author within five minutes", () => {
    const items = buildChatItems(
      [
        comment("a", "2026-10-16T08:00:00Z"),
        comment("b", "2026-10-16T08:04:00Z"),
        comment("c", "2026-10-16T08:10:00Z"),
        comment("d", "2026-10-16T08:11:00Z", { actor_type: "member", actor_id: ME }),
      ],
      { userId: ME, dayKey },
    );
    const starts = items.flatMap((i) => (i.kind === "message" ? [[i.id, i.groupStart]] : []));
    expect(starts).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
      ["d", true],
    ]);
  });

  it("quotes the thread root on replies, also for reply-to-reply", () => {
    const items = buildChatItems(
      [
        comment("root", "2026-10-16T08:00:00Z", { content: "\n**Stufe 1** – [@ux](mention://agent/x)\nmore" }),
        comment("r1", "2026-10-16T08:01:00Z", { parent_id: "root" }),
        comment("r2", "2026-10-16T08:02:00Z", { parent_id: "r1" }),
      ],
      { userId: ME, dayKey },
    );
    const r2 = items.find((i) => i.id === "r2");
    expect(r2?.kind === "message" && r2.replyTo).toMatchObject({
      rootId: "root",
      preview: "Stufe 1 – @ux",
      deleted: false,
    });
    const r1 = items.find((i) => i.id === "r1");
    expect(r1?.kind === "message" && r1.groupStart).toBe(true);
  });

  it("keeps an orphan reply as a plain message", () => {
    const items = buildChatItems([comment("r", "2026-10-16T08:00:00Z", { parent_id: "gone" })], {
      userId: ME,
      dayKey,
    });
    const r = items.find((i) => i.id === "r");
    expect(r?.kind === "message" && r.replyTo).toBeNull();
  });

  it("hides deleted comments but keeps their replies with a deleted quote", () => {
    const items = buildChatItems(
      [
        comment("root", "2026-10-16T08:00:00Z", { deleted_at: "2026-10-16T08:05:00Z", content: "" }),
        comment("r1", "2026-10-16T08:01:00Z", { parent_id: "root" }),
      ],
      { userId: ME, dayKey },
    );
    expect(kinds(items)).toEqual(["day:day:2026-10-16", "message:r1"]);
    const r1 = items[1]!;
    expect(r1.kind === "message" && r1.replyTo?.deleted).toBe(true);
  });

  it("marks replies of a resolved thread as resolved", () => {
    const items = buildChatItems(
      [
        comment("root", "2026-10-16T08:00:00Z", { resolved_at: "2026-10-16T09:00:00Z" }),
        comment("r1", "2026-10-16T08:01:00Z", { parent_id: "root" }),
        comment("other", "2026-10-16T08:02:00Z"),
      ],
      { userId: ME, dayKey },
    );
    const resolved = items.flatMap((i) => (i.kind === "message" ? [[i.id, i.resolved]] : []));
    expect(resolved).toEqual([
      ["root", true],
      ["r1", true],
      ["other", false],
    ]);
  });

  it("folds four or more plain system rows and keeps action status changes apart", () => {
    const entries = [
      activity("s1", "2026-10-16T08:00:00Z", "todo"),
      activity("s2", "2026-10-16T08:00:01Z", "in_progress"),
      activity("s3", "2026-10-16T08:00:02Z", "x", "priority_changed"),
      activity("s4", "2026-10-16T08:00:03Z", "y", "assignee_changed"),
      activity("blocked", "2026-10-16T08:00:04Z", "blocked"),
      activity("s5", "2026-10-16T08:00:05Z", "todo"),
    ];
    const items = buildChatItems(entries, { userId: ME, dayKey });
    expect(kinds(items)).toEqual([
      "day:day:2026-10-16",
      "system-group:group:s1",
      "system:blocked",
      "system:s5",
    ]);
    const blocked = items[2]!;
    expect(blocked.kind === "system" && blocked.emphasis).toBe(true);
    const group = items[1]!;
    expect(group.kind === "system-group" && group.entries.map((e) => e.id)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
  });

  it("expands a folded group on request", () => {
    const entries = ["s1", "s2", "s3", "s4"].map((id, n) =>
      activity(id, `2026-10-16T08:00:0${n}Z`),
    );
    const items = buildChatItems(entries, {
      userId: ME,
      dayKey,
      expandedGroups: new Set(["group:s1"]),
    });
    expect(kinds(items)).toEqual([
      "day:day:2026-10-16",
      "system:s1",
      "system:s2",
      "system:s3",
      "system:s4",
    ]);
  });

  it("leaves three system rows unfolded", () => {
    const entries = ["s1", "s2", "s3"].map((id, n) => activity(id, `2026-10-16T08:00:0${n}Z`));
    const items = buildChatItems(entries, { userId: ME, dayKey });
    expect(items.filter((i) => i.kind === "system")).toHaveLength(3);
  });

  it("flags mentions of the signed-in member", () => {
    const items = buildChatItems(
      [
        comment("m", "2026-10-16T08:00:00Z", { content: `Frage an [@admin](mention://member/${ME})` }),
        comment("n", "2026-10-16T08:01:00Z", { content: "[@x](mention://member/someone-else)" }),
      ],
      { userId: ME, dayKey },
    );
    const flags = items.flatMap((i) => (i.kind === "message" ? [i.mentionsMe] : []));
    expect(flags).toEqual([true, false]);
  });

  it("places the unread divider before the comment the oldest unread entry points at", () => {
    const entries = [
      comment("old", "2026-10-16T07:00:00Z"),
      comment("new1", "2026-10-16T08:00:00Z"),
      comment("new2", "2026-10-16T08:30:00Z"),
    ];
    const items = buildChatItems(entries, {
      userId: ME,
      dayKey,
      unreadInbox: [
        inbox({ id: "i2", created_at: "2026-10-16T08:30:01Z", details: { comment_id: "new2" } }),
        inbox({ id: "i1", created_at: "2026-10-16T08:00:01Z", details: { comment_id: "new1" } }),
      ],
    });
    expect(kinds(items)).toEqual([
      "day:day:2026-10-16",
      "message:old",
      "unread:unread",
      "message:new1",
      "message:new2",
    ]);
  });
});

describe("unreadAnchorId", () => {
  const entries = [
    comment("a", "2026-10-16T08:00:00Z"),
    comment("b", "2026-10-16T09:00:00Z"),
  ];

  it("is null without unread entries", () => {
    expect(unreadAnchorId(entries, [])).toBeNull();
    expect(unreadAnchorId(entries, [inbox({ read: true })])).toBeNull();
    expect(unreadAnchorId(entries, [inbox({ archived: true })])).toBeNull();
  });

  it("falls back to time when the entry has no comment anchor", () => {
    // Status change written at 08:59:58 → the comment two seconds later counts.
    expect(
      unreadAnchorId(entries, [inbox({ type: "status_changed", created_at: "2026-10-16T09:00:02Z" })]),
    ).toBe("b");
    expect(unreadAnchorId(entries, [inbox({ created_at: "2026-10-16T10:00:00Z" })])).toBeNull();
  });
});

describe("mentionsUser / firstLine", () => {
  it("treats @all as a mention", () => {
    expect(mentionsUser("[@all](mention://all/all)", ME)).toBe(true);
    expect(mentionsUser("hello", ME)).toBe(false);
    expect(mentionsUser("[@me](mention://member/x)", null)).toBe(false);
  });

  it("strips markdown and truncates", () => {
    expect(firstLine("![img](u) see [docs](http://x) `code`")).toBe("see docs code");
    expect(firstLine("a".repeat(200), 10)).toBe("aaaaaaaaa…");
    expect(firstLine(undefined)).toBe("");
  });
});

describe("opensInChat / getInboxOpenTarget", () => {
  it.each([
    ["new_comment", undefined, true],
    ["mentioned", undefined, true],
    ["reaction_added", undefined, true],
    ["task_failed", undefined, true],
    ["status_changed", "blocked", true],
    ["status_changed", "in_review", true],
    ["status_changed", "testing", false],
    ["status_changed", "done", false],
    ["issue_assigned", undefined, false],
    ["priority_changed", undefined, false],
    ["children_done", undefined, false],
  ])("%s → %s opens chat: %s", (type, to, expected) => {
    const item = inbox({ type: type as InboxItem["type"], details: to ? { to } : null });
    expect(opensInChat(item)).toBe(expected);
  });

  it("never opens a chat without an issue", () => {
    expect(opensInChat(inbox({ issue_id: null }))).toBe(false);
  });

  it("routes chat types to the chat with the comment anchor", () => {
    const target = getInboxOpenTarget(
      inbox({ type: "mentioned", details: { comment_id: "c-9" } }),
      "rb",
      "42",
    );
    expect(target).toEqual({
      pathname: "/[workspace]/issue/[id]/chat",
      params: { workspace: "rb", id: "issue-1", comment: "c-9", h: "42" },
    });
  });

  it("routes other types to the detail, and honours an explicit mode", () => {
    const assigned = inbox({ type: "issue_assigned" });
    expect(getInboxOpenTarget(assigned, "rb", "1")?.pathname).toBe("/[workspace]/issue/[id]");
    expect(getInboxOpenTarget(assigned, "rb", "1", "chat")?.pathname).toBe(
      "/[workspace]/issue/[id]/chat",
    );
    expect(getInboxOpenTarget(inbox({ type: "mentioned" }), "rb", "1", "detail")?.pathname).toBe(
      "/[workspace]/issue/[id]",
    );
    expect(getInboxOpenTarget(inbox({}), null, "1")).toBeNull();
  });
});

describe("isIssueId", () => {
  it("accepts UUIDs only", () => {
    expect(isIssueId(ME)).toBe(true);
    expect(isIssueId("MUL-118")).toBe(false);
    expect(isIssueId("../../etc")).toBe(false);
    expect(isIssueId(undefined)).toBe(false);
  });
});

describe("unreadForIssue / activeForIssue", () => {
  it("filters by issue and state", () => {
    const items = [
      inbox({ id: "a" }),
      inbox({ id: "b", read: true }),
      inbox({ id: "c", archived: true }),
      inbox({ id: "d", issue_id: "other" }),
    ];
    expect(unreadForIssue(items, "issue-1").map((i) => i.id)).toEqual(["a"]);
    expect(activeForIssue(items, "issue-1").map((i) => i.id)).toEqual(["a", "b"]);
    expect(unreadForIssue(undefined, "issue-1")).toEqual([]);
  });
});

describe("canMarkDone", () => {
  it("needs inbox entries and an open issue", () => {
    expect(canMarkDone("in_review", 1)).toBe(true);
    expect(canMarkDone("blocked", 0)).toBe(false);
    expect(canMarkDone("done", 2)).toBe(false);
    expect(canMarkDone("cancelled", 2)).toBe(false);
  });
});

describe("shareChatItems", () => {
  const entries = (): TimelineEntry[] => [
    comment("c1", "2026-10-16T08:00:00Z"),
    comment("c2", "2026-10-16T08:01:00Z", { actor_type: "member", actor_id: ME }),
    comment("c3", "2026-10-16T08:02:00Z", { parent_id: "c1" }),
    activity("a1", "2026-10-16T08:03:00Z"),
    comment("c4", "2026-10-16T08:04:00Z", { reactions: [] }),
  ];
  const build = (list: TimelineEntry[]) => buildChatItems(list, { userId: ME, dayKey });
  const onPressQuote = () => {};

  // Same props the list's renderItem passes to ChatBubble.
  const bubbleProps = (items: ChatItem[], highlightId: string | null = null) =>
    new Map(
      items.flatMap((item) =>
        item.kind === "message"
          ? [
              [
                item.id,
                {
                  entry: item.entry,
                  issueId: "issue-1",
                  issueIdentifier: "MUL-1",
                  own: item.own,
                  groupStart: item.groupStart,
                  replyTo: item.replyTo,
                  mentionsMe: item.mentionsMe,
                  resolved: item.resolved,
                  highlighted: highlightId === item.id,
                  onPressQuote,
                },
              ] as const,
            ]
          : [],
      ),
    );

  /** Ids of bubbles whose memo comparison fails, i.e. that would re-render. */
  const rerendered = (prev: ChatItem[], next: ChatItem[], prevHl: string | null = null, nextHl = prevHl) => {
    const a = bubbleProps(prev, prevHl);
    const b = bubbleProps(next, nextHl);
    return [...b].filter(([id, p]) => !a.has(id) || !shallowEqualProps(a.get(id)!, p)).map(([id]) => id);
  };

  // A refetch parsed from JSON: every object is new, even the unchanged ones.
  const refetch = (list: TimelineEntry[]) => JSON.parse(JSON.stringify(list)) as TimelineEntry[];

  it("returns the previous array when nothing changed", () => {
    const first = build(entries());
    const second = shareChatItems(first, build(refetch(entries())));
    expect(second).toBe(first);
    expect(rerendered(first, second)).toEqual([]);
  });

  it("re-renders only the bubble whose message changed", () => {
    const first = build(entries());
    const changed = refetch(entries()).map((e) =>
      e.id === "c2" ? { ...e, content: "edited", updated_at: "2026-10-16T09:00:00Z" } : e,
    );
    const second = shareChatItems(first, build(changed));
    expect(second).not.toBe(first);
    expect(rerendered(first, second)).toEqual(["c2"]);
    // Rows around it keep their objects.
    expect(second.filter((i) => i.id !== "c2").every((i) => first.includes(i))).toBe(true);
  });

  it("re-renders a bubble on a new reaction although updated_at stays", () => {
    const first = build(entries());
    const changed = refetch(entries()).map((e) =>
      e.id === "c4"
        ? { ...e, reactions: [{ id: "r1", comment_id: "c4", actor_type: "member", actor_id: ME, emoji: "👍", created_at: "2026-10-16T08:05:00Z" }] }
        : e,
    ) as TimelineEntry[];
    expect(rerendered(first, shareChatItems(first, build(changed)))).toEqual(["c4"]);
  });

  it("re-renders the reply when its quoted root changed", () => {
    const first = build(entries());
    const changed = refetch(entries()).map((e) => (e.id === "c1" ? { ...e, content: "new root" } : e));
    expect(rerendered(first, shareChatItems(first, build(changed))).sort()).toEqual(["c1", "c3"]);
  });

  it("adds a new message without re-rendering the others", () => {
    const first = build(entries());
    const more = [...refetch(entries()), comment("c5", "2026-10-16T08:30:00Z")];
    const second = shareChatItems(first, build(more));
    expect(rerendered(first, second)).toEqual(["c5"]);
  });

  it("keeps ids and order for the quote jump; highlight re-renders only the target", () => {
    const first = build(entries());
    const second = shareChatItems(first, build(refetch(entries())));
    expect(kinds(second)).toEqual(kinds(first));
    const c3 = second.find((i) => i.id === "c3");
    expect(c3?.kind === "message" && c3.replyTo?.rootId).toBe("c1");
    expect(rerendered(second, second, null, "c1")).toEqual(["c1"]);
    expect(rerendered(second, second, "c1", null)).toEqual(["c1"]);
  });

  it("passes the first build through", () => {
    const next = build(entries());
    expect(shareChatItems(undefined, next)).toBe(next);
    expect(shareChatItems([], next)).toBe(next);
  });
});

describe("cache → server on a cold open", () => {
  const OTHER = "33333333-3333-4333-8333-333333333333";
  const withFile = (id: string, at: string): TimelineEntry =>
    comment(id, at, {
      actor_avatar_url: "https://cdn.example/a.png?X-Amz-Signature=s1",
      attachments: [
        {
          id: `f-${id}`,
          workspace_id: "ws",
          issue_id: "issue-1",
          comment_id: id,
          chat_session_id: null,
          chat_message_id: null,
          uploader_type: "agent",
          uploader_id: AGENT,
          filename: "log.txt",
          url: `https://files.example/${id}?token=t1`,
          download_url: `https://files.example/dl/${id}?sig=t1`,
          markdown_url: `mc://file/f-${id}`,
          content_type: "text/plain",
          size_bytes: 12,
          created_at: "2026-10-16T08:00:00Z",
        },
      ],
    } as Partial<TimelineEntry>);

  /** 60 entries; every third with an attachment and a signed avatar URL. */
  const serverEntries = (n = 60, sig = "1"): TimelineEntry[] =>
    Array.from({ length: n }, (_, i) => {
      const at = new Date(Date.UTC(2026, 9, 16, 8, i)).toISOString();
      const e = i % 3 === 0 ? withFile(`c${i}`, at) : comment(`c${i}`, at, { actor_id: i % 2 ? AGENT : OTHER });
      return JSON.parse(JSON.stringify(e).replaceAll("=s1", `=s${sig}`).replaceAll("=t1", `=t${sig}`));
    });

  /** What `initialData` hands the chat: the entry as the cache stored and read it. */
  function fromCache(entries: TimelineEntry[]): TimelineEntry[] {
    const store = new TimelineCacheStore(new MemoryKv(), () => 1_000_000);
    store.bind({ serverOrigin: "https://multica.example", userId: ME });
    expect(store.write("ws", "issue-1", entries, 1_000_000)).toBe(true);
    return store.read("ws", "issue-1")!.entries;
  }

  const build = (list: TimelineEntry[]) => buildChatItems(list, { userId: ME, dayKey });
  const ids = (items: ChatItem[]) => items.map((i) => i.id);

  it("server data with 1 new entry: only that row is new, no empty build, window keeps its rows", () => {
    const cached = build(fromCache(serverEntries()));
    // Fresh signatures from the server: the cache never had them.
    const synced = [...serverEntries(60, "2"), comment("c60", "2026-10-16T10:00:00Z")];
    const next = shareChatItems(cached, build(synced));

    expect(next.length).toBeGreaterThan(0);
    const newRows = next.filter((i) => !cached.includes(i)).map((i) => i.id);
    expect(newRows).toEqual(["c60"]);

    // The window on screen before the next block only grows at its end.
    const before = chatWindow(cached, {});
    const after = chatWindow(next, { keepFromId: before[0]!.id });
    expect(ids(after).slice(0, before.length)).toEqual(ids(before));
    expect(after.slice(0, before.length).every((row, i) => row === before[i])).toBe(true);
    expect(ids(after).at(-1)).toBe("c60");
  });

  it("a real change of a cached entry still renews its row", () => {
    const cached = build(fromCache(serverEntries()));
    const synced = serverEntries().map((e) => (e.id === "c3" ? { ...e, content: "edited" } : e));
    const next = shareChatItems(cached, build(synced));
    expect(next.filter((i) => !cached.includes(i)).map((i) => i.id)).toEqual(["c3"]);
  });

  it("a row inserted in the middle does not renew the rows below it", () => {
    const first = build(serverEntries(10));
    const withUnread = buildChatItems(JSON.parse(JSON.stringify(serverEntries(10))), {
      userId: ME,
      dayKey,
      unreadInbox: [inbox({ details: { comment_id: "c5" } as InboxItem["details"], created_at: "2026-10-16T08:05:00Z" })],
    });
    const next = shareChatItems(first, withUnread);
    expect(next.filter((i) => !first.includes(i)).map((i) => i.id)).toEqual(["unread"]);
  });
});

describe("shallowEqualProps", () => {
  it("compares keys and values with Object.is", () => {
    const fn = () => {};
    expect(shallowEqualProps({ a: 1, f: fn }, { a: 1, f: fn })).toBe(true);
    expect(shallowEqualProps({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqualProps({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqualProps({ a: {} }, { a: {} })).toBe(false);
    expect(shallowEqualProps({ a: undefined }, { b: undefined })).toBe(false);
  });
});
