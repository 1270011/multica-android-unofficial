import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import { AUTOPILOT_RUNS_PAGE_SIZE } from "@/data/autopilot-schemas";

/**
 * Autopilot query keys. Everything sits under
 * `["autopilots", wsId]`, so one `invalidateQueries({ queryKey:
 * autopilotKeys.all(wsId) })` refreshes lists, detail and runs together.
 * List keys share the `lists` prefix, so the optimistic pause patches every
 * status filter at once.
 */
export const autopilotKeys = {
  all: (wsId: string | null) => ["autopilots", wsId] as const,
  lists: (wsId: string | null) => [...autopilotKeys.all(wsId), "list"] as const,
  list: (wsId: string | null, status?: string) =>
    [...autopilotKeys.lists(wsId), status ?? "all"] as const,
  detail: (wsId: string | null, id: string) =>
    [...autopilotKeys.all(wsId), "detail", id] as const,
  runs: (wsId: string | null, id: string) => [...autopilotKeys.detail(wsId, id), "runs"] as const,
  run: (wsId: string | null, id: string, runId: string) =>
    [...autopilotKeys.detail(wsId, id), "run", runId] as const,
};

/** `status` = server filter (`active`, `paused`, `archived`); absent = all. */
export const autopilotListOptions = (wsId: string | null, status?: string) =>
  queryOptions({
    queryKey: autopilotKeys.list(wsId, status),
    queryFn: ({ signal }) => api.listAutopilots({ status }, { signal }),
    enabled: !!wsId,
  });

export const autopilotDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: autopilotKeys.detail(wsId, id),
    queryFn: ({ signal }) => api.getAutopilot(id, { signal }),
    enabled: !!wsId && !!id,
  });

/**
 * Next offset for "Weitere laden". The server reports the page length as
 * `total`, so a full page is the only hint that more runs exist.
 */
export function nextAutopilotRunsOffset(
  lastPage: { runs: unknown[] },
  pages: { runs: unknown[] }[],
): number | undefined {
  if (lastPage.runs.length < AUTOPILOT_RUNS_PAGE_SIZE) return undefined;
  return pages.reduce((sum, page) => sum + page.runs.length, 0);
}

export const autopilotRunsOptions = (wsId: string | null, id: string) =>
  infiniteQueryOptions({
    queryKey: autopilotKeys.runs(wsId, id),
    queryFn: ({ signal, pageParam }) =>
      api.listAutopilotRuns(id, { limit: AUTOPILOT_RUNS_PAGE_SIZE, offset: pageParam }, { signal }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => nextAutopilotRunsOffset(lastPage, pages),
    enabled: !!wsId && !!id,
  });

export const autopilotRunOptions = (wsId: string | null, id: string, runId: string) =>
  queryOptions({
    queryKey: autopilotKeys.run(wsId, id, runId),
    queryFn: ({ signal }) => api.getAutopilotRun(id, runId, { signal }),
    enabled: !!wsId && !!id && !!runId,
  });
