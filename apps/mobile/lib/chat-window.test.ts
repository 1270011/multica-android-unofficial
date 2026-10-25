// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CHAT_IDLE_STEP,
  CHAT_WINDOW_LEAD,
  CHAT_WINDOW_SIZE,
  CHAT_WINDOW_STEP,
  CHAT_LANDING_BELOW,
  chatWindow,
  chatWindowRange,
  chatWindowStart,
  grownWindowEnd,
  grownWindowStart,
  windowStepTowards,
  WindowGrowthGate,
} from "./chat-window";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));
const ids = (list: { id: string }[]) => list.map((i) => i.id);

/** The commits the list makes, like `IssueChatList`: first window, then one
 *  block per `grow` call while the window's top row is kept by id. */
function simulate(items: { id: string }[], focusId?: string) {
  const first = chatWindow(items, { focusId });
  const commits = [ids(first)];
  let top = { id: first[0]!.id, fromEnd: first.length };
  const start = () => chatWindowStart(items, { keepFromId: top.id, keepFromEnd: top.fromEnd });
  const commit = (next: number | null) => {
    if (next === null) return false;
    top = { id: items[next]!.id, fromEnd: items.length - next };
    commits.push(ids(items.slice(start())));
    return true;
  };
  return {
    commits,
    start,
    grow: () => start() > 0 && commit(grownWindowStart(start())),
    towards: (id: string) => commit(windowStepTowards(items, start(), id)),
  };
}

/** New rows per commit after the first one. */
const added = (commits: string[][]) => commits.slice(1).map((c, i) => c.length - commits[i]!.length);

describe("chatWindow", () => {
  it("first commit holds at most CHAT_WINDOW_SIZE rows, the last ones", () => {
    const first = chatWindow(rows(300), {});
    expect(first).toHaveLength(CHAT_WINDOW_SIZE);
    expect(first[0]!.id).toBe(`c${300 - CHAT_WINDOW_SIZE}`);
    expect(first.at(-1)!.id).toBe("c299");
  });

  it("returns the same array when nothing is cut", () => {
    const items = rows(10);
    expect(chatWindow(items, {})).toBe(items);
  });

  it("a target inside the window keeps the window size", () => {
    expect(chatWindowStart(rows(300), { focusId: "c297" })).toBe(300 - CHAT_WINDOW_SIZE);
  });

  it("a target within one block above widens the first window to start just above it", () => {
    const items = rows(300);
    const target = 300 - CHAT_WINDOW_SIZE - 40;
    const first = chatWindow(items, { focusId: `c${target}` });
    expect(first[0]!.id).toBe(`c${target - CHAT_WINDOW_LEAD}`);
    expect(first.at(-1)!.id).toBe("c299");
  });

  it("an older target opens the first window around itself", () => {
    expect(chatWindowRange(rows(300), { focusId: "c40" })).toEqual({
      start: 40 - CHAT_WINDOW_LEAD,
      end: 40 + CHAT_LANDING_BELOW,
    });
    const first = chatWindow(rows(300), { focusId: "c40" });
    expect(first).toHaveLength(CHAT_WINDOW_LEAD + CHAT_LANDING_BELOW);
    expect(first[CHAT_WINDOW_LEAD]!.id).toBe("c40");
  });

  it("keeps CHAT_WINDOW_LEAD rows above a target near the window's top edge", () => {
    const edge = 300 - CHAT_WINDOW_SIZE + 2;
    expect(chatWindowStart(rows(300), { focusId: `c${edge}` })).toBe(edge - CHAT_WINDOW_LEAD);
  });

  it("the unread divider counts as a target", () => {
    const items = [...rows(250), { id: "unread" }, ...rows(30).map((r) => ({ id: `n${r.id}` }))];
    const first = chatWindow(items, { focusId: "unread" });
    expect(ids(first)).toContain("unread");
    expect(first[0]!.id).toBe(`c${250 - CHAT_WINDOW_LEAD}`);
  });

  it("an unknown target falls back to the plain window", () => {
    expect(chatWindowStart(rows(300), { focusId: "nope" })).toBe(300 - CHAT_WINDOW_SIZE);
  });
});

describe("chatWindow keepFromId", () => {
  it("data change before the next block only appends: the top row stays", () => {
    const before = chatWindow(rows(100), {});
    const grown = rows(101);
    // Without the kept top the window would drop its first row and shift every index.
    expect(chatWindow(grown, {})[0]!.id).toBe(`c${101 - CHAT_WINDOW_SIZE}`);
    const after = chatWindow(grown, { keepFromId: before[0]!.id });
    expect(ids(after).slice(0, before.length)).toEqual(ids(before));
    expect(after.at(-1)!.id).toBe("c100");
  });

  it("never narrows a wider landing window; an unknown id is ignored", () => {
    const items = rows(100);
    const end = 100 - CHAT_WINDOW_SIZE;
    const focus = end - 60;
    expect(chatWindowStart(items, { focusId: `c${focus}`, keepFromId: `c${end}` })).toBe(focus - CHAT_WINDOW_LEAD);
    expect(chatWindowStart(items, { keepFromId: "gone" })).toBe(end);
  });

  it("a vanished top row keeps the window's length instead", () => {
    // A system group expanded into its lines: the grown window stays grown.
    expect(chatWindowStart(rows(300), { keepFromId: "gone", keepFromEnd: 120 })).toBe(180);
  });
});

describe("chat window blocks", () => {
  it("scrolling up loads block by block until the first row, nothing lost or doubled", () => {
    const items = rows(1122);
    const sim = simulate(items);
    while (sim.grow());
    const { commits } = sim;
    expect(commits.at(-1)).toEqual(ids(items));
    expect(commits.length).toBe(1 + Math.ceil((1122 - CHAT_WINDOW_SIZE) / CHAT_WINDOW_STEP));
    for (let i = 1; i < commits.length; i++) {
      const prev = commits[i - 1]!;
      const cur = commits[i]!;
      // Only prepended: the previous window is the tail of the next one.
      expect(cur.slice(cur.length - prev.length)).toEqual(prev);
      expect(new Set(cur).size).toBe(cur.length);
    }
    expect(sim.grow()).toBe(false);
  });

  it("no commit after the first adds more than ~100 rows", () => {
    expect(CHAT_WINDOW_STEP).toBeLessThanOrEqual(100);
    expect(CHAT_IDLE_STEP).toBeLessThanOrEqual(CHAT_WINDOW_STEP);
    const sim = simulate(rows(1122));
    while (sim.grow());
    expect(Math.max(...added(sim.commits))).toBeLessThanOrEqual(100);
  });

  it("a quote root above the window opens block by block until it is in, with lead rows above", () => {
    const items = rows(1122);
    const sim = simulate(items);
    expect(sim.commits[0]).toHaveLength(CHAT_WINDOW_SIZE);
    while (sim.towards("c40"));
    const last = sim.commits.at(-1)!;
    expect(last[0]).toBe(`c${40 - CHAT_WINDOW_LEAD}`);
    expect(last).toContain("c40");
    expect(last.at(-1)).toBe("c1121");
    expect(Math.max(...added(sim.commits))).toBeLessThanOrEqual(CHAT_WINDOW_STEP);
    // Not the whole list: the rows above the lead stay out until scrolled to.
    expect(last).not.toContain("c0");
  });

  it("a target already in the window or unknown needs no step", () => {
    const items = rows(300);
    expect(windowStepTowards(items, 275, "c290")).toBeNull();
    expect(windowStepTowards(items, 275, "nope")).toBeNull();
    expect(windowStepTowards(items, 275, "c260")).toBe(255);
    expect(windowStepTowards(items, 3, "c2")).toBe(0);
  });

  it("new rows while growing are appended at the end, the grown top stays", () => {
    const items = rows(300);
    const top = chatWindowStart(items, {});
    const grown = grownWindowStart(top);
    const more = rows(305);
    expect(chatWindowStart(more, { keepFromId: `c${grown}`, keepFromEnd: 300 - grown })).toBe(grown);
  });
});

describe("window around a far target", () => {
  const items = rows(1122);
  const target = 667; // ~455 rows above the end

  it("the first commit holds the target with lead rows and a few below, nothing grown toward it", () => {
    const { start, end } = chatWindowRange(items, { focusId: `c${target}` });
    expect(start).toBe(target - CHAT_WINDOW_LEAD);
    expect(end).toBe(target + CHAT_LANDING_BELOW);
    expect(end).toBeLessThan(items.length);
  });

  it("a target within one block stays a suffix window", () => {
    const near = 1122 - CHAT_WINDOW_SIZE - CHAT_WINDOW_STEP + 1;
    expect(chatWindowRange(items, { focusId: `c${near}` }).end).toBe(1122);
  });

  it("once recorded, top and bottom rows keep the window; new rows stay below it", () => {
    const opts = { keepFromId: `c${target - CHAT_WINDOW_LEAD}`, keepToId: `c${target + CHAT_LANDING_BELOW - 1}` };
    expect(chatWindowRange(items, opts)).toEqual({ start: target - CHAT_WINDOW_LEAD, end: target + CHAT_LANDING_BELOW });
    expect(chatWindowRange(rows(1130), opts)).toEqual({ start: target - CHAT_WINDOW_LEAD, end: target + CHAT_LANDING_BELOW });
  });

  it("grows below block by block up to the last row, then reaches the end", () => {
    let end = target + CHAT_LANDING_BELOW;
    const steps: number[] = [];
    while (end < items.length) {
      const next = grownWindowEnd(end, items.length);
      steps.push(next - end);
      end = next;
    }
    expect(end).toBe(items.length);
    expect(Math.max(...steps)).toBeLessThanOrEqual(CHAT_WINDOW_STEP);
    const opts = { keepFromId: `c${target - CHAT_WINDOW_LEAD}`, keepToId: null };
    expect(chatWindowRange(items, opts).end).toBe(items.length);
  });

  it("a vanished bottom row opens to the end; a kept top ignores the focus", () => {
    const opts = { focusId: "c100", keepFromId: `c${target}`, keepToId: "gone" };
    expect(chatWindowRange(items, opts)).toEqual({ start: target, end: items.length });
  });
});

describe("WindowGrowthGate", () => {
  it("lets a growth through while nothing holds it", () => {
    const gate = new WindowGrowthGate(() => false);
    expect(gate.request()).toBe(true);
    expect(gate.release()).toBe(false);
  });

  it("holds a growth back and releases it once after the hold", () => {
    let held = true;
    const gate = new WindowGrowthGate(() => held);
    expect(gate.request()).toBe(false);
    expect(gate.request()).toBe(false);
    expect(gate.release()).toBe(false);
    held = false;
    expect(gate.release()).toBe(true);
    expect(gate.release()).toBe(false);
  });

  it("releases nothing when no growth was asked for", () => {
    let held = true;
    const gate = new WindowGrowthGate(() => held);
    held = false;
    expect(gate.release()).toBe(false);
  });
});
