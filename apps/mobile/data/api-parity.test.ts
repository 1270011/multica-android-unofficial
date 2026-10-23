import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "./api";
import { EMPTY_ISSUE_FALLBACK } from "./schemas";

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

const issue = { ...EMPTY_ISSUE_FALLBACK, id: "i-2", title: "Original", status: "todo" };
const session = { id: "s-1", title: "Neu", status: "active", pinned: true };

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

describe("issue writes", () => {
  it("moveIssue posts status and neighbours to /move", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...issue, status: "done" }));
    const res = await api.moveIssue("i-1", {
      status: "done",
      before_id: "a",
      after_id: null,
    });
    expect(lastCall()).toEqual({
      url: `${BASE}/api/issues/i-1/move`,
      method: "POST",
      body: { status: "done", before_id: "a", after_id: null },
    });
    expect(res.status).toBe("done");
  });

  it("batchUpdateIssues sends ids and updates", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ updated: 2 }));
    const res = await api.batchUpdateIssues(["a", "b"], { priority: "high" });
    expect(lastCall()).toEqual({
      url: `${BASE}/api/issues/batch-update`,
      method: "POST",
      body: { issue_ids: ["a", "b"], updates: { priority: "high" } },
    });
    expect(res).toEqual({ updated: 2 });
  });

  it("batchDeleteIssues degrades a drifted count to 0", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: "two" }));
    const res = await api.batchDeleteIssues(["a"]);
    expect(lastCall().body).toEqual({ issue_ids: ["a"] });
    expect(res).toEqual({ deleted: 0 });
  });

  it("listIssueDuplicates parses both sides and falls back on drift", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ duplicate_of: null, duplicates: [issue] }),
    );
    const ok = await api.listIssueDuplicates("i-1");
    expect(lastCall().url).toBe(`${BASE}/api/issues/i-1/duplicates`);
    expect(ok.duplicates.map((d) => d.id)).toEqual(["i-2"]);

    fetchMock.mockResolvedValueOnce(jsonResponse("nope"));
    expect(await api.listIssueDuplicates("i-1")).toEqual({
      duplicate_of: null,
      duplicates: [],
    });
  });
});

describe("custom properties", () => {
  it("listProperties treats a 404 (old server) as an empty catalog", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "not found" }, 404));
    const res = await api.listProperties();
    expect(res.properties).toEqual([]);
  });

  it("listProperties rethrows other errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "boom" }, 500));
    await expect(api.listProperties()).rejects.toBeInstanceOf(ApiError);
  });

  it("listProperties asks for archived definitions only on request", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ properties: [] }));
    await api.listProperties({ includeArchived: true });
    expect(lastCall().url).toBe(`${BASE}/api/properties?include_archived=true`);
  });

  it("setIssueProperty PUTs the value; unset DELETEs", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ properties: { p1: "x" } }));
    const res = await api.setIssueProperty("i-1", "p1", "x");
    expect(lastCall()).toEqual({
      url: `${BASE}/api/issues/i-1/properties/p1`,
      method: "PUT",
      body: { value: "x" },
    });
    expect(res.properties).toEqual({ p1: "x" });

    fetchMock.mockResolvedValue(jsonResponse({ properties: {} }));
    await api.unsetIssueProperty("i-1", "p1");
    expect(lastCall()).toMatchObject({
      url: `${BASE}/api/issues/i-1/properties/p1`,
      method: "DELETE",
    });
  });
});

describe("pins", () => {
  it("listPins opts in to view pins and keeps their type", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ id: "p-1", item_type: "view", item_id: "v-1", position: 1 }]),
    );
    const res = await api.listPins();
    expect(lastCall().url).toBe(`${BASE}/api/pins?include=view`);
    expect(res[0]?.item_type).toBe("view");
  });
});

describe("saved views", () => {
  const view = { id: "v-1", name: "Meine offenen", revision: 3 };

  it("listIssueViews scopes by type and id", async () => {
    fetchMock.mockResolvedValue(jsonResponse([view]));
    const res = await api.listIssueViews({ scope_type: "project", scope_id: "p-1" });
    expect(lastCall().url).toBe(
      `${BASE}/api/issue-views?scope_type=project&scope_id=p-1`,
    );
    expect(res[0]?.name).toBe("Meine offenen");
  });

  it("listIssueViews degrades a drifted list to []", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ views: "x" }));
    expect(await api.listIssueViews({ scope_type: "workspace" })).toEqual([]);
  });

  it("updateIssueView PATCHes with expected_revision", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...view, revision: 4 }));
    const res = await api.updateIssueView("v-1", { name: "x", expected_revision: 3 });
    expect(lastCall()).toEqual({
      url: `${BASE}/api/issue-views/v-1`,
      method: "PATCH",
      body: { name: "x", expected_revision: 3 },
    });
    expect(res?.revision).toBe(4);
  });

  it("view preference read falls back to the empty preference", async () => {
    fetchMock.mockResolvedValue(jsonResponse(42));
    const res = await api.getIssueViewPreference({ scope_type: "my" });
    expect(lastCall().url).toBe(`${BASE}/api/issue-view-preferences?scope_type=my`);
    expect(res.prefs).toEqual({ hidden: [], order: [] });
  });

  it("deleteIssueView sends DELETE", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await api.deleteIssueView("v-1");
    expect(lastCall()).toMatchObject({ url: `${BASE}/api/issue-views/v-1`, method: "DELETE" });
  });
});

describe("chat session management", () => {
  it("listChatSessions passes status=all only when asked", async () => {
    fetchMock.mockImplementation(async () => jsonResponse([session]));
    await api.listChatSessions();
    expect(lastCall().url).toBe(`${BASE}/api/chat/sessions`);
    await api.listChatSessions({ status: "all" });
    expect(lastCall().url).toBe(`${BASE}/api/chat/sessions?status=all`);
  });

  it.each([
    ["renameChatSession", () => api.renameChatSession("s-1", "Neu"), "/api/chat/sessions/s-1", { title: "Neu" }],
    ["setChatSessionPinned", () => api.setChatSessionPinned("s-1", true), "/api/chat/sessions/s-1/pin", { pinned: true }],
    ["setChatSessionArchived", () => api.setChatSessionArchived("s-1", true), "/api/chat/sessions/s-1/archive", { archived: true }],
  ])("%s PATCHes %s", async (_name, call, path, body) => {
    fetchMock.mockResolvedValue(jsonResponse(session));
    const res = await call();
    expect(lastCall()).toEqual({ url: `${BASE}${path}`, method: "PATCH", body });
    expect(res?.pinned).toBe(true);
  });

  it("session writes return null for a drifted body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nope: true }));
    expect(await api.renameChatSession("s-1", "x")).toBeNull();
  });

  it("queue: prioritize POSTs, clear DELETEs", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ task_id: "t-1" }));
    expect(await api.prioritizeQueuedChatTask("s-1", "t-1")).toMatchObject({ task_id: "t-1" });
    expect(lastCall()).toMatchObject({
      url: `${BASE}/api/chat/sessions/s-1/queued-tasks/t-1/prioritize`,
      method: "POST",
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await api.clearQueuedChatTasks("s-1");
    expect(lastCall()).toMatchObject({
      url: `${BASE}/api/chat/sessions/s-1/queued-tasks`,
      method: "DELETE",
    });
  });
});

describe("agents and squads", () => {
  it("getAgent returns null when the body drifts", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    expect(await api.getAgent("a-1")).toBeNull();
    expect(lastCall().url).toBe(`${BASE}/api/agents/a-1`);
  });

  it("getSquad parses a squad", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "q-1", name: "Mobile Squad" }));
    expect((await api.getSquad("q-1"))?.name).toBe("Mobile Squad");
  });

  it("listSquadMembers keeps rows and defaults missing fields", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ id: "m-1", member_type: "agent", member_id: "a-1" }]),
    );
    const res = await api.listSquadMembers("q-1");
    expect(lastCall().url).toBe(`${BASE}/api/squads/q-1/members`);
    expect(res).toEqual([
      { id: "m-1", squad_id: "", member_type: "agent", member_id: "a-1", role: "", created_at: "" },
    ]);
  });

  it("getSquadMemberStatus falls back to no members", async () => {
    fetchMock.mockResolvedValue(jsonResponse(null));
    expect(await api.getSquadMemberStatus("q-1")).toEqual({ members: [] });
    expect(lastCall().url).toBe(`${BASE}/api/squads/q-1/members/status`);
  });
});
