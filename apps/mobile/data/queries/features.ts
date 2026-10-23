import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

// Does the server have Autopilots? Gates the More → AI Team entry. A server either has the route or not, so the answer is kept for the
// session; a 404 is final and not retried. Runtimes need no probe: the
// presence dot already loads GET /api/runtimes (data/queries/runtimes.ts).
export const autopilotsProbeOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: ["feature-probe", "autopilots", wsId] as const,
    queryFn: ({ signal }) => api.probeAutopilots({ signal }),
    enabled: !!wsId,
    staleTime: Infinity,
    retry: (count, err) => {
      const status = (err as { status?: number }).status;
      return status !== 404 && status !== 501 && count < 2;
    },
  });
