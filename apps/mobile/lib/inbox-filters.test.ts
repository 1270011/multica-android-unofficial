import { describe, expect, it } from "vitest";
import type { InboxItem } from "@multica/core/types";
import de from "../locales/de/inbox.json";
import en from "../locales/en/inbox.json";
import zh from "../locales/zh-Hans/inbox.json";
import {
  EMPTY_INBOX_FILTERS,
  effectiveInboxFilters,
  filterInboxItems,
  inboxActorKey,
  inboxActorKeyParts,
  inboxActorOptions,
  inboxFacets,
  inboxFilterCount,
  inboxStatusKeys,
  inboxSupportsPriority,
  type InboxFilters,
  parseStoredInboxFilters,
  serializeInboxFilters,
  toggleInboxFilter,
} from "./inbox-filters";

function item(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: "inbox-1",
    workspace_id: "ws-1",
    recipient_type: "member",
    recipient_id: "member-1",
    actor_type: "agent",
    actor_id: "agent-1",
    type: "new_comment",
    severity: "info",
    issue_id: "issue-1",
    title: "Issue title",
    body: null,
    issue_status: "todo",
    issue_priority: "medium",
    read: false,
    archived: false,
    created_at: "2026-10-16T08:00:00Z",
    details: null,
    ...overrides,
  };
}

function filters(partial: Partial<InboxFilters>): InboxFilters {
  return { ...EMPTY_INBOX_FILTERS, ...partial };
}

const ROWS = [
  item({ id: "a", issue_status: "todo", issue_priority: "high", actor_type: "member", actor_id: "alice" }),
  item({ id: "b", issue_status: "in_progress", issue_priority: "high", actor_type: "agent", actor_id: "bot" }),
  item({ id: "c", issue_status: "in_progress", issue_priority: "low", actor_type: "member", actor_id: "alice" }),
  item({ id: "d", issue_id: null, issue_status: null, issue_priority: null, actor_type: "system", actor_id: null }),
];

const ids = (rows: InboxItem[]) => rows.map((r) => r.id);

describe("inboxActorKey", () => {
  it("keys members and agents by type and id, system as one bucket", () => {
    expect(inboxActorKey(item({ actor_type: "member", actor_id: "u1" }))).toBe("member:u1");
    expect(inboxActorKey(item({ actor_type: "agent", actor_id: "a1" }))).toBe("agent:a1");
    expect(inboxActorKey(item({ actor_type: "system", actor_id: null }))).toBe("system");
  });

  it("returns null without usable attribution", () => {
    expect(inboxActorKey(item({ actor_type: null, actor_id: null }))).toBeNull();
    expect(inboxActorKey(item({ actor_type: "member", actor_id: null }))).toBeNull();
  });

  it("round-trips through inboxActorKeyParts", () => {
    expect(inboxActorKeyParts("agent:a1")).toEqual({ type: "agent", id: "a1" });
    expect(inboxActorKeyParts("system")).toEqual({ type: "system", id: "" });
  });
});

describe("filterInboxItems", () => {
  it("returns the same list without filters", () => {
    expect(filterInboxItems(ROWS, EMPTY_INBOX_FILTERS)).toBe(ROWS);
  });

  it("ORs values within one dimension", () => {
    expect(ids(filterInboxItems(ROWS, filters({ statuses: ["todo", "in_progress"] })))).toEqual(["a", "b", "c"]);
  });

  it("ANDs across dimensions", () => {
    const result = filterInboxItems(
      ROWS,
      filters({ statuses: ["in_progress"], priorities: ["high"], actors: ["agent:bot"] }),
    );
    expect(ids(result)).toEqual(["b"]);
    expect(ids(filterInboxItems(ROWS, filters({ statuses: ["todo"], actors: ["agent:bot"] })))).toEqual([]);
  });

  it("never matches rows without an issue on status or priority", () => {
    expect(ids(filterInboxItems(ROWS, filters({ priorities: ["none"] })))).toEqual([]);
    expect(ids(filterInboxItems(ROWS, filters({ statuses: ["todo"] })))).not.toContain("d");
  });

  it("filters by the system actor", () => {
    expect(ids(filterInboxItems(ROWS, filters({ actors: ["system"] })))).toEqual(["d"]);
  });
});

describe("toggleInboxFilter / inboxFilterCount", () => {
  it("adds and removes a value without touching other dimensions", () => {
    const on = toggleInboxFilter(filters({ statuses: ["todo"] }), "actors", "member:alice");
    expect(on).toEqual(filters({ statuses: ["todo"], actors: ["member:alice"] }));
    expect(inboxFilterCount(on)).toBe(2);
    const off = toggleInboxFilter(on, "actors", "member:alice");
    expect(off.actors).toEqual([]);
    expect(inboxFilterCount(off)).toBe(1);
  });
});

describe("priority support", () => {
  it("needs issue_priority on every row (older backend omits it)", () => {
    expect(inboxSupportsPriority(ROWS)).toBe(true);
    const old = item({});
    delete (old as Partial<InboxItem>).issue_priority;
    expect(inboxSupportsPriority([...ROWS, old])).toBe(false);
    expect(inboxSupportsPriority([])).toBe(false);
  });

  it("keeps a stored priority dormant instead of emptying the list", () => {
    const stored = filters({ priorities: ["high"], statuses: ["todo"] });
    expect(effectiveInboxFilters(stored, false)).toEqual(filters({ statuses: ["todo"] }));
    expect(effectiveInboxFilters(stored, true)).toBe(stored);
  });
});

describe("inboxFacets", () => {
  it("counts each dimension against the other active dimensions only", () => {
    const facets = inboxFacets(ROWS, filters({ statuses: ["in_progress"], actors: ["member:alice"] }));
    // Status ignores its own selection: alice has one todo + one in_progress.
    expect(Object.fromEntries(facets.statuses)).toEqual({ todo: 1, in_progress: 1 });
    // Priority respects status + actor: only row c.
    expect(Object.fromEntries(facets.priorities)).toEqual({ low: 1 });
    // Actor ignores its own selection: in_progress rows are b and c.
    expect(Object.fromEntries(facets.actors)).toEqual({ "agent:bot": 1, "member:alice": 1 });
  });
});

describe("sheet options", () => {
  it("offers actors and statuses from the list plus still-selected ones", () => {
    expect(inboxActorOptions(ROWS, ["member:gone"]).sort()).toEqual(
      ["agent:bot", "member:alice", "member:gone", "system"],
    );
    expect(inboxStatusKeys(ROWS, ["done"]).sort()).toEqual(["done", "in_progress", "todo"]);
  });
});

describe("persistence format", () => {
  it("round-trips", () => {
    const value = filters({ statuses: ["todo", "custom_review"], priorities: ["urgent"], actors: ["system"] });
    expect(parseStoredInboxFilters(serializeInboxFilters(value))).toEqual(value);
  });

  it("tolerates missing, broken or foreign values", () => {
    expect(parseStoredInboxFilters(null)).toBe(EMPTY_INBOX_FILTERS);
    expect(parseStoredInboxFilters("{not json")).toBe(EMPTY_INBOX_FILTERS);
    expect(parseStoredInboxFilters("[]")).toBe(EMPTY_INBOX_FILTERS);
    expect(
      parseStoredInboxFilters(
        JSON.stringify({ statuses: ["todo", 3, "", "todo"], priorities: ["bogus", "low"], actors: "x" }),
      ),
    ).toEqual(filters({ statuses: ["todo"], priorities: ["low"] }));
  });
});

describe("inbox filter strings", () => {
  const KEYS = ["button", "button_active", "title", "status", "priority", "from", "clear", "count_other", "empty_title", "nothing_to_filter"];
  for (const [lang, file] of Object.entries({ de, en, "zh-Hans": zh })) {
    it(`${lang} has every filter_sheet key`, () => {
      const sheet = (file as { filter_sheet: Record<string, string> }).filter_sheet;
      for (const key of KEYS) expect(sheet[key], `${lang}:${key}`).toBeTypeOf("string");
    });
  }
});
