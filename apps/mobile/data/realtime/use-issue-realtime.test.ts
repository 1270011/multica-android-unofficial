import { QueryClient } from "@tanstack/react-query";
import type {
  CommentDeletedPayload,
  CommentUpdatedPayload,
  Issue,
} from "@multica/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { issueKeys } from "@/data/queries/issue-keys";
import { wakeupKeys } from "@/data/queries/wakeup-keys";
import { useIssueRealtime } from "./use-issue-realtime";

type EventHandler = (payload: unknown) => void;

interface MockWS {
  on: ReturnType<typeof vi.fn>;
  onReconnect: ReturnType<typeof vi.fn>;
}

type SubscriptionSetup = (ws: MockWS, wsId: string) => (() => void)[];

const state = vi.hoisted(() => ({
  qc: undefined as unknown as QueryClient,
  subscriptionSetups: [] as SubscriptionSetup[],
  subscriptionDeps: [] as (readonly unknown[])[],
  unsubs: [] as (() => void)[],
  ref: null as { current: unknown } | null,
}));

// The hook runs outside a React renderer here. Like React, a ref keeps its box
// across renders (one box per test is enough: each test mounts one hook whose
// callback matters).
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: (initial: unknown) => (state.ref ??= { current: initial }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => state.qc,
}));

vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: SubscriptionSetup, deps: readonly unknown[]) => {
    state.subscriptionSetups.push(setup);
    state.subscriptionDeps.push(deps);
  },
}));

const wsId = "workspace-1";
const issueId = "issue-1";
const detailKey = issueKeys.detail(wsId, issueId);
const timelineKey = issueKeys.timeline(wsId, issueId);
const activeTasksKey = issueKeys.activeTasks(wsId, issueId);

// Runs the setup useIssueRealtime registered and returns an emitter for the
// events it subscribed to.
function connect() {
  expect(state.subscriptionSetups).toHaveLength(1);
  const handlers = new Map<string, EventHandler>();
  const ws: MockWS = {
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return () => {};
    }),
    onReconnect: vi.fn(() => () => {}),
  };
  state.unsubs = state.subscriptionSetups[0](ws, wsId);
  return (event: string, payload: unknown) => {
    const handler = handlers.get(event);
    if (!handler) throw new Error(`no handler for ${event}`);
    handler(payload);
  };
}

function deletedPayload(issueRevision?: number): CommentDeletedPayload {
  return { comment_id: "comment-1", issue_id: issueId, issue_revision: issueRevision };
}

// #8296: deleting a comment that has replies tombstones it via comment:updated.
function tombstonePayload(issueRevision?: number): CommentUpdatedPayload {
  return {
    comment: {
      id: "comment-1",
      issue_id: issueId,
      author_type: "member",
      author_id: "user-1",
      content: "",
      type: "comment",
      parent_id: null,
      reactions: [],
      attachments: [],
      created_at: "2026-09-11T07:00:00Z",
      updated_at: "2026-09-11T08:00:00Z",
      revision: 2,
      resolved_at: null,
      resolved_by_type: null,
      resolved_by_id: null,
      deleted_at: "2026-09-11T08:00:00Z",
    },
    issue_revision: issueRevision,
  };
}

describe("useIssueRealtime owner issue revision on comment deletes", () => {
  beforeEach(() => {
    state.qc = new QueryClient();
    state.subscriptionSetups.length = 0;
  });

  it.each([
    ["comment:deleted", deletedPayload],
    ["comment:updated", tombstonePayload],
  ] as const)("%s with issue_revision refetches only an older cached issue", (event, payload) => {
    state.qc.setQueryData<Issue>(detailKey, { id: issueId, revision: 5 } as Issue);
    useIssueRealtime(issueId);
    const emit = connect();

    emit(event, payload(5));
    expect(state.qc.getQueryState(detailKey)?.isInvalidated).toBe(false);

    emit(event, payload(6));
    expect(state.qc.getQueryState(detailKey)?.isInvalidated).toBe(true);
  });

  it.each([
    ["comment:deleted", deletedPayload],
    ["comment:updated", tombstonePayload],
  ] as const)("%s without issue_revision refetches every loaded owner projection", (event, payload) => {
    const issue = { id: issueId, revision: 7 } as Issue;
    const myKey = issueKeys.myList(wsId, "assigned", { assignee_id: "user-1" });
    state.qc.setQueryData<Issue>(detailKey, issue);
    state.qc.setQueryData<Issue[]>(myKey, [issue]);
    state.qc.setQueryData<Issue[]>(issueKeys.list(wsId), [issue]);
    useIssueRealtime(issueId);
    const emit = connect();

    emit(event, payload());

    for (const key of [detailKey, myKey, issueKeys.list(wsId)]) {
      expect(state.qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});

describe("useIssueRealtime wakeup refresh", () => {
  const summariesKey = wakeupKeys.summaries(wsId);
  const listKey = [...wakeupKeys.issue(wsId, issueId), "list"];

  beforeEach(() => {
    state.qc = new QueryClient();
    state.subscriptionSetups.length = 0;
    state.qc.setQueryData(summariesKey, []);
    state.qc.setQueryData(listKey, []);
  });

  it("task events of this issue invalidate the whole wakeup prefix, throttled", () => {
    vi.useFakeTimers();
    try {
      useIssueRealtime(issueId);
      const emit = connect();

      emit("task:completed", { task_id: "t", agent_id: "a", issue_id: "other", status: "completed" });
      expect(state.qc.getQueryState(summariesKey)?.isInvalidated).toBe(false);

      emit("task:completed", { task_id: "t", agent_id: "a", issue_id: issueId, status: "completed" });
      expect(state.qc.getQueryState(summariesKey)?.isInvalidated).toBe(true);
      expect(state.qc.getQueryState(listKey)?.isInvalidated).toBe(true);

      // Further events inside the 5 s window do not refetch right away…
      state.qc.setQueryData(summariesKey, []);
      vi.advanceTimersByTime(1000);
      emit("task:queued", { task_id: "t", agent_id: "a", issue_id: issueId, status: "queued" });
      emit("task:completed", { task_id: "t", agent_id: "a", issue_id: issueId, status: "completed" });
      expect(state.qc.getQueryState(summariesKey)?.isInvalidated).toBe(false);

      // …but the burst ends in exactly one trailing refresh at the window end.
      vi.advanceTimersByTime(3999);
      expect(state.qc.getQueryState(summariesKey)?.isInvalidated).toBe(false);
      vi.advanceTimersByTime(1);
      expect(state.qc.getQueryState(summariesKey)?.isInvalidated).toBe(true);

      state.qc.setQueryData(summariesKey, []);
      vi.advanceTimersByTime(10_000);
      expect(state.qc.getQueryState(summariesKey)?.isInvalidated).toBe(false);

      // After the window the next event refreshes immediately again.
      emit("task:queued", { task_id: "t", agent_id: "a", issue_id: issueId, status: "queued" });
      expect(state.qc.getQueryState(summariesKey)?.isInvalidated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("issue:updated invalidates wakeups too", () => {
    useIssueRealtime(issueId);
    const emit = connect();
    emit("issue:updated", { issue: { id: issueId, revision: 2 } as Issue });
    expect(state.qc.getQueryState(summariesKey)?.isInvalidated).toBe(true);
  });
});

describe("useIssueRealtime task events", () => {
  let invalidated: string[];

  // Records which of the watched keys each invalidateQueries call hit.
  function watchInvalidations() {
    invalidated = [];
    const original = state.qc.invalidateQueries.bind(state.qc);
    vi.spyOn(state.qc, "invalidateQueries").mockImplementation((filters, options) => {
      const key = JSON.stringify(filters?.queryKey);
      if (key === JSON.stringify(timelineKey)) invalidated.push("timeline");
      else if (key === JSON.stringify(detailKey)) invalidated.push("detail");
      else if (key === JSON.stringify(activeTasksKey)) invalidated.push("activeTasks");
      return original(filters, options);
    });
  }
  const count = (name: string) => invalidated.filter((k) => k === name).length;
  const task = (extra: object = {}) => ({
    task_id: "task-1",
    agent_id: "agent-1",
    issue_id: issueId,
    ...extra,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    state.qc = new QueryClient();
    state.subscriptionSetups.length = 0;
    state.subscriptionDeps.length = 0;
    watchInvalidations();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["task:queued", "task:dispatch", "task:progress"])(
    "%s never refetches the timeline or detail",
    (event) => {
      useIssueRealtime(issueId);
      const emit = connect();

      for (let i = 0; i < 5; i++) emit(event, task());
      vi.advanceTimersByTime(5000);

      expect(count("timeline")).toBe(0);
      expect(count("detail")).toBe(0);
      expect(count("activeTasks")).toBeGreaterThan(0);
    },
  );

  it("queued / dispatch refresh the live task status immediately", () => {
    useIssueRealtime(issueId);
    const emit = connect();

    emit("task:queued", task({ status: "queued" }));
    expect(count("activeTasks")).toBe(1);
    emit("task:dispatch", task({ status: "dispatched" }));
    expect(count("activeTasks")).toBe(2);
  });

  it("20× progress + 1× completed refetch the timeline exactly once", () => {
    useIssueRealtime(issueId);
    const emit = connect();

    for (let i = 0; i < 20; i++) {
      emit("task:progress", task({ summary: `step ${i}` }));
      vi.advanceTimersByTime(30);
    }
    emit("task:completed", task({ status: "completed" }));
    // The completed run's status shows at once; the timeline follows ≤1 s.
    expect(count("activeTasks")).toBeGreaterThan(0);
    expect(count("timeline")).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(count("timeline")).toBe(1);
    expect(count("detail")).toBe(1);

    vi.advanceTimersByTime(10_000);
    expect(count("timeline")).toBe(1);
  });

  it("a steady progress stream refreshes the task status once per second", () => {
    useIssueRealtime(issueId);
    const emit = connect();

    for (let i = 0; i < 30; i++) {
      emit("task:progress", task());
      vi.advanceTimersByTime(100);
    }
    // 3 s of events → 3 bundled refreshes, not 30 and not 0 (no starvation).
    expect(count("activeTasks")).toBe(3);
  });

  it("several terminal events in a burst share one timeline refetch", () => {
    useIssueRealtime(issueId);
    const emit = connect();

    emit("task:completed", task({ task_id: "a" }));
    emit("task:failed", task({ task_id: "b" }));
    emit("task:cancelled", task({ task_id: "c" }));
    vi.advanceTimersByTime(1000);

    expect(count("timeline")).toBe(1);
    expect(count("activeTasks")).toBe(3);
  });

  it("ignores task events of other issues", () => {
    useIssueRealtime(issueId);
    const emit = connect();

    emit("task:completed", { ...task(), issue_id: "other" });
    emit("task:queued", { ...task(), issue_id: "other" });
    vi.advanceTimersByTime(1000);

    expect(invalidated).toEqual([]);
  });

  it("drops a pending refetch on unsubscribe", () => {
    useIssueRealtime(issueId);
    const emit = connect();

    emit("task:completed", task());
    for (const u of state.unsubs) u();
    vi.advanceTimersByTime(1000);

    expect(count("timeline")).toBe(0);
  });
});

// The screens pass `onDeleted` inline, so every render hands the hook
// a new callback. This harness re-renders like React does — a changed dep runs
// the old cleanup and subscribes again — on one shared socket for all mounts.
describe("useIssueRealtime across re-renders", () => {
  type Listeners = Map<string, Set<EventHandler>>;
  let listeners: Listeners;
  let timelineRefetches: Map<string, number>;

  const ws: MockWS = {
    on: vi.fn((event: string, handler: EventHandler) => {
      const set = listeners.get(event) ?? new Set<EventHandler>();
      set.add(handler);
      listeners.set(event, set);
      return () => set.delete(handler);
    }),
    onReconnect: vi.fn(() => () => {}),
  };
  const emit = (event: string, payload: unknown) => {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  };

  function mount(id: string) {
    let deps: readonly unknown[] | null = null;
    let cleanup: (() => void)[] = [];
    return () => {
      const before = state.subscriptionSetups.length;
      useIssueRealtime(id, () => {});
      const setup = state.subscriptionSetups[before];
      const next = state.subscriptionDeps[before];
      const changed =
        deps === null || deps.length !== next.length || deps.some((d, i) => !Object.is(d, next[i]));
      if (changed) {
        for (const u of cleanup) u();
        cleanup = setup(ws, wsId);
      }
      deps = next;
    };
  }

  // Payload shapes as the v0.6.1 server sends them (server/internal/service/
  // task.go: taskEvent for queued/dispatch/terminal, TaskProgressPayload for
  // progress, which carries no issue_id).
  const taskEvent = (issue: string, status: string) => ({
    task_id: "task-1",
    agent_id: "agent-1",
    issue_id: issue,
    status,
  });
  const progress = (step: number) => ({ task_id: "task-1", summary: `step ${step}`, step, total: 2 });
  const message = (issue: string, seq: number) => ({
    task_id: "task-1",
    issue_id: issue,
    seq,
    type: "text",
    content: `m${seq}`,
  });
  const commentCreated = (issue: string) => ({
    comment: { ...tombstonePayload().comment, id: "comment-new", issue_id: issue, deleted_at: null },
    issue_revision: 8,
  });

  // One agent run as measured on a real issue: 1× queued, 1× dispatch, 2× progress,
  // 3× message, the run's comment, 1× completed. The screen re-renders after
  // each event (task queries refetch, timeline patch).
  function agentRun(issue: string, render: () => void) {
    const events: [string, unknown][] = [
      ["task:queued", taskEvent(issue, "queued")],
      ["task:dispatch", taskEvent(issue, "dispatched")],
      ["task:progress", progress(1)],
      ["task:message", message(issue, 1)],
      ["task:progress", progress(2)],
      ["task:message", message(issue, 2)],
      ["task:message", message(issue, 3)],
      ["comment:created", commentCreated(issue)],
      ["task:completed", taskEvent(issue, "completed")],
    ];
    for (const [event, payload] of events) {
      emit(event, payload);
      render();
      vi.advanceTimersByTime(100);
      render();
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = new Map();
    timelineRefetches = new Map();
    ws.on.mockClear();
    state.ref = null;
    state.qc = new QueryClient();
    state.subscriptionSetups.length = 0;
    state.subscriptionDeps.length = 0;
    const original = state.qc.invalidateQueries.bind(state.qc);
    vi.spyOn(state.qc, "invalidateQueries").mockImplementation((filters, options) => {
      for (const id of [issueId, "issue-2"]) {
        if (JSON.stringify(filters?.queryKey) === JSON.stringify(issueKeys.timeline(wsId, id))) {
          timelineRefetches.set(id, (timelineRefetches.get(id) ?? 0) + 1);
        }
      }
      return original(filters, options);
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not re-subscribe when only the inline onDeleted changes", () => {
    const render = mount(issueId);
    render();
    render();
    render();
    const subscribed = ws.on.mock.calls.filter(([event]) => event === "task:completed");
    expect(subscribed).toHaveLength(1);
  });

  it("one agent run refetches the open issue's timeline exactly once, other issues never", () => {
    const renderOpen = mount(issueId);
    const renderOther = mount("issue-2");
    renderOpen();
    renderOther();

    agentRun(issueId, () => {
      renderOpen();
      renderOther();
    });
    vi.advanceTimersByTime(5000);

    expect(timelineRefetches.get(issueId) ?? 0).toBe(1);
    expect(timelineRefetches.get("issue-2") ?? 0).toBe(0);
  });

  it("three runs in a row give one timeline refetch each", () => {
    const render = mount(issueId);
    render();

    for (let run = 1; run <= 3; run++) {
      agentRun(issueId, render);
      vi.advanceTimersByTime(5000);
      expect(timelineRefetches.get(issueId) ?? 0).toBe(run);
    }
  });

  it("calls the latest onDeleted after re-renders", () => {
    const first = vi.fn();
    const latest = vi.fn();
    useIssueRealtime(issueId, first);
    const setup = state.subscriptionSetups[0];
    setup(ws, wsId);
    useIssueRealtime(issueId, latest);

    emit("issue:deleted", { issue_id: issueId });

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
