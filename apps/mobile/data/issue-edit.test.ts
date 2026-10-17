import { describe, expect, it } from "vitest";

import {
  buildIssueTextUpdate,
  detectTextConflict,
  hasConflict,
  isRevisionConflict,
  resolveConflict,
} from "./issue-edit";

const base = { title: "Old title", description: "Old body" };
const MARKER = "<!-- multica:channel-media:0a1b2c3d-0000-4000-8000-0123456789ab -->";

describe("buildIssueTextUpdate", () => {
  it("sends only changed fields, each with its baseline", () => {
    expect(buildIssueTextUpdate({ title: "  New title  ", description: "Old body" }, base)).toEqual({
      title: "New title",
      title_base: "Old title",
    });
    expect(buildIssueTextUpdate({ title: "Old title", description: " New body " }, base)).toEqual({
      description: "New body",
      description_base: "Old body",
    });
  });

  it("is empty when nothing changed (whitespace only)", () => {
    expect(buildIssueTextUpdate({ title: "Old title ", description: "Old body\n" }, base)).toEqual({});
  });

  it("keeps the raw description baseline (channel media markers) for the merge", () => {
    const raw = { title: "T", description: "Body\n<!-- media -->" };
    expect(buildIssueTextUpdate({ title: "T", description: "Body 2" }, raw).description_base).toBe(raw.description);
  });
});

describe("detectTextConflict", () => {
  it("flags a field the user changed while someone else changed it too", () => {
    const c = detectTextConflict(base, { title: "Mine", description: "Old body" }, {
      title: "Theirs",
      description: "Old body",
    });
    expect(c).toEqual({ title: true, description: false });
    expect(hasConflict(c)).toBe(true);
  });

  it("ignores server changes to fields the user did not touch", () => {
    expect(
      detectTextConflict(base, { title: "Mine", description: "Old body" }, {
        title: "Old title",
        description: "Someone else's body",
      }),
    ).toEqual({ title: false, description: false });
  });

  it("does not report a conflict when both landed on the same text", () => {
    expect(
      detectTextConflict(base, { title: "Old title", description: "Same" }, {
        title: "Old title",
        description: "Same",
      }).description,
    ).toBe(false);
  });

  it("treats a null server description as empty", () => {
    expect(
      detectTextConflict({ title: "T", description: "" }, { title: "T", description: "Mine" }, {
        title: "T",
        description: null,
      }),
    ).toEqual({ title: false, description: false });
  });

});

describe("resolveConflict (review blocker: no silent overwrite)", () => {
  // A changed only the title; B changed title and description meanwhile.
  const atStart = { title: "Old title", description: "Old body" };
  const mine = { title: "A title", description: "Old body" };
  const server = { title: "B title", description: "B body" };
  const conflict = detectTextConflict(atStart, mine, server);

  it("detects only the title as conflicting", () => {
    expect(conflict).toEqual({ title: true, description: false });
  });

  it("keep mine: sends the title only and never the old description", () => {
    const next = resolveConflict(atStart, mine, server, conflict, "keep_mine");
    expect(next.draft).toEqual({ title: "A title", description: "B body" });
    expect(buildIssueTextUpdate(next.draft, next.base)).toEqual({
      title: "A title",
      title_base: "B title",
    });
  });

  it("reload, then save: nothing left to send (B's text stays)", () => {
    const next = resolveConflict(atStart, mine, server, conflict, "reload");
    expect(next.draft).toEqual(server);
    expect(buildIssueTextUpdate(next.draft, next.base)).toEqual({});
    expect(hasConflict(detectTextConflict(next.base, next.draft, server))).toBe(false);
  });

  it("reload keeps the user's other, non-conflicting edit and saves only that", () => {
    const both = { title: "A title", description: "A body" };
    const theirs = { title: "B title", description: "Old body" };
    const c = detectTextConflict(atStart, both, theirs);
    expect(c).toEqual({ title: true, description: false });
    const next = resolveConflict(atStart, both, theirs, c, "reload");
    expect(next.draft).toEqual({ title: "B title", description: "A body" });
    expect(buildIssueTextUpdate(next.draft, next.base)).toEqual({
      description: "A body",
      description_base: "Old body",
    });
  });

  it("keep mine with both fields changed by both sides sends both against the new base", () => {
    const both = { title: "A title", description: "A body" };
    const c = detectTextConflict(atStart, both, server);
    expect(c).toEqual({ title: true, description: true });
    const next = resolveConflict(atStart, both, server, c, "keep_mine");
    expect(buildIssueTextUpdate(next.draft, next.base)).toEqual({
      title: "A title",
      title_base: "B title",
      description: "A body",
      description_base: "B body",
    });
  });

  it("treats a null server description as empty and strips markers for the form", () => {
    const marked = `B body\n${MARKER}`;
    const next = resolveConflict(atStart, mine, { title: "B title", description: marked }, conflict, "keep_mine");
    expect(next.base.description).toBe(marked);
    expect(next.draft.description.trim()).toBe("B body");
    expect(buildIssueTextUpdate(next.draft, next.base).description).toBeUndefined();
    expect(
      resolveConflict(atStart, mine, { title: "B title", description: null }, conflict, "reload").base
        .description,
    ).toBe("");
  });
});

describe("channel media markers (review)", () => {
  const raw = { title: "T", description: `Body\n${MARKER}` };

  it("a title-only change does not send the description", () => {
    expect(buildIssueTextUpdate({ title: "T2", description: "Body" }, raw)).toEqual({
      title: "T2",
      title_base: "T",
    });
  });

  it("an untouched description with markers is no conflict", () => {
    expect(
      detectTextConflict(raw, { title: "T2", description: "Body" }, {
        title: "T",
        description: `Body changed\n${MARKER}`,
      }),
    ).toEqual({ title: false, description: false });
  });

  it("server text equal to the draft apart from markers is no conflict", () => {
    expect(
      detectTextConflict(raw, { title: "T", description: "New" }, {
        title: "T",
        description: `New\n${MARKER}`,
      }).description,
    ).toBe(false);
  });
});

describe("isRevisionConflict", () => {
  it("matches the server's 409 edit conflict only", () => {
    expect(isRevisionConflict({ status: 409, body: { code: "revision_conflict" } })).toBe(true);
    expect(isRevisionConflict({ status: 409, body: { code: "active_duplicate_issue" } })).toBe(false);
    expect(isRevisionConflict({ status: 500, body: { code: "revision_conflict" } })).toBe(false);
    expect(isRevisionConflict(new Error("x"))).toBe(false);
    expect(isRevisionConflict(null)).toBe(false);
  });
});
