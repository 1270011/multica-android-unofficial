/**
 * On-device timeline cache, storage logic.
 *
 * The issue chat shows the last known timeline at once instead of waiting
 * for the network (~1.8 s on a known issue). Comments can carry
 * logs and agent output, so the cache is treated like session data:
 *   C1  only `issueKeys.timeline(wsId, id)` is stored (`shouldPersistQuery`)
 *   C2  LRU of at most 20 issues, 512 KB per entry, 5 MB in total; entries
 *       older than 7 days are deleted instead of shown
 *   C3  only timeline fields; attachments keep id/filename/content_type/
 *       size_bytes, URLs lose their query (signed URLs, tokens). On read
 *       their URLs are the stable `/api/attachments/<id>/download` path
 *So images and file cards work before the sync
 *   C6  bound to server origin, user id and schema version; any mismatch
 *       deletes everything
 *   C12 every entry is validated on read; a broken one is deleted, nothing
 *       of its content is logged
 *
 * This file is pure: the encrypted store (MMKV), the key and the clock are
 * passed in, so vitest covers it without native modules. The runtime glue
 * (key, MMKV in noBackupFilesDir, clearing on session end) is in ./index.ts.
 */
import type { Attachment, TimelineEntry } from "@multica/core/types";
import { attachmentDownloadPath } from "@multica/core/types";
import { TimelineEntriesSchema } from "@multica/core/api/schemas";
import { isOptimisticCommentId } from "@/lib/pending-comments";

/** The subset of MMKV the cache uses. */
export interface KvStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
  getAllKeys(): string[];
  clearAll(): void;
}

export interface CacheBinding {
  serverOrigin: string;
  userId: string;
}

/** Bump when the stored shape changes; old caches are then deleted. */
export const SCHEMA_VERSION = 1;
export const MAX_ENTRIES = 20;
export const MAX_ENTRY_BYTES = 512 * 1024;
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Longest uninterrupted schema check when an issue opens. */
export const CHUNK_BUDGET_MS = 8;

/** One entry of the timeline schema (the array schema's element). */
const TimelineEntrySchema = TimelineEntriesSchema.element;

const clock: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const META_KEY = "meta";
const LRU_KEY = "lru";
const ENTRY_PREFIX = "t:";

interface Meta {
  serverOrigin: string;
  userId: string;
  schemaVersion: number;
}

interface LruItem {
  /** Store key of the entry. */
  k: string;
  /** Last read or write (ms), drives eviction. */
  at: number;
  /** Stored size in UTF-16 code units × 2 (upper bound of the bytes). */
  b: number;
}

interface StoredEntry {
  v: number;
  /** When the server data was received (ms); the 7-day limit counts from here. */
  savedAt: number;
  entries: TimelineEntry[];
}

export interface CachedTimeline {
  entries: TimelineEntry[];
  savedAt: number;
}

// ── C1 ─────────────────────────────────────────────────────────────────

/**
 * Allowlist: only `["issues", wsId, "timeline", issueId]` may reach the
 * device. Detail, lists, inbox, chat sessions and the mutation cache never
 * do.
 */
export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  return (
    queryKey.length === 4 &&
    queryKey[0] === "issues" &&
    typeof queryKey[1] === "string" &&
    queryKey[1].length > 0 &&
    queryKey[2] === "timeline" &&
    typeof queryKey[3] === "string" &&
    queryKey[3].length > 0
  );
}

export function entryKey(wsId: string, issueId: string): string {
  return `${ENTRY_PREFIX}${wsId}:${issueId}`;
}

// ── C3 ─────────────────────────────────────────────────────────────────

/** Drop query and fragment (signed URLs, tokens); keep scheme, host, path. */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** The fields of a timeline entry the chat renders. Everything else stays off the device. */
const ENTRY_FIELDS = [
  "type",
  "id",
  "actor_type",
  "actor_id",
  "created_at",
  "actor_name",
  "action",
  "details",
  "content",
  "parent_id",
  "updated_at",
  "revision",
  "comment_type",
  "quick_action_id",
  "reactions",
  "resolved_at",
  "resolved_by_type",
  "resolved_by_id",
  "source_task_id",
  "supplements",
  "supplement_task_id",
  "supplement_status",
  "supplement_failure_reason",
  "supplement_delivered_at",
  "deleted_at",
  "coalesced_count",
] as const;

function sanitizeEntry(entry: TimelineEntry): TimelineEntry {
  const out: Record<string, unknown> = {};
  for (const field of ENTRY_FIELDS) {
    if (entry[field] !== undefined) out[field] = entry[field];
  }
  if (entry.actor_avatar_url) out.actor_avatar_url = stripUrlQuery(entry.actor_avatar_url);
  if (entry.attachments) {
    // Metadata only: no file, no (signed) URL. `withStableUrls` rebuilds
    // the unsigned download path from the id when the entry is read.
    out.attachments = entry.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      content_type: a.content_type,
      size_bytes: a.size_bytes,
      url: "",
      download_url: "",
      markdown_url: "",
    }));
  }
  return out as unknown as TimelineEntry;
}

/**
 * Stored attachments have empty URLs. Give them the stable, unsigned
 * `/api/attachments/<id>/download` path the server re-signs on every
 * request, so an image renders at its real size and a file card opens
 * before the sync (no empty `uri`, no height jump), and the inline/card
 * dedup matches the same path the comment body uses.
 */
function withStableUrls(entry: TimelineEntry): TimelineEntry {
  if (!entry.attachments?.length) return entry;
  return {
    ...entry,
    attachments: entry.attachments.map((a): Attachment => {
      const path = attachmentDownloadPath(a.id);
      return {
        ...a,
        url: a.url || path,
        download_url: a.download_url || path,
        markdown_url: a.markdown_url || path,
      };
    }),
  };
}

/** C3 + no unconfirmed local comments (their text lives in the mutation cache, C1). */
export function sanitizeTimeline(entries: readonly TimelineEntry[]): TimelineEntry[] {
  return entries.filter((e) => !isOptimisticCommentId(e.id)).map(sanitizeEntry);
}

// ── Store ──────────────────────────────────────────────────────────────

export class TimelineCacheStore {
  /** Bumped by every wipe (bind, clear); see `versionOf`. */
  private epoch = 0;
  private readonly versions = new Map<string, number>();

  constructor(
    private readonly kv: KvStore,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Compare the stored binding with the current session; on any
   * difference (other server, other user, other schema, no or broken meta)
   * delete everything and write the new binding. Returns whether it wiped.
   */
  bind(binding: CacheBinding): boolean {
    const meta: Meta = { ...binding, schemaVersion: SCHEMA_VERSION };
    const stored = this.readJson<Meta>(META_KEY);
    const same =
      !!stored &&
      stored.serverOrigin === meta.serverOrigin &&
      stored.userId === meta.userId &&
      stored.schemaVersion === meta.schemaVersion;
    if (same) return false;
    const hadData = this.kv.getAllKeys().length > 0;
    this.epoch += 1;
    this.kv.clearAll();
    this.kv.set(META_KEY, JSON.stringify(meta));
    return hadData;
  }

  /**
   * C2/C12: the cached timeline, or null (missing, too old, broken).
   * Validates in one go; used by `patch` (WS events). Opening an issue uses
   * `readInChunks`, which runs the same check without a long JS block.
   */
  read(wsId: string, issueId: string): CachedTimeline | null {
    const key = entryKey(wsId, issueId);
    const stored = this.readStored(key);
    if (!stored) return null;
    const parsed = TimelineEntriesSchema.safeParse(stored.entries);
    if (!parsed.success) {
      // No content in logs, not even `received`.
      this.drop(key);
      return null;
    }
    this.touch(key);
    const entries = (parsed.data as unknown as TimelineEntry[]).map(withStableUrls);
    return { entries, savedAt: stored.savedAt };
  }

  /**
   * Same result and the same C12 check as `read`, but the schema check runs
   * entry by entry in blocks of at most `budgetMs` with a macrotask yield in
   * between (the one-shot check of a 512 KB entry blocked the JS
   * thread while the chat opened). Any broken entry still drops the whole
   * entry, nothing is logged. If the entry or the store changed during a
   * yield (write, patch, remove, session end), the result is null: the
   * caller then shows nothing from the device and waits for the sync.
   */
  async readInChunks(
    wsId: string,
    issueId: string,
    opts: { budgetMs?: number; signal?: AbortSignal } = {},
  ): Promise<CachedTimeline | null> {
    const key = entryKey(wsId, issueId);
    const version = this.versionOf(key);
    const stored = this.readStored(key);
    if (!stored) return null;
    const budgetMs = opts.budgetMs ?? CHUNK_BUDGET_MS;
    const raw = stored.entries;
    const entries: TimelineEntry[] = [];
    let blockStart = clock();
    for (let i = 0; i < raw.length; i++) {
      if (clock() - blockStart >= budgetMs) {
        await yieldToEventLoop();
        if (opts.signal?.aborted || this.versionOf(key) !== version) return null;
        blockStart = clock();
      }
      const parsed = TimelineEntrySchema.safeParse(raw[i]);
      if (!parsed.success) {
        // C12, as in `read`.
        if (this.versionOf(key) === version) this.drop(key);
        return null;
      }
      entries.push(withStableUrls(parsed.data as unknown as TimelineEntry));
    }
    if (opts.signal?.aborted || this.versionOf(key) !== version) return null;
    this.touch(key);
    return { entries, savedAt: stored.savedAt };
  }

  /** Parsed entry with valid header, entries not yet checked; drops a broken one. */
  private readStored(key: string): { entries: unknown[]; savedAt: number } | null {
    const stored = this.readJson<StoredEntry>(key);
    if (!stored) {
      if (this.kv.getString(key) !== undefined) this.drop(key); // unparsable JSON
      return null;
    }
    if (
      stored.v !== SCHEMA_VERSION ||
      typeof stored.savedAt !== "number" ||
      this.now() - stored.savedAt > MAX_AGE_MS ||
      stored.savedAt > this.now() + MAX_AGE_MS ||
      !Array.isArray(stored.entries)
    ) {
      this.drop(key);
      return null;
    }
    return { entries: stored.entries, savedAt: stored.savedAt };
  }

  /** Changes whenever this entry or the whole store is written or removed. */
  private versionOf(key: string): string {
    return `${this.epoch}:${this.versions.get(key) ?? 0}`;
  }

  private bump(key: string): void {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
  }

  /**
   * C2/C3: store a sanitized timeline. A too large entry is not written (and
   * an older copy of it removed, so it cannot come back stale). Returns
   * whether it was written.
   */
  write(wsId: string, issueId: string, entries: readonly TimelineEntry[], savedAt: number): boolean {
    const key = entryKey(wsId, issueId);
    const value: StoredEntry = { v: SCHEMA_VERSION, savedAt, entries: sanitizeTimeline(entries) };
    const json = JSON.stringify(value);
    const bytes = json.length * 2;
    if (bytes > MAX_ENTRY_BYTES) {
      this.drop(key);
      return false;
    }
    this.bump(key);
    this.kv.set(key, json);
    const lru = this.readLru().filter((i) => i.k !== key);
    lru.unshift({ k: key, at: this.now(), b: bytes });
    this.saveLru(this.evict(lru));
    return true;
  }

  /** Remove one issue's entry (403/404 on sync, issue deleted). */
  remove(wsId: string, issueId: string): void {
    this.drop(entryKey(wsId, issueId));
  }

  /** Remove every entry of a workspace. Returns how many were removed. */
  removeWorkspace(wsId: string): number {
    const prefix = `${ENTRY_PREFIX}${wsId}:`;
    const gone = this.entryKeys().filter((k) => k.startsWith(prefix));
    for (const k of gone) {
      this.bump(k);
      this.kv.remove(k);
    }
    if (gone.length > 0) {
      const set = new Set(gone);
      this.saveLru(this.readLru().filter((i) => !set.has(i.k)));
    }
    return gone.length;
  }

  /** Workspace ids that have at least one stored entry. */
  workspaceIds(): string[] {
    const ids = new Set<string>();
    for (const k of this.entryKeys()) {
      const rest = k.slice(ENTRY_PREFIX.length);
      const cut = rest.indexOf(":");
      if (cut > 0) ids.add(rest.slice(0, cut));
    }
    return [...ids];
  }

  /**
   * Change a stored timeline in place (WS delete/edit of a comment on
   * an issue that is not open). Keeps `savedAt`, so a patch never makes an
   * old entry look newer. `update` returns the new entries, or the same
   * array when nothing changed (then nothing is written). Returns whether
   * it wrote.
   */
  patch(
    wsId: string,
    issueId: string,
    update: (entries: TimelineEntry[]) => TimelineEntry[],
  ): boolean {
    const cached = this.read(wsId, issueId);
    if (!cached) return false;
    const next = update(cached.entries);
    if (next === cached.entries) return false;
    return this.write(wsId, issueId, next, cached.savedAt);
  }

  /** Keys of all stored timelines (tests, diagnostics without content). */
  entryKeys(): string[] {
    return this.kv.getAllKeys().filter((k) => k.startsWith(ENTRY_PREFIX));
  }

  private evict(lru: LruItem[]): LruItem[] {
    lru.sort((a, b) => b.at - a.at);
    const keep: LruItem[] = [];
    let total = 0;
    for (const item of lru) {
      if (keep.length < MAX_ENTRIES && total + item.b <= MAX_TOTAL_BYTES) {
        keep.push(item);
        total += item.b;
      } else {
        this.bump(item.k);
        this.kv.remove(item.k);
      }
    }
    // Entries the index does not know (index lost or broken) are dropped too.
    const known = new Set(keep.map((i) => i.k));
    for (const k of this.entryKeys()) {
      if (known.has(k)) continue;
      this.bump(k);
      this.kv.remove(k);
    }
    return keep;
  }

  private touch(key: string): void {
    const lru = this.readLru();
    const item = lru.find((i) => i.k === key);
    if (!item) return;
    item.at = this.now();
    this.saveLru(lru);
  }

  private drop(key: string): void {
    this.bump(key);
    this.kv.remove(key);
    this.saveLru(this.readLru().filter((i) => i.k !== key));
  }

  private readLru(): LruItem[] {
    const lru = this.readJson<LruItem[]>(LRU_KEY);
    if (!Array.isArray(lru)) return [];
    return lru.filter(
      (i) =>
        !!i && typeof i.k === "string" && typeof i.at === "number" && typeof i.b === "number",
    );
  }

  private saveLru(lru: LruItem[]): void {
    this.kv.set(LRU_KEY, JSON.stringify(lru));
  }

  private readJson<T>(key: string): T | null {
    const raw = this.kv.getString(key);
    if (raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}
