import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import de from "../locales/de/issues.json";
import en from "../locales/en/issues.json";
import zh from "../locales/zh-Hans/issues.json";
import { EMPTY_HIDDEN_ACTORS, type HiddenActors } from "./view-prefs";
import {
  isPickerActorHidden,
  type PickerActorRef,
  splitVisibleActors,
  visibleActors,
  withHiddenNote,
} from "./visible-actors";

type Item = { label: string; ref: PickerActorRef | null };
const item = (label: string, ref: PickerActorRef | null): Item => ({ label, ref });
const refOf = (i: Item) => i.ref;
const labels = (items: Item[]) => items.map((i) => i.label);

const ALL = item("@all", null);
const ANA = item("Ana", { type: "member", id: "u-ana" });
const BO = item("Bo", { type: "member", id: "u-bo" });
const OLD_BOT = item("old-bot", { type: "agent", id: "a-old" });
const DEV = item("dev", { type: "agent", id: "a-dev" });
const TEAM = item("Team", { type: "squad", id: "a-old" });
const ITEMS = [ALL, ANA, BO, OLD_BOT, DEV, TEAM];

const HIDDEN: HiddenActors = { members: ["u-bo"], agents: ["a-old"] };

describe("splitVisibleActors", () => {
  it("keeps everything when nothing is hidden", () => {
    const out = splitVisibleActors(ITEMS, refOf, EMPTY_HIDDEN_ACTORS, { query: "o" });
    expect(labels(out.visible)).toEqual(["@all", "Ana", "Bo", "old-bot", "dev", "Team"]);
    expect(out.hidden).toEqual([]);
  });

  it("drops hidden people and agents, keeps order and non-actor rows (A4.1)", () => {
    const out = splitVisibleActors(ITEMS, refOf, HIDDEN);
    expect(labels(out.visible)).toEqual(["@all", "Ana", "dev", "Team"]);
    expect(out.hidden).toEqual([]);
  });

  it("never hides squads, even with a matching id", () => {
    expect(isPickerActorHidden(HIDDEN, { type: "squad", id: "a-old" })).toBe(false);
    expect(isPickerActorHidden(HIDDEN, { type: "agent", id: "a-old" })).toBe(true);
    expect(isPickerActorHidden(HIDDEN, { type: "member", id: "a-old" })).toBe(false);
  });

  it("keeps a picked hidden actor in the regular list (A4.2)", () => {
    const out = splitVisibleActors(ITEMS, refOf, HIDDEN, {
      selected: [{ type: "agent", id: "a-old" }],
    });
    expect(labels(out.visible)).toEqual(["@all", "Ana", "old-bot", "dev", "Team"]);
  });

  it("matches the picked value by type and id", () => {
    const out = splitVisibleActors(ITEMS, refOf, HIDDEN, {
      selected: [{ type: "member", id: "a-old" }],
    });
    expect(labels(out.visible)).not.toContain("old-bot");
  });

  it("lists hidden matches in their own section while searching (A4.3)", () => {
    const out = splitVisibleActors(ITEMS, refOf, HIDDEN, { query: "o" });
    expect(labels(out.visible)).toEqual(["@all", "Ana", "dev", "Team"]);
    expect(labels(out.hidden)).toEqual(["Bo", "old-bot"]);
  });

  it("treats a blank query as no search", () => {
    expect(splitVisibleActors(ITEMS, refOf, HIDDEN, { query: "   " }).hidden).toEqual([]);
  });

  it("does not list a picked hidden actor twice while searching", () => {
    const out = splitVisibleActors(ITEMS, refOf, HIDDEN, {
      query: "o",
      selected: [{ type: "agent", id: "a-old" }],
    });
    expect(labels(out.visible)).toContain("old-bot");
    expect(labels(out.hidden)).toEqual(["Bo"]);
  });
});

describe("visibleActors", () => {
  it("is the visible part only, current value kept", () => {
    expect(labels(visibleActors(ITEMS, refOf, HIDDEN))).toEqual(["@all", "Ana", "dev", "Team"]);
    expect(
      labels(visibleActors([OLD_BOT, DEV], refOf, HIDDEN, [{ type: "agent", id: "a-old" }])),
    ).toEqual(["old-bot", "dev"]);
  });
});

describe("withHiddenNote", () => {
  const t = (key: string) => (en.picker as Record<string, string>)[key.split(".")[1]] ?? key;

  it("adds the note only for dimmed rows", () => {
    expect(withHiddenNote("Agent", false, t)).toBe("Agent");
    expect(withHiddenNote("Agent", true, t)).toBe("Agent · hidden");
  });

  it("has the section and note texts in all locales", () => {
    for (const locale of [en, de, zh]) {
      expect(locale.picker.hidden_section).toBeTruthy();
      expect(locale.picker.hidden_note).toBeTruthy();
    }
    expect(de.picker.hidden_section).toBe("Ausgeblendet");
    expect(en.picker.hidden_section).toBe("Hidden");
  });
});

describe("picker wiring (P5)", () => {
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
  const pickers = [
    "components/issue/pickers/mention-picker-body.tsx",
    "components/issue/mention-suggestion-bar.tsx",
    "components/issue/pickers/assignee-picker-body.tsx",
    "components/project/pickers/project-lead-picker-body.tsx",
    "components/chat/chat-screen.tsx",
  ];

  it.each(pickers)("%s filters through useVisibleActors", (path) => {
    expect(read(path)).toMatch(/useVisibleActors\(wsId\)/);
  });

  it.each(pickers.slice(0, 4))("%s renders the Hidden section", (path) => {
    expect(read(path)).toMatch(/PickerHiddenSection label=\{t\("picker\.hidden_section"\)\}/);
  });

  it("assignee and lead pickers keep the current value", () => {
    for (const path of pickers.slice(2, 4)) {
      expect(read(path)).toMatch(/selected: value \? \[value\] : \[\]/);
    }
  });

  it("chat keeps the current agent in the picker", () => {
    expect(read("components/chat/chat-screen.tsx")).toMatch(
      /currentAgent \? \[\{ type: "agent", id: currentAgent\.id \}\] : \[\]/,
    );
  });
});
