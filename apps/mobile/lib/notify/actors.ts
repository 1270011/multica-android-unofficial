/**
 * Sender names for the notification service (test report with
 * two workspaces): a live ping from a workspace other than the open one
 * showed "Multica" as sender, because only the open workspace's members and
 * agents were handed over. Now every workspace of the account contributes;
 * the native side looks names up by actor id across all of them.
 */
import { queryOptions } from "@tanstack/react-query";
import type { Agent, MemberWithUser } from "@multica/core/types";
import { api } from "@/data/api";

export interface WorkspaceActors {
  members: readonly Pick<MemberWithUser, "user_id" | "name">[];
  agents: readonly Pick<Agent, "id" | "name">[];
}

/**
 * One map actor id → name over all workspaces. Ids are unique across
 * workspaces (UUIDs); a person in several workspaces keeps the first name
 * seen, so the open workspace (passed first) wins if names differ.
 */
export function buildActorMap(lists: readonly (WorkspaceActors | undefined)[]): Record<string, string> {
  const map: Record<string, string> = {};
  const put = (id: string | undefined, name: string | undefined) => {
    if (id && name && !(id in map)) map[id] = name;
  };
  for (const list of lists) {
    if (!list) continue;
    for (const m of list.members) put(m.user_id, m.name);
    for (const a of list.agents) put(a.id, a.name);
  }
  return map;
}

/**
 * Members and agents of one workspace for the notification names. Own key:
 * `agentListOptions` reads the *current* workspace (header), so reusing its
 * key for another workspace would put the wrong agents into that cache.
 */
export const notifyActorsOptions = (workspace: { id: string; slug: string }) =>
  queryOptions({
    queryKey: ["notify-actors", workspace.id] as const,
    queryFn: async ({ signal }): Promise<WorkspaceActors> => {
      const [members, agents] = await Promise.all([
        api.listMembers(workspace.id, { signal }),
        api.listAgents({ signal, workspaceSlug: workspace.slug }),
      ]);
      return { members, agents };
    },
    staleTime: 5 * 60_000,
  });
