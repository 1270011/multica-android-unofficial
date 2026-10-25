/**
 * Mention frequency for the @-suggestions (W6-P9).
 *
 * Counted locally per workspace after a comment or chat message was sent
 * successfully: every `mention://member|agent|squad/<id>` link in the sent
 * Markdown counts +1, at most once per message and target. `@all` and
 * issues are not counted, edits do not count again. The server knows
 * nothing about it (same as web's mention-recency.ts, which stores only the
 * last time; the app keeps count + last and sorts by count first).
 *
 * Stored in an MMKV instance `mention-usage`, one key per workspace:
 *   `{ v: 1, items: { "<type>:<id>": { n, last } } }`
 * At most 200 entries (the oldest `last` goes first, like web), `n` capped
 * at 9999. Unreadable content counts as empty. Cleared for all workspaces
 * on logout (data/auth-store.ts), per workspace by "Clear history" in
 * Settings › View.
 *
 * The pure part (parse, record, rank) has no native imports so vitest can
 * run it; ./mention-usage-native.ts registers the MMKV store at app start.
 * Without a registered store (tests, a broken MMKV) nothing is kept.
 */

export type MentionUsageType = "member" | "agent" | "squad";

export interface MentionUsageEntry {
  /** Successful sends that mentioned the target. */
  n: number;
  /** Time of the last such send, ms since epoch. */
  last: number;
}

/** `"<type>:<id>"` → entry. */
export type MentionUsage = Record<string, MentionUsageEntry>;

export const MENTION_USAGE_MAX_ENTRIES = 200;
export const MENTION_USAGE_MAX_COUNT = 9999;
const STORAGE_VERSION = 1;

const EMPTY: MentionUsage = Object.freeze({}) as MentionUsage;

export function mentionUsageKey(type: MentionUsageType, id: string): string {
  return `${type}:${id}`;
}

const MENTION_LINK = /\]\(mention:\/\/(member|agent|squad)\/([^)\s]+)\)/g;

/** Distinct counted targets of a sent Markdown body, in order of appearance. */
export function mentionTargetsOf(markdown: string): string[] {
  const seen = new Set<string>();
  for (const match of markdown.matchAll(MENTION_LINK)) {
    seen.add(mentionUsageKey(match[1] as MentionUsageType, match[2]!));
  }
  return [...seen];
}

function isEntry(value: unknown): value is MentionUsageEntry {
  if (!value || typeof value !== "object") return false;
  const { n, last } = value as Record<string, unknown>;
  return (
    typeof n === "number" &&
    Number.isFinite(n) &&
    n >= 1 &&
    typeof last === "number" &&
    Number.isFinite(last)
  );
}

const KEY_SHAPE = /^(member|agent|squad):\S+$/;

/** Stored value → usage; anything unreadable is dropped, never thrown. */
export function parseMentionUsage(raw: string | null | undefined): MentionUsage {
  if (!raw) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY;
  const { v, items } = parsed as { v?: unknown; items?: unknown };
  if (v !== STORAGE_VERSION || !items || typeof items !== "object") return EMPTY;
  const out: MentionUsage = {};
  for (const [key, value] of Object.entries(items as Record<string, unknown>)) {
    if (!KEY_SHAPE.test(key) || !isEntry(value)) continue;
    out[key] = { n: Math.min(Math.floor(value.n), MENTION_USAGE_MAX_COUNT), last: value.last };
  }
  return capEntries(out);
}

export function serializeMentionUsage(usage: MentionUsage): string {
  return JSON.stringify({ v: STORAGE_VERSION, items: usage });
}

/** Keep the newest `max` entries by `last`. */
function capEntries(usage: MentionUsage, max = MENTION_USAGE_MAX_ENTRIES): MentionUsage {
  const keys = Object.keys(usage);
  if (keys.length <= max) return usage;
  const kept = keys.sort((a, b) => usage[b]!.last - usage[a]!.last).slice(0, max);
  const out: MentionUsage = {};
  for (const key of kept) out[key] = usage[key]!;
  return out;
}

/**
 * Usage after one successful send mentioning `targets` at `now`.
 * `known` (when the actor lists are loaded) drops entries of people,
 * agents and squads that no longer exist.
 */
export function recordMentions(
  usage: MentionUsage,
  targets: readonly string[],
  now: number,
  known?: ReadonlySet<string>,
): MentionUsage {
  const next: MentionUsage = {};
  for (const [key, entry] of Object.entries(usage)) {
    if (!known || known.has(key)) next[key] = entry;
  }
  for (const key of new Set(targets)) {
    if (!KEY_SHAPE.test(key)) continue;
    const prev = next[key];
    next[key] = { n: Math.min((prev?.n ?? 0) + 1, MENTION_USAGE_MAX_COUNT), last: now };
  }
  return capEntries(next);
}

export interface RankCandidate {
  /** `mentionUsageKey(type, id)` */
  key: string;
  name: string;
}

/**
 * The most mentioned candidates: count desc, then last mention desc, then
 * name (`localeCompare`). Candidates without a mention and usage entries
 * without a candidate (deleted, archived, hidden, not matching the search)
 * are left out. Input order does not matter.
 */
export function rankFrequent<T extends RankCandidate>(
  usage: MentionUsage,
  candidates: readonly T[],
  limit = 8,
): T[] {
  return candidates
    .filter((c) => usage[c.key] !== undefined)
    .sort((a, b) => {
      const ua = usage[a.key]!;
      const ub = usage[b.key]!;
      return ub.n - ua.n || ub.last - ua.last || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

// ── Storage ────────────────────────────────────────────────────────────────

/** The part of MMKV used here. */
export interface MentionUsageKv {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
  clearAll(): void;
}

let kv: MentionUsageKv | null = null;
const cache = new Map<string, MentionUsage>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Called once by ./mention-usage-native.ts (tests pass a memory store). */
export function registerMentionUsageStore(store: MentionUsageKv | null): void {
  kv = store;
  cache.clear();
  notify();
}

export function subscribeMentionUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current usage of a workspace (cached; a stable object until it changes). */
export function readMentionUsage(wsId: string): MentionUsage {
  const hit = cache.get(wsId);
  if (hit) return hit;
  let usage = EMPTY;
  if (kv) {
    try {
      usage = parseMentionUsage(kv.getString(wsId));
    } catch {
      usage = EMPTY;
    }
  }
  cache.set(wsId, usage);
  return usage;
}

function write(wsId: string, usage: MentionUsage) {
  const empty = Object.keys(usage).length === 0;
  cache.set(wsId, empty ? EMPTY : usage);
  try {
    if (empty) kv?.remove(wsId);
    else kv?.set(wsId, serializeMentionUsage(usage));
  } catch {
    // Best effort: the in-memory value still applies until restart.
  }
  notify();
}

/** Count the mentions of a successfully sent body. */
export function noteSentMentions(
  wsId: string | null,
  markdown: string,
  options: { now?: number; known?: ReadonlySet<string> } = {},
): void {
  if (!wsId) return;
  const targets = mentionTargetsOf(markdown);
  if (targets.length === 0) return;
  write(wsId, recordMentions(readMentionUsage(wsId), targets, options.now ?? Date.now(), options.known));
}

/** Debug seed (lib/mention-frequent.ts `debugSeedUsage`): replaces the history. */
export function replaceMentionUsage(wsId: string, usage: MentionUsage): void {
  write(wsId, capEntries(usage));
}

/** "Clear history" in Settings: this workspace only. */
export function clearMentionUsage(wsId: string): void {
  write(wsId, EMPTY);
}

/** Logout: every workspace on the device. The sort mode stays. */
export function clearAllMentionUsage(): void {
  cache.clear();
  try {
    kv?.clearAll();
  } catch {
    // Nothing more to do; the cache is empty either way.
  }
  notify();
}
