/**
 * Inbox filters: status, priority and actor ("From").
 *
 * Mirrors packages/core/inbox/filter-store.ts (pure part) and the faceted
 * counts of packages/views/inbox/components/inbox-filter-menu.tsx. Mobile
 * keeps its own copy because the web module also creates a web store, see
 * apps/mobile/CLAUDE.md "Sharing and Dependencies". When the web semantics
 * change, sync this file.
 *
 * `GET /api/inbox` has no filter parameters, so filtering is client-side on
 * the deduplicated list the screen renders, exactly like web. "Unread only"
 * is not a filter dimension here: the Inbox segment row already owns it.
 */
import type { InboxItem, IssuePriority, IssueStatus } from "@multica/core/types";

export interface InboxFilters {
  readonly statuses: readonly IssueStatus[];
  readonly priorities: readonly IssuePriority[];
  /** Actor keys, see `inboxActorKey`. */
  readonly actors: readonly string[];
}

export const EMPTY_INBOX_FILTERS: InboxFilters = Object.freeze({
  statuses: Object.freeze([]),
  priorities: Object.freeze([]),
  actors: Object.freeze([]),
});

export type InboxFilterDimension = keyof InboxFilters;

/** Mirrors PRIORITY_ORDER in packages/core/issues/config/priority.ts. */
export const INBOX_PRIORITY_ORDER: readonly IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

/**
 * Stable identity for "who this notification came from". Members and agents
 * key on their id; `system` has no id and collapses into one bucket. Rows
 * without usable attribution return null and never match an actor selection.
 */
export function inboxActorKey(item: InboxItem): string | null {
  const type = item.actor_type;
  if (!type) return null;
  if (type === "system") return "system";
  return item.actor_id ? `${type}:${item.actor_id}` : null;
}

/** Inverse of `inboxActorKey`. */
export function inboxActorKeyParts(key: string): { type: string; id: string } {
  const separator = key.indexOf(":");
  if (separator === -1) return { type: key, id: "" };
  return { type: key.slice(0, separator), id: key.slice(separator + 1) };
}

export function inboxFilterCount(filters: InboxFilters): number {
  return (
    filters.statuses.length + filters.priorities.length + filters.actors.length
  );
}

export function isEmptyInboxFilters(filters: InboxFilters): boolean {
  return inboxFilterCount(filters) === 0;
}

/**
 * OR within a dimension, AND between dimensions. Every dimension is read off
 * the row the list renders (the newest notification of the issue group), so
 * what you filter by is what you see — same rule as web.
 */
export function filterInboxItems(
  items: InboxItem[],
  filters: InboxFilters,
): InboxItem[] {
  if (isEmptyInboxFilters(filters)) return items;
  const statuses = new Set<string>(filters.statuses);
  const priorities = new Set<string>(filters.priorities);
  const actors = new Set(filters.actors);
  return items.filter((item) => {
    const actor = inboxActorKey(item);
    return (
      (statuses.size === 0 ||
        (item.issue_status != null && statuses.has(item.issue_status))) &&
      (priorities.size === 0 ||
        (item.issue_priority != null && priorities.has(item.issue_priority))) &&
      (actors.size === 0 || (actor != null && actors.has(actor)))
    );
  });
}

export function toggleInboxFilter(
  filters: InboxFilters,
  dimension: InboxFilterDimension,
  value: string,
): InboxFilters {
  const current = filters[dimension] as readonly string[];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return { ...filters, [dimension]: next };
}

/**
 * Priority filtering needs `issue_priority` on every row. An older backend
 * omits the field; then a stored priority selection stays dormant instead of
 * emptying the list (web: inboxPriorityFilterSupport).
 */
export function inboxSupportsPriority(items: readonly InboxItem[]): boolean {
  return items.length > 0 && items.every((i) => i.issue_priority !== undefined);
}

export function effectiveInboxFilters(
  filters: InboxFilters,
  prioritySupported: boolean,
): InboxFilters {
  if (prioritySupported || filters.priorities.length === 0) return filters;
  return { ...filters, priorities: [] };
}

export interface InboxFacets {
  statuses: Map<string, number>;
  priorities: Map<string, number>;
  actors: Map<string, number>;
}

/**
 * Faceted counts: each dimension respects the other active dimensions and
 * ignores its own, so a number says how many rows selecting that value can
 * reveal (web inbox-filter-menu.tsx).
 */
export function inboxFacets(
  items: InboxItem[],
  filters: InboxFilters,
): InboxFacets {
  const count = (
    rows: InboxItem[],
    key: (item: InboxItem) => string | null | undefined,
  ) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const k = key(row);
      if (k == null) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  };
  return {
    statuses: count(
      filterInboxItems(items, { ...filters, statuses: [] }),
      (i) => i.issue_status,
    ),
    priorities: count(
      filterInboxItems(items, { ...filters, priorities: [] }),
      (i) => i.issue_priority,
    ),
    actors: count(
      filterInboxItems(items, { ...filters, actors: [] }),
      inboxActorKey,
    ),
  };
}

/**
 * Actor options offered in the sheet: every actor present in the list plus
 * any still-selected actor whose rows are gone (so it can be deselected).
 */
export function inboxActorOptions(
  items: InboxItem[],
  selected: readonly string[],
): string[] {
  const keys = new Set<string>();
  for (const item of items) {
    const key = inboxActorKey(item);
    if (key != null) keys.add(key);
  }
  for (const key of selected) keys.add(key);
  return [...keys];
}

/**
 * Status keys offered in the sheet: statuses present in the list plus any
 * still-selected status. Custom workspace statuses are plain keys.
 */
export function inboxStatusKeys(
  items: InboxItem[],
  selected: readonly string[],
): string[] {
  const keys = new Set<string>(selected);
  for (const item of items) {
    if (item.issue_status != null) keys.add(item.issue_status);
  }
  return [...keys];
}

const PRIORITIES = new Set<string>(INBOX_PRIORITY_ORDER);

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/** Persistence format: tolerant parse, unknown priorities dropped. */
export function parseStoredInboxFilters(raw: string | null): InboxFilters {
  if (!raw) return EMPTY_INBOX_FILTERS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_INBOX_FILTERS;
  }
  if (!value || typeof value !== "object") return EMPTY_INBOX_FILTERS;
  const record = value as Record<string, unknown>;
  const filters: InboxFilters = {
    statuses: stringArray(record.statuses) as IssueStatus[],
    priorities: stringArray(record.priorities).filter((p) =>
      PRIORITIES.has(p),
    ) as IssuePriority[],
    actors: stringArray(record.actors),
  };
  return isEmptyInboxFilters(filters) ? EMPTY_INBOX_FILTERS : filters;
}

export function serializeInboxFilters(filters: InboxFilters): string {
  return JSON.stringify({
    statuses: filters.statuses,
    priorities: filters.priorities,
    actors: filters.actors,
  });
}
