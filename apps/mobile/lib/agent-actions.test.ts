import { describe, expect, it } from "vitest";
import type { Agent, ChatSession } from "@multica/core/types";
import de from "../locales/de/workspace.json";
import en from "../locales/en/workspace.json";
import zh from "../locales/zh-Hans/workspace.json";
import chatDe from "../locales/de/chat.json";
import chatEn from "../locales/en/chat.json";
import chatZh from "../locales/zh-Hans/chat.json";
import { useNewIssueDraftStore } from "../data/stores/new-issue-draft-store";
import {
  AGENT_ACTION_BLOCK_KEY,
  agentActionBlock,
  agentAssigneeParam,
  agentChatHandover,
  latestSessionForAgent,
  parseAssigneeParam,
} from "./agent-actions";

const ME = "user-me";
const OTHER = "user-other";

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agt_1",
    name: "Agent",
    runtime_id: "rt_1",
    runtime_bound: true,
    archived_at: null,
    owner_id: ME,
    visibility: "private",
    permission_mode: "private",
    invocation_targets: [],
    ...overrides,
  } as Agent;
}

function session(id: string, overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id,
    workspace_id: "ws",
    agent_id: "agt_1",
    creator_id: ME,
    title: id,
    status: "active",
    has_unread: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

const member = { userId: ME, role: "member" as const };

describe("agentActionBlock", () => {
  it("allows the owner's bound agent", () => {
    expect(agentActionBlock(agent(), member)).toBeNull();
  });

  it("blocks an archived agent first", () => {
    expect(
      agentActionBlock(agent({ archived_at: "2026-10-01T00:00:00Z", runtime_id: "" }), member),
    ).toBe("archived");
  });

  it("blocks someone else's private agent (same rule as the assignee picker)", () => {
    expect(agentActionBlock(agent({ owner_id: OTHER }), { userId: ME, role: "admin" })).toBe(
      "no_access",
    );
  });

  it("allows a workspace-wide agent for members, not for non-members", () => {
    const shared = agent({
      owner_id: OTHER,
      visibility: "workspace",
      permission_mode: "public_to",
      invocation_targets: [{ target_type: "workspace", target_id: null }],
    } as Partial<Agent>);
    expect(agentActionBlock(shared, member)).toBeNull();
    expect(agentActionBlock(shared, { userId: ME, role: null })).toBe("no_access");
  });

  it("blocks an agent without runtime", () => {
    expect(agentActionBlock(agent({ runtime_id: "" }), member)).toBe("no_runtime");
    expect(agentActionBlock(agent({ runtime_bound: false }), member)).toBe("no_runtime");
  });

  it("has every reason text in de, en and zh", () => {
    for (const key of Object.values(AGENT_ACTION_BLOCK_KEY)) {
      const leaf = key.split(".").pop() as keyof typeof de.agent.actions;
      for (const loc of [de, en, zh]) expect(loc.agent.actions[leaf]).toBeTruthy();
    }
    for (const loc of [chatDe, chatEn, chatZh]) {
      expect(loc.agent_handover.new_chat).toBeTruthy();
      expect(loc.agent_handover.latest).toContain("{{name}}");
    }
  });
});

describe("assignee param", () => {
  it("round-trips an agent id", () => {
    expect(parseAssigneeParam(agentAssigneeParam("agt_1"))).toEqual({ type: "agent", id: "agt_1" });
  });

  it("ignores missing or malformed values", () => {
    expect(parseAssigneeParam(undefined)).toBeNull();
    expect(parseAssigneeParam("")).toBeNull();
    expect(parseAssigneeParam("squad:x")).toBeNull();
    expect(parseAssigneeParam("agent:")).toBeNull();
    expect(parseAssigneeParam("agent:a b")).toBeNull();
    expect(parseAssigneeParam(["member:u1", "agent:a"])).toEqual({ type: "member", id: "u1" });
  });
});

describe("new-issue draft start", () => {
  it("presets the assignee in the same write as the reset", () => {
    const store = useNewIssueDraftStore.getState();
    store.setPriority("high");
    store.start({ assignee: { type: "agent", id: "agt_1" } });
    const s = useNewIssueDraftStore.getState();
    expect(s.assignee).toEqual({ type: "agent", id: "agt_1" });
    expect(s.priority).toBe("none");
    expect(s.status).toBe("todo");
  });

  it("starts empty without a preset (opening via + after cancel)", () => {
    useNewIssueDraftStore.getState().start({ assignee: { type: "agent", id: "agt_1" } });
    useNewIssueDraftStore.getState().reset();
    useNewIssueDraftStore.getState().start();
    expect(useNewIssueDraftStore.getState().assignee).toBeNull();
  });
});

describe("latestSessionForAgent", () => {
  it("picks the most recently active non-archived session of that agent", () => {
    const sessions = [
      session("old", { updated_at: "2026-10-20T00:00:00Z" }),
      session("recent-msg", {
        updated_at: "2026-10-10T00:00:00Z",
        last_message: { content: "x", role: "assistant", created_at: "2026-10-22T00:00:00Z" },
      }),
      session("archived", { status: "archived", updated_at: "2026-10-23T00:00:00Z" }),
      session("other-agent", { agent_id: "agt_2", updated_at: "2026-10-23T00:00:00Z" }),
    ];
    expect(latestSessionForAgent(sessions, "agt_1")?.id).toBe("recent-msg");
  });

  it("returns null when the agent has no session", () => {
    expect(latestSessionForAgent([session("s", { agent_id: "agt_2" })], "agt_1")).toBeNull();
  });
});

describe("agentChatHandover", () => {
  const base = {
    agentId: "agt_1",
    loaded: true,
    availableAgentIds: ["agt_1"],
    sessions: [session("s1")],
  };

  it("waits for the lists, ignores a missing param", () => {
    expect(agentChatHandover({ ...base, loaded: false })).toEqual({ kind: "wait" });
    expect(agentChatHandover({ ...base, agentId: undefined })).toEqual({ kind: "ignore" });
  });

  it("opens the latest session, or a new chat without one", () => {
    expect(agentChatHandover(base)).toEqual({ kind: "open", agentId: "agt_1", sessionId: "s1" });
    expect(agentChatHandover({ ...base, sessions: [] })).toEqual({
      kind: "open",
      agentId: "agt_1",
      sessionId: null,
    });
  });

  it("ignores an agent the user cannot invoke", () => {
    expect(agentChatHandover({ ...base, availableAgentIds: [] })).toEqual({ kind: "ignore" });
  });

  it("is pure: the same input twice never asks for a second session", () => {
    const a = agentChatHandover({ ...base, sessions: [] });
    const b = agentChatHandover({ ...base, sessions: [] });
    expect(a).toEqual(b);
    expect(a.kind === "open" && a.sessionId).toBeNull();
  });
});
