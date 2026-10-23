/**
 * Session lifecycle of the timeline cache (C1, C4, C5,
 * C7, C13).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { TimelineEntry } from "@multica/core/types";
import {
  __resetTimelineCacheForTests,
  clearTimelineCache,
  encodeKeyBytes,
  isTimelineCacheOpen,
  mmkvKeyFrom,
  openTimelineCache,
  prefetchTimelineCacheKey,
  readCachedTimeline,
  readCachedTimelineInChunks,
  registerTimelineCacheBackend,
  startTimelinePersister,
  WRITE_DELAY_MS,
  writeCachedTimeline,
  type TimelineCacheBackend,
} from "./index";
import { MemoryKv } from "./memory-kv";
import { cacheDirectoryFor } from "./paths";
import { clearTimelineSync } from "./sync";
import { issueKeys } from "@/data/queries/issue-keys";
import { issueTimelineOptions } from "@/data/queries/issues";
import { api } from "@/data/api";

vi.mock("@/data/api", () => ({ api: { listTimeline: vi.fn() } }));

const comment = (id: string): TimelineEntry => ({
  type: "comment",
  id,
  actor_type: "member",
  actor_id: "u-1",
  created_at: "2026-10-19T04:00:00Z",
  content: "hi",
});

/**
 * Behaves like MMKV: one native instance per id for the whole
 * process; opening the same id again returns that instance and ignores the
 * new key. Deleting the files under an open instance unlinks them: writes
 * after that are lost at the next cold start.
 */
function fakeBackend(initialKey: string | null = "k".repeat(43)) {
  const state = {
    key: initialKey as string | null,
    kv: new MemoryKv(),
    filesDeleted: 0,
    openedWith: [] as string[],
    rekeyedWith: [] as string[],
    readKeyFails: false,
    openFails: false,
    /** A native instance exists in this process. */
    open: false,
    /** Key the files on disk are encrypted with. */
    diskKey: initialKey ? mmkvKeyFrom(initialKey) : (null as string | null),
    /** Files were deleted while the instance was open. */
    unlinked: false,
  };
  const backend: TimelineCacheBackend = {
    readKey: vi.fn(async () => {
      if (state.readKeyFails) throw new Error("keystore");
      return state.key;
    }),
    writeKey: vi.fn(async (k: string) => {
      state.key = k;
    }),
    deleteKey: vi.fn(async () => {
      state.key = null;
    }),
    newKey: () => encodeKeyBytes(new Uint8Array(24).fill(7)),
    openStore: (k: string) => {
      if (state.openFails) throw new Error("bad key");
      state.openedWith.push(k);
      if (state.open) return state.kv; // existing instance, `k` ignored
      if (state.kv.map.size > 0 && state.diskKey !== k) throw new Error("bad key");
      state.open = true;
      state.diskKey = k;
      return state.kv;
    },
    rekeyStore: vi.fn((store, k: string) => {
      expect(store).toBe(state.kv);
      state.rekeyedWith.push(k);
      state.diskKey = k;
    }),
    deleteFiles: () => {
      state.filesDeleted += 1;
      if (state.open) state.unlinked = true;
      state.kv.map.clear();
    },
    serverOrigin: () => "https://Multica.example/",
  };
  return { backend, state };
}

/** Process ends: what is left on disk, readable with the stored key only. */
function coldStart(prev: ReturnType<typeof fakeBackend>["state"]) {
  __resetTimelineCacheForTests();
  const next = fakeBackend(prev.key);
  if (!prev.unlinked) for (const [k, v] of prev.kv.map) next.state.kv.map.set(k, v);
  next.state.diskKey = prev.unlinked ? null : prev.diskKey;
  registerTimelineCacheBackend(next.backend);
  return next;
}

/** A successful server sync of one timeline (queryFn, not setQueryData). */
function fetchTimeline(qc: QueryClient, issueId: string, entries: TimelineEntry[]) {
  return qc.fetchQuery({
    queryKey: issueKeys.timeline("ws", issueId),
    queryFn: () => Promise.resolve(entries),
  });
}

beforeEach(() => {
  __resetTimelineCacheForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("C1 persister", () => {
  it("writes only timeline queries of a filled QueryClient", async () => {
    vi.useFakeTimers();
    const { backend, state } = fakeBackend();
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    const qc = new QueryClient();
    startTimelinePersister(qc);
    await fetchTimeline(qc, "i-1", [comment("c-1")]);
    qc.setQueryData(issueKeys.detail("ws", "i-1"), { id: "i-1", title: "secret title" });
    qc.setQueryData(issueKeys.list("ws"), [{ id: "i-1" }]);
    qc.setQueryData(["inbox", "ws"], [{ id: "n-1" }]);
    qc.setQueryData(["chat", "ws", "sessions"], [{ id: "s-1" }]);
    qc.getMutationCache().build(qc, { mutationKey: ["comment"] }).state.variables = {
      content: "retry payload",
    };
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    const keys = state.kv.getAllKeys().filter((k) => k !== "meta" && k !== "lru");
    expect(keys).toEqual(["t:ws:i-1"]);
    const dump = [...state.kv.map.values()].join("\n");
    expect(dump).not.toContain("secret title");
    expect(dump).not.toContain("retry payload");
  });
});

describe("C4 key", () => {
  it("reads the key in parallel with the token, before any open", async () => {
    const { backend } = fakeBackend();
    registerTimelineCacheBackend(backend);
    // auth-store: Promise.all([getToken(), prefetchTimelineCacheKey()])
    await Promise.all([Promise.resolve("token"), prefetchTimelineCacheKey()]);
    expect(backend.readKey).toHaveBeenCalledTimes(1);
    await openTimelineCache("u-1");
    expect(backend.readKey).toHaveBeenCalledTimes(1);
  });

  it("missing key: files deleted, empty cache, new key, no crash", async () => {
    const { backend, state } = fakeBackend(null);
    state.kv.set("t:ws:i-1", "leftover");
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    expect(state.filesDeleted).toBe(1);
    expect(state.key).toHaveLength(32);
    expect(readCachedTimeline("ws", "i-1")).toBeNull();
    expect(isTimelineCacheOpen()).toBe(true);
  });

  it("unreadable key: same as missing", async () => {
    const { backend, state } = fakeBackend();
    state.readKeyFails = true;
    state.kv.set("t:ws:i-1", "leftover");
    registerTimelineCacheBackend(backend);
    await expect(openTimelineCache("u-1")).resolves.toBeUndefined();
    expect(state.filesDeleted).toBe(1);
    expect(readCachedTimeline("ws", "i-1")).toBeNull();
  });

  it("store does not open (wrong key, broken file): start without cache", async () => {
    const { backend, state } = fakeBackend();
    state.openFails = true;
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    expect(isTimelineCacheOpen()).toBe(false);
    expect(state.filesDeleted).toBe(1);
    expect(readCachedTimeline("ws", "i-1")).toBeNull();
  });

  it("uses 32 key characters for AES-256", async () => {
    const { backend, state } = fakeBackend("A".repeat(43));
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    expect(state.openedWith).toEqual(["A".repeat(32)]);
    expect(mmkvKeyFrom("x".repeat(43))).toHaveLength(32);
  });

  it("encodes 32 random bytes as 43 base64url characters", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i * 8);
    const encoded = encodeKeyBytes(bytes);
    expect(encoded).toHaveLength(43);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).toBe(Buffer.from(bytes).toString("base64url"));
  });

  it("encodes 24 random bytes as exactly 32 base64url characters", () => {
    const bytes = Uint8Array.from({ length: 24 }, (_, i) => 255 - i * 7);
    const encoded = encodeKeyBytes(bytes);
    expect(encoded).toHaveLength(32);
    expect(encoded).toBe(Buffer.from(bytes).toString("base64url"));
    expect(mmkvKeyFrom(encoded)).toBe(encoded);
  });
});

describe("C5 location", () => {
  it("Android: noBackupFilesDir, never filesDir or shared prefs", () => {
    const dir = cacheDirectoryFor("android", "file:///data/user/0/com.example.app/files/");
    expect(dir).toBe("/data/user/0/com.example.app/no_backup/timeline-cache");
    expect(dir).not.toContain("/files");
    expect(dir).not.toContain("shared_prefs");
  });

  it("iOS: caches directory", () => {
    expect(cacheDirectoryFor("ios", "file:///var/app/Library/Caches/")).toBe(
      "/var/app/Library/Caches/timeline-cache",
    );
  });
});

describe("C6 binding via backend", () => {
  it("normalizes the server origin and binds the user", async () => {
    const { backend, state } = fakeBackend();
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    expect(JSON.parse(state.kv.getString("meta")!)).toMatchObject({
      serverOrigin: "https://multica.example",
      userId: "u-1",
    });
  });
});

describe("C7 clear on session end", () => {
  it("logout during a throttled write: store empty, key gone, write never lands", async () => {
    vi.useFakeTimers();
    const { backend, state } = fakeBackend();
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    const qc = new QueryClient();
    startTimelinePersister(qc);
    await fetchTimeline(qc, "i-1", [comment("c-1")]);
    // Write pending (throttled), then the session ends.
    clearTimelineCache();
    expect(state.kv.map.size).toBe(0);
    // The open instance keeps its files, it is only emptied.
    expect(state.filesDeleted).toBe(0);
    expect(isTimelineCacheOpen()).toBe(false);
    vi.advanceTimersByTime(WRITE_DELAY_MS * 3);
    expect(state.kv.map.size).toBe(0);
    await vi.runAllTimersAsync();
    expect(backend.deleteKey).toHaveBeenCalledTimes(1);
    expect(state.key).toBeNull();
  });

  it("an open still in flight loses against a logout", async () => {
    const { backend } = fakeBackend();
    registerTimelineCacheBackend(backend);
    const opening = openTimelineCache("u-1");
    clearTimelineCache();
    await opening;
    expect(isTimelineCacheOpen()).toBe(false);
  });

  it("the next session gets a new key", async () => {
    const { backend, state } = fakeBackend("old".padEnd(43, "o"));
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    clearTimelineCache();
    await openTimelineCache("u-2");
    expect(state.rekeyedWith).toEqual([encodeKeyBytes(new Uint8Array(24).fill(7))]);
    expect(state.diskKey).toBe(mmkvKeyFrom(state.key!));
  });

  it("logout → login in the same process: same instance, new key, cache survives a cold start", async () => {
    vi.useFakeTimers();
    const { backend, state } = fakeBackend("old".padEnd(43, "o"));
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    const qc = new QueryClient();
    startTimelinePersister(qc);
    await fetchTimeline(qc, "i-1", [comment("c-old")]);
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);

    clearTimelineCache(); // logout or 401
    await vi.runAllTimersAsync();
    qc.clear();
    expect(state.kv.map.size).toBe(0);
    await openTimelineCache("u-1"); // login again, no app restart
    expect(state.openedWith).toHaveLength(1); // never reopened
    expect(state.filesDeleted).toBe(0); // never deleted under the open instance
    expect(state.unlinked).toBe(false);
    expect(state.diskKey).toBe(mmkvKeyFrom(state.key!)); // re-encrypted with the new key
    expect(readCachedTimeline("ws", "i-1")).toBeNull(); // old session is gone

    await fetchTimeline(qc, "i-1", [comment("c-1")]);
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    vi.useRealTimers();

    coldStart(state);
    await openTimelineCache("u-1");
    expect(isTimelineCacheOpen()).toBe(true);
    expect(readCachedTimeline("ws", "i-1")?.entries.map((e) => e.id)).toEqual(["c-1"]);
  });

  it("a failed open after a session end empties the open instance instead of deleting its files", async () => {
    const { backend, state } = fakeBackend();
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    clearTimelineCache();
    state.kv.set("t:ws:i-9", "leftover");
    vi.mocked(backend.rekeyStore).mockImplementationOnce(() => {
      throw new Error("recrypt failed");
    });
    await openTimelineCache("u-1");
    expect(isTimelineCacheOpen()).toBe(false);
    expect(state.filesDeleted).toBe(0);
    expect(state.kv.map.size).toBe(0);
  });
});

describe("C2 no write-back of cached data", () => {
  it("a WS update before the first sync does not persist the cached state with a new savedAt", async () => {
    vi.useFakeTimers();
    const { backend, state } = fakeBackend();
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    const qc = new QueryClient();
    startTimelinePersister(qc);
    await fetchTimeline(qc, "i-1", [comment("c-1")]);
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    const first = state.kv.getString("t:ws:i-1");
    expect(first).toBeDefined();

    // Cold start: the issue opens from the cache, a WS event lands before
    // the sync answered. A new process has no server answer yet.
    vi.setSystemTime(Date.now() + 60_000);
    clearTimelineSync();
    const cold = new QueryClient();
    startTimelinePersister(cold);
    const options = issueTimelineOptions("ws", "i-1");
    const initial = typeof options.initialData === "function" ? options.initialData() : undefined;
    cold.setQueryData(options.queryKey, initial);
    cold.setQueryData(options.queryKey, [...(initial ?? []), comment("c-ws")]);
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    expect(state.kv.getString("t:ws:i-1")).toBe(first);

    // After the sync succeeded, later updates are persisted again.
    await fetchTimeline(cold, "i-1", [comment("c-1"), comment("c-2")]);
    cold.setQueryData(options.queryKey, [comment("c-1"), comment("c-2"), comment("c-3")]);
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    const stored = JSON.parse(state.kv.getString("t:ws:i-1")!);
    expect(stored.entries.map((e: TimelineEntry) => e.id)).toEqual(["c-1", "c-2", "c-3"]);
  });
});

describe("C2 oversized timelines", () => {
  it("a too big timeline is not serialized again until it gets shorter", async () => {
    const { backend, state } = fakeBackend();
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    const big = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...comment(`c-${i}`), content: "x".repeat(4000) }));
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      writeCachedTimeline("ws", "i-1", big(100), Date.now());
      const first = stringify.mock.calls.length;
      expect(first).toBeGreaterThan(0);
      writeCachedTimeline("ws", "i-1", big(100), Date.now());
      writeCachedTimeline("ws", "i-1", big(101), Date.now());
      expect(stringify.mock.calls.length).toBe(first);
      expect(state.kv.getAllKeys().filter((k) => k.startsWith("t:"))).toEqual([]);
      // Shorter (comments deleted) and small enough again: written.
      writeCachedTimeline("ws", "i-1", big(10), Date.now());
      expect(readCachedTimeline("ws", "i-1")?.entries).toHaveLength(10);
    } finally {
      stringify.mockRestore();
    }
  });
});

describe("C13 lazy read when an issue opens", () => {
  it("timeline query starts from the cache and stays stale so the sync runs", async () => {
    const { backend } = fakeBackend();
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    vi.useFakeTimers();
    const qc = new QueryClient();
    startTimelinePersister(qc);
    await fetchTimeline(qc, "i-1", [comment("c-1")]);
    qc.setQueryData(issueKeys.timeline("ws", "i-1"), [comment("c-1"), comment("c-2")]);
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    vi.useRealTimers();

    // Cold start: a fresh QueryClient, nothing hydrated.
    const cold = new QueryClient();
    expect(cold.getQueryCache().getAll()).toHaveLength(0);
    vi.mocked(api.listTimeline).mockReturnValue(new Promise(() => {})); // sync still running
    const observer = new QueryObserver(cold, issueTimelineOptions("ws", "i-1"));
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data?.map((e) => e.id)).toEqual(["c-1", "c-2"]),
    );
    // Stale: the sync still runs and replaces it.
    expect(observer.getCurrentResult().dataUpdatedAt).toBe(0);
    expect(observer.getCurrentResult().isFetching).toBe(true);
    unsubscribe();
    expect(readCachedTimeline("ws", "unknown")).toBeNull();
  });

  it("the open reads the same entries as the one-shot read", async () => {
    const { backend } = fakeBackend();
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    const entries = Array.from({ length: 400 }, (_, i) => ({ ...comment(`c-${i}`), content: "x".repeat(200) }));
    writeCachedTimeline("ws", "i-1", entries, Date.now());
    const chunked = await readCachedTimelineInChunks("ws", "i-1");
    expect(chunked?.entries).toHaveLength(400);
    expect(chunked).toEqual(readCachedTimeline("ws", "i-1"));
  });

  it("a session end during the block read shows nothing", async () => {
    const { backend } = fakeBackend();
    registerTimelineCacheBackend(backend);
    await openTimelineCache("u-1");
    writeCachedTimeline("ws", "i-1", [comment("c-1")], Date.now());
    const pending = readCachedTimelineInChunks("ws", "i-1");
    clearTimelineCache();
    expect(await pending).toBeNull();
  });
});
