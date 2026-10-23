/**
 * Is the realtime socket delivering events right now?
 *
 * Query options are plain objects built outside React, so they cannot call
 * `useWSClient()`. The presence realtime hook registers the live client here
 * while it is subscribed; `agentListOptions` reads it to drop its 30s poll
 * while events keep the cache fresh.
 *
 * "Live" = authenticated socket (`connectedSince() !== null`). Dialing,
 * backoff, paused (background) and no client at all count as not live, so
 * callers fall back to polling.
 */

type ConnectedSince = () => number | null;

let source: ConnectedSince | null = null;

/** Register the live socket. Returns the matching unregister. */
export function setSocketLivenessSource(next: ConnectedSince): () => void {
  source = next;
  return () => {
    if (source === next) source = null;
  };
}

export function isSocketLive(): boolean {
  return source?.() != null;
}

/** `connectedSince()` of the live socket, or null (see ws-client). Read by
 *  the timeline cache to decide whether opening an issue must sync. */
export function socketConnectedSince(): number | null {
  return source?.() ?? null;
}
