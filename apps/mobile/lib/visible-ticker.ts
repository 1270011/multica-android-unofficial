/**
 * Wall-clock tick that only runs while a screen is visible: focused in the
 * navigator AND the app in the foreground. Used where
 * the runtime views re-derive "instabil → offline" every 30 s, without any
 * network polling — data refresh stays with focus, pull-to-refresh and the
 * realtime invalidation.
 *
 * Kept free of React / RN so the gating is unit-testable; the hook in
 * `lib/use-visible-tick.ts` feeds it `useIsFocused()` and AppState.
 */
export const VISIBLE_TICK_MS = 30_000;

export interface TimerApi {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

export interface VisibleTicker {
  setFocused: (focused: boolean) => void;
  setAppActive: (active: boolean) => void;
  isRunning: () => boolean;
  dispose: () => void;
}

export function createVisibleTicker(
  onTick: () => void,
  opts: { intervalMs?: number; timers?: TimerApi; focused?: boolean; appActive?: boolean } = {},
): VisibleTicker {
  const intervalMs = opts.intervalMs ?? VISIBLE_TICK_MS;
  const timers: TimerApi = opts.timers ?? {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  };
  let focused = opts.focused ?? false;
  let appActive = opts.appActive ?? true;
  let handle: unknown = null;
  let disposed = false;

  const sync = () => {
    const shouldRun = !disposed && focused && appActive;
    if (shouldRun && handle === null) {
      // Becoming visible again: the clock moved while hidden, recompute now
      // instead of showing a stale bucket for up to 30 s.
      onTick();
      handle = timers.setInterval(onTick, intervalMs);
    } else if (!shouldRun && handle !== null) {
      timers.clearInterval(handle);
      handle = null;
    }
  };

  sync();
  return {
    setFocused: (next) => {
      focused = next;
      sync();
    },
    setAppActive: (next) => {
      appActive = next;
      sync();
    },
    isRunning: () => handle !== null,
    dispose: () => {
      disposed = true;
      sync();
    },
  };
}
