import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "./api";
import { EMPTY_WORKSPACE_WAKEUP_PAGE } from "./wakeup-schemas";

/**
 * GET/POST/PATCH/PUT/DELETE contract of the 13 issue-wakeup methods:
 * path, method and body per endpoint, plus one
 * malformed-body case each. Fixtures are hand-written after
 * packages/core/types/issue-wakeup.ts; they pin how this client reacts,
 * they do not run server code.
 */

// See api.test.ts: stub the native-backed stores the client reads per request.
vi.mock("@/data/server-config-store", () => ({
  getServerBaseUrl: () => "https://api.example.test",
  getCfAccessHeaders: () => ({}),
}));
vi.mock("@/lib/client-os", () => ({ CLIENT_OS: "android" }));
vi.mock("@/data/workspace-store", () => ({ getCurrentSlug: () => "ws" }));

const BASE = "https://api.example.test";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url,
    method: init.method ?? "GET",
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  };
}

const wakeup = {
  id: "w-1",
  issue_id: "i-1",
  agent_id: "a-1",
  agent_name: "dev",
  instruction: "Prüfe CI",
  kind: "event",
  mode: "once",
  event_types: ["comment.created"],
  filter_agent_id: null,
  filter_task_id: null,
  interval_seconds: null,
  cron_expression: null,
  timezone: "UTC",
  next_fire_at: null,
  enabled: true,
  revision: 3,
  disabled_at: null,
  last_task_id: null,
  last_error: null,
};

const systemRule = {
  id: "s-1",
  revision: 1,
  rule: "child_done",
  enabled: true,
  instruction: "",
  default_instruction: "Prüfe die Kinder",
  customized: false,
  paused_reason: null,
  staged: false,
  stage: null,
  total: 2,
  remaining: 1,
  waiting: ["MUL-2"],
  target: { type: "agent", id: "a-1", name: "dev" },
  blocked: "",
  workspace_default: true,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("issue wakeups: reads", () => {
  it("listIssueWakeups GETs the issue's rules", async () => {
    fetchMock.mockResolvedValue(jsonResponse([wakeup]));
    const res = await api.listIssueWakeups("i/1");
    expect(lastCall()).toMatchObject({ url: `${BASE}/api/issues/i%2F1/wakeups`, method: "GET" });
    expect(res.map((w) => w.id)).toEqual(["w-1"]);
  });

  it("listIssueWakeups: malformed body → empty list, bad row dropped", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "nope" }));
    expect(await api.listIssueWakeups("i-1")).toEqual([]);
    fetchMock.mockResolvedValueOnce(jsonResponse([wakeup, { kind: "at" }, 42]));
    expect((await api.listIssueWakeups("i-1")).map((w) => w.id)).toEqual(["w-1"]);
  });

  it("listIssueWakeupRuns GETs …/runs", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ id: "r-1", status: "completed", created_at: "2026-10-17T10:00:00Z", started_at: null, completed_at: null }]),
    );
    const res = await api.listIssueWakeupRuns("i-1", "w-1");
    expect(lastCall()).toMatchObject({ url: `${BASE}/api/issues/i-1/wakeups/w-1/runs`, method: "GET" });
    expect(res[0]).toMatchObject({ id: "r-1", checkin_note: "", triggers: [], commented: false });
  });

  it("listIssueWakeupRuns: malformed body → empty list", async () => {
    fetchMock.mockResolvedValue(jsonResponse("garbage"));
    expect(await api.listIssueWakeupRuns("i-1", "w-1")).toEqual([]);
  });

  it("listIssueWakeupSummaries GETs /api/issue-wakeup-summaries", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ ...wakeup, active_count: 2, event_count: 1 }]),
    );
    const res = await api.listIssueWakeupSummaries();
    expect(lastCall()).toMatchObject({ url: `${BASE}/api/issue-wakeup-summaries`, method: "GET" });
    expect(res[0]).toMatchObject({ issue_id: "i-1", active_count: 2, event_count: 1 });
  });

  it("listIssueWakeupSummaries: malformed body → empty list", async () => {
    fetchMock.mockResolvedValue(jsonResponse(null));
    expect(await api.listIssueWakeupSummaries()).toEqual([]);
  });

  it("listWorkspaceWakeups sends every filter, defaults included", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [{ ...wakeup, issue_title: "T", issue_identifier: "MUL-1", issue_closed: false, can_manage: true, active_runs: 0, task: null }],
        total: 1,
        counts: { active: 1, all: 1, paused: 0, disabled: 0, ended: 0 },
        agents: [{ id: "a-1", name: "dev" }],
      }),
    );
    const res = await api.listWorkspaceWakeups({ scope: "paused", search: "ci & cd", offset: 50 });
    const url = new URL(lastCall().url);
    expect(url.pathname).toBe("/api/issue-wakeups");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scope: "paused",
      kind: "all",
      source: "",
      search: "ci & cd",
      agent_id: "",
      offset: "50",
      limit: "50",
    });
    expect(res.items[0]).toMatchObject({ issue_identifier: "MUL-1", source: "member", runs_7d: 0 });
    expect(res.counts.active).toBe(1);
  });

  it("listWorkspaceWakeups: malformed body → empty page", async () => {
    fetchMock.mockResolvedValue(jsonResponse([1, 2, 3]));
    expect(await api.listWorkspaceWakeups()).toEqual(EMPTY_WORKSPACE_WAKEUP_PAGE);
  });

  it("listPausedWakeups GETs /api/issue-wakeup-paused", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ issue_id: "i-1", id: "w-1", agent_id: "a-1", paused_reason: "loop" }]),
    );
    const res = await api.listPausedWakeups();
    expect(lastCall()).toMatchObject({ url: `${BASE}/api/issue-wakeup-paused`, method: "GET" });
    expect(res[0]?.paused_reason).toBe("loop");
  });

  it("listPausedWakeups: malformed body → empty list", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: "x" }));
    expect(await api.listPausedWakeups()).toEqual([]);
  });

  it("listIssueSystemWakeups GETs …/system-wakeups", async () => {
    fetchMock.mockResolvedValue(jsonResponse([systemRule]));
    const res = await api.listIssueSystemWakeups("i-1");
    expect(lastCall()).toMatchObject({ url: `${BASE}/api/issues/i-1/system-wakeups`, method: "GET" });
    expect(res[0]).toMatchObject({ rule: "child_done", remaining: 1 });
  });

  it("listIssueSystemWakeups: malformed body → empty list", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rule: "child_done" }));
    expect(await api.listIssueSystemWakeups("i-1")).toEqual([]);
  });
});

describe("issue wakeups: writes", () => {
  it("createIssueWakeup POSTs the input and returns the stored rule", async () => {
    fetchMock.mockResolvedValue(jsonResponse(wakeup, 201));
    const input = {
      agent_id: "a-1",
      instruction: "Prüfe CI",
      kind: "event" as const,
      event_types: ["comment.created"],
      expires_in_seconds: 3600,
      on_timeout: "wake" as const,
    };
    const res = await api.createIssueWakeup("i-1", input);
    expect(lastCall()).toEqual({ url: `${BASE}/api/issues/i-1/wakeups`, method: "POST", body: input });
    expect(res?.id).toBe("w-1");
  });

  it("createIssueWakeup: malformed body → null, not a half rule", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }, 201));
    expect(await api.createIssueWakeup("i-1", { agent_id: "a", instruction: "", kind: "at" })).toBeNull();
  });

  it("createIssueWakeup surfaces a capacity 409 as ApiError", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "too many active wakeups" }, 409));
    await expect(
      api.createIssueWakeup("i-1", { agent_id: "a", instruction: "", kind: "at" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      api.createIssueWakeup("i-1", { agent_id: "a", instruction: "", kind: "at" }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("disableIssueWakeup POSTs …/disable without body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...wakeup, enabled: false }));
    const res = await api.disableIssueWakeup("i-1", "w-1");
    expect(lastCall()).toEqual({ url: `${BASE}/api/issues/i-1/wakeups/w-1/disable`, method: "POST", body: undefined });
    expect(res?.enabled).toBe(false);
  });

  it("disableIssueWakeup: malformed body → null", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    expect(await api.disableIssueWakeup("i-1", "w-1")).toBeNull();
  });

  it("enableIssueWakeup POSTs revision, at and rearm", async () => {
    fetchMock.mockResolvedValue(jsonResponse(wakeup));
    const input = { revision: 3, at: "2026-10-18T08:00:00Z", rearm: true };
    const res = await api.enableIssueWakeup("i-1", "w-1", input);
    expect(lastCall()).toEqual({ url: `${BASE}/api/issues/i-1/wakeups/w-1/enable`, method: "POST", body: input });
    expect(res?.enabled).toBe(true);
  });

  it("enableIssueWakeup: malformed body → null", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 7 }));
    expect(await api.enableIssueWakeup("i-1", "w-1", { revision: 1 })).toBeNull();
  });

  it("editIssueWakeupInstruction PATCHes …/instruction", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const input = { instruction: "neu", expected_instruction: "alt", revision: 3 };
    await expect(api.editIssueWakeupInstruction("i-1", "w-1", input)).resolves.toBeUndefined();
    expect(lastCall()).toEqual({ url: `${BASE}/api/issues/i-1/wakeups/w-1/instruction`, method: "PATCH", body: input });
  });

  it("editIssueWakeupInstruction: unexpected body is ignored, 409 throws", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ surprise: [1] }));
    await expect(
      api.editIssueWakeupInstruction("i-1", "w-1", { instruction: "", expected_instruction: "", revision: 1 }),
    ).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "changed" }, 409));
    await expect(
      api.editIssueWakeupInstruction("i-1", "w-1", { instruction: "", expected_instruction: "", revision: 1 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("triggerIssueWakeup POSTs …/trigger", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.triggerIssueWakeup("i-1", "w-1")).resolves.toBeUndefined();
    expect(lastCall()).toEqual({ url: `${BASE}/api/issues/i-1/wakeups/w-1/trigger`, method: "POST", body: undefined });
  });

  it("triggerIssueWakeup: unexpected body is ignored", async () => {
    fetchMock.mockResolvedValue(jsonResponse("not-a-204"));
    await expect(api.triggerIssueWakeup("i-1", "w-1")).resolves.toBeUndefined();
  });

  it("deleteIssueWakeup DELETEs the rule", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteIssueWakeup("i-1", "w-1")).resolves.toBeUndefined();
    expect(lastCall()).toEqual({ url: `${BASE}/api/issues/i-1/wakeups/w-1`, method: "DELETE", body: undefined });
  });

  it("deleteIssueWakeup: unexpected body is ignored", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: "yes" }));
    await expect(api.deleteIssueWakeup("i-1", "w-1")).resolves.toBeUndefined();
  });

  it("updateIssueSystemWakeup PUTs enabled/instruction and returns the rules", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ ...systemRule, enabled: false }]));
    const res = await api.updateIssueSystemWakeup("i-1", "child_done", { enabled: false });
    expect(lastCall()).toEqual({
      url: `${BASE}/api/issues/i-1/system-wakeups/child_done`,
      method: "PUT",
      body: { enabled: false },
    });
    expect(res[0]?.enabled).toBe(false);
  });

  it("updateIssueSystemWakeup: malformed body → empty list", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ updated: true }));
    expect(await api.updateIssueSystemWakeup("i-1", "child_done", { instruction: "x" })).toEqual([]);
  });
});
