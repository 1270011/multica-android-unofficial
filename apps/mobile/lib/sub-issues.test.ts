import { describe, expect, it } from "vitest";
import type { Issue } from "@multica/core/types";
import { countTerminal, groupSubIssuesByStage } from "./sub-issues";

const mk = (id: string, stage: number | null, status = "todo") =>
  ({ id, stage, status }) as unknown as Issue;

describe("groupSubIssuesByStage", () => {
  it("orders stages ascending and puts unstaged children last", () => {
    const groups = groupSubIssuesByStage([
      mk("c", null),
      mk("b", 2),
      mk("a", 1),
      mk("d", 1),
    ]);
    expect(groups.map((g) => g.stage)).toEqual([1, 2, null]);
    expect(groups[0]?.issues.map((i) => i.id)).toEqual(["a", "d"]);
    expect(groups[2]?.issues.map((i) => i.id)).toEqual(["c"]);
  });

  it("returns no groups for no children", () => {
    expect(groupSubIssuesByStage([])).toEqual([]);
  });
});

describe("countTerminal", () => {
  it("counts done and closed categories, including custom statuses", () => {
    const categoryOf = (s: string) =>
      ({ done: "done", cancelled: "closed", shipped: "done", todo: "todo" })[s] ?? null;
    expect(
      countTerminal(
        [mk("1", null, "done"), mk("2", null, "cancelled"), mk("3", null, "shipped"), mk("4", null, "todo")],
        categoryOf,
      ),
    ).toEqual({ done: 3, total: 4 });
  });
});
