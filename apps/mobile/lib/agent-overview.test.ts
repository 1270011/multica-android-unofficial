import { describe, expect, it } from "vitest";
import type { AgentTask, SquadMember, SquadMemberStatus } from "@multica/core/types";
import type { AgentPresenceDetail } from "@multica/core/agents";
import de from "../locales/de/workspace.json";
import en from "../locales/en/workspace.json";
import zh from "../locales/zh-Hans/workspace.json";
import navDe from "../locales/de/navigation.json";
import navEn from "../locales/en/navigation.json";
import navZh from "../locales/zh-Hans/navigation.json";
import {
  agentRuntimeLabel,
  agentStatus,
  lastRunByAgent,
  runSource,
  squadMemberRows,
  visibleAgents,
  runsSectionState,
  SQUAD_ROW_MIN_DP,
} from "./agent-overview";

const presence = (p: Partial<AgentPresenceDetail>): AgentPresenceDetail => ({
  availability: "online",
  workload: "idle",
  runningCount: 0,
  queuedCount: 0,
  capacity: 1,
  ...p,
});
const agent = { archived_at: null, runtime_bound: true };

describe("agentStatus", () => {
  it("archived wins over everything", () => {
    expect(agentStatus({ archived_at: "2026-10-01", runtime_bound: true }, presence({ runningCount: 2 })).key).toBe("archived");
  });

  it("no runtime before workload and availability", () => {
    expect(agentStatus({ archived_at: null, runtime_bound: false }, presence({})).key).toBe("no_runtime");
    // Older backends omit runtime_bound: not treated as "no runtime".
    expect(agentStatus({ archived_at: null }, presence({})).key).toBe("online");
  });

  it("working, then queued, with counts", () => {
    expect(agentStatus(agent, presence({ runningCount: 2, queuedCount: 1 }))).toEqual({ key: "working", running: 2, queued: 1 });
    expect(agentStatus(agent, presence({ queuedCount: 3 }))).toEqual({ key: "queued", running: 0, queued: 3 });
  });

  it("falls back to the three-state availability; unknown presence = offline", () => {
    expect(agentStatus(agent, presence({ availability: "unstable" })).key).toBe("unstable");
    expect(agentStatus(agent, presence({ availability: "offline" })).key).toBe("offline");
    expect(agentStatus(agent, undefined).key).toBe("offline");
  });
});

describe("agentRuntimeLabel", () => {
  const runtimes = [
    { id: "r1", name: "claude-laptop", custom_name: null },
    { id: "r2", name: "codex", custom_name: "  Build box " },
  ];
  it("names the runtime, custom name first", () => {
    expect(agentRuntimeLabel({ runtime_id: "r1", runtime_bound: true }, runtimes)).toEqual({ kind: "named", name: "claude-laptop" });
    expect(agentRuntimeLabel({ runtime_id: "r2" }, runtimes)).toEqual({ kind: "named", name: "Build box" });
  });
  it("hidden when bound to a runtime the member cannot see, none when unbound", () => {
    expect(agentRuntimeLabel({ runtime_id: "r9", runtime_bound: true }, runtimes)).toEqual({ kind: "hidden" });
    expect(agentRuntimeLabel({ runtime_id: "", runtime_bound: false }, runtimes)).toEqual({ kind: "none" });
  });
});

const task = (o: Partial<AgentTask>): AgentTask =>
  ({ id: "t", agent_id: "a1", status: "completed", issue_id: "", created_at: "2026-10-16T01:00:00Z", started_at: null, completed_at: null, ...o }) as AgentTask;

describe("lastRunByAgent", () => {
  it("keeps the newest finished run per agent and ignores active ones", () => {
    const map = lastRunByAgent([
      task({ id: "old", completed_at: "2026-10-16T01:00:00Z" }),
      task({ id: "new", status: "failed", completed_at: "2026-10-16T03:00:00Z" }),
      task({ id: "running", status: "running", created_at: "2026-10-16T04:00:00Z" }),
      task({ id: "other", agent_id: "a2", status: "cancelled", created_at: "2026-10-15T00:00:00Z" }),
    ]);
    expect(map.get("a1")?.id).toBe("new");
    expect(map.get("a2")?.id).toBe("other");
    expect(lastRunByAgent([task({ status: "queued" })]).size).toBe(0);
  });
});

describe("runSource / visibleAgents", () => {
  it("tells issue, chat and autopilot runs apart", () => {
    expect(runSource({ issue_id: "i1" })).toBe("issue");
    expect(runSource({ issue_id: "", chat_session_id: "c1" })).toBe("chat");
    expect(runSource({ issue_id: "", autopilot_run_id: "p1" })).toBe("autopilot");
    expect(runSource({ issue_id: "" })).toBe("other");
  });
  it("lists active agents by name, hides archived", () => {
    const list = visibleAgents([
      { name: "Zed", archived_at: null },
      { name: "alpha", archived_at: null },
      { name: "Gone", archived_at: "2026-10-01" },
    ]);
    expect(list.map((a) => a.name)).toEqual(["alpha", "Zed"]);
  });
});

describe("squadMemberRows", () => {
  const m = (id: string, type: SquadMember["member_type"], role = ""): SquadMember =>
    ({ id: `m-${id}`, squad_id: "s", member_type: type, member_id: id, role, created_at: "" }) as SquadMember;
  const st = (id: string, type: SquadMember["member_type"], status: SquadMemberStatus["status"], issues = 0): SquadMemberStatus => ({
    member_type: type,
    member_id: id,
    status,
    active_issues: Array.from({ length: issues }, (_, i) => ({ issue_id: `i${i}`, identifier: `MUL-${i}`, title: "t" }) as never),
    last_active_at: null,
  });

  it("puts the leader first, then agents, then humans, and joins the status", () => {
    const rows = squadMemberRows(
      [m("human", "member", "PM"), m("bot2", "agent"), m("lead", "agent")],
      [st("bot2", "agent", "working", 2), st("lead", "agent", "idle"), st("human", "member", null)],
      "lead",
    );
    expect(rows.map((r) => r.id)).toEqual(["lead", "bot2", "human"]);
    expect(rows[0]).toMatchObject({ isLeader: true, status: "idle" });
    expect(rows[1].activeIssues).toHaveLength(2);
    expect(rows[2]).toMatchObject({ status: null, role: "PM" });
  });

  it("works before the status call answered", () => {
    expect(squadMemberRows([m("a", "agent")], [], "")[0]).toMatchObject({ status: null, activeIssues: [] });
  });
});

describe("agents strings", () => {
  const KEYS = ["tab_agents", "tab_squads", "overview", "recent_runs", "runs_error", "runs_forbidden", "runtime_hidden", "runtime_none", "last_run", "last_run_none", "members", "leader", "not_found"];
  const STATUS = ["archived", "no_runtime", "working_other", "queued_other", "online", "unstable", "offline"];
  const MEMBER = ["working", "idle", "unstable", "offline", "archived"];
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every agents key`, () => {
      const a = (file as unknown as { agent: Record<string, unknown> & { status: Record<string, string>; member_status: Record<string, string> } }).agent;
      for (const k of KEYS) expect(a[k], `${lang}:${k}`).toBeTypeOf("string");
      for (const k of STATUS) expect(a.status[k], `${lang}:status.${k}`).toBeTypeOf("string");
      for (const k of MEMBER) expect(a.member_status[k], `${lang}:member_status.${k}`).toBeTypeOf("string");
      expect(a).not.toHaveProperty("coming_soon");
    });
  }
});

// Smoke test H1-1: the More menu needs its own "Agents" entry.
describe("More menu entry", () => {
  for (const [lang, file] of Object.entries({ de: navDe, en: navEn, "zh-Hans": navZh })) {
    it(`${lang} labels the Agents entry`, () => {
      expect((file as { more_menu: Record<string, string> }).more_menu.agents).toBeTypeOf("string");
    });
  }
});

describe("runsSectionState", () => {
  const none = { hasData: false, count: 0 };
  it("a failed first load is an error state, not \"no runs yet\"", () => {
    expect(runsSectionState({ ...none, isLoading: false, error: new Error("network") })).toBe("error");
    expect(runsSectionState({ ...none, isLoading: false, error: { status: 403 } })).toBe("forbidden");
    expect(runsSectionState({ ...none, isLoading: false, error: { status: 500 } })).toBe("error");
  });
  it("a failed refetch keeps the runs on screen", () => {
    expect(runsSectionState({ isLoading: false, error: new Error("blip"), hasData: true, count: 3 })).toBe("list");
    expect(runsSectionState({ isLoading: false, error: { status: 403 }, hasData: true, count: 0 })).toBe("empty");
  });
  it("loading, empty and list", () => {
    expect(runsSectionState({ ...none, isLoading: true, error: null })).toBe("loading");
    expect(runsSectionState({ isLoading: false, error: null, hasData: true, count: 0 })).toBe("empty");
    expect(runsSectionState({ isLoading: false, error: null, hasData: true, count: 3 })).toBe("list");
  });
  it("squad rows are at least 44 dp", () => {
    expect(SQUAD_ROW_MIN_DP).toBeGreaterThanOrEqual(44);
  });
});
