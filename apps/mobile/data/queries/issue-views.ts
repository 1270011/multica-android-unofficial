/**
 * Saved issue views + per-scope view preferences (hidden/order of built-in
 * and saved views). Mirrors packages/core/issue-views/queries.ts; `scope_id`
 * is null for workspace / "my" scopes and the project id for project scope.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export type IssueViewScope = {
  scope_type: "workspace" | "my" | "project";
  scope_id?: string | null;
};

export const issueViewKeys = {
  all: (wsId: string | null) => ["issue-views", wsId] as const,
  list: (wsId: string | null, scope: IssueViewScope) =>
    [
      ...issueViewKeys.all(wsId),
      "list",
      scope.scope_type,
      scope.scope_id ?? null,
    ] as const,
  detail: (wsId: string | null, id: string) =>
    [...issueViewKeys.all(wsId), "detail", id] as const,
  preference: (wsId: string | null, scope: IssueViewScope) =>
    [
      ...issueViewKeys.all(wsId),
      "preference",
      scope.scope_type,
      scope.scope_id ?? null,
    ] as const,
};

export const issueViewListOptions = (
  wsId: string | null,
  scope: IssueViewScope,
) =>
  queryOptions({
    queryKey: issueViewKeys.list(wsId, scope),
    queryFn: ({ signal }) => api.listIssueViews(scope, { signal }),
    enabled: !!wsId,
  });

export const issueViewDetailOptions = (wsId: string | null, id: string) =>
  queryOptions({
    queryKey: issueViewKeys.detail(wsId, id),
    queryFn: ({ signal }) => api.getIssueView(id, { signal }),
    enabled: !!wsId && !!id,
  });

export const issueViewPreferenceOptions = (
  wsId: string | null,
  scope: IssueViewScope,
) =>
  queryOptions({
    queryKey: issueViewKeys.preference(wsId, scope),
    queryFn: ({ signal }) => api.getIssueViewPreference(scope, { signal }),
    enabled: !!wsId,
  });
