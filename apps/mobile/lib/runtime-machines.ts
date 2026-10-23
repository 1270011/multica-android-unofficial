/**
 * Runtime list grouped by machine (consumed by the runtime list and
 * detail).
 *
 * Mobile-owned mirror of the grouping in
 * `packages/views/runtimes/components/runtime-machines.ts` (views is not
 * importable from mobile): same machine identity (`runtime_mode` + daemon id,
 * else device name, else the runtime itself), same machine title rules
 * (shared `custom_name` → host from "name (host)" / `device_info` → daemon id),
 * same per-runtime row label. Health per runtime comes from core's
 * `deriveRuntimeHealth` (5-min "instabil", 6-day "lange offline" buckets).
 *
 * Deliberate divergences from web, both from the UX spec:
 *   - Sort order: machines with a problem (not online AND tasks waiting)
 *     first, then online, then offline; alphabetical inside each bucket.
 *     Web sorts "this machine" first, which a phone never is.
 *   - Waiting count uses core's `deriveWorkloadDetail` vocabulary
 *     (queued/dispatched/waiting_local_directory), so a runtime row and the
 *     agent presence dot never disagree. Web's list index omits the
 *     local-directory hold state.
 */
import { deriveWorkloadDetail } from "@multica/core/agents/derive-presence";
import { deriveRuntimeHealth } from "@multica/core/runtimes/derive-health";
import type { RuntimeHealth } from "@multica/core/runtimes";
import type { Agent, AgentTask, RuntimeDevice } from "@multica/core/types";

export interface RuntimeRowSummary {
  runtime: RuntimeDevice;
  /** Row label under the machine title (provider base or one-off rename). */
  label: string;
  health: RuntimeHealth;
  agentCount: number;
  runningCount: number;
  queuedCount: number;
  /** Not online and something is waiting on it — drives the problem banner. */
  hasProblem: boolean;
  /** Launched from a custom runtime profile ("Eigene" badge). */
  isCustomProfile: boolean;
}

export interface RuntimeMachineGroup {
  id: string;
  title: string;
  /** online if any runtime is online, else the worst offline bucket. */
  health: RuntimeHealth;
  runtimes: RuntimeRowSummary[];
  hasProblem: boolean;
  runningCount: number;
  queuedCount: number;
  lastSeenAt: string | null;
}

const HEALTH_SEVERITY: Record<RuntimeHealth, number> = {
  online: 0,
  recently_lost: 1,
  offline: 2,
  long_offline: 3,
};

/**
 * Task statuses that sit in a runtime's queue (UX §3.3 "Warteschlange").
 * Exactly the statuses `deriveWorkloadDetail` counts as queued, so the row
 * counter ("3 warten"), the queue list and the agent presence dot never
 * disagree (review, #94). `deferred` (retry backoff) is left
 * out of all three, like web.
 */
export const RUNTIME_QUEUE_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "dispatched",
  "waiting_local_directory",
]);

export function splitRuntimeName(name: string): { base: string; hostname: string | null } {
  const m = name.match(/^(.+?)\s+\(([^)]+)\)$/);
  if (!m || !m[1] || !m[2]) return { base: name, hostname: null };
  return { base: m[1], hostname: m[2] };
}

function runtimeDeviceName(runtime: RuntimeDevice): string | null {
  const host = splitRuntimeName(runtime.name ?? "").hostname;
  if (host) return host;
  const raw = runtime.device_info?.trim();
  if (!raw) return null;
  return raw.split(" · ")[0]?.trim() || null;
}

export function runtimeMachineId(runtime: RuntimeDevice): string {
  if (runtime.daemon_id) return `${runtime.runtime_mode}:${runtime.daemon_id}`;
  const device = runtimeDeviceName(runtime);
  if (device) return `${runtime.runtime_mode}:device:${device}`;
  return `${runtime.runtime_mode}:runtime:${runtime.id}`;
}

function sharedCustomName(runtimes: readonly RuntimeDevice[]): string | null {
  const names = runtimes.map((r) => r.custom_name?.trim() ?? "");
  const first = names[0];
  if (!first) return null;
  return names.every((n) => n === first) ? first : null;
}

function machineTitle(runtimes: readonly RuntimeDevice[]): string {
  const shared = sharedCustomName(runtimes);
  if (shared) return shared;
  const first = runtimes[0];
  if (!first) return "?";
  const device = runtimeDeviceName(first);
  if (device) return device;
  if (first.runtime_mode === "cloud" && first.provider) {
    return `${first.provider.slice(0, 1).toUpperCase()}${first.provider.slice(1)} cloud`;
  }
  if (first.daemon_id) {
    return first.daemon_id.length > 12 ? `${first.daemon_id.slice(0, 8)}...` : first.daemon_id;
  }
  return first.name || first.id;
}

export function runtimeRowLabel(runtime: RuntimeDevice, title: string): string {
  const custom = runtime.custom_name?.trim();
  if (custom && custom !== title) return custom;
  return splitRuntimeName(runtime.name ?? "").base || runtime.provider;
}

function latest(a: string | null, b: string | null): string | null {
  if (!b || Number.isNaN(Date.parse(b))) return a;
  if (!a) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function machineFromRows(
  id: string,
  title: string,
  rows: RuntimeRowSummary[],
): RuntimeMachineGroup {
  const health = rows.some((r) => r.health === "online")
    ? "online"
    : rows.reduce<RuntimeHealth>(
        (worst, r) => (HEALTH_SEVERITY[r.health] > HEALTH_SEVERITY[worst] ? r.health : worst),
        "recently_lost",
      );
  return {
    id,
    title,
    health,
    runtimes: rows,
    hasProblem: rows.some((r) => r.hasProblem),
    runningCount: rows.reduce((n, r) => n + r.runningCount, 0),
    queuedCount: rows.reduce((n, r) => n + r.queuedCount, 0),
    lastSeenAt: rows.reduce<string | null>((acc, r) => latest(acc, r.runtime.last_seen_at), null),
  };
}

function bucket(m: RuntimeMachineGroup): number {
  if (m.hasProblem) return 0;
  if (m.health === "online") return 1;
  return 2;
}

/**
 * Tasks are mapped to a runtime through their agent's binding (like web's
 * workload index), archived agents excluded; snapshot terminal rows are
 * ignored by `deriveWorkloadDetail`.
 */
export function buildRuntimeMachineGroups(input: {
  runtimes: readonly RuntimeDevice[];
  agents: readonly Agent[];
  snapshot: readonly AgentTask[];
  now: number;
}): RuntimeMachineGroup[] {
  const agentToRuntime = new Map<string, string>();
  const agentsByRuntime = new Map<string, number>();
  for (const a of input.agents) {
    if (!a.runtime_id || a.archived_at) continue;
    agentToRuntime.set(a.id, a.runtime_id);
    agentsByRuntime.set(a.runtime_id, (agentsByRuntime.get(a.runtime_id) ?? 0) + 1);
  }
  const tasksByRuntime = new Map<string, AgentTask[]>();
  for (const t of input.snapshot) {
    const rid = agentToRuntime.get(t.agent_id);
    if (!rid) continue;
    const list = tasksByRuntime.get(rid);
    if (list) list.push(t);
    else tasksByRuntime.set(rid, [t]);
  }

  const drafts = new Map<string, RuntimeDevice[]>();
  for (const r of input.runtimes) {
    const id = runtimeMachineId(r);
    const list = drafts.get(id);
    if (list) list.push(r);
    else drafts.set(id, [r]);
  }

  const groups: RuntimeMachineGroup[] = [];
  for (const [id, list] of drafts) {
    const sorted = [...list].sort((a, b) => (a.provider ?? "").localeCompare(b.provider ?? ""));
    const title = machineTitle(sorted);
    const rows = sorted.map((runtime): RuntimeRowSummary => {
      const health = deriveRuntimeHealth(runtime, input.now);
      const work = deriveWorkloadDetail(tasksByRuntime.get(runtime.id) ?? []);
      return {
        runtime,
        label: runtimeRowLabel(runtime, title),
        health,
        agentCount: agentsByRuntime.get(runtime.id) ?? 0,
        runningCount: work.runningCount,
        queuedCount: work.queuedCount,
        hasProblem: health !== "online" && work.queuedCount + work.runningCount > 0,
        isCustomProfile: !!runtime.profile_id,
      };
    });
    groups.push(machineFromRows(id, title, rows));
  }

  return groups.sort((a, b) => bucket(a) - bucket(b) || a.title.localeCompare(b.title));
}

/** "Lange offline (n)" is collapsed below the rest (UX §3.2). */
export function partitionLongOffline(groups: readonly RuntimeMachineGroup[]): {
  visible: RuntimeMachineGroup[];
  longOffline: RuntimeMachineGroup[];
} {
  const visible: RuntimeMachineGroup[] = [];
  const longOffline: RuntimeMachineGroup[] = [];
  for (const g of groups) {
    // A machine with waiting tasks stays visible even after six days — the
    // problem banner jumps to it.
    if (g.health === "long_offline" && !g.hasProblem) longOffline.push(g);
    else visible.push(g);
  }
  return { visible, longOffline };
}

/** Problem banner: "n Runtime(s) offline mit m wartenden Aufgaben". */
export function runtimeProblemSummary(groups: readonly RuntimeMachineGroup[]): {
  runtimeCount: number;
  taskCount: number;
  firstRuntimeId: string;
} | null {
  let runtimeCount = 0;
  let taskCount = 0;
  let firstRuntimeId: string | null = null;
  for (const g of groups) {
    for (const r of g.runtimes) {
      if (!r.hasProblem) continue;
      runtimeCount += 1;
      taskCount += r.queuedCount + r.runningCount;
      firstRuntimeId ??= r.runtime.id;
    }
  }
  return firstRuntimeId ? { runtimeCount, taskCount, firstRuntimeId } : null;
}

/** Filter "Alle | Meine" plus free-text search over titles and names. */
export function filterRuntimeMachineGroups(
  groups: readonly RuntimeMachineGroup[],
  opts: { scope: "all" | "mine"; userId: string | null; query: string },
): RuntimeMachineGroup[] {
  const q = opts.query.trim().toLowerCase();
  const out: RuntimeMachineGroup[] = [];
  for (const g of groups) {
    const rows =
      opts.scope === "mine"
        ? g.runtimes.filter((r) => !!opts.userId && r.runtime.owner_id === opts.userId)
        : g.runtimes;
    if (rows.length === 0) continue;
    if (q) {
      const hay = [g.title, ...rows.flatMap((r) => [r.label, r.runtime.name, r.runtime.provider])]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(rows === g.runtimes ? g : machineFromRows(g.id, g.title, rows));
  }
  return out;
}

/** Waiting tasks of one runtime, oldest first (UX §3.3 "Warteschlange"). */
export function runtimeQueue(
  runtimeId: string,
  agents: readonly Agent[],
  snapshot: readonly AgentTask[],
): AgentTask[] {
  const onRuntime = new Set(
    agents.filter((a) => a.runtime_id === runtimeId && !a.archived_at).map((a) => a.id),
  );
  const time = (t: AgentTask) => {
    const ms = Date.parse(t.created_at);
    return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
  };
  return snapshot
    .filter((t) => onRuntime.has(t.agent_id) && RUNTIME_QUEUE_STATUSES.has(t.status))
    .sort((a, b) => time(a) - time(b));
}
