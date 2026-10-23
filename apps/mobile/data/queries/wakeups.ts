import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import type { WorkspaceWakeupFilters } from "@/data/wakeup-schemas";
import { nextOverviewOffset, overviewQuery, type OverviewFilterState } from "@/lib/wakeup-overview";
import { wakeupKeys } from "./wakeup-keys";

export { wakeupKeys } from "./wakeup-keys";

/** Rules of one issue. Key `wakeupKeys.issue(wsId, id)` is also the prefix of
 *  its runs and system rules, so invalidating it refreshes all three. */
export const issueWakeupsOptions = (wsId: string | null, issueId: string) =>
  queryOptions({
    queryKey: [...wakeupKeys.issue(wsId, issueId), "list"] as const,
    queryFn: ({ signal }) => api.listIssueWakeups(issueId, { signal }),
    enabled: !!wsId && !!issueId,
  });

export const issueWakeupRunsOptions = (
  wsId: string | null,
  issueId: string,
  wakeupId: string,
) =>
  queryOptions({
    queryKey: wakeupKeys.runs(wsId, issueId, wakeupId),
    queryFn: ({ signal }) => api.listIssueWakeupRuns(issueId, wakeupId, { signal }),
    enabled: !!wsId && !!issueId && !!wakeupId,
  });

export const issueSystemWakeupsOptions = (wsId: string | null, issueId: string) =>
  queryOptions({
    queryKey: wakeupKeys.system(wsId, issueId),
    queryFn: ({ signal }) => api.listIssueSystemWakeups(issueId, { signal }),
    enabled: !!wsId && !!issueId,
  });

export const wakeupSummariesOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: wakeupKeys.summaries(wsId),
    queryFn: ({ signal }) => api.listIssueWakeupSummaries({ signal }),
    enabled: !!wsId,
  });

export const pausedWakeupsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: wakeupKeys.paused(wsId),
    queryFn: ({ signal }) => api.listPausedWakeups({ signal }),
    enabled: !!wsId,
  });

export const workspaceWakeupsOptions = (
  wsId: string | null,
  filters: Partial<WorkspaceWakeupFilters> = {},
) =>
  queryOptions({
    queryKey: wakeupKeys.workspace(wsId, filters),
    queryFn: ({ signal }) => api.listWorkspaceWakeups(filters, { signal }),
    enabled: !!wsId,
  });

/** Paged overview: one key per filter state, pages of 50
 *  loaded by offset. Under `wakeupKeys.workspaceAll`, so every own action
 *  (which invalidates `wakeupKeys.all`) refreshes it. */
export const workspaceWakeupsPagedOptions = (wsId: string | null, state: OverviewFilterState) =>
  infiniteQueryOptions({
    queryKey: [...wakeupKeys.workspace(wsId, overviewQuery(state)), "paged"] as const,
    queryFn: ({ signal, pageParam }) =>
      api.listWorkspaceWakeups(overviewQuery(state, pageParam), { signal }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => nextOverviewOffset(lastPage, pages),
    enabled: !!wsId,
  });
