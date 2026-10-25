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
 *   - The last shown message of every thread carries `replyRootId`: the
 *     bubble shows the "Reply" button under it, which replies to the thread
 *     root (W1-1).
 *   - The unread divider sits before the comment the oldest unread inbox
 *     entry of this issue points at (or, without a comment anchor, before
 *     the first comment created at or after that entry minus a small skew).
 */
import type { InboxItem, TimelineEntry } from "@multica/core/types";
import { isDeletedComment } from "@multica/core/issues/comment-deletion";
import { replaceEqualDeep } from "@tanstack/react-query";
import { sanitizeTimeline } from "@/data/timeline-cache/core";
import { isOptimisticCommentId } from "@/lib/pending-comments";
import { canReplyToThread } from "@/lib/thread-reply";

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
      /** Last shown message of its thread: the root id the "Reply" button
       *  under it replies to. Null for other messages and for
       *  threads whose root is pending, failed or deleted. */
      replyRootId: string | null;
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
  return unreadAnchor(entries, unreadInbox, (e) => ms(e.created_at));
}

function unreadAnchor(
  entries: TimelineEntry[],
  unreadInbox: InboxItem[] | undefined,
  time: (entry: TimelineEntry) => number,
): string | null {
  const unread = (unreadInbox ?? []).filter((i) => !i.read && !i.archived);
  if (unread.length === 0) return null;
  const oldest = [...unread].sort((a, b) => ms(a.created_at) - ms(b.created_at))[0]!;
  const comments = entries.filter((e) => e.type === "comment" && !isDeletedComment(e));
  const byAnchor = oldest.details?.comment_id;
  if (byAnchor && comments.some((c) => c.id === byAnchor)) return byAnchor;
  const since = ms(oldest.created_at) - UNREAD_SKEW_MS;
  const first = comments.find((c) => time(c) >= since);
  return first ? first.id : null;
}

/** What the chat derives from one entry alone; computed once per entry object. */
interface EntryFacts {
  time: number;
  day: string;
  /** Reply quote preview when this entry is a thread root; filled on first use. */
  preview?: string;
}

/**
 * Rows of the previous builds, keyed by the entry objects they were built
 * from. Entries keep their object across refetches (TanStack structural
 * sharing) and WS patches (only the changed entry is replaced), so a rebuild
 * only computes the rows whose entry or neighbourhood changed and returns
 * the previous object for every other row.
 */
interface ChatBuildCache {
  dayKey: (iso: string) => string;
  userId: string | null;
  facts: WeakMap<TimelineEntry, EntryFacts>;
  rows: WeakMap<TimelineEntry, ChatItem>;
  groups: WeakMap<TimelineEntry, Extract<ChatItem, { kind: "system-group" }>>;
  /** Entry → the equal older entry object a kept row still carries. */
  kept: WeakMap<TimelineEntry, TimelineEntry>;
  days: Map<string, ChatItem>;
}

export type ChatItemsBuilder = (
  entries: TimelineEntry[] | undefined,
  options: BuildChatOptions,
) => ChatItem[];

/**
 * Incremental `buildChatItems` plus `shareChatItems`, the chat
 * screen's per-change step. The result equals
 * `shareChatItems(previousResult, buildChatItems(entries, options))`, but a
 * row is only computed when its entry object or its context (neighbours,
 * thread root, unread divider, expanded groups) changed. Day keys,
 * timestamps and quote previews are computed once per entry object. A row
 * that sharing keeps from the previous result (cache → server sync: new
 * entry objects with equal data) is remembered for the new entry object, so
 * later changes reuse it without comparing again. One builder per chat
 * screen; it holds entries only weakly besides the last result.
 */
export function createChatItemsBuilder(): ChatItemsBuilder {
  let cache: ChatBuildCache | null = null;
  let prev: ChatItem[] | undefined;
  return (entries, options) => {
    const dayKey = options.dayKey ?? localDayKey;
    const userId = options.userId;
    if (!cache || cache.dayKey !== dayKey || cache.userId !== userId) {
      cache = {
        dayKey,
        userId,
        facts: new WeakMap(),
        rows: new WeakMap(),
        groups: new WeakMap(),
        kept: new WeakMap(),
        days: new Map(),
      };
    }
    const built = build(entries, options, cache);
    const next = shareChatItems(prev, built);
    if (next !== built) {
      for (let i = 0; i < built.length; i++) {
        const b = built[i]!;
        const kept = next[i]!;
        if (kept === b) continue;
        if ((b.kind === "message" || b.kind === "system") && kept.kind === b.kind) {
          cache.rows.set(b.entry, kept);
        } else if (b.kind === "system-group" && kept.kind === "system-group") {
          cache.groups.set(b.entries[0]!, kept);
          b.entries.forEach((e, j) => cache!.kept.set(e, kept.entries[j]!));
        }
      }
    }
    prev = next;
    return next;
  };
}

/** One full build without previous rows (tests, benchmarks). */
export function buildChatItems(
  entries: TimelineEntry[] | undefined,
  options: BuildChatOptions,
): ChatItem[] {
  return createChatItemsBuilder()(entries, options);
}

function build(
  entries: TimelineEntry[] | undefined,
  options: BuildChatOptions,
  cache: ChatBuildCache,
): ChatItem[] {
  if (!entries || entries.length === 0) return [];
  const expanded = options.expandedGroups ?? new Set<string>();
  const { dayKey, userId } = cache;

  const factsOf = (entry: TimelineEntry): EntryFacts => {
    let f = cache.facts.get(entry);
    if (!f) {
      f = { time: ms(entry.created_at), day: dayKey(entry.created_at) };
      cache.facts.set(entry, f);
    }
    return f;
  };
  const time = (entry: TimelineEntry) => factsOf(entry).time;

  // Stable sort: the server list is already ASC; local pending rows are
  // appended by mergeLocalComments and may carry a slightly older clock.
  // The usual case is an ordered list, which needs no sort at all.
  let ordered = true;
  for (let i = 1; i < entries.length && ordered; i++) {
    if (time(entries[i]!) < time(entries[i - 1]!)) ordered = false;
  }
  const sorted = ordered
    ? entries
    : entries
        .map((entry, index) => ({ entry, index, t: time(entry) }))
        .sort((a, b) => a.t - b.t || a.index - b.index)
        .map((x) => x.entry);

  const byId = new Map<string, TimelineEntry>();
  for (const e of sorted) if (e.type === "comment") byId.set(e.id, e);

  const rootOf = (entry: TimelineEntry): TimelineEntry | null => {
    if (!entry.parent_id || !byId.has(entry.parent_id)) return null;
    let cur = entry;
    const seen = new Set<string>();
    while (cur.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_id)!;
    }
    return cur.id === entry.id ? null : cur;
  };

  // Thread root (or the comment itself) per comment, and the last shown
  // comment of every thread: that bubble carries the "Reply" button.
  const threadOf = new Map<TimelineEntry, TimelineEntry>();
  const lastOfThread = new Map<string, TimelineEntry>();
  for (const e of sorted) {
    if (e.type !== "comment") continue;
    const threadRoot = rootOf(e) ?? e;
    threadOf.set(e, threadRoot);
    if (!isDeletedComment(e)) lastOfThread.set(threadRoot.id, e);
  }

  const previewOf = (root: TimelineEntry): string => {
    const f = factsOf(root);
    f.preview ??= firstLine(root.content);
    return f.preview;
  };

  const anchor = unreadAnchor(sorted, options.unreadInbox, time);
  const out: ChatItem[] = [];
  let lastDay = "";
  let lastMessage: TimelineEntry | null = null;
  let pendingSystem: TimelineEntry[] = [];

  const systemRow = (entry: TimelineEntry, emphasis: boolean): ChatItem => {
    const old = cache.rows.get(entry);
    if (old?.kind === "system" && old.emphasis === emphasis) return old;
    const row: ChatItem = { kind: "system", id: entry.id, entry, emphasis };
    cache.rows.set(entry, row);
    return row;
  };

  const flushSystem = () => {
    if (pendingSystem.length === 0) return;
    const run = pendingSystem;
    pendingSystem = [];
    const groupId = `group:${run[0]!.id}`;
    if (run.length >= SYSTEM_GROUP_MIN && !expanded.has(groupId)) {
      const old = cache.groups.get(run[0]!);
      if (
        old &&
        old.id === groupId &&
        old.entries.length === run.length &&
        old.entries.every((e, i) => e === run[i] || cache.kept.get(run[i]!) === e)
      ) {
        out.push(old);
      } else {
        const group = { kind: "system-group" as const, id: groupId, entries: run };
        cache.groups.set(run[0]!, group);
        out.push(group);
      }
    } else {
      for (const e of run) out.push(systemRow(e, false));
    }
  };

  for (const entry of sorted) {
    if (entry.type === "comment" && isDeletedComment(entry)) continue;

    const day = factsOf(entry).day;
    if (day && day !== lastDay) {
      flushSystem();
      let dayRow = cache.days.get(day);
      if (!dayRow) {
        dayRow = { kind: "day", id: `day:${day}`, day };
        cache.days.set(day, dayRow);
      }
      out.push(dayRow);
      lastDay = day;
      lastMessage = null;
    }

    if (entry.type !== "comment") {
      if (isActionStatusChange(entry)) {
        flushSystem();
        out.push(systemRow(entry, true));
      } else {
        pendingSystem.push(entry);
      }
      lastMessage = null;
      continue;
    }

    flushSystem();
    if (anchor === entry.id) {
      out.push(UNREAD_ROW);
      lastMessage = null;
    }

    const threadRoot = threadOf.get(entry) ?? entry;
    const root = threadRoot === entry ? null : threadRoot;
    const replyRootId =
      lastOfThread.get(threadRoot.id) === entry && canReplyToThread(threadRoot)
        ? threadRoot.id
        : null;
    const groupStart =
      !lastMessage ||
      !sameAuthor(lastMessage, entry) ||
      time(entry) - time(lastMessage) > GROUP_WINDOW_MS ||
      // A reply always shows its quote with a header so it reads as one unit.
      !!root;
    const own = !!userId && entry.actor_type === "member" && entry.actor_id === userId;
    const resolved = !!(root ?? entry).resolved_at;
    const rootDeleted = !!root && isDeletedComment(root);
    const preview = root && !rootDeleted ? previewOf(root) : "";

    const old = cache.rows.get(entry);
    if (
      old?.kind === "message" &&
      old.own === own &&
      old.groupStart === groupStart &&
      old.resolved === resolved &&
      old.replyRootId === replyRootId &&
      (root
        ? !!old.replyTo &&
          old.replyTo.rootId === root.id &&
          old.replyTo.actorType === root.actor_type &&
          old.replyTo.actorId === root.actor_id &&
          old.replyTo.actorName === root.actor_name &&
          old.replyTo.preview === preview &&
          old.replyTo.deleted === rootDeleted
        : !old.replyTo)
    ) {
      out.push(old);
    } else {
      const row: ChatItem = {
        kind: "message",
        id: entry.id,
        entry,
        own,
        groupStart,
        replyTo: root
          ? {
              rootId: root.id,
              actorType: root.actor_type,
              actorId: root.actor_id,
              actorName: root.actor_name,
              preview,
              deleted: rootDeleted,
            }
          : null,
        mentionsMe:
          old?.kind === "message" && old.entry === entry
            ? old.mentionsMe
            : mentionsUser(entry.content, userId),
        resolved,
        replyRootId,
      };
      cache.rows.set(entry, row);
      out.push(row);
    }
    lastMessage = entry;
  }
  flushSystem();
  return out;
}

const UNREAD_ROW: ChatItem = { kind: "unread", id: "unread" };

/**
 * Structural sharing for chat rows: every rebuild
 * after a refetch makes new item objects, which made every visible bubble
 * re-render (Markdown tree included). This keeps the previous object for
 * every row that equals its predecessor, and the previous array when nothing
 * changed, so memoised rows only re-render when their own data changed.
 *
 * Rows are matched by id, not by position, so a row inserted in
 * the middle (unread divider, an entry the sync brings) does not renew every
 * row below it. And an entry from the on-device cache counts as
 * equal to the server's copy when the cache would store the same thing
 * (`sanitizeTimeline`: signed URLs and fields the chat does not show are
 * dropped there). Otherwise the cache → server sync on a cold open renewed
 * every row with an attachment or avatar: all bubbles re-rendered, images
 * reloaded and FlashList re-measured — the flicker and the jump seen after
 * the first content.
 */
export function shareChatItems(prev: ChatItem[] | undefined, next: ChatItem[]): ChatItem[] {
  if (!prev || prev.length === 0) return next;
  // Rows from createChatItemsBuilder are mostly the previous objects already
  //The id map is only needed once a row differs.
  let byId: Map<string, ChatItem> | undefined;
  let same = prev.length === next.length;
  const out = next.map((item, i) => {
    if (item === prev[i]) return item;
    byId ??= new Map(prev.map((p) => [p.id, p]));
    const old = byId.get(item.id);
    const kept = old && sameChatItem(old, item) ? old : item;
    if (kept !== prev[i]) same = false;
    return kept;
  });
  return same ? prev : out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return a === b || replaceEqualDeep(a, b) === a;
}

/** Same entry for the chat: deep-equal, or equal as the cache stores it. */
export function sameChatEntry(a: TimelineEntry, b: TimelineEntry): boolean {
  if (deepEqual(a, b)) return true;
  if (a.id !== b.id || isOptimisticCommentId(a.id)) return false;
  const [sa] = sanitizeTimeline([a]);
  const [sb] = sanitizeTimeline([b]);
  return !!sa && !!sb && deepEqual(sa, sb);
}

function sameChatItem(a: ChatItem, b: ChatItem): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  return keys.every((k) => {
    if (!Object.prototype.hasOwnProperty.call(rb, k)) return false;
    if (k === "entry") return sameChatEntry(ra.entry as TimelineEntry, rb.entry as TimelineEntry);
    if (k === "entries") {
      const ea = ra.entries as TimelineEntry[];
      const eb = rb.entries as TimelineEntry[];
      return ea.length === eb.length && ea.every((e, i) => sameChatEntry(e, eb[i]!));
    }
    return deepEqual(ra[k], rb[k]);
  });
}

/**
 * Prop comparison for memoised chat rows: same keys, every value `Object.is`
 * (what `React.memo` does by default). Exported so the "only the changed
 * bubble re-renders" test uses exactly the comparison the list uses.
 */
export function shallowEqualProps(a: object, b: object): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as (keyof typeof a)[];
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]));
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

/** Deep links can come from any app: only accept a UUID id. */
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
