// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { describe, expect, it, vi } from "vitest";

const { listProperties } = vi.hoisted(() => ({
  listProperties: vi.fn(async () => ({ properties: [], total: 0 })),
}));
vi.mock("@/data/api", () => ({ api: { listProperties } }));

import { issueKeys } from "@/data/queries/issue-keys";
import { propertyKeys, propertyListOptions } from "@/data/queries/properties";
import { patchIssueProperties } from "./issue-ws-updaters";

const wsId = "ws-1";
const issue = (revision: number) => ({ id: "i-1", revision, properties: { a: 1 } }) as unknown as Issue;

describe("patchIssueProperties (issue_properties:changed, review #24)", () => {
  it("takes the bag from a newer or equal revision", () => {
    const qc = new QueryClient();
    qc.setQueryData(issueKeys.detail(wsId, "i-1"), issue(5));
    patchIssueProperties(qc, wsId, "i-1", { b: "x" }, 6);
    expect(qc.getQueryData<Issue>(issueKeys.detail(wsId, "i-1"))?.properties).toEqual({ b: "x" });
  });

  it("ignores an older revision", () => {
    const qc = new QueryClient();
    qc.setQueryData(issueKeys.detail(wsId, "i-1"), issue(7));
    patchIssueProperties(qc, wsId, "i-1", { b: "x" }, 6);
    expect(qc.getQueryData<Issue>(issueKeys.detail(wsId, "i-1"))?.properties).toEqual({ a: 1 });
  });

  it("without a revision marks the detail stale instead of guessing", () => {
    const qc = new QueryClient();
    qc.setQueryData(issueKeys.detail(wsId, "i-1"), issue(7));
    patchIssueProperties(qc, wsId, "i-1", { b: "x" }, undefined);
    expect(qc.getQueryState(issueKeys.detail(wsId, "i-1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryData<Issue>(issueKeys.detail(wsId, "i-1"))?.properties).toEqual({ a: 1 });
  });
});

describe("propertyListOptions includeArchived (review #24)", () => {
  it("keys and requests archived definitions separately", async () => {
    const qc = new QueryClient();
    const withArchived = propertyListOptions(wsId, true);
    expect(withArchived.queryKey).toEqual([...propertyKeys.all(wsId), "list", true]);
    expect(propertyListOptions(wsId).queryKey).toEqual([...propertyKeys.all(wsId), "list", false]);
    await qc.fetchQuery(withArchived);
    expect(listProperties).toHaveBeenCalledWith(expect.objectContaining({ includeArchived: true }));
  });
});
