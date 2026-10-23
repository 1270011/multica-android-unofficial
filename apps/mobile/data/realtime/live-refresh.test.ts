import { QueryClient } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/api", () => ({ api: {} }));

import { chatKeys } from "@/data/queries/chat";
import { issueKeys } from "@/data/queries/issue-keys";
import {
  FOCUS_MAX_AGE_MS,
  markChatMessagesStale,
  markIssueTimelineStale,
  myIssuesMembershipChanged,
  needsFocusRefresh,
  refreshOnFocus,
} from "./live-refresh";

const wsId = "ws-1";
const NOW = 10_000_000;

function state(dataUpdatedAt: number, isInvalidated = false) {
  return { state: { dataUpdatedAt, isInvalidated } } as Parameters<
    typeof needsFocusRefresh
  >[0];
}

describe("needsFocusRefresh", () => {
  it("skips fresh data on a socket that was up before the fetch", () => {
    expect(needsFocusRefresh(state(NOW - 1000), NOW - 5000, NOW)).toBe(false);
  });

  it("skips queries that never loaded (mount fetches them)", () => {
    expect(needsFocusRefresh(state(0), null, NOW)).toBe(false);
  });

  it("refetches invalidated data", () => {
    expect(needsFocusRefresh(state(NOW - 1000, true), NOW - 5000, NOW)).toBe(true);
  });

  it("refetches while no socket is authenticated", () => {
    expect(needsFocusRefresh(state(NOW - 1000), null, NOW)).toBe(true);
  });

  it("refetches data fetched before the current socket came up", () => {
    expect(needsFocusRefresh(state(NOW - 5000), NOW - 1000, NOW)).toBe(true);
  });

  it("refetches data older than the max age", () => {
    const at = NOW - FOCUS_MAX_AGE_MS - 1;
    expect(needsFocusRefresh(state(at), at - 1, NOW)).toBe(true);
  });
});

describe("refreshOnFocus", () => {
  afterEach(() => vi.useRealTimers());

  it("refetches only active, due queries under the given keys", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const qc = new QueryClient();
    const fetchFresh = vi.fn(async () => ["fresh"]);
    const fetchStale = vi.fn(async () => ["stale"]);
    const fetchInactive = vi.fn(async () => ["inactive"]);

    const freshKey = issueKeys.myList(wsId, "assigned", { assignee_id: "u" });
    const staleKey = issueKeys.myList(wsId, "created", { creator_id: "u" });
    const inactiveKey = issueKeys.myList(wsId, "all", { involves_user_id: "u" });

    // Fresh + stale are observed (active); inactive has no observer.
    const { QueryObserver } = await import("@tanstack/react-query");
    const o1 = new QueryObserver(qc, { queryKey: freshKey, queryFn: fetchFresh });
    const o2 = new QueryObserver(qc, { queryKey: staleKey, queryFn: fetchStale });
    const u1 = o1.subscribe(() => {});
    const u2 = o2.subscribe(() => {});
    await vi.runAllTimersAsync();
    qc.setQueryData(inactiveKey, ["x"]);
    await qc.invalidateQueries({ queryKey: staleKey, refetchType: "none" });
    fetchFresh.mockClear();
    fetchStale.mockClear();

    const count = refreshOnFocus(qc, [issueKeys.myAll(wsId)], NOW - 60_000, NOW);
    await vi.runAllTimersAsync();

    expect(count).toBe(1);
    expect(fetchFresh).not.toHaveBeenCalled();
    expect(fetchStale).toHaveBeenCalledTimes(1);
    expect(fetchInactive).not.toHaveBeenCalled();
    u1();
    u2();
  });
});

describe("stale marks", () => {
  it("marks a cached timeline invalidated without fetching", () => {
    const qc = new QueryClient();
    const key = issueKeys.timeline(wsId, "i1");
    qc.setQueryData(key, []);
    markIssueTimelineStale(qc, wsId, "i1");
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(key)?.fetchStatus).toBe("idle");
  });

  it("marks chat messages and pending task invalidated", () => {
    const qc = new QueryClient();
    qc.setQueryData(chatKeys.messages("s1"), []);
    qc.setQueryData(chatKeys.pendingTask("s1"), null);
    qc.setQueryData(chatKeys.messages("s2"), []);
    markChatMessagesStale(qc, "s1");
    expect(qc.getQueryState(chatKeys.messages("s1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(chatKeys.pendingTask("s1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(chatKeys.messages("s2"))?.isInvalidated).toBe(false);
  });
});

describe("myIssuesMembershipChanged", () => {
  const issue = (over: Partial<Issue>) =>
    ({ id: "i1", assignee_id: "me", assignee_type: "member", ...over }) as Issue;

  function cacheWith(issues: Issue[]) {
    const qc = new QueryClient();
    qc.setQueryData(issueKeys.myList(wsId, "assigned", { assignee_id: "me" }), issues);
    return qc;
  }

  it("trusts the server flag", () => {
    const qc = cacheWith([issue({})]);
    expect(myIssuesMembershipChanged(qc, wsId, issue({}), true)).toBe(true);
    expect(myIssuesMembershipChanged(qc, wsId, issue({ assignee_id: "x" }), false)).toBe(false);
  });

  it("diffs against cached rows when the flag is missing", () => {
    const qc = cacheWith([issue({})]);
    expect(myIssuesMembershipChanged(qc, wsId, issue({}), undefined)).toBe(false);
    expect(
      myIssuesMembershipChanged(qc, wsId, issue({ assignee_id: "other" }), undefined),
    ).toBe(true);
    expect(
      myIssuesMembershipChanged(qc, wsId, issue({ assignee_type: "agent" }), undefined),
    ).toBe(true);
  });

  it("treats an uncached issue without flag as unchanged (agent status flips)", () => {
    const qc = cacheWith([]);
    expect(myIssuesMembershipChanged(qc, wsId, issue({}), undefined)).toBe(false);
  });
});
