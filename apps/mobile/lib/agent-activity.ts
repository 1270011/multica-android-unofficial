/**
 * State of the agent activity row ("Working" / "Runs · N") below the issue
 * chat and in the issue header card (`components/issue/agent-activity-row.tsx`).
 *
 * The chat renders the row as the list footer. The task queries usually
 * answer after the timeline, so a row that appears only then pushes the
 * last bubble up by one row in the same frame. With
 * `reserveSpace` the chat keeps a placeholder of the row's height while the
 * tasks load. If it turns out there are no runs, the placeholder stays for
 * this mount: a collapsing footer would move the last bubble just the same.
 */

export type AgentActivityTask = { status: string; agent_id: string };

export type AgentActivityState =
  | { kind: "placeholder" }
  | { kind: "none" }
  | { kind: "active"; agentIds: string[] }
  | { kind: "past"; count: number };

/** Row height in dp: `py-2` plus the 24 dp avatar stack. Idle content is
 * smaller, so the row gets it as min height and both states match. */
export const AGENT_ACTIVITY_ROW_HEIGHT = 40;

const PAST = new Set(["completed", "failed", "cancelled"]);

export function agentActivityState(input: {
  activeTasks: readonly AgentActivityTask[] | undefined;
  allTasks: readonly AgentActivityTask[] | undefined;
  /** Keep the row's height while loading (chat footer). */
  reserveSpace: boolean;
  /** A placeholder was shown earlier in this mount. */
  reserved: boolean;
}): AgentActivityState {
  const { activeTasks, allTasks, reserveSpace, reserved } = input;
  if (activeTasks && activeTasks.length > 0) {
    return { kind: "active", agentIds: activeTasks.map((t) => t.agent_id) };
  }
  if (activeTasks && allTasks) {
    const count = allTasks.filter((t) => PAST.has(t.status)).length;
    if (count > 0) return { kind: "past", count };
    return reserveSpace && reserved ? { kind: "placeholder" } : { kind: "none" };
  }
  return reserveSpace ? { kind: "placeholder" } : { kind: "none" };
}
