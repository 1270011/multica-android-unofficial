import { describe, expect, it, vi } from "vitest";
import {
  IssueWakeupListSchema,
  IssueWakeupSchema,
  PausedWakeupListSchema,
  SystemWakeupListSchema,
  WorkspaceWakeupPageSchema,
} from "./wakeup-schemas";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), log: vi.fn(), error: vi.fn() } }));

/**
 * Enum drift for issue wakeups (unknown `kind` or
 * `paused_reason` must not fail parsing). Core's IssueWakeupSchema declares
 * `kind` as a closed enum; mobile reads unknown values as "unknown".
 */
const base = {
  id: "w-1",
  issue_id: "i-1",
  agent_id: "a-1",
  instruction: "",
  kind: "event",
  mode: "once",
  enabled: true,
};

describe("wakeup schema drift", () => {
  it("parses a minimal rule and fills defaults", () => {
    const parsed = IssueWakeupSchema.parse(base);
    expect(parsed).toMatchObject({
      kind: "event",
      event_types: [],
      timezone: "",
      condition: null,
      paused_reason: null,
      next_fire_at: null,
    });
  });

  it("reads an unknown kind as 'unknown' instead of failing", () => {
    for (const kind of ["webhook", 7, null, undefined]) {
      expect(IssueWakeupSchema.parse({ ...base, kind }).kind).toBe("unknown");
    }
  });

  it("keeps a rule with an unknown paused_reason paused", () => {
    expect(IssueWakeupSchema.parse({ ...base, paused_reason: "budget" }).paused_reason).toBe("unknown");
    expect(IssueWakeupSchema.parse({ ...base, paused_reason: "loop" }).paused_reason).toBe("loop");
    // Go zero value and null mean "not paused".
    expect(IssueWakeupSchema.parse({ ...base, paused_reason: "" }).paused_reason).toBeNull();
    expect(IssueWakeupSchema.parse({ ...base, paused_reason: null }).paused_reason).toBeNull();
  });

  it("degrades unknown mode, on_timeout and condition", () => {
    const parsed = IssueWakeupSchema.parse({
      ...base,
      mode: "forever",
      on_timeout: "explode",
      condition: { type: "moon_phase", value: "full" },
    });
    expect(parsed).toMatchObject({ mode: "once", on_timeout: null, condition: null });
  });

  it("keeps a known condition", () => {
    const condition = { type: "other_issue", issue_id: "i-2", state: "in_review" };
    expect(IssueWakeupSchema.parse({ ...base, condition }).condition).toEqual(condition);
  });

  it("drops only rows without an id", () => {
    const rows = IssueWakeupListSchema.parse([base, { ...base, id: undefined }, { ...base, id: "w-2", kind: "lunar" }]);
    expect(rows.map((r) => [r.id, r.kind])).toEqual([
      ["w-1", "event"],
      ["w-2", "unknown"],
    ]);
  });

  it("paused list: unknown reason stays a paused row", () => {
    const rows = PausedWakeupListSchema.parse([
      { issue_id: "i-1", id: "w-1", agent_id: "a", paused_reason: "budget" },
      { issue_id: "i-1", id: "w-2" },
    ]);
    expect(rows.map((r) => r.paused_reason)).toEqual(["unknown", "unknown"]);
  });

  it("system rules: unknown rule, blocked and pause reason survive", () => {
    const rows = SystemWakeupListSchema.parse([
      { rule: "parent_done", enabled: true, blocked: "frozen", paused_reason: "budget", target: { type: "robot" } },
    ]);
    expect(rows[0]).toMatchObject({ rule: "parent_done", blocked: "frozen", paused_reason: "unknown", target: null, waiting: [] });
  });

  it("workspace page: unknown source and missing counts degrade, can_manage defaults to false", () => {
    const page = WorkspaceWakeupPageSchema.parse({
      items: [{ ...base, kind: "geo", source: "robot", task: { nonsense: true } }, { nope: 1 }],
      total: 2,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ kind: "unknown", source: "member", can_manage: false, task: null });
    expect(page.counts).toEqual({ active: 0, all: 0, paused: 0, disabled: 0, ended: 0 });
    expect(page.agents).toEqual([]);
  });

  it("system rule row in the workspace page has no agent", () => {
    const page = WorkspaceWakeupPageSchema.parse({
      items: [{ ...base, agent_id: null, revision: null, source: "system", rule: "child_done" }],
      total: 1,
      counts: { active: 1, all: 1, disabled: 0, ended: 0 },
      agents: [],
    });
    expect(page.items[0]).toMatchObject({ agent_id: "", revision: undefined, source: "system", rule: "child_done" });
    expect(page.counts.paused).toBe(0);
  });
});
