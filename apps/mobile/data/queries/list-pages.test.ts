// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listIssues = vi.hoisted(() => vi.fn());
vi.mock("@/data/api", () => ({ api: { listIssues } }));

import { issueListOptions } from "./issues";
import { listIssuePages } from "./list-pages";
import { listTotalKey } from "./list-total";
import { myIssueListOptions } from "./my-issues";

const issues = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `i${from + i}` }));

/** Fake server: `total` issues, served 100 per request by offset. */
function serve(total: number) {
  listIssues.mockImplementation(async ({ offset = 0, limit }: { offset?: number; limit: number }) => ({
    issues: issues(offset, Math.max(0, Math.min(limit, total - offset))),
    total,
  }));
}

describe("paged issue lists", () => {
  beforeEach(() => {
    listIssues.mockReset();
  });

  it("one request when the first page holds everything", async () => {
    serve(42);
    const res = await listIssuePages({});
    expect(res.issues).toHaveLength(42);
    expect(listIssues).toHaveBeenCalledTimes(1);
    expect(listIssues).toHaveBeenCalledWith({ limit: 100 }, undefined);
  });

  it("loads the pages behind the 100-issue cap with offset", async () => {
    serve(202);
    const res = await listIssuePages({ assignee_id: "u1" });
    expect(res).toEqual({ issues: issues(0, 202), total: 202 });
    expect(listIssues.mock.calls.map((c) => c[0])).toEqual([
      { assignee_id: "u1", limit: 100 },
      { assignee_id: "u1", limit: 100, offset: 100 },
      { assignee_id: "u1", limit: 100, offset: 200 },
    ]);
  });

  it("stops at 10 pages; the total still reports the rest", async () => {
    serve(1234);
    const res = await listIssuePages({});
    expect(listIssues).toHaveBeenCalledTimes(10);
    expect(res.issues).toHaveLength(1000);
    expect(res.total).toBe(1234);
  });

  it("drops an issue that a position change moved onto the next page too", async () => {
    listIssues
      .mockResolvedValueOnce({ issues: issues(0, 100), total: 150 })
      .mockResolvedValueOnce({ issues: [{ id: "i99" }, ...issues(100, 50)], total: 150 });
    const res = await listIssuePages({});
    expect(res.issues).toHaveLength(150);
    expect(new Set(res.issues.map((i) => i.id)).size).toBe(150);
  });

  it("a full first page without total (old server) is not paged", async () => {
    listIssues.mockResolvedValue({ issues: issues(0, 100), total: 0 });
    const res = await listIssuePages({});
    expect(listIssues).toHaveBeenCalledTimes(1);
    expect(res.issues).toHaveLength(100);
  });

  it("passes the abort signal to every page", async () => {
    serve(150);
    const signal = new AbortController().signal;
    await listIssuePages({}, { signal });
    for (const call of listIssues.mock.calls) expect(call[1]).toEqual({ signal });
  });

  it("the workspace list and My Issues keep a flat Issue[] cache with the server total", async () => {
    serve(250);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const all = issueListOptions("ws-1");
    expect(await client.fetchQuery(all)).toHaveLength(250);
    expect(client.getQueryData(listTotalKey(all.queryKey))).toBe(250);
    const mine = myIssueListOptions("ws-1", "assigned", { assignee_id: "u1" });
    expect(await client.fetchQuery(mine)).toHaveLength(250);
  });
});
