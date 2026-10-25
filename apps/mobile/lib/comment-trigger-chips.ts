/**
 * Pure rules for the composer's "Starts: X" chips (W1-P3b,
 * W1-3). The preview itself comes from
 * `useCommentTriggerPreview` (W1-P3a); these helpers decide what the row
 * shows and which agent ids go out as `suppress_agent_ids`.
 */
import type { CommentTriggerPreviewAgent } from "@multica/core/types";

/** Trigger sources the app has a reason text for (server comment.go:1526). */
export const TRIGGER_REASON_SOURCES = [
  "issue_assignee",
  "mention_agent",
  "mention_squad_leader",
  "thread_parent",
  "conversation_continuation",
] as const;

export type TriggerReasonSource = (typeof TRIGGER_REASON_SOURCES)[number];

/** Known source → its reason key; unknown (newer server) → no reason. */
export function triggerReasonSource(source: string): TriggerReasonSource | null {
  return (TRIGGER_REASON_SOURCES as readonly string[]).includes(source)
    ? (source as TriggerReasonSource)
    : null;
}

export interface TriggerChip {
  agent: CommentTriggerPreviewAgent;
  /** Deselected by the user: sending will not start this agent. */
  suppressed: boolean;
}

/**
 * One chip per agent of the preview, in server order (an agent can show up
 * once only; the first source wins). An empty preview — nobody starts,
 * loading, error, offline — yields no chips and no text (W1-P3b).
 */
export function triggerChips(
  agents: readonly CommentTriggerPreviewAgent[],
  suppressed: readonly string[],
): TriggerChip[] {
  const seen = new Set<string>();
  const chips: TriggerChip[] = [];
  for (const agent of agents) {
    if (!agent.id || seen.has(agent.id)) continue;
    seen.add(agent.id);
    chips.push({ agent, suppressed: suppressed.includes(agent.id) });
  }
  return chips;
}

/** Tap on a chip: deselect, or select again. */
export function toggleSuppressed(suppressed: readonly string[], agentId: string): string[] {
  return suppressed.includes(agentId)
    ? suppressed.filter((id) => id !== agentId)
    : [...suppressed, agentId];
}

/**
 * `suppress_agent_ids` for the send: only agents the user deselected AND
 * that the row still shows. A deselection of an agent that dropped out of
 * the preview (mention removed, other reply target) is not sent, so it
 * cannot silently skip that agent later. `undefined` when nothing is
 * deselected, so the body stays as before.
 */
export function suppressIdsForSubmit(
  suppressed: readonly string[],
  agents: readonly CommentTriggerPreviewAgent[],
): string[] | undefined {
  if (suppressed.length === 0) return undefined;
  const shown = new Set(agents.map((a) => a.id));
  const ids = suppressed.filter((id) => shown.has(id));
  return ids.length > 0 ? ids : undefined;
}
