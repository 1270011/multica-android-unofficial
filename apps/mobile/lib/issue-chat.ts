/**
 * Issue chat: the comment thread of an
 * issue rendered as a messenger. Pure data shaping only — the screen lives
 * in `app/(app)/[workspace]/issue/[id]/chat.tsx`.
 *
 * Same data as the detail timeline (`issueTimelineOptions` plus the local
 * pending/failed rows from `lib/pending-comments.ts`), different layout:
 *
 *   - Comments stay flat in time order. A reply carries a quote of its
 *     thread root (the detail screen bundles replies into the root bubble
 *     instead, see `lib/timeline-thread.ts`). Counts agree with the detail:
 *     no comment is dropped or duplicated, except deleted ones, which the
 *     chat hides (a deleted root keeps its replies; they quote "deleted").
 *   - Activity entries become one-line system rows. A run of more than
 *     `SYSTEM_GROUP_MIN - 1` plain system rows folds into one expandable
 *     group; status changes to `blocked`/`in_review` stay on their own row
 *     and are emphasised.
 *   - Messages by the same author within `GROUP_WINDOW_MS` share one header.
 *   - A day separator precedes the first row of every calendar day.
 *   - The unread divider sits before the comment the oldest unread inbox
 *     entry of this issue points at (or, without a comment anchor, before
 *     the first comment created at or after that entry minus a small skew).
 */
import type { InboxItem, TimelineEntry } from "@multica/core/types";
import { isDeletedComment } from "@multica/core/issues/comment-deletion";

/** Same author within this window → one bubble group (UX §8.2). */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** Runs of at least this many plain system rows are folded (UX §8.2: "mehr als drei"). */
export const SYSTEM_GROUP_MIN = 4;
/** The inbox row is written after the comment it reports; allow for that. */
const UNREAD_SKEW_MS = 5000;

/** Status targets that the chat highlights and that open the chat from the inbox. */
export const ACTION_STATUSES: ReadonlySet<string> = new Set(["blocked", "in_review"]);

export interface ReplyQuote {
  rootId: string;
  actorType: string;
  actorId: string;
  actorName?: string;
  /** First non-empty line of the root, plain text; empty when deleted. */
  preview: string;
  deleted: boolean;
}

export type ChatItem =
  | { kind: "day"; id: string; day: string }
  | { kind: "unread"; id: string }
  | {
      kind: "message";
      id: string;
      entry: TimelineEntry;
      own: boolean;
      /** First bubble of an author group: show avatar + name. */
      groupStart: boolean;
      replyTo: ReplyQuote | null;
      mentionsMe: boolean;
      /** Belongs to a resolved thread (root or reply): rendered dimmed. */
      resolved: boolean;
    }
  | { kind: "system"; id: string; entry: TimelineEntry; emphasis: boolean }
  | { kind: "system-group"; id: string; entries: TimelineEntry[] };

export interface BuildChatOptions {
  userId: string | null;
  /** Unread inbox entries of THIS issue (any order). */
  unreadInbox?: InboxItem[];
  /** Calendar-day key of an ISO timestamp; injectable for tests (time zones). */
  dayKey?: (iso: string) => string;
  /** Ids of folded system groups the user expanded. */
  expandedGroups?: ReadonlySet<string>;
}

export function localDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const MENTION_RE = /mention:\/\/(member|all)\/([A-Za-z0-9-]+)/g;

/** True when the comment mentions the signed-in member (or @all). */
export function mentionsUser(content: string | undefined, userId: string | null): boolean {
  if (!content || !userId) return false;
  for (const m of content.matchAll(MENTION_RE)) {
    if (m[1] === "all" || m[2] === userId) return true;
  }
  return false;
}

/** First non-empty line, markdown links/mentions reduced to their label. */
export function firstLine(content: string | undefined, max = 120): string {
  if (!content) return "";
  const line =
    content
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const plain = line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export function isActionStatusChange(entry: TimelineEntry): boolean {
  if (entry.type !== "activity" || entry.action !== "status_changed") return false;
  const to = (entry.details as Record<string, unknown> | undefined)?.to;
  return typeof to === "string" && ACTION_STATUSES.has(to);
}

function sameAuthor(a: TimelineEntry, b: TimelineEntry): boolean {
  return a.actor_type === b.actor_type && a.actor_id === b.actor_id;
}

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Comment id the unread divider should precede, or null. */
export function unreadAnchorId(
  entries: TimelineEntry[],
  unreadInbox: InboxItem[] | undefined,
): string | null {
  const unread = (unreadInbox ?? []).filter((i) => !i.read && !i.archived);
  if (unread.length === 0) return null;
  const oldest = [...unread].sort((a, b) => ms(a.created_at) - ms(b.created_at))[0]!;
  const comments = entries.filter((e) => e.type === "comment" && !isDeletedComment(e));
  const byAnchor = oldest.details?.comment_id;
  if (byAnchor && comments.some((c) => c.id === byAnchor)) return byAnchor;
  const since = ms(oldest.created_at) - UNREAD_SKEW_MS;
  const first = comments.find((c) => ms(c.created_at) >= since);
  return first ? first.id : null;
}

export function buildChatItems(
  entries: TimelineEntry[] | undefined,
  options: BuildChatOptions,
): ChatItem[] {
  if (!entries || entries.length === 0) return [];
  const dayKey = options.dayKey ?? localDayKey;
  const expanded = options.expandedGroups ?? new Set<string>();
  // Stable sort: the server list is already ASC; local pending rows are
  // appended by mergeLocalComments and may carry a slightly older clock.
  const sorted = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => ms(a.entry.created_at) - ms(b.entry.created_at) || a.index - b.index)
    .map((x) => x.entry);

  const byId = new Map<string, TimelineEntry>();
  for (const e of sorted) if (e.type === "comment") byId.set(e.id, e);

  const rootOf = (entry: TimelineEntry): TimelineEntry | null => {
    let cur = entry;
    const seen = new Set<string>();
    while (cur.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_id)!;
    }
    return cur.id === entry.id ? null : cur;
  };

  const anchor = unreadAnchorId(sorted, options.unreadInbox);
  const out: ChatItem[] = [];
  let lastDay = "";
  let lastMessage: TimelineEntry | null = null;
  let pendingSystem: TimelineEntry[] = [];

  const flushSystem = () => {
    if (pendingSystem.length === 0) return;
    const run = pendingSystem;
    pendingSystem = [];
    const groupId = `group:${run[0]!.id}`;
    if (run.length >= SYSTEM_GROUP_MIN && !expanded.has(groupId)) {
      out.push({ kind: "system-group", id: groupId, entries: run });
    } else {
      for (const e of run) out.push({ kind: "system", id: e.id, entry: e, emphasis: false });
    }
  };

  for (const entry of sorted) {
    if (entry.type === "comment" && isDeletedComment(entry)) continue;

    const day = dayKey(entry.created_at);
    if (day && day !== lastDay) {
      flushSystem();
      out.push({ kind: "day", id: `day:${day}`, day });
      lastDay = day;
      lastMessage = null;
    }

    if (entry.type !== "comment") {
      if (isActionStatusChange(entry)) {
        flushSystem();
        out.push({ kind: "system", id: entry.id, entry, emphasis: true });
      } else {
        pendingSystem.push(entry);
      }
      lastMessage = null;
      continue;
    }

    flushSystem();
    if (anchor === entry.id) {
      out.push({ kind: "unread", id: "unread" });
      lastMessage = null;
    }

    const root = rootOf(entry);
    const groupStart =
      !lastMessage ||
      !sameAuthor(lastMessage, entry) ||
      ms(entry.created_at) - ms(lastMessage.created_at) > GROUP_WINDOW_MS ||
      // A reply always shows its quote with a header so it reads as one unit.
      !!root;

    out.push({
      kind: "message",
      id: entry.id,
      entry,
      own:
        !!options.userId &&
        entry.actor_type === "member" &&
        entry.actor_id === options.userId,
      groupStart,
      replyTo: root
        ? {
            rootId: root.id,
            actorType: root.actor_type,
            actorId: root.actor_id,
            actorName: root.actor_name,
            preview: isDeletedComment(root) ? "" : firstLine(root.content),
            deleted: isDeletedComment(root),
          }
        : null,
      mentionsMe: mentionsUser(entry.content, options.userId),
      resolved: !!(root ?? entry).resolved_at,
    });
    lastMessage = entry;
  }
  flushSystem();
  return out;
}

/** Inbox types whose tap opens the chat (UX §8.1); everything else opens the detail. */
const CHAT_TYPES: ReadonlySet<string> = new Set([
  "new_comment",
  "mentioned",
  "reaction_added",
  "task_failed",
  // Known to the client type, not emitted by server v0.6.1 (UX §8.3).
  "review_requested",
  "agent_blocked",
]);

export function opensInChat(item: Pick<InboxItem, "type" | "details" | "issue_id">): boolean {
  if (!item.issue_id) return false;
  if (CHAT_TYPES.has(item.type)) return true;
  if (item.type === "status_changed") {
    const to = item.details?.to;
    return typeof to === "string" && ACTION_STATUSES.has(to);
  }
  return false;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deep links can come from any app (security T5): only accept a UUID id. */
export function isIssueId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Unread, non-archived inbox entries that belong to an issue. */
export function unreadForIssue(items: InboxItem[] | undefined, issueId: string): InboxItem[] {
  return (items ?? []).filter((i) => i.issue_id === issueId && !i.read && !i.archived);
}

/** Non-archived inbox entries of an issue — "Erledigt" is offered while there are any. */
export function activeForIssue(items: InboxItem[] | undefined, issueId: string): InboxItem[] {
  return (items ?? []).filter((i) => i.issue_id === issueId && !i.archived);
}

/**
 * "Erledigt" (done + archive) is offered while the issue has inbox entries and
 * is not closed yet; a done/cancelled issue only needs archiving, which the
 * existing Archive action covers.
 */
export function canMarkDone(status: string | null | undefined, activeInboxCount: number): boolean {
  return activeInboxCount > 0 && status !== "done" && status !== "cancelled";
}
