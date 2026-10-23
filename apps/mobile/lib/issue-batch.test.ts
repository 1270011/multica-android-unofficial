// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { describe, expect, it } from "vitest";

import { issueKeys } from "@/data/queries/issue-keys";
import {
  batchFieldOf,
  commonValue,
  selectedIssuesFromCache,
  selectionActionsIconsOnly,
} from "./issue-batch";

const issue = (id: string, over: Partial<Issue> = {}) =>
  ({ id, status: "todo", priority: "none", ...over }) as Issue;

describe("selectionActionsIconsOnly", () => {
  it("drops the labels at 200 % or below 360 dp", () => {
    expect(selectionActionsIconsOnly(411, 1)).toBe(false);
    expect(selectionActionsIconsOnly(411, 2)).toBe(true);
    expect(selectionActionsIconsOnly(359, 1)).toBe(true);
  });
});

describe("batchFieldOf", () => {
  it("names the field of the running update", () => {
    expect(batchFieldOf(undefined)).toBeNull();
    expect(batchFieldOf({ updates: { status: "done" } })).toBe("status");
    expect(batchFieldOf({ updates: { priority: "low" } })).toBe("priority");
    expect(batchFieldOf({ updates: { assignee_type: null, assignee_id: null } })).toBe("assignee");
  });
});

describe("commonValue", () => {
  it("returns the shared value, null when mixed or empty", () => {
    expect(commonValue([issue("a"), issue("b")], (i) => i.status)).toBe("todo");
    expect(commonValue([issue("a"), issue("b", { status: "done" })], (i) => i.status)).toBeNull();
    expect(commonValue([], (i) => i.status)).toBeNull();
  });
});

describe("selectedIssuesFromCache", () => {
  it("finds the selected issues across list caches, in selection order", () => {
    const qc = new QueryClient();
    qc.setQueryData(issueKeys.myList("ws", "all", {}), [issue("a"), issue("b")]);
    qc.setQueryData(issueKeys.myList("ws", "assigned", {}), [issue("c")]);
    expect(selectedIssuesFromCache(qc, "ws", ["c", "a", "gone"]).map((i) => i.id)).toEqual([
      "c",
      "a",
    ]);
  });
});
