/**
 * W6-P10 (A6.1–A6.7): "Frequent" section —
 * cap at 8, no duplicates, hidden and ineligible rows out, search, mode.
 */
import { describe, expect, it } from "vitest";
import { debugSeedUsage, splitFrequent, type FrequentKey } from "./mention-frequent";
import type { MentionUsage } from "./mention-usage";

interface Item {
  type: "member" | "agent" | "squad" | "all";
  id: string;
  name: string;
  hidden?: boolean;
  archived?: boolean;
}

const item = (type: Item["type"], id: string, name = id): Item => ({ type, id, name });
const keyOf = (i: Item): FrequentKey | null =>
  i.type === "all" ? null : { key: `${i.type}:${i.id}`, name: i.name };
const names = (items: Item[]) => items.map((i) => i.name);

const all = item("all", "all");
const people = [item("member", "anna"), item("member", "carl"), item("member", "eve")];
const agents = [item("agent", "bot-b"), item("agent", "bot-d")];
const squads = [item("squad", "sq-x")];

describe("splitFrequent", () => {
  it("no history: no section, sections unchanged (A6.1)", () => {
    const r = splitFrequent([[all], people, agents, squads], keyOf, {}, { mode: "frequency" });
    expect(r.frequent).toEqual([]);
    expect(r.sections.map(names)).toEqual([["all"], ["anna", "carl", "eve"], ["bot-b", "bot-d"], ["sq-x"]]);
  });

  it("mixes types, count desc, removes them from their sections, @all stays (A6.2)", () => {
    const usage: MentionUsage = {
      "agent:bot-b": { n: 3, last: 10 },
      "member:carl": { n: 1, last: 20 },
      "squad:sq-x": { n: 2, last: 5 },
    };
    const r = splitFrequent([[all], people, agents, squads], keyOf, usage, { mode: "frequency" });
    expect(names(r.frequent)).toEqual(["bot-b", "sq-x", "carl"]);
    expect(r.sections.map(names)).toEqual([["all"], ["anna", "eve"], ["bot-d"], []]);
    const seen = [...r.frequent, ...r.sections.flat()].map((i) => i.id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("tie on count: last mention first; tie on both: name (A6.3)", () => {
    const usage: MentionUsage = {
      "agent:bot-b": { n: 2, last: 10 },
      "agent:bot-d": { n: 2, last: 30 },
      "member:eve": { n: 1, last: 7 },
      "member:anna": { n: 1, last: 7 },
    };
    const r = splitFrequent([people, agents], keyOf, usage, { mode: "frequency" });
    expect(names(r.frequent)).toEqual(["bot-d", "bot-b", "anna", "eve"]);
  });

  it("caps at 8, the rest stays alphabetical in its section (A6.4)", () => {
    const many = Array.from({ length: 12 }, (_, i) => item("member", `m${String(i).padStart(2, "0")}`));
    const usage: MentionUsage = Object.fromEntries(
      many.map((m, i) => [`member:${m.id}`, { n: i + 1, last: i }]),
    );
    const r = splitFrequent([many], keyOf, usage, { mode: "frequency" });
    expect(r.frequent).toHaveLength(8);
    expect(names(r.frequent)[0]).toBe("m11");
    expect(names(r.sections[0]!)).toEqual(["m00", "m01", "m02", "m03"]);
  });

  it("search: only the matches passed in can be frequent (A6.4)", () => {
    const usage: MentionUsage = {
      "agent:bot-b": { n: 5, last: 1 },
      "member:carl": { n: 9, last: 1 },
    };
    const matches = [agents.filter((a) => a.name.includes("b"))];
    const r = splitFrequent(matches, keyOf, usage, { mode: "frequency" });
    expect(names(r.frequent)).toEqual(["bot-b"]);
  });

  it("hidden actors never frequent, their count is kept (A6.7)", () => {
    const usage: MentionUsage = {
      "agent:bot-b": { n: 5, last: 1 },
      "member:carl": { n: 1, last: 1 },
    };
    const hiddenB = agents.map((a) => (a.id === "bot-b" ? { ...a, hidden: true } : a));
    const r = splitFrequent([people, hiddenB], keyOf, usage, {
      mode: "frequency",
      isHidden: (i) => !!i.hidden,
    });
    expect(names(r.frequent)).toEqual(["carl"]);
    expect(names(r.sections[1]!)).toEqual(["bot-b", "bot-d"]);
    expect(usage["agent:bot-b"]!.n).toBe(5);
    // Shown again: back at its old place.
    const again = splitFrequent([people, agents], keyOf, usage, { mode: "frequency" });
    expect(names(again.frequent)).toEqual(["bot-b", "carl"]);
  });

  it("ineligible rows (archived, no runtime) stay in their section", () => {
    const usage: MentionUsage = { "agent:bot-b": { n: 5, last: 1 } };
    const archived = agents.map((a) => (a.id === "bot-b" ? { ...a, archived: true } : a));
    const r = splitFrequent([archived], keyOf, usage, {
      mode: "frequency",
      isEligible: (i) => !i.archived,
    });
    expect(r.frequent).toEqual([]);
    expect(names(r.sections[0]!)).toEqual(["bot-b", "bot-d"]);
  });

  it("mode name: no section even with history (A6.8)", () => {
    const usage: MentionUsage = { "agent:bot-b": { n: 5, last: 1 } };
    const r = splitFrequent([people, agents], keyOf, usage, { mode: "name" });
    expect(r.frequent).toEqual([]);
    expect(names(r.sections[1]!)).toEqual(["bot-b", "bot-d"]);
  });

  it("usage of unknown ids is ignored", () => {
    const usage: MentionUsage = { "agent:gone": { n: 9, last: 1 } };
    const r = splitFrequent([agents], keyOf, usage, { mode: "frequency" });
    expect(r.frequent).toEqual([]);
  });
});

describe("debugSeedUsage", () => {
  it("seeds the first two by name, the second on top", () => {
    const { usage, top } = debugSeedUsage(
      [
        { key: "member:z", name: "zoe" },
        { key: "member:a", name: "al" },
        { key: "member:m", name: "mia" },
      ],
      100_000,
    );
    expect(top).toBe("mia");
    expect(Object.keys(usage).sort()).toEqual(["member:a", "member:m"]);
    expect(usage["member:m"]!.n).toBeGreaterThan(usage["member:a"]!.n);
  });

  it("one candidate: it is on top; none: nothing", () => {
    expect(debugSeedUsage([{ key: "member:a", name: "al" }], 1).top).toBe("al");
    expect(debugSeedUsage([], 1)).toEqual({ usage: {}, top: null });
  });
});
