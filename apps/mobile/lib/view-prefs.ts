/**
 * Settings › View (W4–W6): value types,
 * defaults and the SecureStore (de)serialisation for
 *   - hidden people/agents (W4, per workspace)
 *   - the issue title filter (W5, per workspace)
 *   - the @-suggestion sort mode (W6, per device)
 *
 * Pure functions only; the store lives in data/stores/view-prefs-store.ts.
 * Stored values are parsed defensively: anything unreadable falls back to
 * the default instead of throwing.
 */
import { titleFilterState } from "./title-filter";

/** Locally hidden actors of one workspace. `squads` is reserved for later
 *  (decision 1: no squads in W4 yet). */
export interface HiddenActors {
  members: string[];
  agents: string[];
}

export type HiddenActorKind = keyof HiddenActors;

export const EMPTY_HIDDEN_ACTORS: HiddenActors = Object.freeze({
  members: [],
  agents: [],
}) as HiddenActors;

export interface TitleFilterSettings {
  enabled: boolean;
  pattern: string;
  ignoreCase: boolean;
  /** "Also mute push notifications" (W7): only usable while the filter is
   *  on and the pattern valid; see lib/notify/title-mute.ts. */
  mutePush: boolean;
}

/** `^AUTO: ` with the trailing space, upper case on purpose. */
export const DEFAULT_TITLE_FILTER_PATTERN = "^AUTO: ";

export const DEFAULT_TITLE_FILTER: TitleFilterSettings = Object.freeze({
  enabled: false,
  pattern: DEFAULT_TITLE_FILTER_PATTERN,
  ignoreCase: false,
  mutePush: false,
}) as TitleFilterSettings;

export type MentionSortMode = "frequency" | "name";

export const DEFAULT_MENTION_SORT: MentionSortMode = "frequency";

// SecureStore keys allow only [A-Za-z0-9._-].
function safeWsId(wsId: string): string {
  return wsId.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function hiddenActorsStorageKey(wsId: string): string {
  return `rb.hidden_actors.${safeWsId(wsId)}`;
}

export function titleFilterStorageKey(wsId: string): string {
  return `rb.issue_title_filter.${safeWsId(wsId)}`;
}

/** Device preference, not workspace data: survives logout like the language. */
export const MENTION_SORT_STORAGE_KEY = "rb.view.mention_sort";

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && v !== ""))];
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseStoredHiddenActors(raw: string | null): HiddenActors {
  const value = parseJson(raw);
  if (!value || typeof value !== "object") return EMPTY_HIDDEN_ACTORS;
  const v = value as Record<string, unknown>;
  const parsed = { members: stringList(v.members), agents: stringList(v.agents) };
  return isEmptyHiddenActors(parsed) ? EMPTY_HIDDEN_ACTORS : parsed;
}

export function serializeHiddenActors(hidden: HiddenActors): string {
  return JSON.stringify({ members: hidden.members, agents: hidden.agents });
}

export function isEmptyHiddenActors(hidden: HiddenActors): boolean {
  return hidden.members.length === 0 && hidden.agents.length === 0;
}

export function hiddenActorCount(hidden: HiddenActors): number {
  return hidden.members.length + hidden.agents.length;
}

export function isActorHidden(
  hidden: HiddenActors,
  kind: HiddenActorKind,
  id: string,
): boolean {
  return hidden[kind].includes(id);
}

export function setActorHidden(
  hidden: HiddenActors,
  kind: HiddenActorKind,
  id: string,
  on: boolean,
): HiddenActors {
  const has = hidden[kind].includes(id);
  if (has === on) return hidden;
  const list = on ? [...hidden[kind], id] : hidden[kind].filter((x) => x !== id);
  return { ...hidden, [kind]: list };
}

/** Drops ids of actors that no longer exist (deleted members, archived
 *  agents). Returns the same object when nothing changed. */
export function pruneHiddenActors(
  hidden: HiddenActors,
  existing: { members: Iterable<string>; agents: Iterable<string> },
): HiddenActors {
  const members = new Set(existing.members);
  const agents = new Set(existing.agents);
  const next = {
    members: hidden.members.filter((id) => members.has(id)),
    agents: hidden.agents.filter((id) => agents.has(id)),
  };
  if (
    next.members.length === hidden.members.length &&
    next.agents.length === hidden.agents.length
  ) {
    return hidden;
  }
  return isEmptyHiddenActors(next) ? EMPTY_HIDDEN_ACTORS : next;
}

export function parseStoredTitleFilter(raw: string | null): TitleFilterSettings {
  const value = parseJson(raw);
  if (!value || typeof value !== "object") return DEFAULT_TITLE_FILTER;
  const v = value as Record<string, unknown>;
  return {
    enabled: v.enabled === true,
    pattern: typeof v.pattern === "string" ? v.pattern : DEFAULT_TITLE_FILTER_PATTERN,
    ignoreCase: v.ignoreCase === true,
    mutePush: v.mutePush === true,
  };
}

export function serializeTitleFilter(settings: TitleFilterSettings): string {
  return JSON.stringify({
    enabled: settings.enabled,
    pattern: settings.pattern,
    ignoreCase: settings.ignoreCase,
    mutePush: settings.mutePush,
  });
}

export function isDefaultTitleFilter(settings: TitleFilterSettings): boolean {
  return (
    settings.enabled === DEFAULT_TITLE_FILTER.enabled &&
    settings.pattern === DEFAULT_TITLE_FILTER.pattern &&
    settings.ignoreCase === DEFAULT_TITLE_FILTER.ignoreCase &&
    settings.mutePush === DEFAULT_TITLE_FILTER.mutePush
  );
}

/** State shown in the Settings row: same rules as the lists
 *  (lib/title-filter.ts: syntax, length, nested repetition, too slow). */
export type TitleFilterSummary = "off" | "on" | "invalid";

export function titleFilterSummary(settings: TitleFilterSettings): TitleFilterSummary {
  const state = titleFilterState(settings);
  return state.status === "active" ? "on" : state.status === "error" ? "invalid" : "off";
}

export function parseMentionSort(raw: string | null): MentionSortMode {
  return raw === "name" || raw === "frequency" ? raw : DEFAULT_MENTION_SORT;
}
