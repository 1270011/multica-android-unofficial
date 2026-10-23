import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "./api";
import { EMPTY_AUTOPILOT_LIST, EMPTY_AUTOPILOT_RUN_LIST } from "./autopilot-schemas";

/**
 * GET/POST/PATCH/DELETE contract of the 7 autopilot methods: path, method and body per endpoint, plus one malformed-body
 * case each. Fixtures are hand-written after packages/core/types/autopilot.ts
 * and server/internal/handler/autopilot.go; they pin how this client reacts,
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
    headers: init.headers as Record<string, string>,
  };
}

const autopilot = {
  id: "ap-1",
  workspace_id: "ws-1",
  title: "Nachtlauf Regression",
  description: null,
  project_id: null,
  assignee_type: "agent",
  assignee_id: "a-1",
  status: "active",
  pause_reason: null,
  execution_mode: "create_issue",
  issue_title_template: "Nachtlauf {{date}}",
  created_by_type: "member",
  created_by_id: "u-1",
  last_run_at: "2026-10-17T02:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  trigger_kinds: ["schedule"],
  next_run_at: "2026-10-18T02:00:00Z",
  last_run_status: "completed",
  subscribers: [],
  can_write: true,
};

const run = {
  id: "r-1",
  autopilot_id: "ap-1",
  trigger_id: null,
  source: "manual",
  status: "issue_created",
  issue_id: "i-1",
  task_id: null,
  triggered_at: "2026-10-17T10:00:00Z",
  completed_at: null,
  failure_reason: null,
  trigger_payload: null,
  result: null,
  created_at: "2026-10-17T10:00:00Z",
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

describe("autopilots: reads", () => {
  it("listAutopilots GETs /api/autopilots, optional ?status=", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ autopilots: [autopilot], total: 1 }));
    const all = await api.listAutopilots();
    expect(lastCall()).toMatchObject({ url: `${BASE}/api/autopilots`, method: "GET", body: undefined });
    expect(all.autopilots.map((a) => a.id)).toEqual(["ap-1"]);
    expect(all.total).toBe(1);

    await api.listAutopilots({ status: "paused" });
    expect(lastCall().url).toBe(`${BASE}/api/autopilots?status=paused`);
  });

  it("listAutopilots: malformed body → empty list, bad row dropped", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "nope" }));
    expect(await api.listAutopilots()).toEqual(EMPTY_AUTOPILOT_LIST);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ autopilots: [autopilot, { title: "ohne id" }, 42], total: 3 }),
    );
    expect((await api.listAutopilots()).autopilots.map((a) => a.id)).toEqual(["ap-1"]);
  });

  it("getAutopilot GETs /api/autopilots/{id} with triggers and collaborators", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        autopilot,
        triggers: [
          {
            id: "t-1",
            autopilot_id: "ap-1",
            kind: "schedule",
            enabled: true,
            cron_expression: "0 2 * * *",
            timezone: "Europe/Berlin",
            next_run_at: null,
            webhook_token: null,
            label: null,
            last_fired_at: null,
            created_at: "",
            updated_at: "",
          },
        ],
        collaborators: [{ user_type: "member", user_id: "u-2", granted_by: "u-1", created_at: "" }],
      }),
    );
    const res = await api.getAutopilot("ap/1");
    expect(lastCall()).toMatchObject({ url: `${BASE}/api/autopilots/ap%2F1`, method: "GET" });
    expect(res?.autopilot.id).toBe("ap-1");
    expect(res?.triggers[0]).toMatchObject({ kind: "schedule", cron_expression: "0 2 * * *" });
    expect(res?.collaborators.map((c) => c.user_id)).toEqual(["u-2"]);
  });

  it("getAutopilot: malformed body → null", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ triggers: [] }));
    expect(await api.getAutopilot("ap-1")).toBeNull();
    fetchMock.mockResolvedValueOnce(jsonResponse("garbage"));
    expect(await api.getAutopilot("ap-1")).toBeNull();
  });

  it("listAutopilotRuns GETs …/runs with limit=20&offset=0 by default", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ runs: [run], total: 1 }));
    const res = await api.listAutopilotRuns("ap-1");
    expect(lastCall()).toMatchObject({
      url: `${BASE}/api/autopilots/ap-1/runs?limit=20&offset=0`,
      method: "GET",
    });
    expect(res.runs[0]).toMatchObject({ id: "r-1", status: "issue_created", source: "manual" });

    await api.listAutopilotRuns("ap-1", { limit: 20, offset: 40 });
    expect(lastCall().url).toBe(`${BASE}/api/autopilots/ap-1/runs?limit=20&offset=40`);
  });

  it("listAutopilotRuns: malformed body → empty list, bad row dropped", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null));
    expect(await api.listAutopilotRuns("ap-1")).toEqual(EMPTY_AUTOPILOT_RUN_LIST);
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [run, { status: "failed" }], total: 2 }));
    expect((await api.listAutopilotRuns("ap-1")).runs.map((r) => r.id)).toEqual(["r-1"]);
  });

  it("getAutopilotRun GETs …/runs/{runId} incl. payload", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...run, trigger_payload: { event: "push" }, result: { ok: true } }),
    );
    const res = await api.getAutopilotRun("ap-1", "r 1");
    expect(lastCall()).toMatchObject({ url: `${BASE}/api/autopilots/ap-1/runs/r%201`, method: "GET" });
    expect(res).toMatchObject({ trigger_payload: { event: "push" }, result: { ok: true } });
  });

  it("getAutopilotRun: malformed body → null", async () => {
    fetchMock.mockResolvedValue(jsonResponse([run]));
    expect(await api.getAutopilotRun("ap-1", "r-1")).toBeNull();
  });
});

describe("autopilots: writes", () => {
  it("triggerAutopilot POSTs …/trigger without body, with an Idempotency-Key", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(run));
    const res = await api.triggerAutopilot("ap-1");
    const call = lastCall();
    expect(call).toMatchObject({ url: `${BASE}/api/autopilots/ap-1/trigger`, method: "POST", body: undefined });
    expect(call.headers["Idempotency-Key"]).toMatch(/^mobile-\w+$/);
    expect(res?.status).toBe("issue_created");

    await api.triggerAutopilot("ap-1", { idempotencyKey: "retry-1" });
    expect(lastCall().headers["Idempotency-Key"]).toBe("retry-1");
  });

  it("triggerAutopilot: skipped run is returned as skipped with reason_code", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...run, status: "skipped", issue_id: null, reason_code: "runtime_offline" }),
    );
    const res = await api.triggerAutopilot("ap-1");
    expect(res).toMatchObject({ status: "skipped", raw_status: "skipped", reason_code: "runtime_offline" });
  });

  it("triggerAutopilot: malformed body → null; 429 quota → ApiError", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    expect(await api.triggerAutopilot("ap-1")).toBeNull();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "quota reached" }, 429));
    await expect(api.triggerAutopilot("ap-1")).rejects.toMatchObject({ status: 429 });
  });

  it("setAutopilotStatus PATCHes {status}", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...autopilot, status: "paused" }));
    const res = await api.setAutopilotStatus("ap-1", "paused");
    expect(lastCall()).toMatchObject({
      url: `${BASE}/api/autopilots/ap-1`,
      method: "PATCH",
      body: { status: "paused" },
    });
    expect(res?.status).toBe("paused");
  });

  it("setAutopilotStatus: malformed body → null; 4xx → ApiError", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    expect(await api.setAutopilotStatus("ap-1", "active")).toBeNull();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "forbidden" }, 403));
    await expect(api.setAutopilotStatus("ap-1", "active")).rejects.toBeInstanceOf(ApiError);
  });

  it("deleteAutopilot DELETEs /api/autopilots/{id}", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteAutopilot("ap-1")).resolves.toBeUndefined();
    expect(lastCall()).toMatchObject({ url: `${BASE}/api/autopilots/ap-1`, method: "DELETE", body: undefined });
  });

  it("deleteAutopilot: 404 → ApiError (delete waits for the server)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "autopilot not found" }, 404));
    await expect(api.deleteAutopilot("ap-1")).rejects.toMatchObject({ status: 404 });
  });
});
