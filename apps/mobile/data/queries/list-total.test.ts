// @vitest-environment node
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listIssues = vi.hoisted(() => vi.fn());
vi.mock("@/data/api", () => ({ api: { listIssues } }));

import { issueListOptions } from "./issues";
import { issueKeys } from "./issue-keys";
import { listTotalKey, listTotalQueryOptions, rememberListTotal } from "./list-total";

describe("list totals (J3a, review #35)", () => {
  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    listIssues.mockReset();
  });

  it("the list query stores the server total next to the Issue[] cache", async () => {
    listIssues.mockResolvedValue({ issues: [{ id: "1" }, { id: "2" }], total: 250 });
    const options = issueListOptions("ws-1");
    const issues = await client.fetchQuery(options);
    expect(issues).toHaveLength(2); // cache shape stays Issue[]
    expect(client.getQueryData(listTotalKey(options.queryKey))).toBe(250);
  });

  it("the observer behind useListTotal sees the remembered total without fetching", () => {
    const listKey = issueKeys.list("ws-1");
    const observer = new QueryObserver<number>(client, listTotalQueryOptions(listKey));
    const seen: Array<number | undefined> = [];
    const unsubscribe = observer.subscribe((result) => seen.push(result.data));
    expect(observer.getCurrentResult().data).toBeUndefined();
    rememberListTotal(client, listKey, 135);
    expect(observer.getCurrentResult().data).toBe(135);
    expect(seen).toContain(135);
    expect(observer.getCurrentResult().fetchStatus).toBe("idle");
    unsubscribe();
  });

  it("lives outside the issues prefix, so invalidating lists does not touch it", async () => {
    const listKey = issueKeys.list("ws-1");
    rememberListTotal(client, listKey, 135);
    await client.invalidateQueries({ queryKey: issueKeys.all("ws-1") });
    expect(client.getQueryState(listTotalKey(listKey))?.isInvalidated).toBe(false);
    expect(listTotalKey(listKey)[0]).toBe("issue-list-total");
  });
});
