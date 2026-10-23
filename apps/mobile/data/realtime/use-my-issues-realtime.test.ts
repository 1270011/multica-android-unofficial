import { QueryClient } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { issueKeys } from "@/data/queries/issue-keys";

type EventHandler = (payload: unknown) => void;
interface MockWS {
  on: ReturnType<typeof vi.fn>;
  onReconnect: ReturnType<typeof vi.fn>;
}
type SubscriptionSetup = (ws: MockWS, wsId: string) => (() => void)[];

const state = vi.hoisted(() => ({
  qc: undefined as unknown as QueryClient,
  setups: [] as SubscriptionSetup[],
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => state.qc,
}));
vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: SubscriptionSetup) => {
    state.setups.push(setup);
  },
}));
vi.mock("@/data/api", () => ({ api: {} }));

import { useMyIssuesRealtime } from "./use-my-issues-realtime";
import { useIssuesRealtime } from "./use-issues-realtime";

const wsId = "ws-1";
const assignedKey = issueKeys.myList(wsId, "assigned", { assignee_id: "me" });

function connect() {
  const handlers = new Map<string, EventHandler[]>();
  const reconnect: (() => void)[] = [];
  const ws: MockWS = {
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    }),
    onReconnect: vi.fn((cb: () => void) => {
      reconnect.push(cb);
      return () => {};
    }),
  };
  for (const setup of state.setups) setup(ws, wsId);
  return {
    emit: (event: string, payload: unknown) => {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
    reconnect: () => reconnect.forEach((cb) => cb()),
    subscribed: (event: string) => handlers.has(event),
  };
}

const issue = (over: Partial<Issue> = {}) =>
  ({
    id: "i1",
    title: "T",
    status: "todo",
    assignee_id: "me",
    assignee_type: "member",
    revision: 1,
    ...over,
  }) as Issue;

describe("useMyIssuesRealtime", () => {
  beforeEach(() => {
    state.qc = new QueryClient();
    state.setups = [];
    useMyIssuesRealtime();
  });

  it("patches in place on a status change without refetching", () => {
    state.qc.setQueryData(assignedKey, [issue()]);
    const spy = vi.spyOn(state.qc, "invalidateQueries");
    connect().emit("issue:updated", {
      issue: issue({ status: "done", revision: 2 }),
      assignee_changed: false,
      status_changed: true,
    });
    expect(state.qc.getQueryData<Issue[]>(assignedKey)?.[0].status).toBe("done");
    expect(spy).not.toHaveBeenCalled();
  });

  it("refetches the My Issues lists when the assignee changed", () => {
    state.qc.setQueryData(assignedKey, [issue()]);
    const spy = vi.spyOn(state.qc, "invalidateQueries");
    connect().emit("issue:updated", {
      issue: issue({ id: "i2", assignee_id: "me", revision: 3 }),
      assignee_changed: true,
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: issueKeys.myAll(wsId) });
  });
});

describe("useIssuesRealtime", () => {
  beforeEach(() => {
    state.qc = new QueryClient();
    state.setups = [];
    useIssuesRealtime();
  });

  it("patches a cached, closed issue detail", () => {
    state.qc.setQueryData(issueKeys.detail(wsId, "i1"), issue());
    connect().emit("issue:updated", { issue: issue({ title: "Neu", revision: 2 }) });
    expect(state.qc.getQueryData<Issue>(issueKeys.detail(wsId, "i1"))?.title).toBe("Neu");
  });

  it("marks a closed issue's timeline stale on comment events", () => {
    const key = issueKeys.timeline(wsId, "i1");
    state.qc.setQueryData(key, []);
    const ws = connect();
    ws.emit("comment:created", { comment: { id: "c1", issue_id: "i1" } });
    expect(state.qc.getQueryState(key)?.isInvalidated).toBe(true);

    for (const event of [
      "comment:updated",
      "comment:resolved",
      "comment:unresolved",
      "comment:deleted",
      "activity:created",
      "reaction:added",
      "reaction:removed",
    ]) {
      expect(ws.subscribed(event)).toBe(true);
    }
  });

  it("marks the whole issues prefix stale on reconnect", () => {
    const spy = vi.spyOn(state.qc, "invalidateQueries");
    connect().reconnect();
    // No blanket refetch: focused screens refetch, stacked ones on focus.
    expect(spy).toHaveBeenCalledWith({
      queryKey: issueKeys.all(wsId),
      refetchType: "none",
    });
  });
});
