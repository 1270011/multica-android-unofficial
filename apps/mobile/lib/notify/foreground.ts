/**
 * Which issue's chat is on screen, for the native ping suppression.
 *
 * - `clear(id)` only clears when `id` is still the current one: going from
 *   chat A to chat B fires A's blur after B's focus, which must not wipe B.
 * - `pause()` (app in the background) tells native "nothing on screen" but
 *   remembers the chat; `resume()` (app active again) sends it back, since
 *   the chat's focus effect does not run again on returning to the app.
 */
export interface ForegroundNative {
  setForegroundIssue(id: string | null, dismiss: boolean): void;
}

export function createForegroundTracker(native: ForegroundNative) {
  let current: string | null = null;
  return {
    set(id: string, dismiss: boolean) {
      current = id;
      native.setForegroundIssue(id, dismiss);
    },
    clear(id: string) {
      if (current !== id) return;
      current = null;
      native.setForegroundIssue(null, false);
    },
    pause() {
      native.setForegroundIssue(null, false);
    },
    resume() {
      if (current) native.setForegroundIssue(current, false);
    },
    get current() {
      return current;
    },
  };
}
