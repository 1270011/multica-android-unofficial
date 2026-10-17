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
 * Reconnect: re-invalidate runtimes + agents + snapshot after missed events.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";

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

      return [
        // Daemon lifecycle; heartbeats deliberately omitted.
        ws.on("daemon:register", () => {
          invalidateRuntimes();
          invalidateAgents();
        }),

        // Agent identity churn — visible in pickers / chat header straight
        // away, so invalidate the cached list.
        ws.on("agent:status", invalidateAgents),
        ws.on("agent:created", invalidateAgents),
        ws.on("agent:archived", invalidateAgents),
        ws.on("agent:restored", invalidateAgents),

        // Task lifecycle — drives the workload dimension of presence and the
        // reserved-for-P1 peek sheet. progress / message intentionally absent.
        ...TASK_LIFECYCLE_EVENTS.map((type) => ws.on(type, invalidateRuns)),

        // Recover all presence inputs after missed sweeper transitions.
        ws.onReconnect(() => {
          invalidateRuntimes();
          invalidateAgents();
          invalidateSnapshot();
        }),
      ];
    },
    [queryClient],
  );
}
