/**
 * Where the "Warum hängt mein Agent?" notice shows up. The bucket itself comes
 * from `deriveAgentHangState`, the same derivation the autopilot detail
 * and the runtime screens use, so every entry says the same thing.
 *
 * Pure: `now` is a parameter; callers pass `useVisibleNow()` (30 s visible
 * tick), so nothing here polls.
 */
import type { Agent, AgentTask, RuntimeDevice } from "@multica/core/types";
import { deriveAgentHangState, type AgentHangKind, type AgentHangState } from "@/lib/agent-hang-state";

type RuntimeInput = Pick<RuntimeDevice, "id" | "status" | "last_seen_at" | "name" | "custom_name">;

/** Buckets where the runtime is the reason, so "Runtime ansehen" helps. */
const RUNTIME_LINK_KINDS = new Set<AgentHangKind>([
  "stuck_offline",
  "connection_lost",
  "unavailable",
  "queued",
]);

/**
 * Whether the status line on the agent detail renders. "Alles ok" (working,
 * idle, queued under two minutes) and "archived" (the header says so
 * already) render nothing; every row with a hint text or a non-ok tone does.
 */
export function showAgentHangLine(state: AgentHangState): boolean {
  if (state.kind === "archived") return false;
  return state.showHint || state.tone === "warning" || state.tone === "danger";
}

/** Runtime the notice links to, or null when no link makes sense. */
export function hangRuntimeLinkId(state: AgentHangState): string | null {
  return state.runtimeId && RUNTIME_LINK_KINDS.has(state.kind) ? state.runtimeId : null;
}

/** Hang state of one agent from the workspace lists (agent detail, picker). */
export function agentHangStateFor(input: {
  agentId: string;
  agents: readonly Agent[] | undefined;
  runtimes: readonly RuntimeInput[] | undefined;
  snapshot: readonly AgentTask[] | undefined;
  now: number;
}): AgentHangState | null {
  const agent = input.agents?.find((a) => a.id === input.agentId);
  if (!agent || !input.runtimes) return null;
  const runtime = input.runtimes.find((r) => r.id === agent.runtime_id) ?? null;
  const tasks = (input.snapshot ?? []).filter((t) => t.agent_id === agent.id);
  return deriveAgentHangState({ agent, runtime, tasks, now: input.now });
}

/**
 * Banner on the issue detail: the first agent whose active task on THIS
 * issue waits on an offline runtime. Only the issue's own tasks count, so an
 * agent stuck elsewhere does not flag an issue it is not working on.
 */
export function findStuckIssueAgent(input: {
  activeTasks: readonly AgentTask[];
  agents: readonly Agent[] | undefined;
  runtimes: readonly RuntimeInput[] | undefined;
  now: number;
}): { agent: Agent; state: AgentHangState } | null {
  if (!input.agents || !input.runtimes) return null;
  const seen = new Set<string>();
  for (const task of input.activeTasks) {
    if (seen.has(task.agent_id)) continue;
    seen.add(task.agent_id);
    const agent = input.agents.find((a) => a.id === task.agent_id);
    if (!agent) continue;
    const runtime = input.runtimes.find((r) => r.id === agent.runtime_id) ?? null;
    const tasks = input.activeTasks.filter((t) => t.agent_id === agent.id);
    const state = deriveAgentHangState({ agent, runtime, tasks, now: input.now });
    if (state.kind === "stuck_offline") return { agent, state };
  }
  return null;
}
