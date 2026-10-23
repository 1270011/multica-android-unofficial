import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

// The base URL comes from the user's server setup at request time; the real
// store pulls in expo-secure-store, so stub the sync getters the client uses.
vi.mock("@/data/server-config-store", () => ({
  getServerBaseUrl: () => "https://api.example.test",
  getCfAccessHeaders: () => ({}),
}));
vi.mock("@/lib/client-os", () => ({ CLIENT_OS: "android" }));

// The real store pulls in expo-secure-store; the client only needs the slug.
vi.mock("@/data/workspace-store", () => ({ getCurrentSlug: () => null }));

describe("api.deleteComment", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // #8296: servers that keep a deleted comment's replies also route
  // /keep-replies; older servers do not, so a keep-replies delete that reaches
  // one fails instead of deleting the replies too.
  it.each([
    [{ keepReplies: true }, "https://api.example.test/api/comments/comment-1/keep-replies"],
    [{ keepReplies: false }, "https://api.example.test/api/comments/comment-1"],
    [undefined, "https://api.example.test/api/comments/comment-1"],
  ])("with %j sends DELETE %s", async (opts, url) => {
    await api.deleteComment("comment-1", opts);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: "DELETE" }));
  });
});

describe("api.listIssues", () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ issues: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Actor filters went out as "[object Object]" and the server
  // answered 400; web sends `type:id`, comma-separated.
  it("sends actor filters as type:id lists", async () => {
    await api.listIssues({
      assignee_filters: [
        { type: "member", id: "u1" },
        { type: "agent", id: "a1" },
      ],
      creator_filters: [{ type: "member", id: "u2" }],
      assignee_types: ["agent", "squad"],
      include_no_assignee: true,
      limit: 100,
    });

    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("assignee_filters")).toBe("member:u1,agent:a1");
    expect(url.searchParams.get("creator_filters")).toBe("member:u2");
    expect(url.searchParams.get("assignee_types")).toBe("agent,squad");
    expect(url.searchParams.get("include_no_assignee")).toBe("true");
  });

  // The server reads `sort`/`direction`, like web's client.
  it("sends the sort as sort/direction", async () => {
    await api.listIssues({ sort_by: "priority", sort_direction: "desc", limit: 100 });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("sort")).toBe("priority");
    expect(url.searchParams.get("direction")).toBe("desc");
    expect(url.searchParams.has("sort_by")).toBe(false);
    expect(url.searchParams.has("sort_direction")).toBe(false);
  });
});
