/**
 * Automatic resend of comments written offline.
 *
 * The connectivity banner promises "changes are sent when the connection is
 * back", but `useCreateComment` used to fire exactly once: TanStack resumed
 * the paused mutation on the first NetInfo "connected" event, the POST hit
 * the 30 s client timeout on the still-flaky link, and the row went straight
 * to "Retry". This module holds the pure rules the mutation now follows:
 *
 *   - transient failures (timeout, network error, 5xx, 408/429) are retried
 *     automatically with backoff; TanStack pauses each retry while
 *     `onlineManager` reports offline, so the next attempt waits for the
 *     network itself instead of burning a try.
 *   - real server answers (other 4xx) and a sign-out stop at once → "Retry".
 *   - no double send: once a POST may have reached the server (a timeout
 *     does not say it did not), every later attempt — automatic or the
 *     manual "Retry" — first looks for the comment in the issue timeline and
 *     takes that row instead of posting again.
 */
import type { Comment, TimelineEntry } from "@multica/core/types";

/** Automatic attempts after the first one. */
export const COMMENT_AUTO_RETRIES = 3;

/** Backoff between attempts (index = failures so far). */
export const COMMENT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000] as const;

/** Device and server clocks differ; look this far back for an earlier send. */
export const DELIVERY_CLOCK_SLACK_MS = 2 * 60 * 1000;

/** The session ended (logout, 401, account switch) while the comment was
 *  waiting — never send it under whoever is signed in now. */
export class CommentSessionEndedError extends Error {
  constructor() {
    super("Session ended before the comment was sent");
    this.name = "CommentSessionEndedError";
  }
}

/** True for failures a later attempt can fix on its own. */
export function isTransientSendError(err: unknown): boolean {
  if (err instanceof CommentSessionEndedError) return false;
  // `ApiError` from data/api.ts, matched by shape: importing the class would
  // pull the native fetch chain into this pure module.
  const status = (err as { status?: unknown } | null)?.status;
  if (err instanceof Error && typeof status === "number") {
    // Cloudflare Access blocks keep their status (often 200/302/403) and do
    // not heal by waiting.
    if (err.name === "AccessBlockedError") return false;
    // 0 = our own fetch timeout (data/api.ts).
    return status === 0 || status === 408 || status === 429 || status >= 500;
  }
  // fetch() rejects with a TypeError ("Network request failed") when the
  // link is down; anything else unknown is treated the same way.
  return true;
}

/** TanStack `retry` callback: `failureCount` is 0 after the first failure. */
export function shouldAutoResendComment(failureCount: number, err: unknown): boolean {
  return failureCount < COMMENT_AUTO_RETRIES && isTransientSendError(err);
}

/** TanStack `retryDelay` callback. */
export function commentResendDelay(failureCount: number): number {
  const last = COMMENT_RETRY_DELAYS_MS[COMMENT_RETRY_DELAYS_MS.length - 1];
  return COMMENT_RETRY_DELAYS_MS[failureCount] ?? last;
}

export interface DeliveryProbe {
  userId: string;
  content: string;
  parentId?: string | null;
  /** ISO time just before the first POST that may have reached the server. */
  since: string;
}

/**
 * The comment an earlier attempt already created, if any: same author, same
 * text and thread, created no earlier than the first send (minus clock
 * slack). The newest match wins.
 */
export function findDeliveredComment(
  timeline: TimelineEntry[] | undefined,
  probe: DeliveryProbe,
): TimelineEntry | null {
  if (!timeline) return null;
  const from = Date.parse(probe.since) - DELIVERY_CLOCK_SLACK_MS;
  const content = probe.content.trim();
  const parentId = probe.parentId ?? null;
  let found: TimelineEntry | null = null;
  for (const entry of timeline) {
    if (entry.type !== "comment") continue;
    if (entry.actor_type !== "member" || entry.actor_id !== probe.userId) continue;
    if ((entry.parent_id ?? null) !== parentId) continue;
    if ((entry.content ?? "").trim() !== content) continue;
    const created = Date.parse(entry.created_at);
    if (Number.isNaN(created) || created < from) continue;
    if (!found || entry.created_at > found.created_at) found = entry;
  }
  return found;
}

/** Per-submission state, kept across the attempts of one mutation. */
export interface CommentSendState {
  /** Session epoch when the user pressed send. */
  epoch: number;
  /** Set before the first POST; non-null = a POST may have landed. */
  since: string | null;
}

export interface CommentSendDeps {
  userId: string | null;
  post: () => Promise<Comment>;
  listTimeline: () => Promise<TimelineEntry[]>;
  sessionEpochChanged: (epoch: number) => boolean;
  now?: () => number;
}

/** What one attempt delivered: the new comment, or the row an earlier
 *  attempt had already created (then there is no POST response). */
export type CommentSendResult =
  | { kind: "posted"; comment: Comment }
  | { kind: "already-delivered"; entry: TimelineEntry };

/** One attempt; TanStack calls it again for each automatic retry. */
export async function sendCommentAttempt(
  content: string,
  parentId: string | undefined,
  state: CommentSendState,
  deps: CommentSendDeps,
): Promise<CommentSendResult> {
  if (deps.sessionEpochChanged(state.epoch)) throw new CommentSessionEndedError();
  if (state.since && deps.userId) {
    const entry = findDeliveredComment(await deps.listTimeline(), {
      userId: deps.userId,
      content,
      parentId,
      since: state.since,
    });
    if (deps.sessionEpochChanged(state.epoch)) throw new CommentSessionEndedError();
    if (entry) return { kind: "already-delivered", entry };
  }
  state.since ??= new Date((deps.now ?? Date.now)()).toISOString();
  return { kind: "posted", comment: await deps.post() };
}
