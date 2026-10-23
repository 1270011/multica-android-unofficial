import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));

import { issueKeys, issueScreenQueryKeys } from "@/data/queries/issue-keys";
import { invalidateIssueAfterReconnect } from "./issue-ws-updaters";
import { refreshOnFocus } from "./live-refresh";
import {
  invalidateAfterReconnect,
  isParked,
  parkFocusKeys,
  resetParkedFocusKeys,
  unparkFocusKeys,
} from "./reconnect-refresh";

const wsId = "ws-1";

/** One mounted issue screen: detail + timeline observers (active queries),
 *  its keys registered like `useRefreshOnFocus` does. */
function mountIssueScreen(qc: QueryClient, issueId: string, focused: boolean) {
  const calls = { detail: 0, timeline: 0 };
  const comments = ["c1"];
  const detail = new QueryObserver(qc, {
    queryKey: issueKeys.detail(wsId, issueId),
    queryFn: async () => {
      calls.detail += 1;
      return { id: issueId };
    },
    staleTime: Infinity,
  });
  const timeline = new QueryObserver(qc, {
    queryKey: issueKeys.timeline(wsId, issueId),
    queryFn: async () => {
      calls.timeline += 1;
      return [...comments];
    },
    staleTime: Infinity,
  });
  const unsubs = [detail.subscribe(() => {}), timeline.subscribe(() => {})];
  const screen = Symbol(issueId);
  const keys = issueScreenQueryKeys(wsId, issueId);
  parkFocusKeys(screen, keys, focused);
  return {
    calls,
    comments,
    keys,
    setFocused: (f: boolean) => parkFocusKeys(screen, keys, f),
    unmount: () => {
      unsubs.forEach((u) => u());
      unparkFocusKeys(screen);
    },
  };
}

/** What the WS layer runs on reconnect: the global issues handler plus the
 *  per-issue handler of every mounted issue screen. */
function reconnect(qc: QueryClient, issueIds: string[]) {
  invalidateAfterReconnect(qc, issueKeys.all(wsId));
  for (const id of issueIds) invalidateIssueAfterReconnect(qc, wsId, id);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("reconnect with a back stack", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    resetParkedFocusKeys();
  });
  afterEach(() => {
    qc.clear();
    resetParkedFocusKeys();
  });

  it("refetches only the focused screen; stacked screens once on focus", async () => {
    const a = mountIssueScreen(qc, "a", false);
    const b = mountIssueScreen(qc, "b", false);
    const c = mountIssueScreen(qc, "c", true);
    await flush();
    const loaded = [a, b, c].map((s) => ({ ...s.calls }));
    expect(loaded).toEqual([
      { detail: 1, timeline: 1 },
      { detail: 1, timeline: 1 },
      { detail: 1, timeline: 1 },
    ]);

    const connectedSince = Date.now();
    reconnect(qc, ["a", "b", "c"]);
    await flush();

    // Focused screen: exactly one refetch per query, even though two
    // handlers (global prefix + per-issue) covered it.
    expect(c.calls).toEqual({ detail: 2, timeline: 2 });
    // Stacked screens: nothing yet, but marked stale.
    expect(a.calls).toEqual({ detail: 1, timeline: 1 });
    expect(b.calls).toEqual({ detail: 1, timeline: 1 });
    expect(qc.getQueryState(issueKeys.detail(wsId, "a"))?.isInvalidated).toBe(true);

    // Back to b: refetches exactly once …
    c.setFocused(false);
    b.setFocused(true);
    refreshOnFocus(qc, b.keys, connectedSince);
    await flush();
    expect(b.calls).toEqual({ detail: 2, timeline: 2 });
    // … and a second focus on the same socket makes no request.
    refreshOnFocus(qc, b.keys, connectedSince);
    await flush();
    expect(b.calls).toEqual({ detail: 2, timeline: 2 });
    expect(a.calls).toEqual({ detail: 1, timeline: 1 });
  });

  it("loses no comment that arrived while disconnected", async () => {
    const a = mountIssueScreen(qc, "a", false);
    mountIssueScreen(qc, "c", true);
    await flush();
    expect(qc.getQueryData(issueKeys.timeline(wsId, "a"))).toEqual(["c1"]);

    // Comment posted during the gap: no WS event ever reaches this client.
    a.comments.push("c2");
    const connectedSince = Date.now();
    reconnect(qc, ["a", "c"]);
    await flush();
    expect(qc.getQueryData(issueKeys.timeline(wsId, "a"))).toEqual(["c1"]);

    a.setFocused(true);
    refreshOnFocus(qc, a.keys, connectedSince);
    await flush();
    expect(qc.getQueryData(issueKeys.timeline(wsId, "a"))).toEqual(["c1", "c2"]);
  });

  it("refetches a query that a focused screen also shows", async () => {
    const stacked = mountIssueScreen(qc, "a", false);
    const top = mountIssueScreen(qc, "a", true); // same issue opened again
    await flush();
    const before = stacked.calls.detail + top.calls.detail;
    reconnect(qc, ["a"]);
    await flush();
    expect(stacked.calls.detail + top.calls.detail).toBe(before + 1);
  });

  it("keeps the old behaviour for queries no screen parked", async () => {
    let fetches = 0;
    const listKey: QueryKey = [...issueKeys.list(wsId), "byProject", "p1"];
    new QueryObserver(qc, {
      queryKey: listKey,
      queryFn: async () => ++fetches,
      staleTime: Infinity,
    }).subscribe(() => {});
    await flush();
    reconnect(qc, []);
    await flush();
    expect(fetches).toBe(2);
  });

  it("does not refetch inactive queries (they reload on mount)", async () => {
    const a = mountIssueScreen(qc, "a", true);
    await flush();
    a.unmount();
    reconnect(qc, []);
    await flush();
    expect(a.calls).toEqual({ detail: 1, timeline: 1 });
    expect(qc.getQueryState(issueKeys.detail(wsId, "a"))?.isInvalidated).toBe(true);
  });
});

describe("isParked", () => {
  beforeEach(() => resetParkedFocusKeys());

  it("matches by key prefix and forgets unmounted screens", () => {
    const s = Symbol("my-issues");
    parkFocusKeys(s, [issueKeys.myAll(wsId)], false);
    expect(isParked(issueKeys.myList(wsId, "assigned", {}))).toBe(true);
    expect(isParked(issueKeys.detail(wsId, "x"))).toBe(false);
    parkFocusKeys(s, [issueKeys.myAll(wsId)], true);
    expect(isParked(issueKeys.myList(wsId, "assigned", {}))).toBe(false);
    parkFocusKeys(s, [issueKeys.myAll(wsId)], false);
    unparkFocusKeys(s);
    expect(isParked(issueKeys.myList(wsId, "assigned", {}))).toBe(false);
  });
});
