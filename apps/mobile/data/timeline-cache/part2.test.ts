/**
 * Timeline cache part 2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Comment, TimelineEntry } from "@multica/core/types";

type EventHandler = (payload: unknown) => void;
interface MockWS {
  on: ReturnType<typeof vi.fn>;
  onReconnect: ReturnType<typeof vi.fn>;
}
type SubscriptionSetup = (ws: MockWS, wsId: string) => (() => void)[];

const hoisted = vi.hoisted(() => ({
  qc: undefined as unknown as QueryClient,
  setups: [] as SubscriptionSetup[],
  listTimeline: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => hoisted.qc,
}));
vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: SubscriptionSetup) => {
    hoisted.setups.push(setup);
  },
}));
vi.mock("@/data/api", () => ({
  api: { listTimeline: (...args: unknown[]) => hoisted.listTimeline(...args) },
}));

import {
  __resetTimelineCacheForTests,
  encodeKeyBytes,
  openTimelineCache,
  readCachedTimeline,
  registerTimelineCacheBackend,
  startTimelinePersister,
  writeCachedTimeline,
  WRITE_DELAY_MS,
  type TimelineCacheBackend,
} from "./index";
import { MemoryKv } from "./memory-kv";
import { lastTimelineSync, SYNC_MAX_AGE_MS, timelineNeedsSync } from "./sync";
import { issueKeys } from "@/data/queries/issue-keys";
import { issueTimelineOptions } from "@/data/queries/issues";
import { setSocketLivenessSource } from "@/data/realtime/socket-liveness";
import { removeCommentCascade } from "@/data/realtime/issue-ws-updaters";
import { useIssuesRealtime } from "@/data/realtime/use-issues-realtime";

const comment = (id: string, over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  type: "comment",
  id,
  actor_type: "member",
  actor_id: "u-1",
  created_at: "2026-10-19T04:00:00Z",
  content: `text ${id}`,
  ...over,
});

function backend(kv: MemoryKv): TimelineCacheBackend {
  let key: string | null = "k".repeat(32);
  return {
    readKey: async () => key,
    writeKey: async (k) => {
      key = k;
    },
    deleteKey: async () => {
      key = null;
    },
    newKey: () => encodeKeyBytes(new Uint8Array(24).fill(7)),
    openStore: () => kv,
    rekeyStore: () => {},
    deleteFiles: () => kv.map.clear(),
    serverOrigin: () => "https://multica.example",
  };
}

function httpError(status: number, error = "forbidden") {
  return Object.assign(new Error(error), { status, body: { error } });
}

function ids(wsId: string, issueId: string) {
  return readCachedTimeline(wsId, issueId)?.entries.map((e) => e.id) ?? null;
}

/** Mount the timeline query like the issue screen does; returns unmount. */
function mount(qc: QueryClient, wsId: string, issueId: string) {
  const observer = new QueryObserver(qc, issueTimelineOptions(wsId, issueId));
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unmount: unsubscribe };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

/** The query shows these entries (the cache read on open is async). */
async function shown(observer: ReturnType<typeof mount>["observer"], expected: string[]) {
  await vi.waitFor(() =>
    expect(observer.getCurrentResult().data?.map((e) => e.id)).toEqual(expected),
  );
}

let kv: MemoryKv;
let qc: QueryClient;
let stopPersister: () => void;
let connectedSince: number | null;
let unregisterSocket: () => void;

beforeEach(async () => {
  __resetTimelineCacheForTests();
  kv = new MemoryKv();
  registerTimelineCacheBackend(backend(kv));
  await openTimelineCache("u-1");
  // Same defaults as data/query-client.ts.
  qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1, retryDelay: 1 } } });
  stopPersister = startTimelinePersister(qc);
  connectedSince = null;
  unregisterSocket = setSocketLivenessSource(() => connectedSince);
  hoisted.listTimeline.mockReset();
});
afterEach(() => {
  stopPersister();
  unregisterSocket();
  qc.clear();
  vi.useRealTimers();
});

describe("C8 workspace left or revoked", () => {
  it("workspace list without the wsId deletes its entries, others stay", () => {
    writeCachedTimeline("ws-a", "i-1", [comment("c-1")], Date.now());
    writeCachedTimeline("ws-b", "i-2", [comment("c-2")], Date.now());
    // A manual write is no server answer and changes nothing.
    qc.setQueryData(["workspaces"], [{ id: "ws-b" }]);
    expect(ids("ws-a", "i-1")).toEqual(["c-1"]);
    qc.removeQueries({ queryKey: ["workspaces"] });
    return qc
      .fetchQuery({ queryKey: ["workspaces"], queryFn: async () => [{ id: "ws-b" }] })
      .then(() => {
        expect(ids("ws-a", "i-1")).toBeNull();
        expect(ids("ws-b", "i-2")).toEqual(["c-2"]);
        expect(kv.getAllKeys().some((k) => k.startsWith("t:ws-a:"))).toBe(false);
      });
  });

  it("a pending throttled write of the lost workspace never lands", async () => {
    vi.useFakeTimers();
    qc.setQueryData(issueKeys.timeline("ws-a", "i-1"), [comment("c-1")]);
    await qc.fetchQuery({ queryKey: ["workspaces"], queryFn: async () => [{ id: "ws-b" }] });
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    expect(ids("ws-a", "i-1")).toBeNull();
    // Nor a later one, until the workspace is back in the list.
    qc.setQueryData(issueKeys.timeline("ws-a", "i-1"), [comment("c-1"), comment("c-2")]);
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    expect(ids("ws-a", "i-1")).toBeNull();
  });

  it('"workspace not found" (404) on a workspace request deletes the workspace', async () => {
    writeCachedTimeline("ws-a", "i-1", [comment("c-1")], Date.now());
    writeCachedTimeline("ws-a", "i-2", [comment("c-2")], Date.now());
    await qc
      .fetchQuery({
        queryKey: issueKeys.detail("ws-a", "i-9"),
        queryFn: async () => {
          throw httpError(404, "workspace not found");
        },
        retry: false,
      })
      .catch(() => undefined);
    expect(ids("ws-a", "i-1")).toBeNull();
    expect(ids("ws-a", "i-2")).toBeNull();
  });

  it("403 on a workspace-wide list deletes the workspace", async () => {
    writeCachedTimeline("ws-a", "i-1", [comment("c-1")], Date.now());
    await qc
      .fetchQuery({
        queryKey: issueKeys.list("ws-a"),
        queryFn: async () => {
          throw httpError(403);
        },
        retry: false,
      })
      .catch(() => undefined);
    expect(ids("ws-a", "i-1")).toBeNull();
  });

  it("a 404 for one issue keeps the other issues of the workspace", async () => {
    writeCachedTimeline("ws-a", "i-1", [comment("c-1")], Date.now());
    await qc
      .fetchQuery({
        queryKey: issueKeys.detail("ws-a", "i-9"),
        queryFn: async () => {
          throw httpError(404, "issue not found");
        },
        retry: false,
      })
      .catch(() => undefined);
    expect(ids("ws-a", "i-1")).toEqual(["c-1"]);
  });

  it("a list that arrived before the store opened is applied on open", async () => {
    writeCachedTimeline("ws-a", "i-1", [comment("c-1")], Date.now());
    __resetTimelineCacheForTests();
    registerTimelineCacheBackend(backend(kv));
    stopPersister();
    stopPersister = startTimelinePersister(qc);
    await qc.fetchQuery({ queryKey: ["workspaces"], queryFn: async () => [{ id: "ws-b" }] });
    expect(kv.getAllKeys().some((k) => k.startsWith("t:ws-a:"))).toBe(true);
    await openTimelineCache("u-1");
    expect(kv.getAllKeys().some((k) => k.startsWith("t:ws-a:"))).toBe(false);
  });
});

describe("C9 403/404 on the timeline sync", () => {
  it.each([403, 404])("%i: entry deleted, chat gets the error instead of old content, no retry", async (status) => {
    writeCachedTimeline("ws", "i-1", [comment("c-1")], Date.now());
    hoisted.listTimeline.mockRejectedValue(httpError(status));
    const { observer, unmount } = mount(qc, "ws", "i-1");
    const seen: (string[] | undefined)[] = [];
    observer.subscribe((r) => seen.push(r.data?.map((e) => e.id)));
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("error"));
    // The cached chat was shown before the sync answered.
    expect(seen).toContainEqual(["c-1"]);
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(ids("ws", "i-1")).toBeNull();
    expect(hoisted.listTimeline).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("other errors (500, offline) keep the entry and the content", async () => {
    writeCachedTimeline("ws", "i-1", [comment("c-1")], Date.now());
    hoisted.listTimeline.mockRejectedValue(httpError(500, "boom"));
    const { observer, unmount } = mount(qc, "ws", "i-1");
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("error"));
    expect(observer.getCurrentResult().data?.map((e) => e.id)).toEqual(["c-1"]);
    expect(ids("ws", "i-1")).toEqual(["c-1"]);
    unmount();
  });

  it("issue:deleted drops the stored entry", () => {
    writeCachedTimeline("ws-1", "i-1", [comment("c-1")], Date.now());
    const ws = connectRealtime();
    ws.emit("issue:deleted", { issue_id: "i-1" });
    expect(ids("ws-1", "i-1")).toBeNull();
  });
});

/** The listing subscriptions as RealtimeSubscriptions mounts them. */
beforeEach(() => {
  hoisted.qc = qc;
  hoisted.setups = [];
  useIssuesRealtime();
});

function connectRealtime() {
  const handlers = new Map<string, EventHandler[]>();
  const ws: MockWS = {
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    }),
    onReconnect: vi.fn(() => () => {}),
  };
  for (const setup of hoisted.setups) setup(ws, "ws-1");
  return {
    emit: (event: string, payload: unknown) => {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
  };
}

const wsComment = (id: string, over: Partial<Comment> = {}) =>
  ({
    id,
    issue_id: "i-1",
    author_type: "member",
    author_id: "u-1",
    content: `text ${id}`,
    type: "comment",
    created_at: "2026-10-19T04:00:00Z",
    updated_at: "2026-10-19T04:00:00Z",
    reactions: [],
    attachments: [],
    parent_id: null,
    revision: 2,
    ...over,
  }) as unknown as Comment;

describe("C10 WS edits and deletes reach the device", () => {
  it("comment:deleted on a closed issue: comment and its replies leave the stored entry", () => {
    const savedAt = Date.now() - 60_000;
    writeCachedTimeline(
      "ws-1",
      "i-1",
      [comment("c-1"), comment("secret"), comment("reply", { parent_id: "secret" })],
      savedAt,
    );
    connectRealtime().emit("comment:deleted", { issue_id: "i-1", comment_id: "secret" });
    expect(ids("ws-1", "i-1")).toEqual(["c-1"]);
    expect([...kv.map.values()].join("\n")).not.toContain("text secret");
    // A patch never makes the entry look newer.
    expect(readCachedTimeline("ws-1", "i-1")?.savedAt).toBe(savedAt);
  });

  it("comment:updated on a closed issue: stored content is replaced", () => {
    writeCachedTimeline("ws-1", "i-1", [comment("c-1", { revision: 1 })], Date.now());
    connectRealtime().emit("comment:updated", {
      comment: wsComment("c-1", { content: "edited", revision: 2 }),
    });
    expect(readCachedTimeline("ws-1", "i-1")?.entries[0].content).toBe("edited");
    expect([...kv.map.values()].join("\n")).not.toContain("text c-1");
  });

  it("an older comment:updated does not overwrite a newer stored revision", () => {
    writeCachedTimeline("ws-1", "i-1", [comment("c-1", { revision: 5, content: "new" })], Date.now());
    connectRealtime().emit("comment:updated", {
      comment: wsComment("c-1", { content: "old", revision: 3 }),
    });
    expect(readCachedTimeline("ws-1", "i-1")?.entries[0].content).toBe("new");
  });

  it("events for issues without an entry write nothing", () => {
    connectRealtime().emit("comment:deleted", { issue_id: "i-x", comment_id: "c" });
    expect(kv.getAllKeys().filter((k) => k.startsWith("t:"))).toEqual([]);
  });

  it("open issue after its sync: the in-memory delete is persisted by the throttled writer", async () => {
    vi.useFakeTimers();
    await qc.fetchQuery({
      queryKey: issueKeys.timeline("ws-1", "i-1"),
      queryFn: async () => [comment("c-1"), comment("secret")],
    });
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    expect(ids("ws-1", "i-1")).toEqual(["c-1", "secret"]);
    removeCommentCascade(qc, "ws-1", "i-1", "secret");
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    expect(ids("ws-1", "i-1")).toEqual(["c-1"]);
  });

  it("comment:deleted before the first sync patches the stored entry, the persister writes nothing back", async () => {
    vi.useFakeTimers();
    const savedAt = Date.now() - 60_000;
    writeCachedTimeline("ws-1", "i-1", [comment("c-1"), comment("secret")], savedAt);
    hoisted.listTimeline.mockReturnValue(new Promise(() => {})); // sync still running
    // Cold start: the open issue shows the device copy, no server answer yet.
    const { observer, unmount } = mount(qc, "ws-1", "i-1");
    await shown(observer, ["c-1", "secret"]);
    expect(lastTimelineSync("ws-1", "i-1")).toBeUndefined();
    const write = vi.spyOn(kv, "set");

    connectRealtime().emit("comment:deleted", { issue_id: "i-1", comment_id: "secret" });
    // The WS handler patched the stored entry directly …
    expect(ids("ws-1", "i-1")).toEqual(["c-1"]);
    expect([...kv.map.values()].join("\n")).not.toContain("text secret");
    expect(readCachedTimeline("ws-1", "i-1")?.savedAt).toBe(savedAt);
    const patchWrites = write.mock.calls.length;

    // … and the in-memory update of the open query is not written back.
    removeCommentCascade(qc, "ws-1", "i-1", "secret");
    expect(observer.getCurrentResult().data?.map((e) => e.id)).toEqual(["c-1"]);
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    expect(write.mock.calls.length).toBe(patchWrites);
    expect(readCachedTimeline("ws-1", "i-1")?.savedAt).toBe(savedAt);
    unmount();
  });
});

describe("C11 sync on open only when needed", () => {
  const now = 1_000_000_000;
  const state = (over: Partial<{ data: unknown; dataUpdatedAt: number; isInvalidated: boolean }> = {}) => ({
    data: [] as unknown,
    dataUpdatedAt: now - 1000,
    isInvalidated: false,
    ...over,
  });

  it("matrix", async () => {
    // Nothing fetched in this process (cold start, data from the device).
    expect(timelineNeedsSync(state({ dataUpdatedAt: 0 }), "ws", "i-1", now - 5000, now)).toBe(true);
    expect(timelineNeedsSync(state(), "ws", "i-1", now - 5000, now)).toBe(true);
    // Fetched in this process at now-1000.
    await qc.fetchQuery({
      queryKey: issueKeys.timeline("ws", "i-1"),
      queryFn: async () => [comment("c-1")],
    });
    const synced = lastTimelineSync("ws", "i-1")!;
    const at = (t: number) => synced + t;
    const s = state({ dataUpdatedAt: synced });
    // Socket up since before the fetch, no break → skip.
    expect(timelineNeedsSync(s, "ws", "i-1", synced - 1, at(1000))).toBe(false);
    // Socket rebuilt after the fetch → sync.
    expect(timelineNeedsSync(s, "ws", "i-1", synced + 1, at(1000))).toBe(true);
    // No socket → sync.
    expect(timelineNeedsSync(s, "ws", "i-1", null, at(1000))).toBe(true);
    // Older than 10 min → sync.
    expect(timelineNeedsSync(s, "ws", "i-1", synced - 1, at(SYNC_MAX_AGE_MS + 1))).toBe(true);
    // Marked stale by an event → sync.
    expect(
      timelineNeedsSync({ ...s, isInvalidated: true }, "ws", "i-1", synced - 1, at(1000)),
    ).toBe(true);
  });

  it("reopen with the socket up the whole time: no request, WS patches still shown", async () => {
    connectedSince = Date.now() - 10_000;
    hoisted.listTimeline.mockResolvedValue([comment("c-1")]);
    const first = mount(qc, "ws", "i-1");
    await vi.waitFor(() => expect(first.observer.getCurrentResult().status).toBe("success"));
    first.unmount();
    expect(hoisted.listTimeline).toHaveBeenCalledTimes(1);

    // While closed-but-cached the open-issue patches keep coming (e.g. the
    // issue is open in the detail and the chat screen at once).
    qc.setQueryData<TimelineEntry[]>(issueKeys.timeline("ws", "i-1"), (old) => [
      ...(old ?? []),
      comment("c-2"),
    ]);

    // Past the default staleTime (60 s), which alone would refetch.
    const later = Date.now() + 2 * 60_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(later);

    const again = mount(qc, "ws", "i-1");
    await settle();
    expect(hoisted.listTimeline).toHaveBeenCalledTimes(1);
    expect(again.observer.getCurrentResult().data?.map((e) => e.id)).toEqual(["c-1", "c-2"]);
    again.unmount();
  });

  it("reconnect between the cache state and the open: the sync runs", async () => {
    connectedSince = Date.now() - 10_000;
    hoisted.listTimeline.mockResolvedValue([comment("c-1")]);
    const first = mount(qc, "ws", "i-1");
    await vi.waitFor(() => expect(first.observer.getCurrentResult().status).toBe("success"));
    first.unmount();

    await settle();
    connectedSince = Date.now(); // new socket after the fetch
    hoisted.listTimeline.mockResolvedValue([comment("c-1"), comment("missed")]);
    const again = mount(qc, "ws", "i-1");
    await vi.waitFor(() => expect(hoisted.listTimeline).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(again.observer.getCurrentResult().data?.map((e) => e.id)).toEqual(["c-1", "missed"]),
    );
    again.unmount();
  });

  it("socket down at open: the sync runs", async () => {
    connectedSince = Date.now() - 10_000;
    hoisted.listTimeline.mockResolvedValue([comment("c-1")]);
    const first = mount(qc, "ws", "i-1");
    await vi.waitFor(() => expect(first.observer.getCurrentResult().status).toBe("success"));
    first.unmount();
    connectedSince = null;
    const again = mount(qc, "ws", "i-1");
    await vi.waitFor(() => expect(hoisted.listTimeline).toHaveBeenCalledTimes(2));
    again.unmount();
  });

  it("cold start (data from the device): the sync always runs, after the first frame", async () => {
    writeCachedTimeline("ws", "i-1", [comment("c-1")], Date.now());
    connectedSince = Date.now() - 10_000; // even with a live socket
    const frames: (() => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
    hoisted.listTimeline.mockResolvedValue([comment("c-1"), comment("c-2")]);
    try {
      const { observer, unmount } = mount(qc, "ws", "i-1");
      // The cached chat comes first (checked in short blocks),
      // the request waits for the frame after it.
      await shown(observer, ["c-1"]);
      await settle();
      expect(hoisted.listTimeline).not.toHaveBeenCalled();
      frames.splice(0).forEach((cb) => cb());
      await vi.waitFor(() => expect(hoisted.listTimeline).toHaveBeenCalledTimes(1));
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().data?.map((e) => e.id)).toEqual(["c-1", "c-2"]),
      );
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a fetch that spans a reconnect counts from its start: the next open syncs", async () => {
    const t0 = 1_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    connectedSince = t0 - 10_000;
    let answer: (entries: TimelineEntry[]) => void = () => {};
    hoisted.listTimeline.mockReturnValue(new Promise((r) => (answer = r)));
    const { observer, unmount } = mount(qc, "ws", "i-1");
    await vi.waitFor(() => expect(hoisted.listTimeline).toHaveBeenCalledTimes(1));
    // The socket is rebuilt while the request runs; events before that are lost.
    vi.setSystemTime(t0 + 5_000);
    connectedSince = t0 + 5_000;
    vi.setSystemTime(t0 + 6_000);
    answer([comment("c-1")]);
    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("success"));
    expect(lastTimelineSync("ws", "i-1")).toBe(t0);
    const state = qc.getQueryCache().find({ queryKey: issueKeys.timeline("ws", "i-1") })!.state;
    expect(timelineNeedsSync(state, "ws", "i-1", connectedSince, t0 + 7_000)).toBe(true);
    unmount();
  });

  it("first open without cached data does not wait for a frame", async () => {
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    hoisted.listTimeline.mockResolvedValue([comment("c-1")]);
    try {
      const { unmount } = mount(qc, "ws", "i-new");
      await vi.waitFor(() => expect(hoisted.listTimeline).toHaveBeenCalledTimes(1));
      expect(raf).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
describe("C10 closed issue with a pending throttled write", () => {
  // The screen was just left: the timeline was synced, then patched in
  // memory, and the throttled write is still pending. Only the global
  // handler sees the event, the write must carry its result.
  async function syncedThenPending(entries: TimelineEntry[]) {
    vi.useFakeTimers();
    await qc.fetchQuery({
      queryKey: issueKeys.timeline("ws-1", "i-1"),
      queryFn: async () => entries,
    });
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    qc.setQueryData(issueKeys.timeline("ws-1", "i-1"), entries.map((e) => ({ ...e })));
  }

  it("comment:deleted: the pending write does not bring the comment back", async () => {
    await syncedThenPending([comment("c-1"), comment("secret"), comment("r-1", { parent_id: "secret" })]);
    connectRealtime().emit("comment:deleted", { issue_id: "i-1", comment_id: "secret" });
    expect(ids("ws-1", "i-1")).toEqual(["c-1"]);
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    expect(ids("ws-1", "i-1")).toEqual(["c-1"]);
    expect([...kv.map.values()].join("\n")).not.toContain("text secret");
    expect(qc.getQueryData<TimelineEntry[]>(issueKeys.timeline("ws-1", "i-1"))?.map((e) => e.id)).toEqual(["c-1"]);
  });

  it("comment:updated: the pending write does not bring the old content back", async () => {
    await syncedThenPending([comment("c-1", { revision: 1, content: "secret" })]);
    connectRealtime().emit("comment:updated", {
      comment: wsComment("c-1", { content: "redacted", revision: 2 }),
    });
    vi.advanceTimersByTime(WRITE_DELAY_MS + 1);
    expect(readCachedTimeline("ws-1", "i-1")?.entries[0]?.content).toBe("redacted");
    expect([...kv.map.values()].join("\n")).not.toContain("secret");
  });
});
