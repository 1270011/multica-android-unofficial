/**
 * React side of the mention frequency (./mention-usage.ts).
 */
import { useCallback, useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Agent, MemberWithUser, Squad } from "@multica/core/types";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { squadListOptions } from "@/data/queries/squads";
import {
  type MentionUsage,
  mentionUsageKey,
  noteSentMentions,
  readMentionUsage,
  subscribeMentionUsage,
} from "./mention-usage";

const EMPTY: MentionUsage = Object.freeze({}) as MentionUsage;

/** Usage of the workspace; re-renders when it is counted or cleared. */
export function useMentionUsage(wsId: string | null): MentionUsage {
  const get = useCallback(() => (wsId ? readMentionUsage(wsId) : EMPTY), [wsId]);
  return useSyncExternalStore(subscribeMentionUsage, get, get);
}

/**
 * Ids of all people, agents and squads of the workspace when all three
 * lists are in the query cache; otherwise undefined (then nothing is
 * pruned). Archived agents still count as known: they come back on
 * unarchive and are only left out when ranking.
 */
export function knownMentionTargets(
  qc: QueryClient,
  wsId: string,
): ReadonlySet<string> | undefined {
  const members = qc.getQueryData<MemberWithUser[]>(memberListOptions(wsId).queryKey);
  const agents = qc.getQueryData<Agent[]>(agentListOptions(wsId).queryKey);
  const squads = qc.getQueryData<Squad[]>(squadListOptions(wsId).queryKey);
  if (!members || !agents || !squads) return undefined;
  return new Set([
    ...members.map((m) => mentionUsageKey("member", m.user_id)),
    ...agents.map((a) => mentionUsageKey("agent", a.id)),
    ...squads.map((s) => mentionUsageKey("squad", s.id)),
  ]);
}

/** Count a successfully sent comment or chat message. Never throws. */
export function noteSentMessage(qc: QueryClient, wsId: string | null, content: string): void {
  if (!wsId) return;
  try {
    noteSentMentions(wsId, content, { known: knownMentionTargets(qc, wsId) });
  } catch {
    // Counting must never break a send.
  }
}
