/**
 * On-device timeline cache, runtime (rules C1–C7, C12,
 * C13). Storage rules are in ./core.ts; this file owns the session
 * lifecycle:
 *
 *   - C4  The MMKV key (32 random bytes, AES-256) lives in expo-secure-store
 *         and is read in parallel with the token at launch
 *         (`prefetchTimelineCacheKey`, auth-store). No plaintext fallback:
 *         a missing or unreadable key deletes the files and a new key is
 *         made, so the app starts without cache.
 *   - C5  The files live in noBackupFilesDir (./native.ts).
 *   - C6  `openTimelineCache` binds the store to server + user.
 *   - C7  `clearTimelineCache` (called by clearSessionData on logout, 401,
 *         server reset/change) is synchronous: it bumps a generation so no
 *         throttled write lands afterwards, empties the store and queues the
 *         key delete. The next session gets a new key.
 *
 * MMKV keeps one native instance per id + path for the whole process and
 * ignores a new `encryptionKey` when the same id is opened again.
 * So once a store was opened in this process it is never reopened or its
 * files deleted: a session end empties it (`clearAll`), the next session
 * re-encrypts the same instance with its new key (`rekeyStore`). Files are
 * deleted only while no instance is open (cold start without a key, broken
 * file).
 *   - C13 Nothing is hydrated at launch. The timeline query's queryFn reads
 *         the entry when an issue is opened (`readCachedTimelineInChunks`,
 *         schema check in short blocks) and shows it before the
 *         sync.
 *
 * Part 2:
 *   - C8  Workspace left or revoked: the workspace list no longer has it, or
 *         a workspace request answers "workspace not found" (404) or a
 *         workspace-wide list answers 403 → all entries of that wsId go.
 *   - C9  The timeline sync answers 403 or 404 → the entry goes and the
 *         query loses its data, so the chat shows the error, not old content.
 *   - C10 WS edits/deletes of comments patch the stored entry directly
 *         (`patchCachedTimeline` in use-issues-realtime), open issue or not.
 *         That is the only way they reach the device for an issue that has
 *         not synced in this process; the persister never writes such data
 *         back (see `startTimelinePersister`).
 *   - C11 The persister records each server answer (./sync.ts); the timeline
 *         query only skips its sync when the socket stayed up since then.
 *
 * Native modules are not imported here (vitest runs in Node); ./native.ts
 * registers the real backend at app start.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { TimelineEntry } from "@multica/core/types";
import {
  entryKey,
  shouldPersistQuery,
  TimelineCacheStore,
  type CacheBinding,
  type CachedTimeline,
  type KvStore,
} from "./core";
import {
  clearTimelineSync,
  dropTimelineFetchStart,
  forgetTimelineSync,
  forgetWorkspaceSync,
  lastTimelineSync,
  noteTimelineSynced,
} from "./sync";

export { shouldPersistQuery } from "./core";

export interface TimelineCacheBackend {
  /** Stored key or null; throws when the Keystore cannot be read. */
  readKey(): Promise<string | null>;
  writeKey(key: string): Promise<void>;
  deleteKey(): Promise<void>;
  /** A new key from 24 secure random bytes (32 base64url characters). */
  newKey(): string;
  /** Open the encrypted store with this key (once per process). */
  openStore(key: string): KvStore;
  /** Re-encrypt an already open store with a new key. */
  rekeyStore(store: KvStore, key: string): void;
  /** Delete the store's files. Only called while no store is open. */
  deleteFiles(): void;
  /** Base URL of the configured server (C6 binding). */
  serverOrigin(): string | null;
}

/** Time a burst of cache updates (WS events, optimistic edits) is merged. */
export const WRITE_DELAY_MS = 1000;

let backend: TimelineCacheBackend | null = null;
let generation = 0;
let store: TimelineCacheStore | null = null;
/** The native instance once opened; lives as long as the process. */
let openedKv: KvStore | null = null;
let keyPromise: Promise<string | null | undefined> | null = null;
const timers = new Map<string, { timer: ReturnType<typeof setTimeout>; wsId: string }>();
/** entryKey → length of a timeline that was too big to store. */
const oversized = new Map<string, number>();
/** Workspaces lost in this session; nothing of them is written again. */
const revokedWorkspaces = new Set<string>();
/** Ids of the last workspace list, applied when the store opens later. */
let knownWorkspaces: readonly string[] | null = null;

// Keystore operations run one after another, so a key delete queued by a
// logout can never be overtaken by the next session's key write.
let keyOps: Promise<unknown> = Promise.resolve();
function serializeKeyOp<T>(op: () => Promise<T>): Promise<T> {
  const result = keyOps.then(op, op);
  keyOps = result.catch(() => undefined);
  return result;
}

export function registerTimelineCacheBackend(next: TimelineCacheBackend | null): void {
  backend = next;
}

/** Base64url without padding; 24 bytes give 32 characters, 32 bytes 43. */
export function encodeKeyBytes(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.ceil(((Math.min(3, bytes.length - i)) * 8) / 6);
    for (let c = 0; c < chars; c++) out += alphabet[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

/**
 * MMKV's AES-256 takes at most 32 bytes of key string. The stored secret is
 * 24 random bytes as base64url, exactly 32 characters (192 bits). Older
 * secrets (32 bytes, 43 characters) are cut to their first 32.
 */
export function mmkvKeyFrom(secret: string): string {
  return secret.slice(0, 32);
}

export function normalizeServerOrigin(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Start reading the key. Called next to `getToken()` at launch so both
 * Keystore reads overlap. Never rejects: `undefined` = unreadable.
 */
export function prefetchTimelineCacheKey(): Promise<string | null | undefined> {
  if (!backend) return Promise.resolve(undefined);
  if (!keyPromise) {
    const b = backend;
    keyPromise = serializeKeyOp(() => b.readKey()).catch(() => undefined);
  }
  return keyPromise;
}

/**
 * Open the cache for a confirmed session of `userId` on the configured
 * server. Safe to call more than once; a logout while it runs wins
 * (generation check).
 */
export async function openTimelineCache(userId: string): Promise<void> {
  const b = backend;
  const origin = b?.serverOrigin();
  if (!b || !origin || !userId) return;
  const gen = generation;
  const normalized: CacheBinding = { serverOrigin: normalizeServerOrigin(origin), userId };
  if (store) {
    if (store.bind(normalized)) clearPendingWrites();
    return;
  }
  let secret = await prefetchTimelineCacheKey();
  if (gen !== generation) return;
  try {
    if (!secret) {
      // No key (first start, after a session end) or unreadable key —
      // whatever is on disk can't be trusted or read: delete it, new key.
      // An instance open in this process was emptied at the session end.
      if (openedKv) openedKv.clearAll();
      else b.deleteFiles();
      const fresh = b.newKey();
      await serializeKeyOp(() => b.writeKey(fresh));
      if (gen !== generation) return;
      secret = fresh;
      keyPromise = Promise.resolve(fresh);
    }
    const mmkvKey = mmkvKeyFrom(secret);
    let opened: KvStore;
    if (openedKv) {
      b.rekeyStore(openedKv, mmkvKey);
      opened = openedKv;
    } else {
      opened = b.openStore(mmkvKey);
      openedKv = opened;
    }
    if (gen !== generation) return;
    const next = new TimelineCacheStore(opened);
    next.bind(normalized);
    store = next;
    if (knownWorkspaces) pruneCachedWorkspaces(knownWorkspaces);
  } catch {
    // Wrong key, broken file: start without cache. No content in logs.
    try {
      if (openedKv) openedKv.clearAll();
      else b.deleteFiles();
    } catch {
      // nothing left to do
    }
    store = null;
  }
}

/** Read one issue's cached timeline when it is opened. */
export function readCachedTimeline(wsId: string | null, issueId: string): CachedTimeline | null {
  if (!store || !wsId || !issueId) return null;
  try {
    return store.read(wsId, issueId);
  } catch {
    return null;
  }
}

/**
 * C12/C13 without a long JS block: the same check as
 * `readCachedTimeline`, split into short blocks. Null when the session
 * ended, the store was reopened or the entry changed meanwhile.
 */
export async function readCachedTimelineInChunks(
  wsId: string | null,
  issueId: string,
  signal?: AbortSignal,
): Promise<CachedTimeline | null> {
  const s = store;
  if (!s || !wsId || !issueId) return null;
  const gen = generation;
  try {
    const cached = await s.readInChunks(wsId, issueId, { signal });
    return gen === generation && store === s ? cached : null;
  } catch {
    return null;
  }
}

export function writeCachedTimeline(
  wsId: string,
  issueId: string,
  entries: readonly TimelineEntry[],
  savedAt: number,
): void {
  if (!store || revokedWorkspaces.has(wsId)) return;
  const key = entryKey(wsId, issueId);
  // An entry that was too big is not serialized again on every WS
  // update while its timeline keeps that length or grows.
  const tooBig = oversized.get(key);
  if (tooBig !== undefined && entries.length >= tooBig) return;
  try {
    if (store.write(wsId, issueId, entries, savedAt)) oversized.delete(key);
    else oversized.set(key, entries.length);
  } catch {
    // Storage full or broken: the cache is an optimisation, skip.
  }
}

function clearPendingWrites(wsId?: string, hash?: string): void {
  for (const [h, t] of timers) {
    if (hash !== undefined && h !== hash) continue;
    if (wsId !== undefined && t.wsId !== wsId) continue;
    clearTimeout(t.timer);
    timers.delete(h);
  }
}

/** Drop one issue's entry (403/404 on sync, issue deleted). */
export function removeCachedTimeline(wsId: string, issueId: string): void {
  forgetTimelineSync(wsId, issueId);
  try {
    store?.remove(wsId, issueId);
  } catch {
    // broken store: nothing readable left to protect
  }
}

/** Drop every entry of a workspace and write none of it again. */
export function removeCachedWorkspace(wsId: string): void {
  revokedWorkspaces.add(wsId);
  clearPendingWrites(wsId);
  forgetWorkspaceSync(wsId);
  try {
    store?.removeWorkspace(wsId);
  } catch {
    // see removeCachedTimeline
  }
}

/** The workspace list arrived; entries of workspaces not in it go. */
export function pruneCachedWorkspaces(workspaceIds: readonly string[]): void {
  knownWorkspaces = workspaceIds;
  const keep = new Set(workspaceIds);
  for (const id of keep) revokedWorkspaces.delete(id);
  // Stored entries and pending writes (not on the device yet) alike.
  const present = new Set([...timers.values()].map((t) => t.wsId));
  try {
    for (const id of store?.workspaceIds() ?? []) present.add(id);
  } catch {
    // broken store: the pending writes are still dropped below
  }
  for (const id of present) if (!keep.has(id)) removeCachedWorkspace(id);
}

/**
 * Apply a WS edit/delete to the stored entry of an issue. `update`
 * returns the same array when it changes nothing. A pending persister
 * write of the in-memory query (open issue) still lands afterwards and
 * carries the same patch.
 */
export function patchCachedTimeline(
  wsId: string,
  issueId: string,
  update: (entries: TimelineEntry[]) => TimelineEntry[],
): void {
  if (!store) return;
  try {
    store.patch(wsId, issueId, update);
  } catch {
    // broken entry: read() already dropped it
  }
}

interface ErrorWithStatus {
  status?: unknown;
  body?: unknown;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as ErrorWithStatus | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/** The issue is gone or no longer readable for this user. */
export function isAccessLost(error: unknown): boolean {
  const status = statusOf(error);
  return status === 403 || status === 404;
}

/** The server says this user is no member of the request's workspace. */
export function isWorkspaceGone(error: unknown): boolean {
  if (statusOf(error) !== 404) return false;
  const body = (error as ErrorWithStatus).body;
  return (
    !!body &&
    typeof body === "object" &&
    (body as { error?: unknown }).error === "workspace not found"
  );
}

function isWorkspaceListKey(queryKey: readonly unknown[]): boolean {
  return (
    queryKey[0] === "issues" &&
    typeof queryKey[1] === "string" &&
    (queryKey[2] === "list" || queryKey[2] === "my")
  );
}

function workspaceIdsOf(data: unknown): string[] | null {
  if (!Array.isArray(data)) return null;
  const ids: string[] = [];
  for (const w of data) {
    const id = (w as { id?: unknown } | null)?.id;
    if (typeof id !== "string") return null;
    ids.push(id);
  }
  return ids;
}

/**
 * Synchronous wipe for every way a session ends. After it returns no
 * pending write can land and the store is empty; the key delete is queued
 * in the Keystore order. An instance open in this process keeps its files
 * (see the header), otherwise the files are deleted.
 */
export function clearTimelineCache(): void {
  generation += 1;
  clearPendingWrites();
  clearTimelineSync();
  revokedWorkspaces.clear();
  oversized.clear();
  knownWorkspaces = null;
  store = null;
  keyPromise = null;
  const b = backend;
  try {
    if (openedKv) openedKv.clearAll();
    else b?.deleteFiles();
  } catch {
    // key delete below makes leftovers unreadable (crypto-erase)
  }
  if (!b) return;
  void serializeKeyOp(() => b.deleteKey()).catch(() => undefined);
}

/**
 * Write timeline queries (and only those) to the device, throttled per
 * issue. Data that came from the device itself is not written back: a
 * timeline is persisted only once this process has a server answer for it
 * (`lastTimelineSync`, ./sync.ts), and it is stored with the time of that
 * answer as `savedAt`. Until then a WS update (`setQueryData`, `manual`) on
 * top of the cached state is not written back, so it cannot stretch the
 * 7-day limit. WS edits/deletes still reach the stored entry
 * of such an issue directly through `patchCachedTimeline`.
 *
 * The same subscription feeds C8 (workspace list, "workspace not found"),
 * C9 (403/404 on the timeline sync) and C11 (time of each server answer).
 * Returns the unsubscribe.
 */
export function startTimelinePersister(client: QueryClient): () => void {
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const { action, query } = event;
    const queryKey = query.queryKey;

    if (action.type === "error") {
      const error = action.error;
      if (shouldPersistQuery(queryKey)) {
        dropTimelineFetchStart(queryKey[1] as string, queryKey[3] as string);
      }
      const wsId = queryKey[0] === "issues" ? queryKey[1] : undefined;
      if (
        typeof wsId === "string" &&
        (isWorkspaceGone(error) || (isWorkspaceListKey(queryKey) && statusOf(error) === 403))
      ) {
        removeCachedWorkspace(wsId);
      }
      if (shouldPersistQuery(queryKey) && isAccessLost(error)) {
        clearPendingWrites(undefined, query.queryHash);
        removeCachedTimeline(queryKey[1] as string, queryKey[3] as string);
        // The chat must show the error, not the last known content.
        if (query.state.data !== undefined) query.setState({ data: undefined, dataUpdatedAt: 0 });
      }
      return;
    }

    if (action.type !== "success") return;

    if (queryKey.length === 1 && queryKey[0] === "workspaces" && !action.manual) {
      const ids = workspaceIdsOf(query.state.data);
      if (ids) pruneCachedWorkspaces(ids);
      return;
    }

    if (!shouldPersistQuery(queryKey)) return;
    const wsId = queryKey[1] as string;
    const issueId = queryKey[3] as string;
    // The cached timeline put in on open (`dataUpdatedAt` 0): it came from
    // the device, nothing to write back.
    if (action.manual && query.state.dataUpdatedAt === 0) return;
    if (!action.manual) {
      // A server answer, counted from the start of its fetch. A
      // server answer also proves access again.
      noteTimelineSynced(wsId, issueId, query.state.dataUpdatedAt);
      revokedWorkspaces.delete(wsId);
    }
    if (!store || lastTimelineSync(wsId, issueId) === undefined) return;
    const hash = query.queryHash;
    if (timers.has(hash)) return;
    const gen = generation;
    const timer = setTimeout(() => {
      timers.delete(hash);
      if (gen !== generation) return;
      const current = client.getQueryCache().get(hash);
      const data = current?.state.data;
      // The time of the server answer, not of the last WS patch. Gone when
      // the entry was removed meanwhile (C8/C9): then nothing is written.
      const savedAt = lastTimelineSync(wsId, issueId);
      if (!Array.isArray(data) || savedAt === undefined) return;
      writeCachedTimeline(wsId, issueId, data, savedAt);
    }, WRITE_DELAY_MS);
    timers.set(hash, { timer, wsId });
  });
  return () => {
    unsubscribe();
    clearPendingWrites();
  };
}

/** Tests only. */
export function __resetTimelineCacheForTests(): void {
  clearPendingWrites();
  backend = null;
  generation = 0;
  store = null;
  openedKv = null;
  keyPromise = null;
  keyOps = Promise.resolve();
  revokedWorkspaces.clear();
  oversized.clear();
  knownWorkspaces = null;
  clearTimelineSync();
}

/** Tests/diagnostics: is a store open right now. */
export function isTimelineCacheOpen(): boolean {
  return store !== null;
}
