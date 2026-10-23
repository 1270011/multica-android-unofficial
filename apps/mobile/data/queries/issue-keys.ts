/**
 * Centralised TanStack Query keys for issue-domain queries on mobile.
 *
 * Prefix shape mirrors web's `packages/core/issues/queries.ts` so the same
 * WS invalidation surface (e.g. `invalidateQueries({ queryKey: issueKeys.myAll(wsId) })`)
 * eventually drives both clients. Keys are workspace-scoped — switching
 * workspace flips wsId and the cache moves automatically (root CLAUDE.md
 * "Workspace-scoped queries must key on wsId").
 */
import type { ListIssuesParams } from "@multica/core/types";
import type { QueryKey } from "@tanstack/react-query";
import { wakeupKeys } from "./wakeup-keys";

/**
 * Tabs of "My Issues".
 * `all` is the whole workspace; the former `agents` tab became the filter
 * "My agents and squads" (`involvesMe`).
 */
export type MyIssuesScope = "assigned" | "created" | "all";
export const MY_ISSUES_SCOPES: readonly MyIssuesScope[] = ["assigned", "created", "all"];

export function isMyIssuesScope(value: unknown): value is MyIssuesScope {
  return value === "assigned" || value === "created" || value === "all";
}

export type MyIssuesFilter = Pick<
  ListIssuesParams,
  | "assignee_id"
  | "assignee_ids"
  | "creator_id"
  | "involves_user_id"
  | "assignee_filters"
  | "include_no_assignee"
  | "assignee_types"
  | "creator_filters"
  | "sort_by"
  | "sort_direction"
>;

export const issueKeys = {
  all: (wsId: string | null) => ["issues", wsId] as const,
  list: (wsId: string | null) => [...issueKeys.all(wsId), "list"] as const,
  myAll: (wsId: string | null) => [...issueKeys.all(wsId), "my"] as const,
  myList: (
    wsId: string | null,
    scope: MyIssuesScope,
    filter: MyIssuesFilter,
  ) => [...issueKeys.myAll(wsId), scope, filter] as const,
  detail: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "detail", id] as const,
  timeline: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "timeline", id] as const,
  // Currently-running tasks for an issue (queued/dispatched/running). Drives
  // the "Working" state of the AgentActivityRow inside IssueHeaderCard.
  activeTasks: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "active-tasks", id] as const,
  // All tasks (any status) for an issue — drives the Runs history sheet.
  tasks: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "tasks", id] as const,
  // File attachments hooked to an issue (and its comments). Used by the
  // markdown renderer to resolve `mc://file/<id>` URIs to download_url.
  attachments: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "attachments", id] as const,
  children: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "children", id] as const,
  // Both sides of the duplicate relation (`GET /api/issues/{id}/duplicates`).
  duplicates: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "duplicates", id] as const,
  subscribers: (wsId: string | null, id: string) =>
    [...issueKeys.all(wsId), "subscribers", id] as const,
};

/** Every per-record query the issue screen shows: its focus
 *  refresh and its reconnect handler cover the same set. */
export function issueScreenQueryKeys(
  wsId: string | null,
  id: string,
): QueryKey[] {
  return [
    issueKeys.detail(wsId, id),
    issueKeys.timeline(wsId, id),
    issueKeys.attachments(wsId, id),
    issueKeys.activeTasks(wsId, id),
    issueKeys.tasks(wsId, id),
    issueKeys.children(wsId, id),
    issueKeys.duplicates(wsId, id),
    issueKeys.subscribers(wsId, id),
    wakeupKeys.issue(wsId, id),
  ];
}
