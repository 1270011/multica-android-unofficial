/**
 * Marks an issue-chat open as coming from inside the app (narrow
 * read rule "T5"). Only such opens — and taps on the
 * app's own notification — mark the issue's inbox entries read. A deep link
 * from another app or a web page goes through the same route but never
 * passes here, so it only displays the chat and cannot clear the operator's
 * "action needed" entries behind their back.
 *
 * Process memory only: nothing is persisted or put into the URL, so the
 * marker cannot be forged from outside. Each marker is consumed once and
 * expires quickly in case the navigation never happened.
 */
const TTL_MS = 10_000;
const pending = new Map<string, number>();

export function markInAppChatOpen(issueId: string, now: number = Date.now()): void {
  pending.set(issueId, now);
}

/** True once per marked open, within the TTL. */
export function consumeInAppChatOpen(issueId: string, now: number = Date.now()): boolean {
  const at = pending.get(issueId);
  pending.delete(issueId);
  return at !== undefined && now - at <= TTL_MS;
}
