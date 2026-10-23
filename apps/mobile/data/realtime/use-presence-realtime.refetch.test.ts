/**
 * End to end against a real QueryClient: a burst of task events
 * must reach the server as ONE snapshot request, and the new snapshot must
 * be in the cache right after the window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

const { client, subscriptionSetups } = vi.hoisted(() => ({
  client: { current: null as unknown },
  subscriptionSetups: [] as ((ws: unknown, wsId: string) => (() => void)[])[],
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => client.current,
}));

vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: (ws: unknown, wsId: string) => (() => void)[]) => {
    subscriptionSetups.push(setup);
  },
}));

import { PRESENCE_COALESCE_MS, usePresenceRealtime } from "./use-presence-realtime";

describe("usePresenceRealtime with a real QueryClient", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    subscriptionSetups.length = 0;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.current = queryClient;
  });
  afterEach(() => {
    queryClient.clear();
    vi.useRealTimers();
  });

  it("30 task events in 2 s → exactly 1 snapshot refetch, fresh data after the window", async () => {
    let version = 0;
    const fetchSnapshot = vi.fn(async () => [{ version: ++version }]);
    const observer = new QueryObserver(queryClient, {
      queryKey: ["agent-task-snapshot", "workspace-1"],
      queryFn: fetchSnapshot,
    });
    const unsubscribeObserver = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    const handlers = new Map<string, () => void>();
    usePresenceRealtime();
    const unsubs = subscriptionSetups[0](
      {
        on: (event: string, handler: () => void) => {
          handlers.set(event, handler);
          return () => {};
        },
        onReconnect: () => () => {},
        connectedSince: () => 1,
      },
      "workspace-1",
    );

    const types = ["task:queued", "task:dispatch", "task:completed", "task:failed", "task:cancelled"];
    for (let i = 0; i < 30; i++) {
      handlers.get(types[i % types.length])?.();
      await vi.advanceTimersByTimeAsync(PRESENCE_COALESCE_MS / 30 - 1);
    }
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PRESENCE_COALESCE_MS);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toEqual([{ version: 2 }]);

    for (const u of unsubs) u();
    unsubscribeObserver();
  });
});
