/**
 * Agent detail action row:
 * "Chat" and "New issue" for one agent, plus the chat tab's one-shot
 * `?agent=` hand-over (P6).
 *
 * The buttons stay visible like on the web, but are disabled with a reason
 * when the agent cannot be invoked. The access check is the same rule the
 * assignee picker and the chat agent picker use (`canAssignAgentToIssue`),
 * so the button never offers what the server would refuse with a 403.
 */
import type { Agent, ChatSession, MemberRole } from "@multica/core/types";
import { canAssignAgentToIssue } from "@multica/core/permissions";
import { isAgentRuntimeBound } from "./is-agent-runtime-bound";

export type AgentActionBlock = "archived" | "no_runtime" | "no_access";

/** Why the action row is disabled, or null when both actions work. */
export function agentActionBlock(
  agent: Agent,
  viewer: { userId: string | null; role: MemberRole | null },
): AgentActionBlock | null {
  if (agent.archived_at) return "archived";
  if (!canAssignAgentToIssue(agent, viewer).allowed) return "no_access";
  if (!isAgentRuntimeBound(agent)) return "no_runtime";
  return null;
}

/** i18n key (workspace namespace) for the explanation under the row. */
export const AGENT_ACTION_BLOCK_KEY = {
  archived: "agent.actions.blocked_archived",
  no_runtime: "agent.actions.blocked_no_runtime",
  no_access: "agent.actions.blocked_no_access",
} as const satisfies Record<AgentActionBlock, string>;

/** `new-issue` route param that preselects an agent as assignee. */
export function agentAssigneeParam(agentId: string): string {
  return `agent:${agentId}`;
}

/** Parses `?assignee=agent:<id>` / `member:<id>`; anything else is ignored. */
export function parseAssigneeParam(
  raw: string | string[] | undefined,
): { type: "agent" | "member"; id: string } | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const match = /^(agent|member):([\w-]+)$/.exec(value);
  if (!match) return null;
  return { type: match[1] as "agent" | "member", id: match[2] };
}

function lastActivity(s: ChatSession): number {
  const at = s.last_message?.created_at ?? s.updated_at ?? s.created_at;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * The session the chat tab opens for `?agent=<id>`: the most recently active,
 * non-archived session with this agent, or null for a blank new chat
 * (the session is only created on the first send, F2).
 */
export function latestSessionForAgent(
  sessions: readonly ChatSession[],
  agentId: string,
): ChatSession | null {
  let best: ChatSession | null = null;
  for (const s of sessions) {
    if (s.agent_id !== agentId || s.status === "archived") continue;
    if (!best || lastActivity(s) > lastActivity(best)) best = s;
  }
  return best;
}

export type AgentChatHandover =
  | { kind: "wait" }
  | { kind: "ignore" }
  | { kind: "open"; agentId: string; sessionId: string | null };

/**
 * Decides what the chat tab does with a `?agent=` param. "wait" until the
 * agent and session lists are loaded, "ignore" for an unknown or
 * uninvocable agent (the tab then keeps its current state and the agent
 * row already showed why), otherwise open the latest session or a new chat.
 */
export function agentChatHandover(input: {
  agentId: string | undefined;
  loaded: boolean;
  availableAgentIds: readonly string[];
  sessions: readonly ChatSession[];
}): AgentChatHandover {
  if (!input.agentId) return { kind: "ignore" };
  if (!input.loaded) return { kind: "wait" };
  if (!input.availableAgentIds.includes(input.agentId)) return { kind: "ignore" };
  const session = latestSessionForAgent(input.sessions, input.agentId);
  return { kind: "open", agentId: input.agentId, sessionId: session?.id ?? null };
}
