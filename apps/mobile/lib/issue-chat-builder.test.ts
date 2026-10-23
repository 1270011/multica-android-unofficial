import { describe, expect, it, vi } from "vitest";
import type { InboxItem, TimelineEntry } from "@multica/core/types";
import {
  buildChatItems,
  createChatItemsBuilder,
  shareChatItems,
  SYSTEM_GROUP_MIN,
  type BuildChatOptions,
  type ChatItem,
} from "./issue-chat";

vi.mock("@/data/server-config-store", () => ({ getServerBaseUrl: () => null }));

/**
 * The incremental builder must give exactly what the screen got
 * before — `shareChatItems(prev, buildChatItems(entries, options))` — for
 * any sequence of data changes: same rows (deep), and the same rows kept as
 * the previous object (that decides which bubbles re-render).
 */

const ME = "11111111-1111-4111-8111-111111111111";
const ACTORS = [ME, "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const dayKey = (iso: string) => iso.slice(0, 10);
const T0 = Date.parse("2026-10-16T08:00:00Z");

/** Small seeded PRNG so a failure is reproducible from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T,>(list: T[]): T => list[Math.floor(next() * list.length)]!,
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof rng>;

function makeEntry(r: Rng, n: number, at: number, entries: TimelineEntry[]): TimelineEntry {
  const iso = new Date(at).toISOString();
  const actor = r.pick(ACTORS);
  if (r.chance(0.35)) {
    const to = r.pick(["todo", "in_progress", "blocked", "in_review", "done"]);
    return {
      type: "activity",
      id: `a${n}`,
      actor_type: actor === ME ? "member" : "agent",
      actor_id: actor,
      created_at: iso,
      action: r.chance(0.7) ? "status_changed" : "assignee_changed",
      details: { from: "todo", to },
    };
  }
  const comments = entries.filter((e) => e.type === "comment");
  const parent = comments.length > 0 && r.chance(0.3) ? r.pick(comments).id : null;
  const mention = r.chance(0.15) ? ` [@me](mention://member/${ME})` : "";
  return {
    type: "comment",
    id: `c${n}`,
    actor_type: actor === ME ? "member" : "agent",
    actor_id: actor,
    created_at: iso,
    content: `**Zeile ${n}**${mention}\nmehr`,
    parent_id: parent,
    attachments: r.chance(0.1)
      ? [
          {
            id: `att${n}`,
            filename: "a.png",
            url: `https://cdn.example/a.png?sig=${n}`,
            content_type: "image/png",
            size_bytes: 10,
          } as never,
        ]
      : undefined,
  };
}

function initial(r: Rng, count: number): { entries: TimelineEntry[]; clock: number; n: number } {
  const entries: TimelineEntry[] = [];
  let clock = T0;
  let n = 0;
  for (let i = 0; i < count; i++) {
    // Mostly seconds apart (author groups, system runs), sometimes a day.
    clock += r.chance(0.05) ? 26 * 3600_000 : r.chance(0.2) ? 10 * 60_000 : 1000 * (1 + r.int(30));
    entries.push(makeEntry(r, n++, clock, entries));
  }
  return { entries, clock, n };
}

type State = {
  entries: TimelineEntry[];
  clock: number;
  n: number;
  options: BuildChatOptions;
};

/** One data change as the chat screen sees it; unchanged entries keep their object. */
function change(r: Rng, s: State): string {
  const { entries } = s;
  const idx = () => r.int(entries.length);
  const replaceAt = (i: number, patch: Partial<TimelineEntry>) => {
    s.entries = entries.map((e, k) => (k === i ? { ...e, ...patch } : e));
  };
  const op = r.int(13);
  switch (op) {
    case 0: {
      s.clock += 1000 * (1 + r.int(400));
      s.entries = [...entries, makeEntry(r, s.n++, s.clock, entries)];
      return "append";
    }
    case 1: {
      const i = idx();
      if (entries[i]!.type === "comment") replaceAt(i, { content: `edit ${r.int(1000)}` });
      return "edit";
    }
    case 2: {
      const i = idx();
      if (entries[i]!.type === "comment")
        replaceAt(i, { deleted_at: entries[i]!.deleted_at ? null : new Date(s.clock).toISOString() } as never);
      return "delete-toggle";
    }
    case 3: {
      const i = idx();
      if (entries[i]!.type === "comment")
        replaceAt(i, { resolved_at: entries[i]!.resolved_at ? null : new Date(s.clock).toISOString() });
      return "resolve-toggle";
    }
    case 4: {
      // An entry the sync brings in the middle (same clock as a neighbour).
      const i = idx();
      const e = makeEntry(r, s.n++, Date.parse(entries[i]!.created_at), entries.slice(0, i));
      s.entries = [...entries.slice(0, i + 1), e, ...entries.slice(i + 1)];
      return "insert";
    }
    case 5: {
      const i = idx();
      s.entries = entries.filter((_, k) => k !== i);
      return "remove";
    }
    case 6:
      // Cache → server: equal data, all new objects, signed URLs differ.
      s.entries = (JSON.parse(JSON.stringify(entries)) as TimelineEntry[]).map((e) =>
        e.attachments
          ? { ...e, attachments: e.attachments.map((a) => ({ ...a, url: `${a.url}x` })) }
          : e,
      );
      return "sync";
    case 7:
      s.entries = [...entries];
      return "refetch";
    case 8: {
      const comments = entries.filter((e) => e.type === "comment");
      const unread: InboxItem[] = r.chance(0.3)
        ? []
        : [
            {
              id: `in${r.int(1000)}`,
              workspace_id: "ws",
              recipient_type: "member",
              recipient_id: ME,
              actor_type: "agent",
              actor_id: ACTORS[1]!,
              type: "new_comment",
              severity: "info",
              issue_id: "issue",
              title: "t",
              body: null,
              issue_status: null,
              read: false,
              archived: false,
              created_at: comments.length ? r.pick(comments).created_at : new Date(T0).toISOString(),
              details: r.chance(0.5) && comments.length ? { comment_id: r.pick(comments).id } : null,
            },
          ];
      s.options = { ...s.options, unreadInbox: unread };
      return "unread";
    }
    case 9: {
      const groups = buildChatItems(entries, s.options).filter((i) => i.kind === "system-group");
      if (groups.length === 0) return "expand-none";
      const next = new Set(s.options.expandedGroups);
      next.add(r.pick(groups).id);
      s.options = { ...s.options, expandedGroups: next };
      return "expand";
    }
    case 10: {
      // Local pending row with a slightly older clock, appended at the end.
      const last = entries[entries.length - 1]!;
      s.entries = [
        ...entries,
        {
          type: "comment",
          id: `optimistic-${s.n++}`,
          actor_type: "member",
          actor_id: ME,
          created_at: new Date(Date.parse(last.created_at) - 500).toISOString(),
          content: "pending",
          parent_id: null,
        },
      ];
      return "pending";
    }
    case 11:
      s.options = { ...s.options, userId: s.options.userId === ME ? ACTORS[1]! : ME };
      return "user";
    default: {
      // Status change of a system row to/from an emphasised one.
      const i = idx();
      if (entries[i]!.type === "activity")
        replaceAt(i, { details: { from: "todo", to: r.pick(["blocked", "in_progress"]) } });
      return "status";
    }
  }
}

/** For each row: was it kept as the previous result's object with that id? */
function keptMask(prev: ChatItem[] | undefined, next: ChatItem[]): boolean[] {
  const byId = new Map((prev ?? []).map((i) => [i.id, i]));
  return next.map((i) => byId.get(i.id) === i);
}

describe("createChatItemsBuilder", () => {
  it.each(Array.from({ length: 40 }, (_, k) => k + 1))(
    "equals full rebuild + sharing over random changes (seed %i)",
    (seed) => {
      const r = rng(seed);
      const start = initial(r, 20 + r.int(120));
      const s: State = { ...start, options: { userId: ME, dayKey, unreadInbox: [] } };
      const build = createChatItemsBuilder();
      let prevFull: ChatItem[] | undefined;
      let prevInc: ChatItem[] | undefined;
      const log: string[] = [];
      for (let step = 0; step < 60; step++) {
        if (step > 0) log.push(change(r, s));
        const full = shareChatItems(prevFull, buildChatItems(s.entries, s.options));
        const inc = build(s.entries, s.options);
        const where = `seed ${seed}, after ${log.join(" → ")}`;
        expect(inc, where).toEqual(full);
        // Re-render behaviour: the same rows are previous objects.
        expect(keptMask(prevInc, inc), where).toEqual(keptMask(prevFull, full));
        expect(inc === prevInc, where).toBe(full === prevFull);
        prevFull = full;
        prevInc = inc;
      }
    },
  );

  it("recomputes only the rows around a WS append", () => {
    const r = rng(99);
    const { entries, clock } = initial(r, 200);
    const build = createChatItemsBuilder();
    const options = { userId: ME, dayKey, unreadInbox: [] };
    const before = build(entries, options);
    const added: TimelineEntry = {
      type: "comment",
      id: "new",
      actor_type: "agent",
      actor_id: ACTORS[1]!,
      created_at: new Date(clock + 3600_000).toISOString(),
      content: "neu",
      parent_id: null,
    };
    const after = build([...entries, added], options);
    const old = new Set(before);
    const fresh = after.filter((i) => !old.has(i));
    // The new message, at most a day separator and the system rows/group
    // right before it (a run of system rows ends with the new comment).
    expect(fresh.map((i) => i.id)).toContain("new");
    expect(fresh.length).toBeLessThanOrEqual(2 + SYSTEM_GROUP_MIN);
  });

  it("keeps rows after a cache → server sync for later WS patches", () => {
    const r = rng(7);
    const { entries } = initial(r, 150);
    const build = createChatItemsBuilder();
    const options = { userId: ME, dayKey, unreadInbox: [] };
    const cached = build(entries, options);
    const server = JSON.parse(JSON.stringify(entries)) as TimelineEntry[];
    const synced = build(server, options);
    expect(synced).toBe(cached);
    // A comment without replies: replies quote their root and change with it.
    const parents = new Set(server.map((e) => e.parent_id));
    const i = server.findIndex((e) => e.type === "comment" && !parents.has(e.id));
    const edited = server.map((e, k) => (k === i ? { ...e, content: "geändert" } : e));
    const patched = build(edited, options);
    const changed = patched.filter((row, k) => row !== synced[k]);
    expect(changed.map((row) => row.id)).toEqual([server[i]!.id]);
  });

  it("gives the same rows as before for an unsorted list (pending rows)", () => {
    const at = (s: number) => new Date(T0 + s * 1000).toISOString();
    const entries: TimelineEntry[] = [
      { type: "comment", id: "a", actor_type: "agent", actor_id: ACTORS[1]!, created_at: at(10), content: "a", parent_id: null },
      { type: "comment", id: "b", actor_type: "agent", actor_id: ACTORS[1]!, created_at: at(20), content: "b", parent_id: null },
      { type: "comment", id: "p", actor_type: "member", actor_id: ME, created_at: at(15), content: "p", parent_id: null },
    ];
    const ids = buildChatItems(entries, { userId: ME, dayKey })
      .filter((i) => i.kind === "message")
      .map((i) => i.id);
    expect(ids).toEqual(["a", "p", "b"]);
  });
});
