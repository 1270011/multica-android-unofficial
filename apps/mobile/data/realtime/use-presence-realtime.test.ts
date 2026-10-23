import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invalidateQueries, subscriptionSetups } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  subscriptionSetups: [] as Array<
    (ws: MockWS, wsId: string) => Array<() => void>
  >,
}));

type EventHandler = (payload: unknown) => void;

interface MockWS {
  on: ReturnType<typeof vi.fn>;
  onReconnect: ReturnType<typeof vi.fn>;
  connectedSince: () => number | null;
}

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (
    setup: (ws: MockWS, wsId: string) => Array<() => void>,
  ) => {
    subscriptionSetups.push(setup);
  },
}));

import {
  PRESENCE_COALESCE_MS,
  usePresenceRealtime,
} from "./use-presence-realtime";
import { isSocketLive } from "./socket-liveness";

function mockWS(connectedSince: number | null = 1) {
  const handlers = new Map<string, EventHandler>();
  const reconnect: { fn?: () => void } = {};
  const ws: MockWS = {
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return () => {};
    }),
    onReconnect: vi.fn((handler: () => void) => {
      reconnect.fn = handler;
      return () => {};
    }),
    connectedSince: () => connectedSince,
  };
  return { ws, handlers, reconnect };
}

const invalidatedKeys = () =>
  invalidateQueries.mock.calls.map(([query]) => query.queryKey);
const countKey = (key: unknown[]) =>
  invalidatedKeys().filter((k) => JSON.stringify(k) === JSON.stringify(key))
    .length;

describe("usePresenceRealtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invalidateQueries.mockReset();
    subscriptionSetups.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes hidden agent liveness on daemon register and reconnect", () => {
    usePresenceRealtime();
    expect(subscriptionSetups).toHaveLength(1);

    const handlers = new Map<string, EventHandler>();
    let reconnect: (() => void) | undefined;
    const ws: MockWS = {
      on: vi.fn((event: string, handler: EventHandler) => {
        handlers.set(event, handler);
        return () => {};
      }),
      onReconnect: vi.fn((handler: () => void) => {
        reconnect = handler;
        return () => {};
      }),
      connectedSince: () => 1,
    };

    subscriptionSetups[0](ws, "workspace-1");
    handlers.get("daemon:register")?.({});
    vi.advanceTimersByTime(PRESENCE_COALESCE_MS);

    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        ["runtimes", "workspace-1"],
        ["agents", "workspace-1"],
      ]),
    );

    invalidateQueries.mockClear();
    reconnect?.();

    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        ["runtimes", "workspace-1"],
        ["agents", "workspace-1"],
        ["agent-task-snapshot", "workspace-1"],
      ]),
    );
  });

  it("a newly queued run reaches the agent detail within one window", () => {
    usePresenceRealtime();
    const { ws, handlers } = mockWS();
    subscriptionSetups[0](ws, "workspace-1");
    for (const event of ["task:queued", "task:dispatch", "task:completed", "task:failed", "task:cancelled"]) {
      invalidateQueries.mockClear();
      handlers.get(event)?.({});
      vi.advanceTimersByTime(PRESENCE_COALESCE_MS);
      const keys = invalidateQueries.mock.calls.map(([query]) => query.queryKey);
      expect(keys, event).toEqual(
        expect.arrayContaining([
          ["agent-task-snapshot", "workspace-1"],
          ["agents", "workspace-1", "tasks"],
        ]),
      );
    }
  });

  it("bundles a task event burst into one snapshot refetch", () => {
    usePresenceRealtime();
    const { ws, handlers } = mockWS();
    subscriptionSetups[0](ws, "workspace-1");

    // 30 lifecycle events spread over the 2 s window.
    const types = ["task:queued", "task:dispatch", "task:completed", "task:failed", "task:cancelled"];
    for (let i = 0; i < 30; i++) {
      handlers.get(types[i % types.length])?.({});
      vi.advanceTimersByTime(PRESENCE_COALESCE_MS / 30 - 1);
    }
    expect(countKey(["agent-task-snapshot", "workspace-1"])).toBe(0);

    vi.advanceTimersByTime(PRESENCE_COALESCE_MS);
    expect(countKey(["agent-task-snapshot", "workspace-1"])).toBe(1);
    expect(countKey(["agents", "workspace-1", "tasks"])).toBe(1);

    // The next event opens a new window: presence keeps updating.
    handlers.get("task:completed")?.({});
    vi.advanceTimersByTime(PRESENCE_COALESCE_MS);
    expect(countKey(["agent-task-snapshot", "workspace-1"])).toBe(2);
  });

  it("bundles agent and daemon churn the same way", () => {
    usePresenceRealtime();
    const { ws, handlers } = mockWS();
    subscriptionSetups[0](ws, "workspace-1");

    for (let i = 0; i < 10; i++) {
      handlers.get("agent:status")?.({});
      handlers.get("daemon:register")?.({});
    }
    vi.advanceTimersByTime(PRESENCE_COALESCE_MS);
    expect(countKey(["agents", "workspace-1"])).toBe(1);
    expect(countKey(["runtimes", "workspace-1"])).toBe(1);
  });

  it("reconnect refreshes at once and drops the pending window", () => {
    usePresenceRealtime();
    const { ws, handlers, reconnect } = mockWS();
    subscriptionSetups[0](ws, "workspace-1");

    handlers.get("task:queued")?.({});
    reconnect.fn?.();
    expect(countKey(["agent-task-snapshot", "workspace-1"])).toBe(1);
    expect(countKey(["agents", "workspace-1"])).toBe(1);

    vi.advanceTimersByTime(PRESENCE_COALESCE_MS);
    expect(countKey(["agent-task-snapshot", "workspace-1"])).toBe(1);
  });

  it("unsubscribe cancels pending windows and the liveness source", () => {
    usePresenceRealtime();
    const { ws, handlers } = mockWS(123);
    const unsubs = subscriptionSetups[0](ws, "workspace-1");
    expect(isSocketLive()).toBe(true);

    handlers.get("task:queued")?.({});
    for (const u of unsubs) u();
    vi.advanceTimersByTime(PRESENCE_COALESCE_MS);

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(isSocketLive()).toBe(false);
  });

  it("reports a socket without auth_ack as not live", () => {
    usePresenceRealtime();
    const { ws } = mockWS(null);
    const unsubs = subscriptionSetups[0](ws, "workspace-1");
    expect(isSocketLive()).toBe(false);
    for (const u of unsubs) u();
  });
});
