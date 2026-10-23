import { describe, expect, it } from "vitest";
import type { Agent, AgentTask, RuntimeDevice } from "@multica/core/types";
import de from "../locales/de/workspace.json";
import en from "../locales/en/workspace.json";
import zh from "../locales/zh-Hans/workspace.json";
import { deriveAgentHangState, describeAgentHangState } from "./agent-hang-state";
import {
  agentHangStateFor,
  findStuckIssueAgent,
  hangRuntimeLinkId,
  showAgentHangLine,
} from "./agent-hang-notice";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const MIN = 60_000;

function agent(overrides: Partial<Agent> = {}): Agent {
  return { id: "ag-1", runtime_id: "rt-1", name: "planner", archived_at: null, ...overrides } as Agent;
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

const offline = (overrides: Partial<RuntimeDevice> = {}) =>
  runtime({ status: "offline", last_seen_at: new Date(NOW - 40 * MIN).toISOString(), ...overrides });

function task(status: string, overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: `t-${status}-${overrides.agent_id ?? "ag-1"}`,
    agent_id: "ag-1",
    runtime_id: "rt-1",
    issue_id: "is-1",
    status,
    created_at: new Date(NOW - 5 * MIN).toISOString(),
    ...overrides,
  } as AgentTask;
}

/** Minimal i18next stand-in over the real workspace.json (plural _one/_other). */
function translator(res: Record<string, unknown>) {
  return (key: string, o: Record<string, unknown> = {}) => {
    const path = key.replace(/^workspace:/, "").split(".");
    const leaf = path.pop()!;
    const node = path.reduce<Record<string, unknown>>((n, p) => n[p] as Record<string, unknown>, res);
    const count = o.count as number | undefined;
    const raw =
      (count !== undefined && (node[`${leaf}_${count === 1 ? "one" : "other"}`] ?? node[`${leaf}_other`])) ||
      node[leaf];
    if (typeof raw !== "string") throw new Error(`missing ${key}`);
    return raw.replace(/{{(\w+)}}/g, (_, k) => String(o[k]));
  };
}

const minutes = (ms: number) => `${Math.round(ms / MIN)} Min`;

describe("showAgentHangLine / hangRuntimeLinkId", () => {
  const derive = (a: Agent, r: RuntimeDevice | null, tasks: AgentTask[]) =>
    deriveAgentHangState({ agent: a, runtime: r, tasks, now: NOW });

  it("offline + wartend → line with runtime link", () => {
    const s = derive(agent(), offline(), [task("queued")]);
    expect(s.kind).toBe("stuck_offline");
    expect(showAgentHangLine(s)).toBe(true);
    expect(hangRuntimeLinkId(s)).toBe("rt-1");
  });

  it("alles ok → nothing (working, idle, fresh queue)", () => {
    expect(showAgentHangLine(derive(agent(), runtime(), [task("running")]))).toBe(false);
    expect(showAgentHangLine(derive(agent(), runtime(), []))).toBe(false);
    expect(showAgentHangLine(derive(agent(), runtime(), [task("queued", { created_at: new Date(NOW - MIN).toISOString() })]))).toBe(false);
  });

  it("archived → nothing, the header already says so", () => {
    expect(showAgentHangLine(derive(agent({ archived_at: "2026-10-01T00:00:00Z" }), offline(), [task("queued")]))).toBe(false);
  });

  it("no runtime → hint without link; offline idle → hint with link", () => {
    const none = derive(agent({ runtime_id: "" }), null, []);
    expect(showAgentHangLine(none)).toBe(true);
    expect(hangRuntimeLinkId(none)).toBeNull();
    const idle = derive(agent(), offline(), []);
    expect(idle.kind).toBe("unavailable");
    expect(showAgentHangLine(idle)).toBe(true);
    expect(hangRuntimeLinkId(idle)).toBe("rt-1");
  });
});

describe("agentHangStateFor (agent detail, picker)", () => {
  it("uses only this agent's snapshot rows", () => {
    const s = agentHangStateFor({
      agentId: "ag-1",
      agents: [agent(), agent({ id: "ag-2" })],
      runtimes: [offline()],
      snapshot: [task("queued", { agent_id: "ag-2" })],
      now: NOW,
    });
    expect(s?.kind).toBe("unavailable");
  });

  it("null while lists are missing or the agent is unknown", () => {
    expect(agentHangStateFor({ agentId: "ag-1", agents: undefined, runtimes: [], snapshot: [], now: NOW })).toBeNull();
    expect(agentHangStateFor({ agentId: "x", agents: [agent()], runtimes: [], snapshot: [], now: NOW })).toBeNull();
  });
});

describe("findStuckIssueAgent (issue detail banner)", () => {
  it("offline + wartend on this issue → that agent", () => {
    const hit = findStuckIssueAgent({
      activeTasks: [task("running", { agent_id: "ag-2" }), task("queued")],
      agents: [agent(), agent({ id: "ag-2", runtime_id: "rt-2" })],
      runtimes: [offline(), runtime({ id: "rt-2" })],
      now: NOW,
    });
    expect(hit?.agent.id).toBe("ag-1");
    expect(hit?.state).toMatchObject({ kind: "stuck_offline", runtimeId: "rt-1", count: 1 });
  });

  it("online runtime, no active task or unknown lists → no banner", () => {
    const base = { agents: [agent()], runtimes: [runtime()], now: NOW };
    expect(findStuckIssueAgent({ ...base, activeTasks: [task("queued")] })).toBeNull();
    expect(findStuckIssueAgent({ ...base, runtimes: [offline()], activeTasks: [] })).toBeNull();
    expect(findStuckIssueAgent({ activeTasks: [task("queued")], agents: undefined, runtimes: [offline()], now: NOW })).toBeNull();
  });
});

describe("texts — „Hängt: Runtime offline“ with runtime link in de/en/zh", () => {
  const stuck = deriveAgentHangState({ agent: agent(), runtime: offline(), tasks: [task("queued")], now: NOW });

  it("de label and hint", () => {
    const t = translator(de);
    const text = describeAgentHangState(stuck, t, minutes);
    expect(text.label).toBe("Hängt: Runtime offline");
    expect(text.hint).toBe("1 Aufgabe wartet auf Runtime claude (devbox-a), offline seit 40 Min.");
    expect(t("workspace:agent_hang.view_runtime")).toBe("Runtime ansehen");
    expect(t("workspace:agent_hang.with_agent", { name: "planner", label: text.label })).toBe(
      "planner · Hängt: Runtime offline",
    );
  });

  it("en and zh have the new keys", () => {
    for (const res of [en, zh]) {
      const t = translator(res);
      expect(t("workspace:agent_hang.view_runtime")).not.toBe("");
      expect(t("workspace:agent_hang.with_agent", { name: "a", label: "b" })).toContain("a");
    }
    expect(describeAgentHangState(stuck, translator(en), minutes).label).toBe("Stuck: runtime offline");
  });
});
