/**
 * Titles of the issues already loaded into the My Issues caches (all tabs,
 * `issueKeys.myAll(wsId)`), de-duplicated by id. Basis of the title filter
 * preview and its 50 ms test run; never fetches.
 */
import { useMemo } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { issueKeys } from "./issue-keys";

interface TitledIssue {
  id: string;
  title: string;
}

function isTitledIssue(value: unknown): value is TitledIssue {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.title === "string";
}

export function loadedIssueTitles(client: QueryClient, wsId: string | null): string[] {
  if (!wsId) return [];
  const byId = new Map<string, string>();
  for (const [, data] of client.getQueriesData({ queryKey: issueKeys.myAll(wsId) })) {
    if (!Array.isArray(data)) continue;
    for (const issue of data) {
      if (isTitledIssue(issue)) byId.set(issue.id, issue.title);
    }
  }
  return [...byId.values()];
}

/** Snapshot when the screen opens (the preview needs no live updates). */
export function useLoadedIssueTitles(wsId: string | null): string[] {
  const client = useQueryClient();
  return useMemo(() => loadedIssueTitles(client, wsId), [client, wsId]);
}
