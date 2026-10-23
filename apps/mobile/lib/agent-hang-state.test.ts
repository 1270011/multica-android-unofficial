import { describe, expect, it } from "vitest";
import type { Agent, AgentTask, RuntimeDevice } from "@multica/core/types";
import de from "../locales/de/workspace.json";
import en from "../locales/en/workspace.json";
import zh from "../locales/zh-Hans/workspace.json";
import {
  QUEUED_HINT_AFTER_MS,
  deriveAgentHangState,
  describeAgentHangState,
  type AgentHangKind,
} from "./agent-hang-state";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "ag-1",
    runtime_id: "rt-1",
    name: "planner",
    archived_at: null,
    max_concurrent_tasks: 6,
    ...overrides,
  } as Agent;
}

function runtime(overrides: Partial<RuntimeDevice> = {}): RuntimeDevice {
  return {
    id: "rt-1",
    name: "claude (devbox-a)",
    custom_name: null,
    status: "online",
    last_seen_at: new Date(NOW).toISOString(),
    ...overrides,
  } as RuntimeDevice;
}

function offlineFor(ms: number, overrides: Partial<RuntimeDevice> = {}): RuntimeDevice {
  return runtime({ status: "offline", last_seen_at: new Date(NOW - ms).toISOString(), ...overrides });
}

function task(status: string, ageMs = 0, overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: `t-${status}-${ageMs}`,
    agent_id: "ag-1",
    runtime_id: "rt-1",
    status,
    created_at: new Date(NOW - ageMs).toISOString(),
    ...overrides,
  } as AgentTask;
}

const derive = (a: Agent, r: RuntimeDevice | null, tasks: AgentTask[]) =>
  deriveAgentHangState({ agent: a, runtime: r, tasks, now: NOW });

describe("deriveAgentHangState — matrix", () => {
  it("online · arbeitet → Arbeitet (n), no hint", () => {
    const s = derive(agent(), runtime(), [task("running"), task("running"), task("queued")]);
    expect(s).toMatchObject({ kind: "working", tone: "ok", count: 2, showHint: false });
  });

  it("online · wartet ≤ 2 min → Wartet (n) without hint", () => {
    const s = derive(agent(), runtime(), [task("queued", QUEUED_HINT_AFTER_MS)]);
    expect(s).toMatchObject({ kind: "queued", tone: "ok", count: 1, showHint: false });
  });

  it("online · wartet > 2 min → hint with oldest wait time", () => {
    const s = derive(agent(), runtime(), [
      task("queued", 30_000),
      task("waiting_local_directory", 40 * MIN),
      task("dispatched", 3 * MIN),
    ]);
    expect(s).toMatchObject({ kind: "queued", count: 3, showHint: true, waitingForMs: 40 * MIN });
  });

  it("online · frei → idle, no hint; terminal snapshot rows are ignored", () => {
    const s = derive(agent(), runtime(), [task("completed"), task("failed"), task("cancelled")]);
    expect(s).toMatchObject({ kind: "idle", tone: "ok", showHint: false, count: 0 });
  });

  it("instabil · wartet/arbeitet → Verbindung verloren with minutes", () => {
    for (const t of [task("queued"), task("running")]) {
      const s = derive(agent(), offlineFor(3 * MIN), [t]);
      expect(s).toMatchObject({ kind: "connection_lost", tone: "warning", showHint: true, offlineForMs: 3 * MIN });
    }
  });

  it("instabil · frei → Verbindung verloren without hint", () => {
    const s = derive(agent(), offlineFor(MIN), []);
    expect(s).toMatchObject({ kind: "connection_lost", showHint: false });
  });

  it("offline · wartet → Hängt: Runtime offline (danger)", () => {
    const s = derive(agent(), offlineFor(2 * 60 * MIN, { custom_name: "devbox" }), [
      task("queued", 10 * MIN),
      task("queued", 20 * MIN),
    ]);
    expect(s).toMatchObject({
      kind: "stuck_offline",
      tone: "danger",
      count: 2,
      showHint: true,
      runtimeName: "devbox",
      offlineForMs: 2 * 60 * MIN,
    });
  });

  it("offline · arbeitet counts as stuck too (running task cannot report back)", () => {
    expect(derive(agent(), offlineFor(DAY), [task("running")]).kind).toBe("stuck_offline");
  });

  it("offline · frei → Nicht verfügbar", () => {
    expect(derive(agent(), offlineFor(DAY), [])).toMatchObject({ kind: "unavailable", tone: "muted", showHint: true });
  });

  it("no runtime bound → Keine Runtime", () => {
    expect(derive(agent({ runtime_id: "" }), null, [task("queued")])).toMatchObject({
      kind: "no_runtime",
      runtimeId: null,
      showHint: true,
    });
  });

  it("archived wins over every runtime/task signal", () => {
    const s = derive(agent({ archived_at: "2026-10-01T00:00:00Z" }), runtime(), [task("running")]);
    expect(s).toMatchObject({ kind: "archived", count: 0, runningCount: 0, showHint: false });
  });
});

describe("deriveAgentHangState — 5-minute and 6-day boundaries", () => {
  it("offline just under 5 min is instabil, exactly 5 min is offline", () => {
    expect(derive(agent(), offlineFor(5 * MIN - 1), [task("queued")]).kind).toBe("connection_lost");
    expect(derive(agent(), offlineFor(5 * MIN), [task("queued")]).kind).toBe("stuck_offline");
  });

  it("long offline (> 6 days) still reads as offline for the agent", () => {
    expect(derive(agent(), offlineFor(6 * DAY + 1), [task("queued")]).kind).toBe("stuck_offline");
    expect(derive(agent(), offlineFor(6 * DAY + 1), []).kind).toBe("unavailable");
  });
});

describe("deriveAgentHangState — robustness", () => {
  it("unknown runtime status and garbage timestamps do not throw", () => {
    const weird = runtime({ status: "degraded" as never, last_seen_at: "not-a-date" });
    const s = derive(agent(), weird, [task("mystery"), task("queued", 0, { created_at: "??" })]);
    expect(s.kind).toBe("stuck_offline");
    expect(s.offlineForMs).toBeNull();
    expect(s.waitingForMs).toBeNull();
  });

  it("runtime not visible falls back to the agent's runtime_availability", () => {
    const s = derive(agent({ runtime_availability: "unstable" }), null, [task("queued")]);
    expect(s).toMatchObject({ kind: "connection_lost", runtimeName: null, offlineForMs: null });
    expect(derive(agent({ runtime_availability: "online" }), null, [task("running")]).kind).toBe("working");
    expect(derive(agent(), null, [task("queued")]).kind).toBe("stuck_offline");
  });

  it("deferred tasks do not count as waiting (web parity)", () => {
    expect(derive(agent(), runtime(), [task("deferred", 10 * MIN)]).kind).toBe("idle");
  });
});

describe("describeAgentHangState", () => {
  const t = (key: string, o?: Record<string, unknown>) => `${key}${o ? JSON.stringify(o) : ""}`;
  const fmt = (ms: number) => `${Math.round(ms / MIN)}m`;

  it("stuck offline names runtime, count and duration", () => {
    const s = derive(agent(), offlineFor(120 * MIN), [task("queued"), task("queued")]);
    const d = describeAgentHangState(s, t, fmt);
    expect(d.label).toBe('workspace:agent_hang.label_stuck_offline{"count":2}');
    expect(d.hint).toBe('workspace:agent_hang.hint_stuck_offline{"count":2,"name":"claude (devbox-a)","since":"120m"}');
  });

  it("falls back to unknown variants when the runtime is not visible", () => {
    const s = derive(agent(), null, [task("queued")]);
    expect(describeAgentHangState(s, t, fmt).hint).toContain("hint_stuck_offline_unknown");
    const u = derive(agent({ runtime_availability: "unstable" }), null, [task("queued")]);
    expect(describeAgentHangState(u, t, fmt).hint).toBe("workspace:agent_hang.hint_connection_lost_unknown");
  });

  it("connection lost reports whole minutes, at least 1", () => {
    const s = derive(agent(), offlineFor(30_000), [task("running")]);
    expect(describeAgentHangState(s, t, fmt).hint).toBe('workspace:agent_hang.hint_connection_lost{"minutes":1}');
  });

  it("no hint where the matrix has none", () => {
    expect(describeAgentHangState(derive(agent(), runtime(), [task("running")]), t, fmt).hint).toBeNull();
  });

  const KINDS: AgentHangKind[] = [
    "working", "queued", "idle", "connection_lost", "stuck_offline", "unavailable", "no_runtime", "archived",
  ];
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every label and hint key`, () => {
      const keys = (file as unknown as { agent_hang: Record<string, string> }).agent_hang;
      for (const kind of KINDS) expect(keys[`label_${kind}`], `${lang} label_${kind}`).toBeTypeOf("string");
      for (const key of [
        "hint_queued", "hint_connection_lost", "hint_connection_lost_unknown", "hint_stuck_offline_other",
        "hint_stuck_offline_unknown_other", "hint_unavailable", "hint_no_runtime", "runtime_unknown",
      ]) {
        expect(keys[key], `${lang} ${key}`).toBeTypeOf("string");
      }
      const health = (file as unknown as { runtime_health: Record<string, string> }).runtime_health;
      for (const h of ["online", "recently_lost", "offline", "long_offline"]) expect(health[h]).toBeTypeOf("string");
    });
  }
});
