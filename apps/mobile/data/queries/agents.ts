import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const agentListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: ["agents", wsId] as const,
    queryFn: ({ signal }) => api.listAgents({ signal }),
    enabled: !!wsId,
    // Mirrors Web/Desktop: projected unstable ages offline without an event,
    // while offline recovery is covered by lifecycle events and reconnect.
    refetchInterval: (query) =>
      query.state.data?.some(
        (agent) =>
          !agent.archived_at &&
          (agent.runtime_availability === "online" ||
            agent.runtime_availability === "unstable"),
      )
        ? 30_000
        : false,
  });

// Read-only agent detail (UX §6 H). Sits under the list prefix so the
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
