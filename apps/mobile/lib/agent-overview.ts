/**
 * Read-only Agents/Squads overview: status line, runtime label, last run and squad member rows.
 *
 * The three-state presence itself comes from `@multica/core/agents`
 * (`buildPresenceMap`, via lib/use-agent-presence.ts) so web and mobile
 * agree; this file only turns it into one status per row, in this order:
 * archived → no runtime → working → queued → availability (online,
 * unstable, offline).
 */
import type {
  Agent,
  AgentTask,
  RuntimeDevice,
  SquadMember,
  SquadMemberStatus,
  SquadMemberStatusValue,
} from "@multica/core/types";
import type { AgentPresenceDetail } from "@multica/core/agents";

export type AgentStatusKey =
  | "archived"
  | "no_runtime"
  | "working"
  | "queued"
  | "online"
  | "unstable"
  | "offline";

export interface AgentStatus {
  key: AgentStatusKey;
  running: number;
  queued: number;
}

export function agentStatus(
  agent: Pick<Agent, "archived_at" | "runtime_bound">,
  presence: AgentPresenceDetail | undefined,
): AgentStatus {
  const running = presence?.runningCount ?? 0;
  const queued = presence?.queuedCount ?? 0;
  if (agent.archived_at) return { key: "archived", running: 0, queued: 0 };
  if (agent.runtime_bound === false) return { key: "no_runtime", running, queued };
  if (running > 0) return { key: "working", running, queued };
  if (queued > 0) return { key: "queued", running, queued };
  return { key: presence?.availability ?? "offline", running, queued };
}

/**
 * Runtime label for an agent. A runtime the member cannot see (not in the
 * list) still has a coarse availability on the agent; it shows as hidden
 * instead of "unknown". Mirrors runtimeDisplayName (custom name wins).
 */
export function agentRuntimeLabel(
  agent: Pick<Agent, "runtime_id" | "runtime_bound">,
  runtimes: readonly Pick<RuntimeDevice, "id" | "name" | "custom_name">[],
): { kind: "none" } | { kind: "hidden" } | { kind: "named"; name: string } {
  if (agent.runtime_bound === false || !agent.runtime_id) return { kind: "none" };
  const runtime = runtimes.find((r) => r.id === agent.runtime_id);
  if (!runtime) return { kind: "hidden" };
  const custom = runtime.custom_name?.trim();
  return { kind: "named", name: custom ? custom : runtime.name };
}

const TERMINAL = new Set<AgentTask["status"]>(["completed", "failed", "cancelled"]);

const taskTime = (t: AgentTask) =>
  Date.parse(t.completed_at ?? t.started_at ?? t.created_at) || 0;

/** Newest finished run per agent from the workspace task snapshot. */
export function lastRunByAgent(snapshot: readonly AgentTask[]): Map<string, AgentTask> {
  const out = new Map<string, AgentTask>();
  for (const task of snapshot) {
    if (!TERMINAL.has(task.status)) continue;
    const prev = out.get(task.agent_id);
    if (!prev || taskTime(task) > taskTime(prev)) out.set(task.agent_id, task);
  }
  return out;
}

/** What started a run: an issue, a chat or an autopilot. */
export function runSource(task: Pick<AgentTask, "issue_id" | "chat_session_id" | "autopilot_run_id">):
  | "issue"
  | "chat"
  | "autopilot"
  | "other" {
  if (task.issue_id) return "issue";
  if (task.chat_session_id) return "chat";
  if (task.autopilot_run_id) return "autopilot";
  return "other";
}

/** List order: active agents by name; archived ones are not listed. */
export function visibleAgents<T extends Pick<Agent, "name" | "archived_at">>(agents: readonly T[]): T[] {
  return agents
    .filter((a) => !a.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * More › Agents with W4 (Settings › View): agents the user hid are
 * left out of `shown` and counted in `hidden`, so the list can end with
 * "2 hidden · Show". Input order is kept (pass `visibleAgents` output).
 */
export function splitHiddenAgents<T extends Pick<Agent, "id">>(
  agents: readonly T[],
  hiddenIds: readonly string[],
): { shown: T[]; hidden: T[] } {
  const ids = new Set(hiddenIds);
  const shown: T[] = [];
  const hidden: T[] = [];
  for (const a of agents) (ids.has(a.id) ? hidden : shown).push(a);
  return { shown, hidden };
}

export interface SquadMemberRow {
  key: string;
  type: SquadMember["member_type"];
  id: string;
  role: string;
  isLeader: boolean;
  /** null for humans (no presence signal), like the web squad page. */
  status: SquadMemberStatusValue | null;
  activeIssues: SquadMemberStatus["active_issues"];
}

/**
 * Members joined with the server-derived status. Leader first, then agents,
 * then humans, each by insertion order of the member list.
 */
export function squadMemberRows(
  members: readonly SquadMember[],
  statuses: readonly SquadMemberStatus[],
  leaderId: string,
): SquadMemberRow[] {
  const statusOf = new Map(statuses.map((s) => [`${s.member_type}:${s.member_id}`, s]));
  const rank = (m: SquadMember) =>
    m.member_id === leaderId ? 0 : m.member_type === "agent" ? 1 : 2;
  return [...members]
    .map((m, index) => ({ m, index }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.index - b.index)
    .map(({ m }) => {
      const key = `${m.member_type}:${m.member_id}`;
      const status = statusOf.get(key);
      return {
        key,
        type: m.member_type,
        id: m.member_id,
        role: m.role,
        isLeader: m.member_id === leaderId,
        status: status?.status ?? null,
        activeIssues: status?.active_issues ?? [],
      };
    });
}

/**
 * What the "Recent runs" section of the agent detail shows. A failed
 * load — 403 included — is an error state with "Try again", never "No runs
 * yet", which would claim something the app does not know. Runs already on
 * screen stay when a refetch fails (every `task:*` event refetches; a short
 * network blip must not replace the list).
 */
export type RunsSectionState = "loading" | "forbidden" | "error" | "empty" | "list";

export function runsSectionState({
  isLoading,
  error,
  hasData,
  count,
}: {
  isLoading: boolean;
  error: unknown;
  /** The query holds data from an earlier successful load. */
  hasData: boolean;
  count: number;
}): RunsSectionState {
  if (hasData) return count === 0 ? "empty" : "list";
  if (isLoading) return "loading";
  if (error) {
    const status = (error as { status?: unknown }).status;
    return status === 403 ? "forbidden" : "error";
  }
  return "empty";
}

/** Squad rows (active issues too) are at least this tall. */
export const SQUAD_ROW_MIN_DP = 44;
