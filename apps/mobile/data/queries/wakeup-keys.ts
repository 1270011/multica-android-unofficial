import type { WorkspaceWakeupFilters } from "@multica/core/types";

/**
 * Issue-wakeup query keys. Everything sits under
 * `["wakeups", wsId]`, so one `invalidateQueries({ queryKey:
 * wakeupKeys.all(wsId) })` refreshes the issue section, the header chip, the
 * workspace overview and the paused banner together — the server sends no
 * WS event for wakeups, so every own action and every
 * `task:*` event invalidates this prefix.
 *
 * Own module without the API client (like issue-keys.ts), so realtime
 * hooks can import the keys without pulling in react-native.
 */
export const wakeupKeys = {
  all: (wsId: string | null) => ["wakeups", wsId] as const,
  issue: (wsId: string | null, issueId: string) =>
    [...wakeupKeys.all(wsId), "issue", issueId] as const,
  runs: (wsId: string | null, issueId: string, wakeupId: string) =>
    [...wakeupKeys.issue(wsId, issueId), "runs", wakeupId] as const,
  system: (wsId: string | null, issueId: string) =>
    [...wakeupKeys.issue(wsId, issueId), "system"] as const,
  summaries: (wsId: string | null) => [...wakeupKeys.all(wsId), "summaries"] as const,
  paused: (wsId: string | null) => [...wakeupKeys.all(wsId), "paused"] as const,
  workspaceAll: (wsId: string | null) => [...wakeupKeys.all(wsId), "workspace"] as const,
  workspace: (wsId: string | null, filters: Partial<WorkspaceWakeupFilters>) =>
    [...wakeupKeys.workspaceAll(wsId), filters] as const,
};
