import { describe, expect, it } from "vitest";
import {
  WAKEUP_CONDITION_GROUPS,
  WAKEUP_ERROR_FIELD,
  WAKEUP_EVENT_TYPES,
  buildWakeupInput,
  emptyWakeupDraft,
  isEventCondition,
  propertyConditionValue,
  stepOneError,
  toggleWakeupEvent,
  wakeupEventGroups,
  type WakeupCreateDraft,
} from "./wakeup-draft";

// Platform conditions and custom events, spec §1.3.
const NOW = new Date(2026, 9, 19, 10, 0, 0);

function draft(patch: Partial<WakeupCreateDraft>): WakeupCreateDraft {
  return { ...emptyWakeupDraft("agent-1", "Europe/Berlin", NOW), instruction: "Weiter", ...patch };
}

function body(patch: Partial<WakeupCreateDraft>) {
  const r = buildWakeupInput(draft(patch), NOW);
  if ("error" in r) throw new Error(`unexpected error ${r.error}`);
  return r.input;
}

const EVENT_BASE = {
  agent_id: "agent-1",
  instruction: "Weiter",
  kind: "event",
  mode: "once",
  expires_in_seconds: 7 * 86400,
  on_timeout: "wake",
};

describe("W5 – Body je Bedingung", () => {
  it("children_done: all sub-issues sends no stage", () => {
    expect(body({ condition: "children" })).toEqual({ ...EVENT_BASE, condition: { type: "children_done" } });
  });

  it("children_done: one stage", () => {
    expect(body({ condition: "children", stage: 2 }).condition).toEqual({ type: "children_done", stage: 2 });
  });

  it("issue_field status", () => {
    expect(body({ condition: "field", field: "status", fieldTarget: "in_review" })).toEqual({
      ...EVENT_BASE,
      condition: { type: "issue_field", field: "status", value: "in_review" },
    });
  });

  it("issue_field assignee (member, agent, squad)", () => {
    for (const type of ["member", "agent", "squad"] as const) {
      expect(body({ condition: "field", field: "assignee", assignee: { type, id: "x-1" } }).condition).toEqual({
        type: "issue_field",
        field: "assignee",
        assignee_type: type,
        assignee_id: "x-1",
      });
    }
  });

  it("issue_field label", () => {
    expect(body({ condition: "field", field: "label", fieldTarget: "lab-1" }).condition).toEqual({
      type: "issue_field",
      field: "label",
      label_id: "lab-1",
    });
  });

  it("issue_field property: select option id, checkbox bool, number number, text trimmed", () => {
    const prop = (propertyType: string, fieldValue: string) =>
      body({ condition: "field", field: "property", fieldTarget: "p-1", propertyType, fieldValue }).condition;
    expect(prop("select", "opt-1")).toEqual({ type: "issue_field", field: "property", property_id: "p-1", value: "opt-1" });
    expect(prop("checkbox", "true")).toMatchObject({ value: true });
    expect(prop("checkbox", "false")).toMatchObject({ value: false });
    expect(prop("number", " 42 ")).toMatchObject({ value: 42 });
    expect(prop("text", "  fertig ")).toMatchObject({ value: "fertig" });
  });

  it("pull_request: checks finished (default) and merged", () => {
    expect(body({ condition: "pull_request" })).toEqual({
      ...EVENT_BASE,
      condition: { type: "pull_request", event: "checks_finished" },
    });
    expect(body({ condition: "pull_request", prEvent: "merged" }).condition).toEqual({ type: "pull_request", event: "merged" });
  });

  it("other_issue: issue id and state, never the display identifier", () => {
    const otherIssue = { id: "iss-9", identifier: "MUL-9", title: "Anderes" };
    expect(body({ condition: "other_issue", otherIssue })).toEqual({
      ...EVENT_BASE,
      condition: { type: "other_issue", issue_id: "iss-9", state: "done" },
    });
    for (const otherState of ["ended", "in_review"] as const) {
      expect(body({ condition: "other_issue", otherIssue, otherState }).condition).toEqual({
        type: "other_issue",
        issue_id: "iss-9",
        state: otherState,
      });
    }
  });

  it("custom: event_types in catalog order, no condition", () => {
    const input = body({ condition: "custom", events: ["comment.created", "task.failed"] });
    expect(input).toEqual({ ...EVENT_BASE, event_types: ["comment.created", "task.failed"] });
    expect(input.condition).toBeUndefined();
  });

  it("conditions use mode, cap, deadline and on_timeout like events", () => {
    expect(
      body({ condition: "pull_request", mode: "continuous", maxFires: 5, wait: { kind: "none" } }),
    ).toEqual({
      agent_id: "agent-1",
      instruction: "Weiter",
      kind: "event",
      mode: "continuous",
      max_fires: 5,
      condition: { type: "pull_request", event: "checks_finished" },
    });
    expect(body({ condition: "children", wait: { kind: "days", days: 1 }, onTimeout: "end" })).toMatchObject({
      expires_in_seconds: 86400,
      on_timeout: "end",
    });
  });
});

describe("W5 – Validierung", () => {
  it("missing values stop step 1 and point at the value field", () => {
    expect(stepOneError(draft({ condition: "field", field: "status" }), NOW)).toBe("missing_value");
    expect(stepOneError(draft({ condition: "field", field: "assignee" }), NOW)).toBe("missing_value");
    expect(stepOneError(draft({ condition: "field", field: "label" }), NOW)).toBe("missing_value");
    expect(
      stepOneError(draft({ condition: "field", field: "property", fieldTarget: "p-1", fieldValue: "  " }), NOW),
    ).toBe("missing_value");
    expect(stepOneError(draft({ condition: "other_issue" }), NOW)).toBe("missing_issue");
    expect(stepOneError(draft({ condition: "custom" }), NOW)).toBe("missing_events");
    for (const e of ["missing_value", "missing_issue", "missing_events"] as const) {
      expect(WAKEUP_ERROR_FIELD[e]).toBe("value");
    }
    expect(buildWakeupInput(draft({ condition: "custom" }), NOW)).toEqual({ error: "missing_events" });
  });

  it("children and pull_request need nothing more", () => {
    expect(stepOneError(draft({ condition: "children" }), NOW)).toBeNull();
    expect(stepOneError(draft({ condition: "pull_request" }), NOW)).toBeNull();
  });

  it("every new condition is an event condition", () => {
    for (const c of ["children", "field", "pull_request", "other_issue", "custom"] as const) {
      expect(isEventCondition(c)).toBe(true);
    }
    expect(isEventCondition("at")).toBe(false);
    expect(isEventCondition("recurring")).toBe(false);
  });
});

describe("W5 – Gruppen und Ereignisliste", () => {
  it("groups follow spec §1.3 and list every condition once", () => {
    expect(WAKEUP_CONDITION_GROUPS.map((g) => g.group)).toEqual(["time", "collaboration", "runs", "linked", "advanced"]);
    const all = WAKEUP_CONDITION_GROUPS.flatMap((g) => g.conditions);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(9);
  });

  it("event groups keep the catalog and split by prefix", () => {
    const groups = wakeupEventGroups();
    expect(groups.map((g) => g.group)).toEqual(["task", "issue", "comment", "reaction", "attachment"]);
    expect(groups.flatMap((g) => g.events)).toEqual([...WAKEUP_EVENT_TYPES]);
  });

  it("toggling keeps catalog order and removes again", () => {
    let events = toggleWakeupEvent([], "comment.created");
    events = toggleWakeupEvent(events, "task.queued");
    expect(events).toEqual(["task.queued", "comment.created"]);
    expect(toggleWakeupEvent(events, "task.queued")).toEqual(["comment.created"]);
  });

  it("propertyConditionValue keeps unparsable numbers as text", () => {
    expect(propertyConditionValue("number", "abc")).toBe("abc");
    expect(propertyConditionValue(undefined, "x")).toBe("x");
  });
});
