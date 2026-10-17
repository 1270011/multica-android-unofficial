import { describe, expect, it } from "vitest";
import {
  duplicateCandidates,
  affectedParentIds,
  issueUpdateErrorKey,
  maxSiblingStage,
  parentCandidates,
  removeParentPatch,
  setParentPatch,
  stageOptions,
} from "./issue-fields";

describe("stages", () => {
  it("offers at least Stage 1–3 and one beyond the highest in use", () => {
    expect(stageOptions(null)).toEqual([1, 2, 3]);
    expect(stageOptions(null, maxSiblingStage([{ stage: 4 }, { stage: null }]))).toEqual([1, 2, 3, 4, 5]);
    expect(stageOptions(6, 1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("maxSiblingStage ignores unstaged children", () => {
    expect(maxSiblingStage([])).toBe(0);
    expect(maxSiblingStage([{ stage: null }, { stage: 2 }, { stage: 1 }])).toBe(2);
  });
});

describe("parent payloads", () => {
  it("removing the parent clears the stage in the same write", () => {
    expect(removeParentPatch()).toEqual({ parent_issue_id: null, stage: null });
  });

  it("setting or changing the parent sends no stage (as web)", () => {
    expect(setParentPatch("p2")).toEqual({ parent_issue_id: "p2" });
  });
});

describe("affectedParentIds (children cache)", () => {
  it("old and new parent on a move, old parent on remove", () => {
    expect(affectedParentIds("p1", { parent_issue_id: "p2" })).toEqual(["p1", "p2"]);
    expect(affectedParentIds(null, { parent_issue_id: "p2" })).toEqual(["p2"]);
    expect(affectedParentIds("p1", removeParentPatch())).toEqual(["p1"]);
  });

  it("the parent on a stage change, nothing for unrelated fields", () => {
    expect(affectedParentIds("p1", { stage: 3 })).toEqual(["p1"]);
    expect(affectedParentIds("p1", { status: "done" })).toEqual([]);
    expect(affectedParentIds(undefined, { stage: null })).toEqual([]);
  });
});

describe("issueUpdateErrorKey", () => {
  it("maps the duplicate and cycle errors web explains", () => {
    expect(issueUpdateErrorKey({ status: 409, body: { code: "duplicate_target_is_duplicate" } })).toBe(
      "errors.duplicate_target_is_duplicate",
    );
    expect(issueUpdateErrorKey({ status: 409, body: { code: "issue_has_duplicates" } })).toBe(
      "errors.issue_has_duplicates",
    );
    expect(
      issueUpdateErrorKey({ status: 400, body: { error: "circular parent relationship detected" } }),
    ).toBe("errors.circular_parent");
  });

  it("returns null for everything else", () => {
    expect(issueUpdateErrorKey({ status: 409, body: { code: "revision_conflict" } })).toBeNull();
    expect(issueUpdateErrorKey({ status: 400, body: { error: "invalid stage" } })).toBeNull();
    expect(issueUpdateErrorKey(new Error("x"))).toBeNull();
    expect(issueUpdateErrorKey(null)).toBeNull();
  });
});

describe("candidates", () => {
  const issue = { id: "self", parent_issue_id: "p" };
  const rows = [
    { id: "self", parent_issue_id: null },
    { id: "p", parent_issue_id: null },
    { id: "child", parent_issue_id: "self" },
    { id: "ok", parent_issue_id: "x" },
    { id: "dup", parent_issue_id: null, duplicate_of: { id: "ok" } },
  ];

  it("parent: excludes self, current parent and own children", () => {
    expect(parentCandidates(rows, issue).map((r) => r.id)).toEqual(["ok", "dup"]);
  });

  it("duplicate: excludes self and issues that are duplicates themselves", () => {
    expect(duplicateCandidates(rows, "self").map((r) => r.id)).toEqual(["p", "child", "ok"]);
  });
});
