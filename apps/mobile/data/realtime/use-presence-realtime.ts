/**
 * Presence realtime — Layer 3 of the realtime stack. Listing-level (always
 * on while the user is inside a workspace).
 *
 * Invalidates the queries that back the presence dot:
 *   - runtimeListOptions      ← daemon:register, runtime sweeper transitions
 *   - agentListOptions        ← agent:status / created / archived / restored
 *   - agentTaskSnapshotOptions← task:queued / dispatch / completed / failed /
 *                               cancelled
 *
 * Deliberately NOT subscribed (cellular-data rule, apps/mobile/CLAUDE.md):
 *   - daemon:heartbeat — every 15s × in-online runtime; web also skips it
 *     (packages/core/realtime/use-realtime-sync.ts:147). An invalidate per
 *     heartbeat would refetch agents+runtimes+snapshot 4× a minute per
 *     online runtime — guaranteed to wedge the user on cellular.
 *   - task:progress / task:message — fire many times per active task. The
 *     presence cache only needs lifecycle transitions, not per-step updates.
 *
 * Coalescing: a busy workspace emits 25–66 task lifecycle events
 * a minute, and each used to refetch the ~49 KB snapshot on every screen.
 * Events now join a fixed window (PRESENCE_COALESCE_MS) and the window ends
 * in ONE invalidation per key, so presence lags at most one window behind.
 *
 * Reconnect: re-invalidate runtimes + agents + snapshot after missed events,
 * at once (pending windows are dropped, the reconnect covers them).
 *
 * The hook also registers the live socket for `agentListOptions`, which
 * stops polling while events arrive (data/realtime/socket-liveness.ts).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import { coalesce } from "./coalesce";
import { setSocketLivenessSource } from "./socket-liveness";

/** Presence may trail an event by this much (UX budget: ~2 s). */
export const PRESENCE_COALESCE_MS = 2000;

/** Task events that refresh presence and the agent detail's runs. */
export const TASK_LIFECYCLE_EVENTS = [
  "task:queued",
  "task:dispatch",
  "task:completed",
  "task:failed",
  "task:cancelled",
] as const;

export function usePresenceRealtime() {
  const queryClient = useQueryClient();

  useWSSubscriptions(
    (ws, wsId) => {
      const runtimesKey = ["runtimes", wsId];
      const agentsKey = ["agents", wsId];
      const snapshotKey = ["agent-task-snapshot", wsId];

      const invalidateRuntimes = () =>
        queryClient.invalidateQueries({ queryKey: runtimesKey });
      const invalidateAgents = () =>
        queryClient.invalidateQueries({ queryKey: agentsKey });
      const invalidateSnapshot = () =>
        queryClient.invalidateQueries({ queryKey: snapshotKey });
      // Every run lifecycle step also changes the "latest runs" of the
      // agent detail: a new run shows up when it is queued,
      // not only once it ended. Only a mounted detail refetches.
      const invalidateRuns = () => {
        invalidateSnapshot();
        queryClient.invalidateQueries({ queryKey: [...agentsKey, "tasks"] });
      };

      const runtimesWindow = coalesce(invalidateRuntimes, PRESENCE_COALESCE_MS);
      const agentsWindow = coalesce(invalidateAgents, PRESENCE_COALESCE_MS);
      const runsWindow = coalesce(invalidateRuns, PRESENCE_COALESCE_MS);
      const windows = [runtimesWindow, agentsWindow, runsWindow];

      return [
        setSocketLivenessSource(() => ws.connectedSince()),

        // Daemon lifecycle; heartbeats deliberately omitted.
        ws.on("daemon:register", () => {
          runtimesWindow.schedule();
          agentsWindow.schedule();
        }),

        // Agent identity churn — visible in pickers / chat header straight
        // away, so invalidate the cached list.
        ws.on("agent:status", agentsWindow.schedule),
        ws.on("agent:created", agentsWindow.schedule),
        ws.on("agent:archived", agentsWindow.schedule),
        ws.on("agent:restored", agentsWindow.schedule),

        // Task lifecycle — drives the workload dimension of presence and the
        // reserved-for-P1 peek sheet. progress / message intentionally absent.
        ...TASK_LIFECYCLE_EVENTS.map((type) => ws.on(type, runsWindow.schedule)),

        // Recover all presence inputs after missed sweeper transitions.
        ws.onReconnect(() => {
          for (const w of windows) w.cancel();
          invalidateRuntimes();
          invalidateAgents();
          invalidateRuns();
        }),

        () => {
          for (const w of windows) w.cancel();
        },
      ];
    },
    [queryClient],
  );
}
