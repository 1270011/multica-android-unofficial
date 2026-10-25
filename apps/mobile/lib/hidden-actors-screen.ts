/**
 * Settings › View › Hide people & agents (W4 P4):
 * the rows, counts and lock state of the screen
 * as pure functions, so the rules are testable without a renderer.
 *
 * - People are keyed by `user_id`, agents by `id` (see lib/view-prefs.ts).
 * - Archived agents are not listed; squads are not part of W4 (decision 1).
 * - The signed-in person has no switch: hiding yourself would drop
 *   "Assign to me" and the creator filter "Me".
 * - Until the workspace's stored list is loaded (`hydrated`), every switch
 *   and "Show all again" stays locked: a change replaces the whole stored
 *   value, so an early tap would overwrite what is still being read.
 * - Section counts cover the whole section, not only the search hits.
 */
import { type HiddenActors, isActorHidden } from "./view-prefs";

export interface HiddenActorsMemberInput {
  user_id: string;
  name: string;
  email?: string | null;
  avatar_url?: string | null;
}

export interface HiddenActorsAgentInput {
  id: string;
  name: string;
  archived_at?: string | null;
  avatar_url?: string | null;
}

export interface HiddenActorRow {
  kind: "members" | "agents";
  id: string;
  name: string;
  avatarUrl: string | null;
  hidden: boolean;
  /** The signed-in person: shown with "(you)", never with a switch. */
  isSelf: boolean;
  /** Switch locked (not hydrated yet). Always true for `isSelf`. */
  disabled: boolean;
}

export interface HiddenActorsModel {
  people: HiddenActorRow[];
  agents: HiddenActorRow[];
  peopleHidden: number;
  agentsHidden: number;
  /** "Show all again" is enabled. */
  canShowAll: boolean;
  /** A search is active and neither section has a hit. */
  noMatches: boolean;
}

export function normalizeActorQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  if (!q) return true;
  return fields.some((f) => !!f && f.toLocaleLowerCase().includes(q));
}

const byName = (a: HiddenActorRow, b: HiddenActorRow) => a.name.localeCompare(b.name);

export function buildHiddenActorsModel(input: {
  members: readonly HiddenActorsMemberInput[];
  agents: readonly HiddenActorsAgentInput[];
  hidden: HiddenActors;
  selfUserId: string | null | undefined;
  query: string;
  hydrated: boolean;
}): HiddenActorsModel {
  const { hidden, selfUserId, hydrated } = input;
  const q = normalizeActorQuery(input.query);

  const allPeople: HiddenActorRow[] = input.members
    .map((m) => {
      const isSelf = !!selfUserId && m.user_id === selfUserId;
      return {
        kind: "members" as const,
        id: m.user_id,
        name: m.name,
        avatarUrl: m.avatar_url ?? null,
        hidden: !isSelf && isActorHidden(hidden, "members", m.user_id),
        isSelf,
        disabled: isSelf || !hydrated,
      };
    })
    .sort(byName);
  const allAgents: HiddenActorRow[] = input.agents
    .filter((a) => !a.archived_at)
    .map((a) => ({
      kind: "agents" as const,
      id: a.id,
      name: a.name,
      avatarUrl: a.avatar_url ?? null,
      hidden: isActorHidden(hidden, "agents", a.id),
      isSelf: false,
      disabled: !hydrated,
    }))
    .sort(byName);

  const emailById = new Map(input.members.map((m) => [m.user_id, m.email]));
  const people = allPeople.filter((r) => matches(q, r.name, emailById.get(r.id)));
  const agents = allAgents.filter((r) => matches(q, r.name));
  const peopleHidden = allPeople.filter((r) => r.hidden).length;
  const agentsHidden = allAgents.filter((r) => r.hidden).length;

  return {
    people,
    agents,
    peopleHidden,
    agentsHidden,
    // Stored ids without a row (deleted actor, self from an older build)
    // still count, so "Show all again" can clear them too.
    canShowAll: hydrated && hidden.members.length + hidden.agents.length > 0,
    noMatches: !!q && people.length === 0 && agents.length === 0,
  };
}

/**
 * Accessibility props for a row: the whole row is the switch
 * (≥ 48 dp target), the visual Switch inside is decoration only. Returns
 * null for yourself – that row has no switch and stays a plain row.
 */
export function actorRowSwitchA11y(
  row: Pick<HiddenActorRow, "isSelf" | "hidden" | "disabled">,
  label: string,
): {
  accessibilityRole: "switch";
  accessibilityLabel: string;
  accessibilityState: { checked: boolean; disabled: boolean };
} | null {
  if (row.isSelf) return null;
  return {
    accessibilityRole: "switch",
    accessibilityLabel: label,
    accessibilityState: { checked: row.hidden, disabled: row.disabled },
  };
}

/**
 * Props for the purely visual Switch inside a toggle row. The row
 * is the single focus stop and click target; the inner Switch must not be its
 * own clickable/focusable view (a no-hide-descendants wrapper alone still
 * leaves it clickable in the Android UI tree).
 */
export const DECORATIVE_SWITCH_PROPS = {
  accessible: false,
  focusable: false,
  importantForAccessibility: "no",
} as const;
