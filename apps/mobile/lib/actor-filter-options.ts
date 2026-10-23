/**
 * Labels, lists and chips for the assignee and creator sections of the
 * issue filter sheet.
 * Pure functions; the sheet (issues-filter.tsx) and the chips
 * (active-filter-chips.tsx) pass in translated strings via `t`.
 */
import type {
  Agent,
  IssueAssigneeType,
  MemberWithUser,
  Squad,
} from "@multica/core/types";
import {
  type ActorKey,
  actorKey,
  type IssueListFilters,
  parseActorKey,
} from "./issue-list-filters";

/** Rows the sheet shows before "Show all (n)" opens the sub-screen. */
export const ACTOR_LIST_PREVIEW = 8;
/** From this many picked actors on, one count chip replaces the name chips. */
export const ACTOR_CHIP_COLLAPSE = 3;

export type FilterSection = "assignee" | "creator";

export interface ActorOption {
  key: ActorKey;
  type: IssueAssigneeType;
  id: string;
  name: string;
  avatarUrl: string | null;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface ActorDirectory {
  members: readonly MemberWithUser[];
  agents: readonly Agent[];
  squads: readonly Squad[];
}

/**
 * Pickable actors of one section, me excluded (the sheet has its own "Me"
 * row). Order: my agents first, then members, agents and squads, each by
 * name. Archived agents and squads are left out unless picked, so a picked
 * one can still be unticked. `query` matches the name, case-insensitive.
 */
export function actorOptions(
  dir: ActorDirectory,
  opts: {
    userId: string | null;
    types: readonly IssueAssigneeType[];
    selected?: readonly ActorKey[];
    query?: string;
  },
): ActorOption[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  const selected = new Set(opts.selected ?? []);
  const match = (name: string) => !q || name.toLowerCase().includes(q);
  const byName = (a: ActorOption, b: ActorOption) => a.name.localeCompare(b.name);
  const keep = (o: ActorOption, archived: boolean) =>
    match(o.name) && (!archived || selected.has(o.key));

  const members: ActorOption[] = opts.types.includes("member")
    ? dir.members
        .filter((m) => m.user_id !== opts.userId)
        .map((m) => option("member", m.user_id, m.name, m.avatar_url))
        .filter((o) => keep(o, false))
        .sort(byName)
    : [];
  const agents = opts.types.includes("agent") ? dir.agents : [];
  const toAgent = (a: Agent) => option("agent", a.id, a.name, a.avatar_url);
  const mine = agents
    .filter((a) => opts.userId && a.owner_id === opts.userId)
    .map((a) => ({ o: toAgent(a), archived: !!a.archived_at }))
    .filter(({ o, archived }) => keep(o, archived))
    .map(({ o }) => o)
    .sort(byName);
  const others = agents
    .filter((a) => !opts.userId || a.owner_id !== opts.userId)
    .map((a) => ({ o: toAgent(a), archived: !!a.archived_at }))
    .filter(({ o, archived }) => keep(o, archived))
    .map(({ o }) => o)
    .sort(byName);
  const squads: ActorOption[] = opts.types.includes("squad")
    ? dir.squads
        .map((s) => ({ o: option("squad", s.id, s.name, s.avatar_url), archived: !!s.archived_at }))
        .filter(({ o, archived }) => keep(o, archived))
        .map(({ o }) => o)
        .sort(byName)
    : [];
  return [...mine, ...members, ...others, ...squads];
}

function option(
  type: IssueAssigneeType,
  id: string,
  name: string,
  avatarUrl: string | null,
): ActorOption {
  return { key: actorKey(type, id), type, id, name, avatarUrl };
}

/** The sheet shows 8 rows; picked rows beyond those move up so they stay visible. */
export function previewOptions(
  options: readonly ActorOption[],
  selected: readonly ActorKey[],
): { rows: ActorOption[]; hidden: number } {
  if (options.length <= ACTOR_LIST_PREVIEW) return { rows: [...options], hidden: 0 };
  const head = options.slice(0, ACTOR_LIST_PREVIEW);
  const extra = options
    .slice(ACTOR_LIST_PREVIEW)
    .filter((o) => selected.includes(o.key));
  return { rows: [...head, ...extra], hidden: options.length - head.length - extra.length };
}

/**
 * Whether "Nobody" greys out the section's other assignee controls: "My
 * agents and squads", "Me", the assignee kinds and the people list, i.e.
 * everything `setIncludeNoAssignee` clears. The creator section has no
 * "Nobody".
 */
export function lockedByNobody(
  section: FilterSection,
  filters: IssueListFilters,
): boolean {
  return section === "assignee" && filters.includeNoAssignee;
}

/** "Member" / "Agent" / "Squad". */
export function actorTypeLabel(type: IssueAssigneeType, t: Translate): string {
  return t(`filters.actor_type_${type}`);
}

/** TalkBack: "Ana, Member, selected" (D3b). */
export function actorOptionA11yLabel(
  name: string,
  type: IssueAssigneeType,
  selected: boolean,
  t: Translate,
): string {
  const parts = [name, actorTypeLabel(type, t)];
  if (selected) parts.push(t("filters.selected"));
  return parts.join(", ");
}

/**
 * Display name of a picked actor: "Me" for my own member key, the directory
 * name otherwise, "Unknown" for deleted members and archived or unknown
 * agents and squads that the lists no longer carry.
 */
export function actorDisplayName(
  key: ActorKey,
  dir: ActorDirectory,
  userId: string | null,
  t: Translate,
): string {
  const ref = parseActorKey(key);
  if (!ref) return t("filters.unknown_actor");
  if (ref.type === "member") {
    if (ref.id === userId) return t("filters.me");
    return dir.members.find((m) => m.user_id === ref.id)?.name ?? t("filters.unknown_actor");
  }
  if (ref.type === "agent") {
    return dir.agents.find((a) => a.id === ref.id)?.name ?? t("filters.unknown_actor");
  }
  return dir.squads.find((s) => s.id === ref.id)?.name ?? t("filters.unknown_actor");
}

export type ActorChipClear =
  | { kind: "assignee"; key: ActorKey }
  | { kind: "assignees" }
  | { kind: "assigneeType"; type: IssueAssigneeType }
  | { kind: "noAssignee" }
  | { kind: "creator"; key: ActorKey }
  | { kind: "creators" };

export interface ActorChip {
  id: string;
  /** Visible text, e.g. "Assignee: Ana". */
  label: string;
  /** TalkBack, e.g. "Remove filter Assignee Ana". */
  a11yLabel: string;
  clear: ActorChipClear;
}

/**
 * Chips for the assignee and creator filters (spec §2 "Chips"): one chip
 * per picked actor ("Assignee: Ana"), from ACTOR_CHIP_COLLAPSE on one count
 * chip ("Assignee: 3") whose ✕ clears the whole list; one chip per kind
 * ("Kind: Agents") and "No assignee". Pass filters already locked for the
 * tab (lockFiltersForScope) so hidden sections get no chips.
 */
export function actorFilterChips(
  filters: IssueListFilters,
  dir: ActorDirectory,
  userId: string | null,
  t: Translate,
): ActorChip[] {
  const chips: ActorChip[] = [];
  const section = (s: FilterSection) => t(`filters.chip_${s}`);
  const chip = (id: string, s: string, value: string, clear: ActorChipClear): ActorChip => ({
    id,
    label: `${s}: ${value}`,
    a11yLabel: t("filters.remove_section_chip", { section: s, label: value }),
    clear,
  });

  if (filters.includeNoAssignee) {
    const label = t("filters.no_assignee_chip");
    chips.push({
      id: "no-assignee",
      label,
      a11yLabel: t("filters.remove_chip", { label }),
      clear: { kind: "noAssignee" },
    });
  }
  const pushActors = (
    s: FilterSection,
    keys: readonly ActorKey[],
    one: (key: ActorKey) => ActorChipClear,
    all: ActorChipClear,
  ) => {
    if (keys.length >= ACTOR_CHIP_COLLAPSE) {
      chips.push(chip(`${s}-count`, section(s), String(keys.length), all));
      return;
    }
    for (const key of keys) {
      chips.push(chip(`${s}-${key}`, section(s), actorDisplayName(key, dir, userId, t), one(key)));
    }
  };
  pushActors(
    "assignee",
    filters.assignees,
    (key) => ({ kind: "assignee", key }),
    { kind: "assignees" },
  );
  for (const type of filters.assigneeTypes) {
    chips.push(
      chip(`type-${type}`, t("filters.chip_assignee_type"), t(`filters.assignee_type_${type}`), {
        kind: "assigneeType",
        type,
      }),
    );
  }
  pushActors(
    "creator",
    filters.creators,
    (key) => ({ kind: "creator", key }),
    { kind: "creators" },
  );
  return chips;
}

/** Applies a chip's ✕ to the filters (store-independent, for tests). */
export function clearActorChip(
  filters: IssueListFilters,
  clear: ActorChipClear,
): IssueListFilters {
  switch (clear.kind) {
    case "assignee":
      return { ...filters, assignees: filters.assignees.filter((k) => k !== clear.key) };
    case "assignees":
      return { ...filters, assignees: [] };
    case "assigneeType":
      return { ...filters, assigneeTypes: filters.assigneeTypes.filter((x) => x !== clear.type) };
    case "noAssignee":
      return { ...filters, includeNoAssignee: false };
    case "creator":
      return { ...filters, creators: filters.creators.filter((k) => k !== clear.key) };
    case "creators":
      return { ...filters, creators: [] };
  }
}

/**
 * Resets one section after the server rejected its parameters (spec §2
 * "Zustände"). The assignee section covers "My agents and squads" too.
 */
export function clearFilterSection(
  filters: IssueListFilters,
  section: FilterSection,
): IssueListFilters {
  if (section === "creator") return { ...filters, creators: [] };
  return {
    ...filters,
    involvesMe: false,
    includeNoAssignee: false,
    assignees: [],
    assigneeTypes: [],
  };
}

/**
 * Which sections a 400 from `GET /api/issues` points at. The server names
 * the parameter in its message ("invalid assignee_types", "invalid
 * creator_filters"); without a hint both server-side sections are reset.
 * Only sections that are set count, so an unrelated 400 changes nothing.
 */
export function sectionsForBadRequest(
  message: string,
  filters: IssueListFilters,
): FilterSection[] {
  const hasAssignee =
    filters.involvesMe ||
    filters.includeNoAssignee ||
    filters.assignees.length > 0 ||
    filters.assigneeTypes.length > 0;
  const hasCreator = filters.creators.length > 0;
  const m = message.toLowerCase();
  const namesAssignee = /assignee|involves/.test(m);
  const namesCreator = /creator/.test(m);
  const out: FilterSection[] = [];
  if (hasAssignee && (namesAssignee || !namesCreator)) out.push("assignee");
  if (hasCreator && (namesCreator || !namesAssignee)) out.push("creator");
  return out;
}
