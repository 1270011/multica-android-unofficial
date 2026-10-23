import { describe, expect, it } from "vitest";
import { agentActivityState, type AgentActivityTask } from "./agent-activity";

const done: AgentActivityTask = { status: "completed", agent_id: "a1" };
const running: AgentActivityTask = { status: "running", agent_id: "a2" };

describe("agentActivityState", () => {
  it("keeps a placeholder while the tasks load in the chat footer", () => {
    expect(
      agentActivityState({ activeTasks: undefined, allTasks: undefined, reserveSpace: true, reserved: false }),
    ).toEqual({ kind: "placeholder" });
    expect(
      agentActivityState({ activeTasks: [], allTasks: undefined, reserveSpace: true, reserved: true }),
    ).toEqual({ kind: "placeholder" });
  });

  it("renders nothing while loading without reserveSpace (header card)", () => {
    expect(
      agentActivityState({ activeTasks: undefined, allTasks: undefined, reserveSpace: false, reserved: false }),
    ).toEqual({ kind: "none" });
  });

  it("shows the active row as soon as active tasks are known", () => {
    expect(
      agentActivityState({ activeTasks: [running], allTasks: undefined, reserveSpace: true, reserved: true }),
    ).toEqual({ kind: "active", agentIds: ["a2"] });
  });

  it("counts finished runs only", () => {
    expect(
      agentActivityState({
        activeTasks: [],
        allTasks: [done, { status: "failed", agent_id: "a1" }, { status: "queued", agent_id: "a1" }],
        reserveSpace: true,
        reserved: true,
      }),
    ).toEqual({ kind: "past", count: 2 });
  });

  it("keeps the reserved space when no runs exist, so the list does not jump back", () => {
    expect(
      agentActivityState({ activeTasks: [], allTasks: [], reserveSpace: true, reserved: true }),
    ).toEqual({ kind: "placeholder" });
  });

  it("takes no space without runs when nothing was reserved (cached, header card)", () => {
    expect(
      agentActivityState({ activeTasks: [], allTasks: [], reserveSpace: true, reserved: false }),
    ).toEqual({ kind: "none" });
    expect(
      agentActivityState({ activeTasks: [], allTasks: [], reserveSpace: false, reserved: true }),
    ).toEqual({ kind: "none" });
  });

  it("footer slot keeps one height across load: placeholder → past → active", () => {
    // Sequence of the chat footer on a cold open; every visible state is a
    // fixed-height slot, so the last bubble keeps its position.
    const steps = [
      agentActivityState({ activeTasks: undefined, allTasks: undefined, reserveSpace: true, reserved: false }),
      agentActivityState({ activeTasks: [], allTasks: [done], reserveSpace: true, reserved: true }),
      agentActivityState({ activeTasks: [running], allTasks: [done], reserveSpace: true, reserved: true }),
    ];
    expect(steps.map((s) => s.kind)).toEqual(["placeholder", "past", "active"]);
    expect(steps.some((s) => s.kind === "none")).toBe(false);
  });
});
