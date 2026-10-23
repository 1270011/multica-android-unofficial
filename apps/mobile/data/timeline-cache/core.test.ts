/**
 * Storage rules of the on-device timeline cache (C1–C3, C6, C12).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import {
  MAX_AGE_MS,
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_TOTAL_BYTES,
  SCHEMA_VERSION,
  entryKey,
  sanitizeTimeline,
  shouldPersistQuery,
  stripUrlQuery,
  TimelineCacheStore,
} from "./core";
import { MemoryKv } from "./memory-kv";
import { issueKeys } from "@/data/queries/issue-keys";
import { newOptimisticCommentId } from "@/lib/pending-comments";
import { resolveAttachmentUrlWithBase } from "@/lib/attachment-url";
import { standaloneAttachments } from "@/lib/attachment-dedup";

const comment = (id: string, content = "hello"): TimelineEntry => ({
  type: "comment",
  id,
  actor_type: "member",
  actor_id: "u-1",
  created_at: "2026-10-19T04:00:00Z",
  content,
});

vi.mock("@/data/server-config-store", () => ({ getServerBaseUrl: () => null }));

const binding = { serverOrigin: "https://multica.example", userId: "u-1" };

function setup(start = 1_000_000) {
  let now = start;
  const kv = new MemoryKv();
  const store = new TimelineCacheStore(kv, () => now);
  store.bind(binding);
  return { kv, store, advance: (ms: number) => (now += ms), now: () => now };
}

describe("C1 allowlist", () => {
  it("accepts only issueKeys.timeline", () => {
    expect(shouldPersistQuery(issueKeys.timeline("ws", "i-1"))).toBe(true);
    for (const key of [
      issueKeys.detail("ws", "i-1"),
      issueKeys.list("ws"),
      issueKeys.attachments("ws", "i-1"),
      issueKeys.timeline(null, "i-1"),
      issueKeys.timeline("ws", ""),
      ["inbox", "ws"],
      ["chat", "ws", "sessions"],
      [...issueKeys.timeline("ws", "i-1"), "extra"],
    ]) {
      expect(shouldPersistQuery(key)).toBe(false);
    }
  });
});

describe("C2 LRU and limits", () => {
  it("the 21st entry evicts the least recently used one", () => {
    const { store, advance } = setup();
    for (let i = 0; i < MAX_ENTRIES; i++) {
      store.write("ws", `i-${i}`, [comment(`c-${i}`)], 1_000_000);
      advance(10);
    }
    // Reading i-0 makes i-1 the oldest.
    expect(store.read("ws", "i-0")).not.toBeNull();
    advance(10);
    store.write("ws", "i-new", [comment("c-new")], 1_000_000);
    expect(store.entryKeys()).toHaveLength(MAX_ENTRIES);
    expect(store.read("ws", "i-1")).toBeNull();
    expect(store.read("ws", "i-0")).not.toBeNull();
    expect(store.read("ws", "i-new")).not.toBeNull();
  });

  it("does not write an oversized entry and drops its older copy", () => {
    const { store, kv } = setup();
    store.write("ws", "big", [comment("c-1")], 1_000_000);
    const huge = "x".repeat(MAX_ENTRY_BYTES / 2 + 10);
    expect(store.write("ws", "big", [comment("c-2", huge)], 1_000_000)).toBe(false);
    expect(kv.getString(entryKey("ws", "big"))).toBeUndefined();
    expect(store.read("ws", "big")).toBeNull();
  });

  it("keeps the total under 5 MB by evicting the oldest", () => {
    const { store, advance } = setup();
    const content = "y".repeat(Math.floor(MAX_ENTRY_BYTES / 2) - 2000);
    const fits = Math.floor(MAX_TOTAL_BYTES / MAX_ENTRY_BYTES);
    for (let i = 0; i < fits + 3; i++) {
      expect(store.write("ws", `i-${i}`, [comment(`c-${i}`, content)], 1_000_000)).toBe(true);
      advance(10);
    }
    expect(store.entryKeys().length).toBeLessThanOrEqual(fits);
    expect(store.read("ws", "i-0")).toBeNull();
    expect(store.read("ws", `i-${fits + 2}`)).not.toBeNull();
  });

  it("deletes entries older than 7 days instead of showing them", () => {
    const { store, kv, advance } = setup();
    store.write("ws", "i-1", [comment("c-1")], 1_000_000);
    advance(MAX_AGE_MS + 1);
    expect(store.read("ws", "i-1")).toBeNull();
    expect(kv.getString(entryKey("ws", "i-1"))).toBeUndefined();
  });
});

describe("C3 only timeline fields", () => {
  it("strips signed URLs, files, unknown fields and unconfirmed comments", () => {
    const entry = {
      ...comment("c-1"),
      actor_avatar_url: "https://cdn.example/a.png?X-Amz-Signature=secret#frag",
      attachments: [
        {
          id: "f-1",
          workspace_id: "ws",
          issue_id: "i-1",
          comment_id: "c-1",
          chat_session_id: null,
          chat_message_id: null,
          uploader_type: "member",
          uploader_id: "u-1",
          filename: "log.txt",
          url: "https://files.example/log.txt?token=secret",
          download_url: "https://files.example/dl?sig=secret",
          markdown_url: "mc://file/f-1",
          content_type: "text/plain",
          size_bytes: 12,
          created_at: "",
        },
      ],
      authorization: "Bearer secret",
    } as unknown as TimelineEntry;
    const pending = comment(newOptimisticCommentId(), "not sent yet");
    const out = sanitizeTimeline([entry, pending]);
    expect(out).toHaveLength(1);
    const json = JSON.stringify(out);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("authorization");
    expect(out[0].actor_avatar_url).toBe("https://cdn.example/a.png");
    expect(out[0].attachments).toEqual([
      expect.objectContaining({ id: "f-1", filename: "log.txt", content_type: "text/plain", size_bytes: 12, url: "" }),
    ]);
    expect(Object.keys(out[0].attachments![0]).sort()).toEqual(
      ["content_type", "download_url", "filename", "id", "markdown_url", "size_bytes", "url"],
    );
  });

  it("stripUrlQuery keeps scheme, host and path", () => {
    expect(stripUrlQuery("https://a.example/x/y?z=1")).toBe("https://a.example/x/y");
    expect(stripUrlQuery("https://a.example/x#k")).toBe("https://a.example/x");
    expect(stripUrlQuery("https://a.example/x")).toBe("https://a.example/x");
  });

  it("an image attachment read from the cache has a stable, resolvable URL", () => {
    const { store, kv } = setup();
    const id = "0b9a6f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    const path = `/api/attachments/${id}/download`;
    const entry = {
      ...comment("c-1", `see ![shot](${path})`),
      attachments: [
        {
          id,
          filename: "shot.png",
          url: "https://files.example/shot.png?sig=secret",
          download_url: "https://files.example/dl?sig=secret",
          markdown_url: path,
          content_type: "image/png",
          size_bytes: 2048,
        },
      ],
    } as unknown as TimelineEntry;
    store.write("ws", "i-1", [entry], 1_000_000);
    // Stored: metadata only, no URL at all.
    expect(kv.getString(entryKey("ws", "i-1"))).not.toContain("files.example");
    const raw = JSON.parse(kv.getString(entryKey("ws", "i-1"))!);
    expect(raw.entries[0].attachments[0]).toMatchObject({ url: "", download_url: "", markdown_url: "" });

    const att = store.read("ws", "i-1")!.entries[0].attachments![0];
    expect(att).toMatchObject({ id, url: path, download_url: path, markdown_url: path });
    expect(resolveAttachmentUrlWithBase(att.download_url, "https://multica.example/")).toBe(
      `https://multica.example${path}`,
    );
    // Referenced inline in the body: no extra card, the image shows once.
    expect(standaloneAttachments([att], `see ![shot](${path})`)).toEqual([]);
  });

  it("what is stored passes the timeline schema again", () => {
    const { store } = setup();
    store.write("ws", "i-1", sanitizeTimeline([comment("c-1")]), 1_000_000);
    expect(store.read("ws", "i-1")?.entries[0]).toMatchObject({ id: "c-1", content: "hello" });
  });
});

describe("C6 binding", () => {
  it("another user sees nothing", () => {
    const { store, kv } = setup();
    store.write("ws", "i-1", [comment("c-1")], 1_000_000);
    const other = new TimelineCacheStore(kv, () => 1_000_000);
    expect(other.bind({ ...binding, userId: "u-2" })).toBe(true);
    expect(other.read("ws", "i-1")).toBeNull();
    expect(other.entryKeys()).toEqual([]);
  });

  it("another server or schema wipes, the same binding keeps", () => {
    const { store, kv } = setup();
    store.write("ws", "i-1", [comment("c-1")], 1_000_000);
    expect(store.bind(binding)).toBe(false);
    expect(store.read("ws", "i-1")).not.toBeNull();
    expect(store.bind({ ...binding, serverOrigin: "https://other.example" })).toBe(true);
    expect(store.entryKeys()).toEqual([]);

    store.write("ws", "i-1", [comment("c-1")], 1_000_000);
    const meta = JSON.parse(kv.getString("meta")!);
    kv.set("meta", JSON.stringify({ ...meta, schemaVersion: SCHEMA_VERSION + 1 }));
    expect(store.bind({ ...binding, serverOrigin: "https://other.example" })).toBe(true);
    expect(store.entryKeys()).toEqual([]);
  });
});

describe("C12 broken entries", () => {
  it("deletes an entry that fails the schema or is not JSON", () => {
    const { store, kv } = setup();
    kv.set(
      entryKey("ws", "bad"),
      JSON.stringify({ v: SCHEMA_VERSION, savedAt: 1_000_000, entries: [{ id: 5 }] }),
    );
    kv.set(entryKey("ws", "junk"), "{not json");
    kv.set(entryKey("ws", "old"), JSON.stringify({ v: 0, savedAt: 1_000_000, entries: [] }));
    expect(store.read("ws", "bad")).toBeNull();
    expect(store.read("ws", "junk")).toBeNull();
    expect(store.read("ws", "old")).toBeNull();
    expect(store.entryKeys()).toEqual([]);
  });

  it("never logs (no console.* in the cache code)", () => {
    const dir = __dirname;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      expect(readFileSync(join(dir, file), "utf8")).not.toMatch(/console\./);
    }
  });
});

describe("C12 in blocks when an issue opens", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => comment(`c-${i}`, "x".repeat(100)));

  it("same result as the one-shot read, split by yields", async () => {
    const { store } = setup();
    store.write("ws", "i-1", many(300), 1_000_000);
    const oneShot = store.read("ws", "i-1");
    const yields = vi.spyOn(globalThis, "setTimeout");
    try {
      const chunked = await store.readInChunks("ws", "i-1", { budgetMs: 0 });
      expect(chunked).toEqual(oneShot);
      expect(yields.mock.calls.length).toBeGreaterThanOrEqual(299);
    } finally {
      yields.mockRestore();
    }
  });

  it("a broken entry anywhere drops the whole entry, nothing shown", async () => {
    const { store, kv } = setup();
    const entries: unknown[] = many(50);
    entries[40] = { id: 5 };
    kv.set(entryKey("ws", "bad"), JSON.stringify({ v: SCHEMA_VERSION, savedAt: 1_000_000, entries }));
    kv.set(entryKey("ws", "junk"), "{not json");
    kv.set(entryKey("ws", "nolist"), JSON.stringify({ v: SCHEMA_VERSION, savedAt: 1_000_000, entries: {} }));
    expect(await store.readInChunks("ws", "bad", { budgetMs: 0 })).toBeNull();
    expect(await store.readInChunks("ws", "junk")).toBeNull();
    expect(await store.readInChunks("ws", "nolist")).toBeNull();
    expect(store.entryKeys()).toEqual([]);
  });

  it("too old is deleted, as in read", async () => {
    const { store, advance } = setup();
    store.write("ws", "i-1", many(3), 1_000_000);
    advance(MAX_AGE_MS + 1);
    expect(await store.readInChunks("ws", "i-1")).toBeNull();
    expect(store.entryKeys()).toEqual([]);
  });

  it("a write, removal or wipe during a yield gives null, never the old content", async () => {
    for (const change of [
      (s: TimelineCacheStore) => s.write("ws", "i-1", [comment("new")], 1_000_000),
      (s: TimelineCacheStore) => s.remove("ws", "i-1"),
      (s: TimelineCacheStore) => s.removeWorkspace("ws"),
      (s: TimelineCacheStore) => s.bind({ ...binding, userId: "u-2" }),
    ]) {
      const { store } = setup();
      store.write("ws", "i-1", many(20), 1_000_000);
      const pending = store.readInChunks("ws", "i-1", { budgetMs: 0 });
      change(store);
      expect(await pending).toBeNull();
    }
  });

  it("a write of another issue does not cancel the read", async () => {
    const { store } = setup();
    store.write("ws", "i-1", many(20), 1_000_000);
    const pending = store.readInChunks("ws", "i-1", { budgetMs: 0 });
    store.write("ws", "i-2", [comment("other")], 1_000_000);
    expect((await pending)?.entries).toHaveLength(20);
  });

  it("an aborted open stops between blocks", async () => {
    const { store } = setup();
    store.write("ws", "i-1", many(20), 1_000_000);
    const abort = new AbortController();
    const pending = store.readInChunks("ws", "i-1", { budgetMs: 0, signal: abort.signal });
    abort.abort();
    expect(await pending).toBeNull();
    expect(store.entryKeys()).toHaveLength(1);
  });
});
