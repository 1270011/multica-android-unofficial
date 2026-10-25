// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  actorRowSwitchA11y,
  buildHiddenActorsModel,
  DECORATIVE_SWITCH_PROPS,
} from "./hidden-actors-screen";
import { EMPTY_HIDDEN_ACTORS } from "./view-prefs";

const members = [
  { user_id: "u-me", name: "Ada", email: "ada@example.com" },
  { user_id: "u-bob", name: "Bob", email: "bob@example.com", avatar_url: "b.png" },
  { user_id: "u-cy", name: "Cyrus", email: "cy@corp.test" },
];
const agents = [
  { id: "a-old", name: "old-bot", archived_at: null },
  { id: "a-arch", name: "archived-bot", archived_at: "2026-10-01T00:00:00Z" },
  { id: "a-ux", name: "ux-designer" },
];

function model(over: Partial<Parameters<typeof buildHiddenActorsModel>[0]> = {}) {
  return buildHiddenActorsModel({
    members,
    agents,
    hidden: EMPTY_HIDDEN_ACTORS,
    selfUserId: "u-me",
    query: "",
    hydrated: true,
    ...over,
  });
}

describe("buildHiddenActorsModel", () => {
  it("lists people and non-archived agents by name, keyed like the store", () => {
    const m = model();
    expect(m.people.map((r) => r.id)).toEqual(["u-me", "u-bob", "u-cy"]);
    expect(m.agents.map((r) => r.id)).toEqual(["a-old", "a-ux"]);
    expect(m.people[1]).toMatchObject({ kind: "members", avatarUrl: "b.png", hidden: false });
    expect(m.canShowAll).toBe(false);
  });

  it("never offers a switch for yourself (A4.4), even with a stored id", () => {
    const m = model({ hidden: { members: ["u-me"], agents: [] } });
    const self = m.people.find((r) => r.isSelf)!;
    expect(self).toMatchObject({ id: "u-me", hidden: false, disabled: true });
    expect(m.peopleHidden).toBe(0);
    // The stale id can still be cleared.
    expect(m.canShowAll).toBe(true);
  });

  it("locks every switch and 'Show all again' until hydrated", () => {
    const hidden = { members: ["u-bob"], agents: ["a-old"] };
    const locked = model({ hidden, hydrated: false });
    expect([...locked.people, ...locked.agents].every((r) => r.disabled)).toBe(true);
    expect(locked.canShowAll).toBe(false);

    const open = model({ hidden, hydrated: true });
    expect(open.people.filter((r) => !r.disabled).map((r) => r.id)).toEqual(["u-bob", "u-cy"]);
    expect(open.agents.every((r) => !r.disabled)).toBe(true);
    expect(open.canShowAll).toBe(true);
  });

  it("counts hidden per section over the whole list, not the search hits", () => {
    const m = model({
      hidden: { members: ["u-bob", "u-gone"], agents: ["a-old", "a-arch"] },
      query: "cy",
    });
    expect(m.people.map((r) => r.id)).toEqual(["u-cy"]);
    expect(m.agents).toEqual([]);
    // Deleted member and archived agent have no row and do not count.
    expect(m.peopleHidden).toBe(1);
    expect(m.agentsHidden).toBe(1);
    expect(m.noMatches).toBe(false);
  });

  it("searches case-insensitively in names and member emails", () => {
    expect(model({ query: "  UX " }).agents.map((r) => r.id)).toEqual(["a-ux"]);
    expect(model({ query: "corp.test" }).people.map((r) => r.id)).toEqual(["u-cy"]);
    const none = model({ query: "zzz" });
    expect(none.noMatches).toBe(true);
    expect(model({ query: "" }).noMatches).toBe(false);
  });

  it("marks hidden rows from the store", () => {
    const m = model({ hidden: { members: [], agents: ["a-ux"] } });
    expect(m.agents.map((r) => [r.id, r.hidden])).toEqual([
      ["a-old", false],
      ["a-ux", true],
    ]);
  });
});

describe("actorRowSwitchA11y", () => {
  it("makes the whole row a switch with checked = hidden", () => {
    expect(actorRowSwitchA11y({ isSelf: false, hidden: true, disabled: false }, "Hide Bob")).toEqual({
      accessibilityRole: "switch",
      accessibilityLabel: "Hide Bob",
      accessibilityState: { checked: true, disabled: false },
    });
  });

  it("passes the lock (not hydrated) as disabled", () => {
    expect(
      actorRowSwitchA11y({ isSelf: false, hidden: false, disabled: true }, "Hide Bob")?.accessibilityState,
    ).toEqual({ checked: false, disabled: true });
  });

  it("gives yourself no switch", () => {
    expect(actorRowSwitchA11y({ isSelf: true, hidden: false, disabled: true }, "Hide Ada")).toBeNull();
  });
});

describe("DECORATIVE_SWITCH_PROPS", () => {
  it("keeps the inner switch out of focus, clicks and the a11y tree", () => {
    expect(DECORATIVE_SWITCH_PROPS).toEqual({
      accessible: false,
      focusable: false,
      importantForAccessibility: "no",
    });
  });
});
