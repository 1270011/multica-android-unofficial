import { queryOptions } from "@tanstack/react-query";
import type { Agent } from "@multica/core/types";
import { api } from "@/data/api";
import { isSocketLive } from "@/data/realtime/socket-liveness";

export const AGENT_LIST_POLL_MS = 30_000;

/**
 * Poll the agent list only where events cannot keep it fresh:
 *   - `unstable` ages into `offline` after 5 min with no server event, so
 *     it always polls.
 *   - `online` is demoted by the runtime sweeper, which broadcasts
 *     `daemon:register` (use-presence-realtime). Missed events are replayed
 *     by the reconnect invalidation. So `online` polls only while the socket
 *     is not live.
 * The interval is re-evaluated on every observer render; the 30s presence
 * tick re-renders presence surfaces, so a dropped socket resumes polling
 * within one tick. Background never polls (focusManager ← AppState).
 */
export function agentListPollInterval(
  agents: readonly Agent[] | undefined,
  socketLive: boolean,
): number | false {
  let online = false;
  for (const agent of agents ?? []) {
    if (agent.archived_at) continue;
    if (agent.runtime_availability === "unstable") return AGENT_LIST_POLL_MS;
    if (agent.runtime_availability === "online") online = true;
  }
  return online && !socketLive ? AGENT_LIST_POLL_MS : false;
}

export const agentListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: ["agents", wsId] as const,
    queryFn: ({ signal }) => api.listAgents({ signal }),
    enabled: !!wsId,
    refetchInterval: (query) =>
      agentListPollInterval(query.state.data, isSocketLive()),
    refetchIntervalInBackground: false,
  });

// Read-only agent detail. Sits under the list prefix so the
// presence realtime invalidation of `["agents", wsId]` refreshes it too.
export const agentDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: ["agents", wsId, "detail", id] as const,
    queryFn: ({ signal }) => api.getAgent(id, { signal }),
    enabled: !!wsId && !!id,
  });

// Latest runs for the read-only agent detail. Under the list
// prefix like the detail, so task lifecycle invalidations reach it.
export const agentTasksOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: ["agents", wsId, "tasks", id] as const,
    queryFn: ({ signal }) => api.listAgentTasks(id, { signal, limit: 20 }),
    enabled: !!wsId && !!id,
  });
