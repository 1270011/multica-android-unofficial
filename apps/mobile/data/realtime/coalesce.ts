/**
 * Bundle a burst of realtime events into one refetch.
 *
 * Fixed-window coalescing, not a trailing debounce: a steady event stream
 * (task:progress while an agent works) still runs `fn` at most once per
 * window, so the UI never lags more than `windowMs` behind the last event.
 */

/** Short enough that a finished agent run shows up "at once". */
export const EVENT_COALESCE_MS = 1000;

export interface Coalescer {
  /** Request a run. The first request opens a window of `windowMs`; every
   *  request inside it joins that one run at its end. */
  schedule(): void;
  /** Drop a pending run (unmount / unsubscribe). */
  cancel(): void;
}

export function coalesce(fn: () => void, windowMs = EVENT_COALESCE_MS): Coalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, windowMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
