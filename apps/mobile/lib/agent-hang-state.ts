/**
 * "Warum hängt mein Agent?" — the presence matrix.
 *
 * The two axes come straight from `@multica/core/agents/derive-presence`
 * (availability from runtime reachability, workload from the task snapshot),
 * so web and mobile agree on every bucket. This module only folds the two
 * axes into one of the matrix rows and adds the facts the hint texts need
 * (how long the runtime is gone, how long the oldest task waits).
 *
 * Pure: `now` is a parameter; the caller re-runs it on the 30 s visible tick
 * (`lib/use-visible-tick.ts`). Unknown wire values never throw — a runtime
 * status other than "online" is bucketed by `last_seen_at`, an unparseable
 * timestamp yields `null` durations.
 */
import { deriveAgentPresenceDetail } from "@multica/core/agents/derive-presence";
import type { Agent, AgentTask, RuntimeDevice } from "@multica/core/types";

export type AgentHangKind =
  | "working" // online · arbeitet
  | "queued" // online · wartet
  | "idle" // online · frei (no matrix row, no hint)
  | "connection_lost" // instabil · wartet/arbeitet
  | "stuck_offline" // offline · wartet → "Hängt: Runtime offline"
  | "unavailable" // offline · frei
  | "no_runtime" // agent bound to no runtime
  | "archived";

export type AgentHangTone = "ok" | "warning" | "danger" | "muted";

export interface AgentHangState {
  kind: AgentHangKind;
  tone: AgentHangTone;
  runningCount: number;
  queuedCount: number;
  /** Count shown in the label: running for "working", queued otherwise. */
  count: number;
  /** Whether the row carries a hint text (matrix column "Hinweistext"). */
  showHint: boolean;
  runtimeId: string | null;
  /** `custom_name` before `name`; null when the runtime is not visible. */
  runtimeName: string | null;
  /** Time since the runtime's last heartbeat, only when it is not online. */
  offlineForMs: number | null;
  /** Age of the oldest waiting task (queued/dispatched/local-dir lock). */
  waitingForMs: number | null;
}

/** "Wartet" on an online runtime only gets a hint after two minutes. */
export const QUEUED_HINT_AFTER_MS = 2 * 60 * 1000;

const WAITING_STATUSES = new Set<string>([
  "queued",
  "dispatched",
  "waiting_local_directory",
]);

type RuntimeInput = Pick<
  RuntimeDevice,
  "id" | "status" | "last_seen_at" | "name" | "custom_name"
>;

export function runtimeDisplayName(runtime: Pick<RuntimeDevice, "name" | "custom_name">): string {
  return runtime.custom_name?.trim() || runtime.name;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function oldestWaitingMs(tasks: readonly AgentTask[], now: number): number | null {
  let oldest: number | null = null;
  for (const t of tasks) {
    if (!WAITING_STATUSES.has(t.status)) continue;
    const created = parseTime(t.created_at);
    if (created === null) continue;
    if (oldest === null || created < oldest) oldest = created;
  }
  return oldest === null ? null : Math.max(0, now - oldest);
}

export function deriveAgentHangState(input: {
  agent: Agent;
  runtime: RuntimeInput | null;
  /** Tasks of THIS agent (snapshot rows pre-filtered by agent_id). */
  tasks: readonly AgentTask[];
  now: number;
}): AgentHangState {
  const { agent, runtime, tasks, now } = input;
  const base = {
    runningCount: 0,
    queuedCount: 0,
    count: 0,
    showHint: false,
    runtimeId: agent.runtime_id || null,
    runtimeName: runtime ? runtimeDisplayName(runtime) : null,
    offlineForMs: null,
    waitingForMs: null,
  } satisfies Partial<AgentHangState>;

  if (agent.archived_at) return { ...base, kind: "archived", tone: "muted" };
  if (!agent.runtime_id) return { ...base, kind: "no_runtime", tone: "muted", showHint: true };

  const presence = deriveAgentPresenceDetail({ agent, runtime, tasks, now });
  const lastSeen = runtime && runtime.status !== "online" ? parseTime(runtime.last_seen_at) : null;
  const state = {
    ...base,
    runningCount: presence.runningCount,
    queuedCount: presence.queuedCount,
    offlineForMs: lastSeen === null ? null : Math.max(0, now - lastSeen),
    waitingForMs: oldestWaitingMs(tasks, now),
  };
  const busy = presence.workload !== "idle";

  switch (presence.availability) {
    case "online":
      if (presence.workload === "working") {
        return { ...state, kind: "working", tone: "ok", count: presence.runningCount };
      }
      if (presence.workload === "queued") {
        return {
          ...state,
          kind: "queued",
          tone: "ok",
          count: presence.queuedCount,
          showHint: (state.waitingForMs ?? 0) > QUEUED_HINT_AFTER_MS,
        };
      }
      return { ...state, kind: "idle", tone: "ok" };
    case "unstable":
      return {
        ...state,
        kind: "connection_lost",
        tone: "warning",
        count: presence.runningCount + presence.queuedCount,
        showHint: busy,
      };
    default:
      // "offline" — and any availability a future core adds lands here, the
      // safe "not reachable" degrade.
      if (busy) {
        return {
          ...state,
          kind: "stuck_offline",
          tone: "danger",
          count: presence.runningCount + presence.queuedCount,
          showHint: true,
        };
      }
      return { ...state, kind: "unavailable", tone: "muted", showHint: true };
  }
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Label + hint for a hang state, keys under `workspace:agent_hang`.
 * `formatDuration` renders "2 Std" / "40 Min" (caller owns the locale).
 */
export function describeAgentHangState(
  state: AgentHangState,
  t: Translate,
  formatDuration: (ms: number) => string,
): { label: string; hint: string | null } {
  const k = (key: string) => `workspace:agent_hang.${key}`;
  const name = state.runtimeName ?? t(k("runtime_unknown"));
  const since = state.offlineForMs === null ? null : formatDuration(state.offlineForMs);
  const label = t(k(`label_${state.kind}`), { count: state.count });
  if (!state.showHint) return { label, hint: null };

  switch (state.kind) {
    case "queued":
      return {
        label,
        hint: t(k("hint_queued"), { since: formatDuration(state.waitingForMs ?? 0) }),
      };
    case "connection_lost":
      return {
        label,
        hint: since
          ? t(k("hint_connection_lost"), { minutes: Math.max(1, Math.floor((state.offlineForMs ?? 0) / 60_000)) })
          : t(k("hint_connection_lost_unknown")),
      };
    case "stuck_offline":
      return {
        label,
        hint: since
          ? t(k("hint_stuck_offline"), { count: state.count, name, since })
          : t(k("hint_stuck_offline_unknown"), { count: state.count, name }),
      };
    default:
      return { label, hint: t(k(`hint_${state.kind}`)) };
  }
}
