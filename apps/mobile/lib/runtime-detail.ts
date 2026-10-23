/**
 * Runtime detail. Pure
 * derivations so the screen and its unit tests agree:
 *
 * - `runtimeStuckReason`: the "Warum hängt es?" card, only when something
 *   needs attention (matrix §3.4). Online with an empty queue, or offline
 *   with nothing waiting, gives no card.
 * - `runtimeAgentRows`: agents bound to the runtime with their workload.
 * - `activityBars` / `activitySummaryText`: 24 hour columns from
 *   GET /api/runtimes/{id}/activity and the single TalkBack sentence read
 *   instead of 24 values.
 *
 * Counting uses `deriveWorkloadDetail` (queued/dispatched/
 * waiting_local_directory, without `deferred`), same as the R2 list rows.
 */
import { deriveWorkloadDetail } from "@multica/core/agents/derive-presence";
import type { RuntimeHealth } from "@multica/core/runtimes";
import type { Agent, AgentTask, RuntimeHourlyActivity } from "@multica/core/types";
import { i18n } from "@/lib/i18n/singleton";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`workspace:${key}`, opts);

const MIN = 60_000;
/** Online with a queue only counts as a problem after this long. */
export const ONLINE_WAIT_THRESHOLD_MS = 2 * MIN;

export type RuntimeStuckReason =
  | { kind: "offline_waiting"; count: number; lastSeenAt: string | null }
  | { kind: "unstable"; count: number; lastSeenAt: string | null }
  | { kind: "online_waiting"; count: number; oldestAt: string };

const validMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Card "Warum hängt es?" — null means "no action needed, no card".
 * `queue` is the runtime's waiting list (`runtimeQueue`), `running` the
 * number of running tasks on it.
 */
export function runtimeStuckReason(input: {
  health: RuntimeHealth;
  lastSeenAt: string | null;
  queue: readonly AgentTask[];
  running: number;
  now: number;
}): RuntimeStuckReason | null {
  const { health, lastSeenAt, queue, running, now } = input;
  const busy = queue.length + running;
  if (health === "recently_lost") return { kind: "unstable", count: busy, lastSeenAt };
  if (health === "offline" || health === "long_offline") {
    return busy > 0 ? { kind: "offline_waiting", count: busy, lastSeenAt } : null;
  }
  // Online: only a queue that has been waiting for a while (maybe saturated).
  let oldest: { iso: string; ms: number } | null = null;
  for (const task of queue) {
    const ms = validMs(task.created_at);
    if (ms !== null && (!oldest || ms < oldest.ms)) oldest = { iso: task.created_at, ms };
  }
  if (oldest && now - oldest.ms > ONLINE_WAIT_THRESHOLD_MS) {
    return { kind: "online_waiting", count: queue.length, oldestAt: oldest.iso };
  }
  return null;
}

export interface RuntimeAgentRow {
  agent: Agent;
  runningCount: number;
  queuedCount: number;
}

/** Agents bound to the runtime (archived ones left out), busiest first. */
export function runtimeAgentRows(
  runtimeId: string,
  agents: readonly Agent[],
  snapshot: readonly AgentTask[],
): RuntimeAgentRow[] {
  const byAgent = new Map<string, AgentTask[]>();
  for (const task of snapshot) {
    const list = byAgent.get(task.agent_id);
    if (list) list.push(task);
    else byAgent.set(task.agent_id, [task]);
  }
  return agents
    .filter((a) => a.runtime_id === runtimeId && !a.archived_at)
    .map((agent) => {
      const work = deriveWorkloadDetail(byAgent.get(agent.id) ?? []);
      return { agent, runningCount: work.runningCount, queuedCount: work.queuedCount };
    })
    .sort(
      (a, b) =>
        b.runningCount + b.queuedCount - (a.runningCount + a.queuedCount) ||
        a.agent.name.localeCompare(b.agent.name),
    );
}

/** 24 counts (index = hour); duplicate hours add up, out-of-range is dropped. */
export function activityBars(rows: readonly RuntimeHourlyActivity[]): number[] {
  const bars = Array.from({ length: 24 }, () => 0);
  for (const r of rows) {
    const h = Math.floor(r.hour);
    if (h < 0 || h > 23 || !Number.isFinite(r.count) || r.count <= 0) continue;
    bars[h] = (bars[h] ?? 0) + r.count;
  }
  return bars;
}

/**
 * Busiest two-hour window (wrapping past midnight), earliest wins a tie.
 * Returns the start hour or null when there is no activity at all.
 */
export function busiestWindow(bars: readonly number[]): number | null {
  let best: number | null = null;
  let bestSum = 0;
  for (let h = 0; h < 24; h++) {
    const sum = (bars[h] ?? 0) + (bars[(h + 1) % 24] ?? 0);
    if (sum > bestSum) {
      bestSum = sum;
      best = h;
    }
  }
  return best;
}

/** TalkBack summary: "Meiste Läufe zwischen 9 und 11 Uhr, insgesamt 42 Läufe." */
export function activitySummaryText(bars: readonly number[]): string {
  const total = bars.reduce((n, c) => n + c, 0);
  const start = busiestWindow(bars);
  if (total === 0 || start === null) return t("runtime_detail.activity_empty");
  return t("runtime_detail.activity_summary", {
    from: start,
    to: (start + 2) % 24,
    total: t("runtime_detail.activity_total", { count: total }),
  });
}

function durationText(iso: string | null, now: number): string | null {
  const ms = validMs(iso);
  if (ms === null) return null;
  const minutes = Math.max(1, Math.floor((now - ms) / MIN));
  if (minutes < 60) return t("runtime_list.duration_minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("runtime_list.duration_hours", { count: hours });
  return t("runtime_list.duration_days", { count: Math.floor(hours / 24) });
}

/** Body of the "Warum hängt es?" card. */
export function runtimeStuckText(reason: RuntimeStuckReason, name: string, now: number): string {
  if (reason.kind === "online_waiting") {
    return t("runtime_detail.stuck_online", {
      tasks: t("runtime_detail.tasks", { count: reason.count }),
      since: durationText(reason.oldestAt, now) ?? "",
    });
  }
  const since = durationText(reason.lastSeenAt, now);
  if (reason.kind === "unstable") {
    return since
      ? t("runtime_detail.stuck_unstable", { since })
      : t("runtime_detail.stuck_unstable_unknown");
  }
  const tasks = t("runtime_detail.tasks", { count: reason.count });
  return since
    ? t("runtime_detail.stuck_offline", { tasks, name, since })
    : t("runtime_detail.stuck_offline_unknown", { tasks, name });
}

/** Workload of one agent row: "1 läuft · 2 warten" or "frei". */
export function runtimeAgentWorkText(row: RuntimeAgentRow): string {
  if (row.runningCount === 0 && row.queuedCount === 0) return t("runtime_detail.agent_idle");
  const parts: string[] = [];
  if (row.runningCount > 0) parts.push(t("runtime_list.running", { count: row.runningCount }));
  if (row.queuedCount > 0) parts.push(t("runtime_list.queued", { count: row.queuedCount }));
  return parts.join(" · ");
}

/** "wartet seit 40 Minuten" for a queue entry. */
export function queueWaitText(task: AgentTask, now: number): string {
  const since = durationText(task.created_at, now);
  if (task.status === "waiting_local_directory") return t("runtime_detail.queue_local_dir");
  return since ? t("runtime_detail.queue_waiting", { since }) : t("runtime_detail.queue_waiting_unknown");
}

/** Status line under the title: "Offline · seit 2 Stunden". */
export function runtimeStatusLine(health: RuntimeHealth, lastSeenAt: string | null, now: number): string {
  const label = t(`runtime_health.${health}`);
  if (health === "online") return label;
  const since = durationText(lastSeenAt, now);
  return since ? `${label} · ${t("runtime_detail.since", { since })}` : label;
}
