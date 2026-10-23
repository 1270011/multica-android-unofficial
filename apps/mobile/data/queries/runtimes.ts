import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

// Runtime list — workspace-scoped. Feeds the availability dimension of the
// presence dot via @multica/core/agents/derive-presence (status + last_seen_at).
// Invalidated by daemon:register / sweeper-driven status changes; see
// data/realtime/use-presence-realtime.ts.
export const runtimeListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: ["runtimes", wsId] as const,
    queryFn: ({ signal }) => api.listRuntimes({ signal }),
    enabled: !!wsId,
  });

// Hour-of-day activity of one runtime (R3 detail). `tz` is part of the key
// because the server buckets in that zone. Own key root so the realtime
// invalidation of ["runtimes", wsId] (daemon events) does not refetch it;
// refreshed by pull-to-refresh like the other report-style reads.
export const runtimeActivityOptions = (wsId: string | null, runtimeId: string, tz: string) =>
  queryOptions({
    queryKey: ["runtime-activity", wsId, runtimeId, tz] as const,
    queryFn: ({ signal }) => api.getRuntimeActivity(runtimeId, { tz, signal }),
    enabled: !!wsId && !!runtimeId,
    staleTime: 5 * 60_000,
  });
