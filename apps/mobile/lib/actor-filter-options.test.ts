import { describe, expect, it } from "vitest";
import type { Agent, MemberWithUser, Squad } from "@multica/core/types";
import de from "../locales/de/issues.json";
import en from "../locales/en/issues.json";
import zh from "../locales/zh-Hans/issues.json";
import {
  ACTOR_LIST_PREVIEW,
  actorDisplayName,
  actorFilterChips,
  actorOptionA11yLabel,
  actorOptionHint,
  actorOptions,
  clearActorChip,
  clearFilterSection,
  hiddenActorOptions,
  isOptionHidden,
  lockedByNobody,
  previewOptions,
  sectionsForBadRequest,
} from "./actor-filter-options";
import {
  type ActorKey,
  EMPTY_ISSUE_LIST_FILTERS,
  type IssueListFilters,
  setIncludeNoAssignee,
  setInvolvesMe,
} from "./issue-list-filters";

const ME = "u-me";
const member = (user_id: string, name: string): MemberWithUser =>
  ({ id: `m-${user_id}`, user_id, name, avatar_url: null }) as MemberWithUser;
const agent = (id: string, name: string, owner_id: string | null, archived = false): Agent =>
  ({ id, name, owner_id, avatar_url: null, archived_at: archived ? "2026-10-01" : null }) as Agent;
const squad = (id: string, name: string, archived = false): Squad =>
  ({ id, name, avatar_url: null, archived_at: archived ? "2026-10-01" : null }) as Squad;

const DIR = {
  members: [member(ME, "Me Myself"), member("u-ana", "Ana"), member("u-bo", "Bo")],
  agents: [
    agent("a-zed", "Zed", ME),
    agent("a-alf", "Alf", "u-ana"),
    agent("a-old", "Old", "u-ana", true),
  ],
  squads: [squad("s-core", "Core"), squad("s-gone", "Gone", true)],
};

// Minimal i18n stand-in that reads the real German strings.
function tFrom(dict: { filters: Record<string, string> }) {
  return (key: string, opts?: Record<string, unknown>) => {
    const leaf = key.replace(/^filters\./, "");
    let text = String(dict.filters[leaf] ?? key);
    for (const [k, v] of Object.entries(opts ?? {})) text = text.replace(`{{${k}}}`, String(v));
    return text;
  };
}
const t = tFrom(de);

const f = (patch: Partial<IssueListFilters>): IssueListFilters => ({
  ...EMPTY_ISSUE_LIST_FILTERS,
  ...patch,
});

describe("actorOptions", () => {
  it("lists my agents first, then members, agents and squads; me and archived left out", () => {
    const keys = actorOptions(DIR, { userId: ME, types: ["member", "agent", "squad"] }).map(
      (o) => o.key,
    );
    expect(keys).toEqual(["agent:a-zed", "member:u-ana", "member:u-bo", "agent:a-alf", "squad:s-core"]);
  });

  it("keeps a picked archived agent so it can be unticked", () => {
    const keys = actorOptions(DIR, {
      userId: ME,
      types: ["agent"],
      selected: ["agent:a-old"],
    }).map((o) => o.key);
    expect(keys).toContain("agent:a-old");
  });

  it("creator lists have no squads", () => {
    const types = actorOptions(DIR, { userId: ME, types: ["member", "agent"] }).map((o) => o.type);
    expect(types).not.toContain("squad");
  });

  it("filters by name, case-insensitive", () => {
    const names = actorOptions(DIR, {
      userId: ME,
      types: ["member", "agent", "squad"],
      query: " AL ",
    }).map((o) => o.name);
    expect(names).toEqual(["Alf"]);
  });
});

describe("hidden people and agents", () => {
  const HIDDEN = { members: ["u-bo"], agents: ["a-alf"] };
  const ALL = ["member", "agent", "squad"] as const;

  it("leaves hidden members and agents out of the filter lists", () => {
    const keys = actorOptions(DIR, { userId: ME, types: ALL, hidden: HIDDEN }).map((o) => o.key);
    expect(keys).toEqual(["agent:a-zed", "member:u-ana", "squad:s-core"]);
  });

  it("keeps a hidden actor that is an active filter value, so it can be cleared", () => {
    const keys = actorOptions(DIR, {
      userId: ME,
      types: ALL,
      selected: ["agent:a-alf"],
      hidden: HIDDEN,
    }).map((o) => o.key);
    expect(keys).toContain("agent:a-alf");
    expect(keys).not.toContain("member:u-bo");
  });

  it("member and agent ids do not cross over; squads are never hidden", () => {
    const crossed = { members: ["a-zed"], agents: ["u-ana", "s-core"] };
    const keys = actorOptions(DIR, { userId: ME, types: ALL, hidden: crossed }).map((o) => o.key);
    expect(keys).toEqual(["agent:a-zed", "member:u-ana", "member:u-bo", "agent:a-alf", "squad:s-core"]);
    expect(isOptionHidden({ type: "squad", id: "s-core" }, crossed)).toBe(false);
    expect(isOptionHidden({ type: "agent", id: "a-alf" }, undefined)).toBe(false);
  });

  it("search lists hidden matches separately; nothing without a query", () => {
    expect(hiddenActorOptions(DIR, { userId: ME, types: ALL, hidden: HIDDEN })).toEqual([]);
    expect(
      hiddenActorOptions(DIR, { userId: ME, types: ALL, hidden: HIDDEN, query: "  " }),
    ).toEqual([]);
    const q = { userId: ME, types: ALL, hidden: HIDDEN, query: "b" };
    expect(actorOptions(DIR, q).map((o) => o.key)).toEqual([]);
    expect(hiddenActorOptions(DIR, q).map((o) => o.key)).toEqual(["member:u-bo"]);
  });

  it("a picked hidden actor is not listed twice", () => {
    const q = { userId: ME, types: ALL, hidden: HIDDEN, query: "alf", selected: ["agent:a-alf" as ActorKey] };
    expect(actorOptions(DIR, q).map((o) => o.key)).toEqual(["agent:a-alf"]);
    expect(hiddenActorOptions(DIR, q)).toEqual([]);
  });

  it("hidden archived agents stay out of the search too", () => {
    const q = { userId: ME, types: ALL, hidden: { members: [], agents: ["a-old"] }, query: "old" };
    expect(hiddenActorOptions(DIR, q)).toEqual([]);
  });

  it("never touches me (the sheet's own Me row)", () => {
    const q = { userId: ME, types: ALL, hidden: { members: [ME], agents: [] }, query: "me" };
    expect(actorOptions(DIR, q)).toEqual([]);
    expect(hiddenActorOptions(DIR, q)).toEqual([]);
  });

  it("marks hidden rows in text and for TalkBack, not by colour alone", () => {
    expect(actorOptionHint("agent", t)).toBe("Agent");
    expect(actorOptionHint("agent", t, true)).toBe("Agent · ausgeblendet");
    expect(actorOptionA11yLabel("Alf", "agent", false, t, true)).toBe("Alf, Agent, ausgeblendet");
  });
});

describe("previewOptions", () => {
  const many = actorOptions(
    {
      members: Array.from({ length: 12 }, (_, i) => member(`u${i}`, `M${String(i).padStart(2, "0")}`)),
      agents: [],
      squads: [],
    },
    { userId: null, types: ["member"] },
  );

  it("shows 8 rows and counts the rest", () => {
    const { rows, hidden } = previewOptions(many, []);
    expect(rows).toHaveLength(ACTOR_LIST_PREVIEW);
    expect(hidden).toBe(4);
  });

  it("keeps picked rows from beyond the preview visible", () => {
    const { rows, hidden } = previewOptions(many, ["member:u11"]);
    expect(rows.map((r) => r.key)).toContain("member:u11");
    expect(hidden).toBe(3);
  });

  it("no button for short lists", () => {
    expect(previewOptions(many.slice(0, 3), []).hidden).toBe(0);
  });
});

describe("lockedByNobody", () => {
  const nobody = setIncludeNoAssignee(EMPTY_ISSUE_LIST_FILTERS, true);

  it("greys out the assignee controls, including My agents and squads", () => {
    expect(lockedByNobody("assignee", nobody)).toBe(true);
    expect(lockedByNobody("assignee", EMPTY_ISSUE_LIST_FILTERS)).toBe(false);
  });

  it("matches the model: Nobody clears My agents and squads", () => {
    const both = setIncludeNoAssignee(setInvolvesMe(EMPTY_ISSUE_LIST_FILTERS, true), true);
    expect(both.involvesMe).toBe(false);
    expect(lockedByNobody("assignee", both)).toBe(true);
  });

  it("never locks the creator section", () => {
    expect(lockedByNobody("creator", nobody)).toBe(false);
  });
});

describe("TalkBack labels", () => {
  it("reads name, kind and selection", () => {
    expect(actorOptionA11yLabel("Ana", "member", true, t)).toBe("Ana, Mitglied, ausgewählt");
    expect(actorOptionA11yLabel("Zed", "agent", false, t)).toBe("Zed, Agent");
    expect(actorOptionA11yLabel("Ana", "member", true, tFrom(en))).toBe("Ana, Member, selected");
  });
});

describe("actorDisplayName", () => {
  it("me, known names and Unknown for deleted actors", () => {
    expect(actorDisplayName(`member:${ME}`, DIR, ME, t)).toBe("Ich");
    expect(actorDisplayName("member:u-ana", DIR, ME, t)).toBe("Ana");
    expect(actorDisplayName("squad:s-core", DIR, ME, t)).toBe("Core");
    expect(actorDisplayName("member:u-deleted", DIR, ME, t)).toBe("Unbekannt");
    expect(actorDisplayName("agent:a-x", DIR, ME, t)).toBe("Unbekannt");
  });
});

describe("actorFilterChips", () => {
  it("one chip per actor with name, kind chips and remove labels", () => {
    const chips = actorFilterChips(
      f({ assignees: ["member:u-ana"], assigneeTypes: ["agent"], creators: [`member:${ME}`] }),
      DIR,
      ME,
      t,
    );
    expect(chips.map((c) => c.label)).toEqual([
      "Zuweisung: Ana",
      "Zuweisungsart: Agents",
      "Ersteller: Ich",
    ]);
    expect(chips[0].a11yLabel).toBe("Filter Zuweisung Ana entfernen");
    expect(chips[2].a11yLabel).toBe("Filter Ersteller Ich entfernen");
  });

  it("unknown actor shows Unbekannt and stays removable", () => {
    const [chip] = actorFilterChips(f({ assignees: ["agent:a-x"] }), DIR, ME, t);
    expect(chip.label).toBe("Zuweisung: Unbekannt");
    expect(clearActorChip(f({ assignees: ["agent:a-x"] }), chip.clear).assignees).toEqual([]);
  });

  it("three or more actors collapse into a count chip that clears all", () => {
    const keys: ActorKey[] = ["member:u-ana", "member:u-bo", "agent:a-zed"];
    const chips = actorFilterChips(f({ assignees: keys }), DIR, ME, t);
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("Zuweisung: 3");
    expect(clearActorChip(f({ assignees: keys }), chips[0].clear).assignees).toEqual([]);
  });

  it("Nobody gives one chip 'Ohne Zuweisung'", () => {
    const chips = actorFilterChips(setIncludeNoAssignee(EMPTY_ISSUE_LIST_FILTERS, true), DIR, ME, t);
    expect(chips.map((c) => c.label)).toEqual(["Ohne Zuweisung"]);
    expect(chips[0].a11yLabel).toBe("Filter Ohne Zuweisung entfernen");
    expect(clearActorChip(f({ includeNoAssignee: true }), chips[0].clear).includeNoAssignee).toBe(false);
  });

  it("✕ removes only that value", () => {
    const filters = f({
      assignees: ["member:u-ana", "member:u-bo"],
      assigneeTypes: ["agent", "squad"],
      creators: ["agent:a-zed"],
    });
    const chips = actorFilterChips(filters, DIR, ME, t);
    let next = filters;
    for (const c of chips.filter((c) => c.label.endsWith("Ana") || c.label.endsWith("Squads"))) {
      next = clearActorChip(next, c.clear);
    }
    expect(next.assignees).toEqual(["member:u-bo"]);
    expect(next.assigneeTypes).toEqual(["agent"]);
    expect(next.creators).toEqual(["agent:a-zed"]);
  });
});

describe("400 handling", () => {
  const both = f({ assignees: ["member:u-ana"], creators: ["agent:a-zed"] });

  it("resets the section the server names", () => {
    expect(sectionsForBadRequest("400 Bad Request invalid assignee_types", both)).toEqual(["assignee"]);
    expect(sectionsForBadRequest("invalid creator_filters", both)).toEqual(["creator"]);
  });

  it("without a hint both set sections reset; unset sections never", () => {
    expect(sectionsForBadRequest("400 Bad Request", both)).toEqual(["assignee", "creator"]);
    expect(sectionsForBadRequest("400 Bad Request", f({ creators: ["agent:a-zed"] }))).toEqual([
      "creator",
    ]);
    expect(sectionsForBadRequest("invalid status", EMPTY_ISSUE_LIST_FILTERS)).toEqual([]);
  });

  it("clearFilterSection clears assignee values incl. My agents and squads", () => {
    const next = clearFilterSection(
      f({ involvesMe: true, assignees: ["member:u-ana"], assigneeTypes: ["agent"], creators: ["agent:a-zed"] }),
      "assignee",
    );
    expect(next).toMatchObject({ involvesMe: false, assignees: [], assigneeTypes: [] });
    expect(next.creators).toEqual(["agent:a-zed"]);
    expect(clearFilterSection(both, "creator").creators).toEqual([]);
  });
});

describe("strings", () => {
  const keys = [
    "me",
    "no_assignee",
    "no_assignee_chip",
    "assignee_type",
    "actor_type_member",
    "actor_type_agent",
    "actor_type_squad",
    "selected",
    "unknown_actor",
    "chip_assignee",
    "chip_creator",
    "remove_section_chip",
    "creator",
    "creator_fixed_hint",
    "show_all",
    "people_load_failed",
    "not_with_nobody",
    "section_reset",
    "hidden_section",
    "hidden_note",
  ] as const;
  it.each([
    ["de", de],
    ["en", en],
    ["zh", zh],
  ])("%s has every D3b key", (_, dict) => {
    for (const k of keys) expect(dict.filters[k], k).toBeTruthy();
  });
});
