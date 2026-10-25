/**
 * W6-P9: mention frequency —
 * parser, counting, cap at 200, ranking count → last → name, clearing,
 * broken storage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryKv } from "@/data/timeline-cache/memory-kv";
import {
  clearAllMentionUsage,
  clearMentionUsage,
  MENTION_USAGE_MAX_COUNT,
  MENTION_USAGE_MAX_ENTRIES,
  type MentionUsage,
  mentionTargetsOf,
  noteSentMentions,
  parseMentionUsage,
  rankFrequent,
  readMentionUsage,
  recordMentions,
  registerMentionUsageStore,
  serializeMentionUsage,
  subscribeMentionUsage,
} from "./mention-usage";

const B = "agent:b";
const C = "member:c";
const D = "agent:d";

describe("mentionTargetsOf", () => {
  it("counts each member/agent/squad once per message, ignores @all and issues", () => {
    const md =
      "[@B](mention://agent/b) and [@C](mention://member/c) again [@B](mention://agent/b) " +
      "[@all](mention://all/all) [MUL-1](mention://issue/i-1) [@Sq](mention://squad/s-1)";
    expect(mentionTargetsOf(md)).toEqual([B, C, "squad:s-1"]);
  });

  it("ignores plain text, normal links and typed @names", () => {
    expect(mentionTargetsOf("hi @bob, see [docs](https://x.y/mention://agent/z)")).toEqual([]);
  });
});

describe("recordMentions", () => {
  it("adds 1 per send and sets last", () => {
    let u: MentionUsage = {};
    u = recordMentions(u, [B, C], 100);
    u = recordMentions(u, [B], 200);
    expect(u).toEqual({ [B]: { n: 2, last: 200 }, [C]: { n: 1, last: 100 } });
  });

  it("does not change the input object", () => {
    const u: MentionUsage = { [B]: { n: 1, last: 1 } };
    recordMentions(u, [B], 2);
    expect(u[B]).toEqual({ n: 1, last: 1 });
  });

  it("keeps at most 200 entries; the oldest last goes first", () => {
    let u: MentionUsage = {};
    for (let i = 0; i < MENTION_USAGE_MAX_ENTRIES; i++) {
      u = recordMentions(u, [`member:m${i}`], 1000 + i);
    }
    expect(Object.keys(u)).toHaveLength(200);
    u = recordMentions(u, ["agent:new"], 5000);
    expect(Object.keys(u)).toHaveLength(200);
    expect(u["member:m0"]).toBeUndefined();
    expect(u["member:m1"]).toBeDefined();
    expect(u["agent:new"]).toEqual({ n: 1, last: 5000 });
  });

  it("caps n at 9999", () => {
    const u = recordMentions({ [B]: { n: MENTION_USAGE_MAX_COUNT, last: 1 } }, [B], 2);
    expect(u[B]!.n).toBe(MENTION_USAGE_MAX_COUNT);
  });

  it("drops ids that no longer exist when the known set is given, keeps new targets", () => {
    const u = recordMentions(
      { [B]: { n: 3, last: 1 }, [C]: { n: 1, last: 1 } },
      [D],
      2,
      new Set([C]),
    );
    expect(Object.keys(u).sort()).toEqual([D, C].sort());
  });
});

describe("rankFrequent", () => {
  const cand = (key: string, name: string) => ({ key, name });

  it("sorts by count, then last mention, then name", () => {
    const usage: MentionUsage = {
      [B]: { n: 2, last: 10 },
      [D]: { n: 2, last: 20 },
      [C]: { n: 1, last: 99 },
      "agent:x": { n: 2, last: 20 },
    };
    const ranked = rankFrequent(usage, [
      cand(C, "carla"),
      cand(B, "bob"),
      cand("agent:x", "xavier"),
      cand(D, "dora"),
    ]);
    // D and x tie on n and last → name; B is older; C has fewer.
    expect(ranked.map((r) => r.name)).toEqual(["dora", "xavier", "bob", "carla"]);
  });

  it("leaves out never-mentioned candidates and unknown ids, at most `limit`", () => {
    const usage: MentionUsage = { [B]: { n: 1, last: 1 }, "agent:gone": { n: 9, last: 9 } };
    expect(rankFrequent(usage, [cand(B, "b"), cand(C, "c")]).map((r) => r.key)).toEqual([B]);
    const many: MentionUsage = {};
    const cands = Array.from({ length: 12 }, (_, i) => {
      many[`member:${i}`] = { n: i + 1, last: i };
      return cand(`member:${i}`, `m${i}`);
    });
    const top = rankFrequent(many, cands);
    expect(top).toHaveLength(8);
    expect(top[0]!.key).toBe("member:11");
  });

  it("returns nothing on a fresh install", () => {
    expect(rankFrequent({}, [cand(B, "b")])).toEqual([]);
  });
});

describe("parseMentionUsage", () => {
  it("round-trips", () => {
    const u: MentionUsage = { [B]: { n: 2, last: 5 } };
    expect(parseMentionUsage(serializeMentionUsage(u))).toEqual(u);
  });

  it.each([
    ["null", null],
    ["not JSON", "{oops"],
    ["array", "[]"],
    ["wrong version", JSON.stringify({ v: 2, items: { [B]: { n: 1, last: 1 } } })],
    ["items not an object", JSON.stringify({ v: 1, items: 3 })],
  ])("broken content (%s) → empty, no throw", (_name, raw) => {
    expect(parseMentionUsage(raw)).toEqual({});
  });

  it("drops bad entries and keys, keeps the good ones", () => {
    const raw = JSON.stringify({
      v: 1,
      items: {
        [B]: { n: 3, last: 7 },
        [C]: { n: "3", last: 7 },
        [D]: { n: 0, last: 7 },
        "issue:i-1": { n: 1, last: 1 },
        "all:all": { n: 1, last: 1 },
      },
    });
    expect(parseMentionUsage(raw)).toEqual({ [B]: { n: 3, last: 7 } });
  });
});

describe("stored usage per workspace", () => {
  let kv: MemoryKv;
  beforeEach(() => {
    kv = new MemoryKv();
    registerMentionUsageStore(kv);
  });

  it("counts only what is noted after a send, per workspace, and persists it", () => {
    noteSentMentions("ws-1", "[@B](mention://agent/b)", { now: 1 });
    noteSentMentions("ws-1", "[@B](mention://agent/b) [@C](mention://member/c)", { now: 2 });
    noteSentMentions("ws-2", "[@C](mention://member/c)", { now: 3 });
    expect(readMentionUsage("ws-1")).toEqual({ [B]: { n: 2, last: 2 }, [C]: { n: 1, last: 2 } });
    // A restart reads the same from storage.
    registerMentionUsageStore(kv);
    expect(readMentionUsage("ws-1")[B]!.n).toBe(2);
    expect(readMentionUsage("ws-2")).toEqual({ [C]: { n: 1, last: 3 } });
  });

  it("a send without mentions or without workspace writes nothing", () => {
    noteSentMentions("ws-1", "plain text");
    noteSentMentions(null, "[@B](mention://agent/b)");
    expect(kv.getAllKeys()).toEqual([]);
  });

  it("returns the same object until it changes (useSyncExternalStore)", () => {
    noteSentMentions("ws-1", "[@B](mention://agent/b)", { now: 1 });
    const a = readMentionUsage("ws-1");
    expect(readMentionUsage("ws-1")).toBe(a);
    noteSentMentions("ws-1", "[@B](mention://agent/b)", { now: 2 });
    expect(readMentionUsage("ws-1")).not.toBe(a);
  });

  it("Clear history clears only the current workspace and notifies", () => {
    noteSentMentions("ws-1", "[@B](mention://agent/b)");
    noteSentMentions("ws-2", "[@B](mention://agent/b)");
    const listener = vi.fn();
    const off = subscribeMentionUsage(listener);
    clearMentionUsage("ws-1");
    off();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readMentionUsage("ws-1")).toEqual({});
    expect(readMentionUsage("ws-2")[B]!.n).toBe(1);
    expect(kv.getAllKeys()).toEqual(["ws-2"]);
  });

  it("logout clears every workspace", () => {
    noteSentMentions("ws-1", "[@B](mention://agent/b)");
    noteSentMentions("ws-2", "[@C](mention://member/c)");
    clearAllMentionUsage();
    expect(readMentionUsage("ws-1")).toEqual({});
    expect(readMentionUsage("ws-2")).toEqual({});
    expect(kv.getAllKeys()).toEqual([]);
  });

  it("broken stored content → empty, and the next send starts fresh", () => {
    kv.set("ws-1", "{broken");
    registerMentionUsageStore(kv);
    expect(readMentionUsage("ws-1")).toEqual({});
    noteSentMentions("ws-1", "[@B](mention://agent/b)", { now: 4 });
    expect(readMentionUsage("ws-1")).toEqual({ [B]: { n: 1, last: 4 } });
  });

  it("a failing store never throws into the send path", () => {
    registerMentionUsageStore({
      getString: () => {
        throw new Error("io");
      },
      set: () => {
        throw new Error("io");
      },
      remove: () => {
        throw new Error("io");
      },
      clearAll: () => {
        throw new Error("io");
      },
    });
    expect(() => noteSentMentions("ws-1", "[@B](mention://agent/b)")).not.toThrow();
    expect(readMentionUsage("ws-1")[B]!.n).toBe(1);
    expect(() => clearAllMentionUsage()).not.toThrow();
  });
});
