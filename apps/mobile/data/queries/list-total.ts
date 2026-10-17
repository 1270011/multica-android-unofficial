/**
 * Server total of an issue list. `GET /api/issues` returns
 * at most 100 issues plus the real `total`; the list caches keep the flat
 * `Issue[]` shape the WS updaters patch, so the total sits next to them
 * under its own key. It is outside the `issues/<wsId>` prefix on purpose:
 * invalidating a list must not try to refetch this fn-less entry.
 */
import { useQuery, type QueryClient, type QueryKey } from "@tanstack/react-query";

export const listTotalKey = (listKey: QueryKey) => ["issue-list-total", ...listKey] as const;

/** Called from the list's queryFn with the response total. */
export function rememberListTotal(client: QueryClient, listKey: QueryKey, total: number): void {
  client.setQueryData(listTotalKey(listKey), total);
}

/** Observer options for a list total: never fetched, rememberListTotal fills it. */
export function listTotalQueryOptions(listKey: QueryKey) {
  return {
    queryKey: listTotalKey(listKey),
    queryFn: (): Promise<number> => Promise.reject(new Error("list total is set by the list query")),
    enabled: false,
    staleTime: Infinity,
  };
}

/** Total of the list under `listKey`; undefined until it was loaded once. */
export function useListTotal(listKey: QueryKey): number | undefined {
  return useQuery<number>(listTotalQueryOptions(listKey)).data;
}
