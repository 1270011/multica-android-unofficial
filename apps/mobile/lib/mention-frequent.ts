/**
 * "Frequent" section of the @-sheet and the `@` suggestion bar
 * (W6-P10, A6.1–A6.7).
 *
 * In mode "frequency" (default) up to 8 people, agents and squads with at
 * least one mention move into one mixed section on top: count desc, then
 * last mention desc, then name (`rankFrequent`). They leave their
 * alphabetical sections, so no row shows twice. With search text the
 * caller passes only the matches, so the same rule runs on them. Mode
 * "name" or no history: no section, the sections stay as they are.
 *
 * Hidden actors (W4) never show in "Frequent" (A6.7); their count stays,
 * so they come back at their old place once shown again. Rows the caller
 * marks as not eligible (archived, needs a runtime) stay where they are.
 *
 * Pure; the callers freeze `usage` when the sheet opens (A6.5).
 */
import { type MentionUsage, rankFrequent } from "./mention-usage";
import type { MentionSortMode } from "./view-prefs";

export const FREQUENT_LIMIT = 8;

export interface FrequentKey {
  /** `mentionUsageKey(type, id)` */
  key: string;
  name: string;
}

export interface FrequentSplit<T> {
  /** At most `limit` rows, most mentioned first. */
  frequent: T[];
  /** The input sections without the frequent rows, order kept. */
  sections: T[][];
}

export interface FrequentOptions<T> {
  mode: MentionSortMode;
  /** Hidden in Settings › View (W4): never frequent. */
  isHidden?: (item: T) => boolean;
  /** False for rows that cannot be picked (archived, no runtime). */
  isEligible?: (item: T) => boolean;
  limit?: number;
}

/**
 * Splits the already filtered and sorted `sections` (people, agents,
 * squads) into "Frequent" and the rest. `keyOf` returns null for rows that
 * are never counted (`@all`, issues).
 */
export function splitFrequent<T>(
  sections: readonly (readonly T[])[],
  keyOf: (item: T) => FrequentKey | null,
  usage: MentionUsage,
  opts: FrequentOptions<T>,
): FrequentSplit<T> {
  const unchanged = { frequent: [], sections: sections.map((s) => [...s]) };
  if (opts.mode !== "frequency" || Object.keys(usage).length === 0) return unchanged;

  const candidates: (FrequentKey & { item: T })[] = [];
  for (const section of sections) {
    for (const item of section) {
      const key = keyOf(item);
      if (!key) continue;
      if (opts.isHidden?.(item)) continue;
      if (opts.isEligible && !opts.isEligible(item)) continue;
      candidates.push({ ...key, item });
    }
  }
  const ranked = rankFrequent(usage, candidates, opts.limit ?? FREQUENT_LIMIT);
  if (ranked.length === 0) return unchanged;

  const picked = new Set(ranked.map((c) => c.item));
  return {
    frequent: ranked.map((c) => c.item),
    sections: sections.map((s) => s.filter((item) => !picked.has(item))),
  };
}

/**
 * Debug builds only (Maestro flow `mention-frequent`, nothing is sent):
 * history for the first two of `candidates` (alphabetical) with the second
 * mentioned more often, so "Frequent" shows them against the ABC order.
 * Returns the usage and the name expected on top.
 */
export function debugSeedUsage(
  candidates: readonly FrequentKey[],
  now: number,
): { usage: MentionUsage; top: string | null } {
  const sorted = [...candidates].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 2);
  const usage: MentionUsage = {};
  sorted.forEach((c, i) => {
    usage[c.key] = { n: i === 0 ? 1 : 3, last: now - i * 1000 };
  });
  const top = sorted[1]?.name ?? sorted[0]?.name ?? null;
  return { usage, top };
}
